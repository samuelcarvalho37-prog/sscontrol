import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { AppError } from '../../core/errors/app-error.js';
import type { Database } from '../../infrastructure/database/database.js';
import {
  ObjectStorageError,
  type ObjectStorage,
  type StoredObjectReference,
} from '../../infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { GovernanceRepository, type GovernanceRow } from './governance.repository.js';
import type {
  DocumentFileInput,
  DocumentMetadataInput,
  DocumentStatus,
  GovernanceAuditMetadata,
} from './governance.types.js';

interface DocumentFilters {
  readonly search: string | null;
  readonly status: DocumentStatus | null;
  readonly documentType: string | null;
}

function error(code: string, message: string, statusCode: number, details?: unknown): AppError {
  return new AppError({ code, message, statusCode, details });
}

function text(row: GovernanceRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Campo ${key} ausente no contrato do banco.`);
  return value;
}

function nullableText(row: GovernanceRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return value;
}

function integer(row: GovernanceRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Campo ${key} inválido no contrato do banco.`);
  return value;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new Error('Data inválida no contrato do banco.');
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  throw new Error('Data inválida no contrato do banco.');
}

function displayStatus(status: string): DocumentStatus {
  const statuses: Readonly<Record<string, DocumentStatus>> = {
    DRAFT: 'RASCUNHO',
    IN_REVIEW: 'EM_REVISAO',
    ACTIVE: 'VIGENTE',
    EXPIRED: 'OBSOLETO',
    SUPERSEDED: 'OBSOLETO',
    ARCHIVED: 'OBSOLETO',
  };
  const result = statuses[status];
  if (!result) throw new Error(`Status documental desconhecido: ${status}.`);
  return result;
}

function documentSnapshot(row: GovernanceRow): Readonly<Record<string, unknown>> {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    document_type: row.document_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    status: row.status,
    current_revision: row.current_revision,
    valid_until: row.valid_until,
    responsible_id: row.responsible_id,
    description: row.description,
  };
}

function mapDocument(row: GovernanceRow) {
  const validUntil = dateOnly(row.valid_until);
  const expired = validUntil !== null && validUntil < new Date().toISOString().slice(0, 10);
  const status = displayStatus(text(row, 'status'));
  return {
    id: row.id,
    codigo: text(row, 'code'),
    titulo: text(row, 'title'),
    tipo: text(row, 'document_type'),
    entidade_tipo: nullableText(row, 'entity_type') ?? 'EMPRESA',
    entidade_id: nullableText(row, 'entity_id') ?? undefined,
    status,
    status_exibicao: expired && status === 'VIGENTE' ? 'VENCIDO' : status,
    revisao_atual: `R${integer(row, 'current_revision')}`,
    validade_em: validUntil ?? undefined,
    responsavel_id: nullableText(row, 'responsible_id') ?? undefined,
    descricao: nullableText(row, 'description') ?? undefined,
    arquivo_id: text(row, 'storage_object_id'),
    arquivo_nome: text(row, 'original_name'),
    mime_type: text(row, 'media_type'),
    tamanho_bytes: integer(row, 'byte_size'),
    vencido: expired,
    criado_por: text(row, 'created_by'),
    criado_em: iso(row.created_at),
    atualizado_em: iso(row.updated_at),
  };
}

function decodeFile(file: DocumentFileInput, maxBytes: number): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(file.encodedData);
  if (match?.[1] !== file.mediaType) {
    throw error(
      'DOCUMENT_ENCODING_INVALID',
      'O arquivo deve ser enviado em Base64 e seu tipo deve corresponder aos metadados.',
      400,
    );
  }
  const payload = match[2] ?? '';
  if (payload.length === 0 || payload.length % 4 !== 0) {
    throw error('DOCUMENT_ENCODING_INVALID', 'O conteúdo Base64 do documento é inválido.', 400);
  }
  const maximumEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (payload.length > maximumEncodedLength) {
    throw error('FILE_TOO_LARGE', `O documento excede o limite de ${maxBytes} bytes.`, 413);
  }
  const decoded = Buffer.from(payload, 'base64');
  if (decoded.length === 0 || decoded.length > maxBytes) {
    throw error('FILE_TOO_LARGE', `O documento excede o limite de ${maxBytes} bytes.`, 413);
  }
  return decoded;
}

function normalizeStorageError(cause: unknown): never {
  if (cause instanceof ObjectStorageError) {
    const statusCode = cause.code === 'FILE_TOO_LARGE' ? 413 : 422;
    throw error(cause.code, cause.message, statusCode);
  }
  throw cause;
}

export class GovernanceService {
  private readonly repository = new GovernanceRepository();

  constructor(
    private readonly database: Database,
    private readonly objectStorage: ObjectStorage,
  ) {}

