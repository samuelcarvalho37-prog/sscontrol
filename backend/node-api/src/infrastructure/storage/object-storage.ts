import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const LOCAL_PROVIDER = 'LOCAL_PRIVATE';
const EVIDENCE_BUCKET = 'maintenance-evidence';
const DOCUMENT_BUCKET = 'governed-documents';
const BACKUP_BUCKET = 'tenant-backups';
const HEADER_BYTES = 16;

const mediaTypes = {
  'image/jpeg': { extension: 'jpg', evidenceType: 'PHOTO' },
  'image/png': { extension: 'png', evidenceType: 'PHOTO' },
  'image/webp': { extension: 'webp', evidenceType: 'PHOTO' },
} as const;

export type AcceptedEvidenceMediaType = keyof typeof mediaTypes;

export interface StoredObject {
  readonly id: string;
  readonly provider: typeof LOCAL_PROVIDER;
  readonly bucket: typeof EVIDENCE_BUCKET;
  readonly objectKey: string;
  readonly originalName: string;
  readonly mediaType: AcceptedEvidenceMediaType;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly evidenceType: 'PHOTO';
}

export interface StoredDocumentObject {
  readonly id: string;
  readonly provider: typeof LOCAL_PROVIDER;
  readonly bucket: typeof DOCUMENT_BUCKET;
  readonly objectKey: string;
  readonly originalName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
}

export interface StoredBackupObject {
  readonly id: string;
  readonly provider: typeof LOCAL_PROVIDER;
  readonly bucket: typeof BACKUP_BUCKET;
  readonly objectKey: string;
  readonly originalName: string;
  readonly mediaType: 'application/gzip';
  readonly byteSize: number;
  readonly checksumSha256: string;
}

export interface StoredObjectReference {
  readonly provider: string;
  readonly bucket: string;
  readonly objectKey: string;
}

export class ObjectStorageError extends Error {
  constructor(
    readonly code: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_CONTENT_INVALID' | 'FILE_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
  }
}

export interface ObjectStorage {
  readonly maxEvidenceBytes: number;
  readonly maxBackupBytes: number;
  storeEvidence(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly mediaType: string;
    readonly stream: Readable;
  }): Promise<StoredObject>;
  storeDocument(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly mediaType: string;
    readonly stream: Readable;
  }): Promise<StoredDocumentObject>;
  storeBackup(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly stream: Readable;
  }): Promise<StoredBackupObject>;
  open(reference: StoredObjectReference): ReadStream;
  remove(reference: StoredObjectReference): Promise<void>;
}

const documentMediaTypes = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['text/csv', 'csv'],
]);

function acceptedMediaType(value: string): AcceptedEvidenceMediaType {
  if (Object.hasOwn(mediaTypes, value)) return value as AcceptedEvidenceMediaType;
  throw new ObjectStorageError('FILE_TYPE_NOT_ALLOWED', 'Envie uma foto JPEG, PNG ou WebP.');
}

function sanitizedOriginalName(value: string): string {
  const printable = basename(value.normalize('NFKC')).replaceAll(/\p{Cc}/gu, '');
  const normalized = printable.replaceAll(/\s+/gu, ' ').trim();
  return (normalized || 'evidencia').slice(0, 180);
}

