import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';

import { AppError } from '../../core/errors/app-error.js';
import type { Environment } from '../../config/environment.js';
import type { Database } from '../../infrastructure/database/database.js';
import type {
  ObjectStorage,
  StoredObjectReference,
} from '../../infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BACKUP_FORMAT, backupTables, protectedBackupDomains } from './backup-catalog.js';
import {
  BackupRepository,
  type BackupRow,
  type BackupTableData,
} from './backup.repository.js';
import type { GovernanceAuditMetadata } from './governance.types.js';

interface BackupPayload {
  readonly format: typeof BACKUP_FORMAT;
  readonly tenant_id: string;
  readonly created_at: string;
  readonly schema_version: string;
  readonly tables: BackupTableData;
}

interface RestoreClaims {
  readonly backup_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly challenge: string;
  readonly expires_at: string;
  readonly nonce: string;
}

function error(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return '';
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function streamChunk(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw error('BACKUP_FILE_INVALID', 'O arquivo contém um bloco inválido.', 422);
}

function countCells(tables: BackupTableData): number {
  return Object.values(tables).reduce(
    (total, rows) =>
      total + rows.reduce((rowTotal, row) => rowTotal + Object.keys(row).length, 0),
    0,
  );
}

export class BackupService {
  private readonly repository = new BackupRepository();

  constructor(
    private readonly database: Database,
    private readonly storage: ObjectStorage,
    private readonly environment: Environment,
  ) {}

  async list(user: AuthenticatedUser, limit: number) {
    const rows = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      (client) => this.repository.list(client, limit),
    );
    return {
      total: rows.length,
      backups: rows.map((row) => this.mapBackup(row)),
      pasta_id: 'armazenamento-privado',
      restauracao_disponivel: true,
      escopo_restauracao: 'OPERACIONAL_SEGURO',
      abas_protegidas: protectedBackupDomains,
    };
  }

  async create(
    user: AuthenticatedUser,
    reason: string,
    confirmation: string,
    audit: GovernanceAuditMetadata,
    backupType = 'MANUAL',
  ) {
    if (confirmation !== 'CRIAR BACKUP') {
      throw error('BACKUP_CONFIRMATION_INVALID', 'Confirme a criação do backup.', 400);
    }
    if (reason.trim().length < 8) {
      throw error('BACKUP_REASON_REQUIRED', 'Informe um motivo com ao menos 8 caracteres.', 400);
    }
    const id = randomUUID();
    const tables = await this.database.withTransaction<BackupTableData>(
      { tenantId: user.tenantId, userId: user.id, isolationLevel: 'repeatable read' },
      async (client) => {
        await this.repository.createRequested(
          client,
          id,
          user.tenantId,
          user.id,
          reason.trim(),
          backupType,
        );
        return this.repository.exportTenant(client);
      },
    );
    const createdAt = new Date().toISOString();
    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      tenant_id: user.tenantId,
      created_at: createdAt,
      schema_version: this.environment.release.schema,
      tables,
    };
    const content = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
    let stored: Awaited<ReturnType<ObjectStorage['storeBackup']>> | null = null;
    try {
      stored = await this.storage.storeBackup({
        tenantId: user.tenantId,
        originalName: `fab-control-${createdAt.replaceAll(/[:.]/gu, '-')}.json.gz`,
        stream: Readable.from(content),
      });
      const manifest = {
        formato: BACKUP_FORMAT,
        schema_version: payload.schema_version,
        tabelas: Object.fromEntries(
          backupTables.map((table) => [table.name, tables[table.name]?.length ?? 0]),
        ),
        total_registros: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0),
        total_celulas: countCells(tables),
        criado_em: createdAt,
      };
      await this.database.withTransaction(
        { tenantId: user.tenantId, userId: user.id },
        async (client) => {
          if (!stored) throw new Error('Objeto de backup ausente após armazenamento.');
          await this.repository.complete(client, id, user.tenantId, user.id, stored, manifest);
          await this.repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'ADMIN_BACKUP_CREATED',
            id,
            { motivo: reason.trim(), checksum_sha256: stored.checksumSha256, ...manifest },
          );
        },
      );
    } catch (cause) {
      if (stored) await this.storage.remove(stored).catch(() => undefined);
      await this.database
        .withTransaction({ tenantId: user.tenantId, userId: user.id }, (client) =>
          this.repository.fail(
            client,
            id,
            cause instanceof Error ? cause.message : 'Falha desconhecida no backup.',
          ),
        )
        .catch(() => undefined);
      throw cause;
    }
    const row = await this.find(user, id);
    return { created: true, backup: this.mapBackup(row), restauracao_disponivel: true };
  }

  async prepare(user: AuthenticatedUser, backupId: string) {
    const backup = await this.find(user, backupId);
    const payload = await this.readPayload(user, backup);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const challenge = `RESTAURAR-${optionalText(backup.checksum_sha256).slice(0, 8).toUpperCase()}`;
    const claims: RestoreClaims = {
      backup_id: backupId,
      tenant_id: user.tenantId,
      user_id: user.id,
      challenge,
      expires_at: expiresAt,
      nonce: randomBytes(18).toString('base64url'),
    };
    const token = this.sign(claims);
    const present = new Set(Object.keys(payload.tables));
    return {
      prepared: true,
      token,
      desafio: challenge,
      confirmacao_final: 'RESTAURAR BACKUP',
      backup: {
        id: backup.id,
        nome: optionalText(backup.original_name),
        criado_em: dateText(backup.requested_at),
      },
      escopo: 'OPERACIONAL_SEGURO',
      abas_restauradas: backupTables.map((table) => table.name),
      abas_protegidas: protectedBackupDomains,
      abas_ausentes: backupTables.map((table) => table.name).filter((name) => !present.has(name)),
      total_celulas: countCells(payload.tables),
      expira_em: expiresAt,
    };
  }

  async openFile(user: AuthenticatedUser, backupId: string) {
    const row = await this.find(user, backupId);
    const reference: StoredObjectReference = {
      provider: optionalText(row.provider),
      bucket: optionalText(row.bucket),
      objectKey: optionalText(row.object_key),
    };
    return {
      stream: this.storage.open(reference),
      fileName: optionalText(row.original_name) || `backup-${row.id}.json.gz`,
      byteSize: Number(row.byte_size ?? 0),
    };
  }

  async restore(
    user: AuthenticatedUser,
    input: {
      readonly token: string;
      readonly backupId: string;
      readonly challenge: string;
      readonly finalConfirmation: string;
      readonly reason: string;
      readonly createSafetyBackup: boolean;
    },
    audit: GovernanceAuditMetadata,
  ) {
    const claims = this.verify(input.token);
    if (
      claims.backup_id !== input.backupId ||
      claims.tenant_id !== user.tenantId ||
      claims.user_id !== user.id ||
      claims.challenge !== input.challenge.trim().toUpperCase()
    ) {
      throw error('BACKUP_RESTORE_TOKEN_INVALID', 'A autorização da restauração não confere.', 403);
    }
    if (new Date(claims.expires_at).getTime() <= Date.now()) {
      throw error('BACKUP_RESTORE_TOKEN_EXPIRED', 'A autorização da restauração expirou.', 403);
    }
    if (input.finalConfirmation.trim().toUpperCase() !== 'RESTAURAR BACKUP') {
      throw error('BACKUP_RESTORE_CONFIRMATION_INVALID', 'A confirmação final não confere.', 400);
    }
    if (!input.createSafetyBackup) {
      throw error('BACKUP_SAFETY_COPY_REQUIRED', 'O backup de segurança é obrigatório.', 400);
    }
    if (input.reason.trim().length < 8) {
      throw error('BACKUP_RESTORE_REASON_REQUIRED', 'Informe o motivo da restauração.', 400);
    }

    const target = await this.find(user, input.backupId);
    const payload = await this.readPayload(user, target);
    const safety = await this.create(
      user,
      `Segurança anterior à restauração: ${input.reason.trim()}`,
      'CRIAR BACKUP',
      audit,
      'PRE_RESTORE_SAFETY',
    );
    await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, isolationLevel: 'serializable' },
      async (client) => {
        await this.repository.restoreTenant(client, payload.tables);
        await this.repository.writeAudit(
          client,
          user.tenantId,
          user.id,
          audit,
          'ADMIN_BACKUP_RESTORED',
          input.backupId,
          { motivo: input.reason.trim(), backup_seguranca_id: safety.backup.id },
        );
      },
    );
    return {
      restored: true,
      backup_id: input.backupId,
      backup_nome: optionalText(target.original_name),
      escopo: 'OPERACIONAL_SEGURO',
      abas_restauradas: backupTables.map((table) => table.name),
      abas_protegidas: protectedBackupDomains,
      backup_seguranca: safety.backup,
      motivo: input.reason.trim(),
      restaurado_em: new Date().toISOString(),
    };
  }

  private async find(user: AuthenticatedUser, backupId: string): Promise<BackupRow> {
    const row = await this.database.withTransaction(
      { tenantId: user.tenantId, userId: user.id, readOnly: true },
      (client) => this.repository.find(client, backupId),
    );
    if (row?.status !== 'VERIFIED') {
      throw error('BACKUP_NOT_FOUND', 'Backup verificado não encontrado.', 404);
    }
    return row;
  }

  private async readPayload(user: AuthenticatedUser, row: BackupRow): Promise<BackupPayload> {
    const reference: StoredObjectReference = {
      provider: optionalText(row.provider),
      bucket: optionalText(row.bucket),
      objectKey: optionalText(row.object_key),
    };
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of this.storage.open(reference)) {
      const buffer = streamChunk(chunk);
      size += buffer.length;
      if (size > this.storage.maxBackupBytes) {
        throw error('BACKUP_FILE_TOO_LARGE', 'O arquivo excede o limite seguro.', 413);
      }
      chunks.push(buffer);
    }
    const compressed = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(compressed).digest('hex');
    if (checksum !== optionalText(row.checksum_sha256)) {
      throw error('BACKUP_CHECKSUM_INVALID', 'A integridade do arquivo de backup não confere.', 422);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        gunzipSync(compressed, { maxOutputLength: this.storage.maxBackupBytes * 10 }).toString(
          'utf8',
        ),
      ) as unknown;
    } catch {
      throw error('BACKUP_FILE_INVALID', 'O arquivo de backup está corrompido.', 422);
    }
    const object = jsonObject(parsed);
    if (
      object.format !== BACKUP_FORMAT ||
      object.tenant_id !== user.tenantId ||
      object.schema_version !== this.environment.release.schema ||
      !object.tables ||
      typeof object.tables !== 'object' ||
      Array.isArray(object.tables)
    ) {
      throw error('BACKUP_MANIFEST_INVALID', 'O manifesto não pertence a esta empresa.', 422);
    }
    const tables = object.tables as BackupTableData;
    for (const descriptor of backupTables) {
      const rows = tables[descriptor.name];
      if (!Array.isArray(rows)) {
        throw error('BACKUP_TABLE_MISSING', `A tabela ${descriptor.name} está ausente.`, 422);
      }
      for (const value of rows) {
        if (jsonObject(value).tenant_id !== user.tenantId) {
          throw error('BACKUP_TENANT_MISMATCH', 'O backup mistura dados de empresas distintas.', 422);
        }
      }
    }
    return {
      format: BACKUP_FORMAT,
      tenant_id: user.tenantId,
      created_at: optionalText(object.created_at),
      schema_version: optionalText(object.schema_version),
      tables,
    };
  }

  private sign(claims: RestoreClaims): string {
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.environment.auth.recoveryHmacSecret)
      .update(payload, 'utf8')
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private verify(token: string): RestoreClaims {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) {
      throw error('BACKUP_RESTORE_TOKEN_INVALID', 'A autorização é inválida.', 403);
    }
    const expected = createHmac('sha256', this.environment.auth.recoveryHmacSecret)
      .update(payload, 'utf8')
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedSignature, 'base64url');
    } catch {
      throw error('BACKUP_RESTORE_TOKEN_INVALID', 'A assinatura é inválida.', 403);
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw error('BACKUP_RESTORE_TOKEN_INVALID', 'A assinatura é inválida.', 403);
    }
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RestoreClaims;
    } catch {
      throw error('BACKUP_RESTORE_TOKEN_INVALID', 'O conteúdo da autorização é inválido.', 403);
    }
  }

  private mapBackup(row: BackupRow) {
    const manifest = jsonObject(row.manifest);
    return {
      id: row.id,
      nome: optionalText(row.original_name) || `Backup ${row.id}`,
      tamanho_bytes: Number(row.byte_size ?? 0),
      criado_em: dateText(row.requested_at),
      atualizado_em: dateText(row.verified_at),
      url: `/v1/admin/backups/${row.id}/file`,
      pasta_id: 'armazenamento-privado',
      checksum_sha256: optionalText(row.checksum_sha256),
      total_registros: Number(manifest.total_registros ?? 0),
    };
  }
}