  async listDocuments(user: AuthenticatedUser, filters: DocumentFilters) {
    const rows = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      (client) => this.repository.listDocuments(client),
    );
    const normalizedSearch = filters.search?.trim().toLocaleLowerCase('pt-BR') ?? null;
    const documents = rows.map(mapDocument).filter((document) => {
      if (filters.status && document.status !== filters.status) return false;
      if (filters.documentType && document.tipo !== filters.documentType) return false;
      if (
        normalizedSearch &&
        !`${document.codigo} ${document.titulo} ${document.arquivo_nome}`
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
    return { total: documents.length, documentos: documents };
  }

  async documentDetail(user: AuthenticatedUser, documentId: string) {
    return this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const documents = await this.repository.listDocuments(client);
        const current = documents.find((row) => row.id === documentId);
        if (!current) throw error('DOCUMENT_NOT_FOUND', 'Documento não encontrado.', 404);
        const revisions = await this.repository.listRevisions(client, documentId);
        return {
          documento: mapDocument(current),
          revisoes: revisions.map((revision) => ({
            id: revision.id,
            documento_id: text(revision, 'technical_document_id'),
            revisao: `R${integer(revision, 'revision')}`,
            arquivo_id: text(revision, 'storage_object_id'),
            arquivo_nome: text(revision, 'original_name'),
            mime_type: text(revision, 'media_type'),
            tamanho_bytes: integer(revision, 'byte_size'),
            observacao: nullableText(revision, 'observation') ?? undefined,
            criado_por: text(revision, 'created_by'),
            criado_em: iso(revision.created_at),
          })),
          arquivo_url: `/v1/admin/document-files/${text(current, 'storage_object_id')}`,
        };
      },
    );
  }

  async saveDocument(
    user: AuthenticatedUser,
    input: DocumentMetadataInput,
    file: DocumentFileInput,
    audit: GovernanceAuditMetadata,
  ) {
    const content = decodeFile(file, this.objectStorage.maxEvidenceBytes);
    let stored;
    try {
      stored = await this.objectStorage.storeDocument({
        tenantId: user.tenantId,
        originalName: file.originalName,
        mediaType: file.mediaType,
        stream: Readable.from([content]),
      });
    } catch (cause) {
      normalizeStorageError(cause);
    }

    const reference: StoredObjectReference = stored;
    try {
      const documentId = input.documentId ?? randomUUID();
      await this.database.withTransaction(
        { tenantId: user.tenantId, userId: user.id },
        async (client) => {
          await this.repository.insertStorageObject(client, user.tenantId, user.id, stored);
          const existing = input.documentId
            ? await this.repository.findDocument(client, input.documentId, true)
            : null;
          if (input.documentId && !existing) {
            throw error('DOCUMENT_NOT_FOUND', 'Documento não encontrado.', 404);
          }

          const revision = existing ? integer(existing, 'current_revision') + 1 : 1;
          const saved = existing
            ? await this.repository.updateDocument(client, documentId, input, revision)
            : await this.repository.createDocument(
                client,
                user.tenantId,
                user.id,
                documentId,
                input.code ?? `DOC-${randomUUID().slice(0, 8).toUpperCase()}`,
                input,
              );
          await this.repository.addRevision(
            client,
            user.tenantId,
            user.id,
            documentId,
            revision,
            stored,
            input.observation,
          );
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            existing ? 'ADMIN_DOCUMENT_REVISION_CREATED' : 'ADMIN_DOCUMENT_CREATED',
            documentId,
            existing ? documentSnapshot(existing) : null,
            { ...documentSnapshot(saved), storage_object_id: stored.id },
          );
        },
      );
      const detail = await this.documentDetail(user, documentId);
      return { saved: true, documento: detail.documento };
    } catch (cause) {
      await this.objectStorage.remove(reference).catch(() => undefined);
      throw cause;
    }
  }

  async updateDocument(
    user: AuthenticatedUser,
    documentId: string,
    input: DocumentMetadataInput,
    audit: GovernanceAuditMetadata,
  ) {
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id },
      async (client) => {
        const existing = await this.repository.findDocument(client, documentId, true);
        if (!existing) throw error('DOCUMENT_NOT_FOUND', 'Documento não encontrado.', 404);
        const saved = await this.repository.updateDocument(client, documentId, input);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'ADMIN_DOCUMENT_UPDATED',
          documentId,
          documentSnapshot(existing),
          documentSnapshot(saved),
        );
      },
    );
    const detail = await this.documentDetail(user, documentId);
    return { saved: true, documento: detail.documento };
  }

  async openDocumentFile(user: AuthenticatedUser, objectId: string) {
    const object = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      async (client) => {
        const found = await this.repository.findDocumentFile(client, objectId);
        if (!found) throw error('DOCUMENT_FILE_NOT_FOUND', 'Arquivo não encontrado.', 404);
        return found;
      },
    );
    const reference: StoredObjectReference = {
      provider: text(object, 'provider'),
      bucket: text(object, 'bucket'),
      objectKey: text(object, 'object_key'),
    };
    try {
      return {
        stream: this.objectStorage.open(reference),
        originalName: text(object, 'original_name'),
        mediaType: text(object, 'media_type'),
        byteSize: integer(object, 'byte_size'),
        checksumSha256: text(object, 'checksum_sha256'),
      };
    } catch (cause) {
      throw error(
        'DOCUMENT_FILE_UNAVAILABLE',
        'O arquivo não está disponível no armazenamento privado.',
        503,
        cause instanceof Error ? { reason: cause.message } : undefined,
      );
    }
  }
}
