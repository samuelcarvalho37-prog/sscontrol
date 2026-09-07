import type { PoolClient, QueryResultRow } from 'pg';

import type { StoredBackupObject } from '../../infrastructure/storage/object-storage.js';
import { backupTables } from './backup-catalog.js';
import type { GovernanceAuditMetadata } from './governance.types.js';

export interface BackupRow extends QueryResultRow {
  readonly id: string;
  readonly [key: string]: unknown;
}

export type BackupTableData = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;

export class BackupRepository {
  async exportTenant(client: PoolClient): Promise<BackupTableData> {
    const result: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
    for (const descriptor of backupTables) {
      const query = await client.query<{ row: Readonly<Record<string, unknown>> } & QueryResultRow>(
        `SELECT to_jsonb(source.*) AS row FROM ${descriptor.name} source
         WHERE source.tenant_id=current_setting('app.tenant_id')::uuid`,
      );
      result[descriptor.name] = query.rows.map((item) => item.row);
    }
    return result;
  }

  async restoreTenant(client: PoolClient, tables: BackupTableData): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(current_setting('app.tenant_id'), 12082026))`,
    );
    for (const descriptor of [...backupTables].reverse()) {
      await client.query(
        `DELETE FROM ${descriptor.name} WHERE tenant_id=current_setting('app.tenant_id')::uuid`,
      );
    }
    for (const descriptor of backupTables) {
      const rows = tables[descriptor.name] ?? [];
      if (rows.length === 0) continue;
      await client.query(
        `INSERT INTO ${descriptor.name}
         SELECT restored.* FROM jsonb_populate_recordset(NULL::${descriptor.name}, $1::jsonb) restored`,
        [JSON.stringify(rows)],
      );
    }
  }

  async list(client: PoolClient, limit: number): Promise<readonly BackupRow[]> {
    const result = await client.query<BackupRow>(
      `SELECT backup.*,storage.original_name,storage.byte_size,storage.provider,storage.bucket,
              storage.object_key,storage.created_at AS storage_created_at
       FROM governance.backup_snapshots backup
       LEFT JOIN platform.storage_objects storage ON storage.id=backup.storage_object_id
       WHERE backup.status IN ('COMPLETED','VERIFIED')
       ORDER BY backup.requested_at DESC,backup.id LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async find(client: PoolClient, backupId: string): Promise<BackupRow | null> {
    const result = await client.query<BackupRow>(
      `SELECT backup.*,storage.original_name,storage.byte_size,storage.provider,storage.bucket,
              storage.object_key,storage.media_type,storage.checksum_sha256 AS object_checksum
       FROM governance.backup_snapshots backup
       LEFT JOIN platform.storage_objects storage ON storage.id=backup.storage_object_id
       WHERE backup.id=$1`,
      [backupId],
    );
    return result.rows[0] ?? null;
  }

  async createRequested(
    client: PoolClient,
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
    backupType: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO governance.backup_snapshots
       (id,tenant_id,backup_type,status,reason,requested_by)
       VALUES ($1,$2,$3,'RUNNING',$4,$5)`,
      [id, tenantId, backupType, reason, userId],
    );
  }

  async complete(
    client: PoolClient,
    backupId: string,
    tenantId: string,
    userId: string,
    object: StoredBackupObject,
    manifest: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform.storage_objects
       (id,tenant_id,provider,bucket,object_key,original_name,media_type,byte_size,
        checksum_sha256,status,metadata,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AVAILABLE',$10,$11)`,
      [
        object.id,
        tenantId,
        object.provider,
        object.bucket,
        object.objectKey,
        object.originalName,
        object.mediaType,
        object.byteSize,
        object.checksumSha256,
        JSON.stringify({ purpose: 'TENANT_BACKUP', backup_id: backupId }),
        userId,
      ],
    );
    await client.query(
      `UPDATE governance.backup_snapshots
       SET status='VERIFIED',storage_object_id=$2,manifest=$3,checksum_sha256=$4,
           confirmed_by=$5,completed_at=clock_timestamp(),verified_at=clock_timestamp()
       WHERE id=$1`,
      [backupId, object.id, JSON.stringify(manifest), object.checksumSha256, userId],
    );
  }

  async fail(client: PoolClient, backupId: string, message: string): Promise<void> {
    await client.query(
      `UPDATE governance.backup_snapshots SET status='FAILED',manifest=$2,
       completed_at=clock_timestamp() WHERE id=$1`,
      [backupId, JSON.stringify({ erro: message.slice(0, 1_000) })],
    );
  }

  async writeAudit(
    client: PoolClient,
    tenantId: string,
    userId: string,
    audit: GovernanceAuditMetadata,
    action: string,
    entityId: string,
    details: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.events
       (tenant_id,user_id,role_snapshot,action,entity_type,entity_id,after_data,
        redacted_fields,trace_id,source,user_agent,ip_address)
       VALUES ($1,$2,$3,$4,'backup_snapshot',$5,$6,ARRAY['file_content']::text[],
               $7,'APPLICATION',$8,$9)`,
      [
        tenantId,
        userId,
        audit.roleSnapshot,
        action,
        entityId,
        JSON.stringify(details),
        audit.traceId,
        audit.userAgent,
        audit.ipAddress,
      ],
    );
  }
}