function validMagicBytes(mediaType: AcceptedEvidenceMediaType, header: Buffer): boolean {
  if (mediaType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mediaType === 'image/png') {
    return (
      header.length >= 8 &&
      header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function validDocumentMagicBytes(mediaType: string, header: Buffer): boolean {
  if (mediaType === 'application/pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'image/jpeg' || mediaType === 'image/png') {
    return validMagicBytes(mediaType, header);
  }
  if (mediaType === 'application/msword' || mediaType === 'application/vnd.ms-excel') {
    return header
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mediaType.includes('openxmlformats-officedocument')) {
    return (
      header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    );
  }
  return mediaType === 'text/csv' && !header.includes(0);
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    root: string,
    readonly maxEvidenceBytes: number,
    readonly maxBackupBytes = 52_428_800,
  ) {
    this.root = resolve(root);
  }

  private pathFor(reference: StoredObjectReference): string {
    if (
      reference.provider !== LOCAL_PROVIDER ||
      ![EVIDENCE_BUCKET, DOCUMENT_BUCKET, BACKUP_BUCKET].includes(reference.bucket)
    ) {
      throw new Error('O objeto não pertence ao armazenamento privado local.');
    }
    if (isAbsolute(reference.objectKey)) throw new Error('Chave de armazenamento inválida.');

    const bucketRoot = resolve(this.root, reference.bucket);
    const target = resolve(bucketRoot, reference.objectKey);
    if (target !== bucketRoot && !target.startsWith(`${bucketRoot}${sep}`)) {
      throw new Error('Chave de armazenamento fora do diretório privado.');
    }
    return target;
  }

  async storeEvidence(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly mediaType: string;
    readonly stream: Readable;
  }): Promise<StoredObject> {
    const mediaType = acceptedMediaType(input.mediaType);
    const now = new Date();
    const id = randomUUID();
    const extension = mediaTypes[mediaType].extension;
    const objectKey = [
      input.tenantId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.${extension}`,
    ].join('/');
    const reference = { provider: LOCAL_PROVIDER, bucket: EVIDENCE_BUCKET, objectKey } as const;
    const target = this.pathFor(reference);
    const temporary = `${target}.${randomUUID()}.uploading`;
    const hash = createHash('sha256');
    let byteSize = 0;
    let header = Buffer.alloc(0);

    const inspector = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        byteSize += chunk.length;
        if (byteSize > this.maxEvidenceBytes) {
          callback(
            new ObjectStorageError(
              'FILE_TOO_LARGE',
              `A evidência excede o limite de ${this.maxEvidenceBytes} bytes.`,
            ),
          );
          return;
        }
        hash.update(chunk);
        if (header.length < HEADER_BYTES) {
          header = Buffer.concat([header, chunk.subarray(0, HEADER_BYTES - header.length)]);
        }
        callback(null, chunk);
      },
    });

    await mkdir(dirname(target), { recursive: true });
    try {
      await pipeline(
        input.stream,
        inspector,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (byteSize === 0 || !validMagicBytes(mediaType, header)) {
        throw new ObjectStorageError(
          'FILE_CONTENT_INVALID',
          'O conteúdo do arquivo não corresponde ao formato de imagem informado.',
        );
      }
      await rename(temporary, target);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }

    return {
      id,
      ...reference,
      originalName: sanitizedOriginalName(input.originalName),
      mediaType,
      byteSize,
      checksumSha256: hash.digest('hex'),
      evidenceType: mediaTypes[mediaType].evidenceType,
    };
  }

  async storeDocument(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly mediaType: string;
    readonly stream: Readable;
  }): Promise<StoredDocumentObject> {
    const extension = documentMediaTypes.get(input.mediaType);
    if (!extension) {
      throw new ObjectStorageError(
        'FILE_TYPE_NOT_ALLOWED',
        'Envie um arquivo PDF, imagem, documento do Office ou CSV.',
      );
    }

    const now = new Date();
    const id = randomUUID();
    const objectKey = [
      input.tenantId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.${extension}`,
    ].join('/');
    const reference = { provider: LOCAL_PROVIDER, bucket: DOCUMENT_BUCKET, objectKey } as const;
    const target = this.pathFor(reference);
    const temporary = `${target}.${randomUUID()}.uploading`;
    const hash = createHash('sha256');
    let byteSize = 0;
    let header = Buffer.alloc(0);

    const inspector = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        byteSize += chunk.length;
        if (byteSize > this.maxEvidenceBytes) {
          callback(
            new ObjectStorageError(
              'FILE_TOO_LARGE',
              `O documento excede o limite de ${this.maxEvidenceBytes} bytes.`,
            ),
          );
          return;
        }
        hash.update(chunk);
        if (header.length < HEADER_BYTES) {
          header = Buffer.concat([header, chunk.subarray(0, HEADER_BYTES - header.length)]);
        }
        callback(null, chunk);
      },
    });

    await mkdir(dirname(target), { recursive: true });
    try {
      await pipeline(
        input.stream,
        inspector,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (byteSize === 0 || !validDocumentMagicBytes(input.mediaType, header)) {
        throw new ObjectStorageError(
          'FILE_CONTENT_INVALID',
          'O conteúdo do arquivo não corresponde ao formato informado.',
        );
      }
      await rename(temporary, target);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }

    return {
      id,
      ...reference,
      originalName: sanitizedOriginalName(input.originalName),
      mediaType: input.mediaType,
      byteSize,
      checksumSha256: hash.digest('hex'),
    };
  }

  async storeBackup(input: {
    readonly tenantId: string;
    readonly originalName: string;
    readonly stream: Readable;
  }): Promise<StoredBackupObject> {
    const now = new Date();
    const id = randomUUID();
    const objectKey = [
      input.tenantId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.json.gz`,
    ].join('/');
    const reference = { provider: LOCAL_PROVIDER, bucket: BACKUP_BUCKET, objectKey } as const;
    const target = this.pathFor(reference);
    const temporary = `${target}.${randomUUID()}.uploading`;
    const hash = createHash('sha256');
    let byteSize = 0;
    let header = Buffer.alloc(0);
    const inspector = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        byteSize += chunk.length;
        if (byteSize > this.maxBackupBytes) {
          callback(
            new ObjectStorageError(
              'FILE_TOO_LARGE',
              `O backup excede o limite de ${this.maxBackupBytes} bytes compactados.`,
            ),
          );
          return;
        }
        hash.update(chunk);
        if (header.length < 2) header = Buffer.concat([header, chunk.subarray(0, 2 - header.length)]);
        callback(null, chunk);
      },
    });

    await mkdir(dirname(target), { recursive: true });
    try {
      await pipeline(
        input.stream,
        inspector,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (byteSize === 0 || header[0] !== 0x1f || header[1] !== 0x8b) {
        throw new ObjectStorageError('FILE_CONTENT_INVALID', 'O conteúdo não é um backup GZIP válido.');
      }
      await rename(temporary, target);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }

    return {
      id,
      ...reference,
      originalName: sanitizedOriginalName(input.originalName),
      mediaType: 'application/gzip',
      byteSize,
      checksumSha256: hash.digest('hex'),
    };
  }

  open(reference: StoredObjectReference): ReadStream {
    return createReadStream(this.pathFor(reference));
  }

  async remove(reference: StoredObjectReference): Promise<void> {
    await rm(this.pathFor(reference), { force: true });
  }
}
