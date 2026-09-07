import type { PoolClient, QueryResultRow } from 'pg';

import type { StoredDocumentObject } from '../../infrastructure/storage/object-storage.js';
import type { DocumentMetadataInput, GovernanceAuditMetadata } from './governance.types.js';

export interface GovernanceRow extends QueryResultRow {
  [column: string]: unknown;
  id: string;
}

function requireRow<T extends QueryResultRow>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}

export class GovernanceRepository {
  async listDocuments(client: PoolClient): Promise<readonly GovernanceRow[]> {
    const result = await client.query<GovernanceRow>(`
      SELECT
        document.id, document.code, document.title, document.document_type,
        document.entity_type, document.entity_id, document.status,
        document.current_revision, document.valid_until, document.responsible_id,
        document.description, document.created_by, document.created_at, document.updated_at,
        revision.id AS revision_id, revision.storage_object_id,
        object.original_name, object.media_type, object.byte_size
      FROM governance.technical_documents document
      JOIN governance.document_revisions revision
        ON revision.tenant_id = document.tenant_id
       AND revision.technical_document_id = document.id
       AND revision.revision = document.current_revision
      JOIN platform.storage_objects object
        ON object.tenant_id = revision.tenant_id
       AND object.id = revision.storage_object_id
       AND object.status = 'AVAILABLE'
      ORDER BY document.updated_at DESC, document.id
    `);
    return result.rows;
  }

  async findDocument(
    client: PoolClient,
    documentId: string,
    lock = false,
  ): Promise<GovernanceRow | null> {
    const result = await client.query<GovernanceRow>(
      `SELECT * FROM governance.technical_documents WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async listRevisions(client: PoolClient, documentId: string): Promise<readonly GovernanceRow[]> {
    const result = await client.query<GovernanceRow>(
      `
        SELECT
          revision.id, revision.technical_document_id, revision.revision,
          revision.storage_object_id, revision.observation, revision.created_by,
          revision.created_at, object.original_name, object.media_type, object.byte_size
        FROM governance.document_revisions revision
        JOIN platform.storage_objects object
          ON object.tenant_id = revision.tenant_id
         AND object.id = revision.storage_object_id
         AND object.status = 'AVAILABLE'
        WHERE revision.technical_document_id = $1
        ORDER BY revision.revision DESC
      `,
      [documentId],
    );
    return result.rows;
  }

  async findDocumentFile(client: PoolClient, objectId: string): Promise<GovernanceRow | null> {
    const result = await client.query<GovernanceRow>(
      `
        SELECT
          object.id, object.provider, object.bucket, object.object_key,
          object.original_name, object.media_type, object.byte_size,
          object.checksum_sha256
        FROM platform.storage_objects object
        JOIN governance.document_revisions revision
          ON revision.tenant_id = object.tenant_id
         AND revision.storage_object_id = object.id
        WHERE object.id = $1 AND object.status = 'AVAILABLE'
        LIMIT 1
      `,
      [objectId],
    );
    return result.rows[0] ?? null;
  }

  async insertStorageObject(
    client: PoolClient,
    tenantId: string,
    userId: string,
    object: StoredDocumentObject,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO platform.storage_objects (
          id, tenant_id, provider, bucket, object_key, original_name, media_type,
          byte_size, checksum_sha256, status, metadata, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AVAILABLE', $10, $11)
      `,
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
        JSON.stringify({ classification: 'PRIVATE_GOVERNED_DOCUMENT' }),
        userId,
      ],
    );
  }

  async createDocument(
    client: PoolClient,
    tenantId: string,
    userId: string,
    documentId: string,
    code: string,
    input: DocumentMetadataInput,
  ): Promise<GovernanceRow> {
    const result = await client.query<GovernanceRow>(
      `
        INSERT INTO governance.technical_documents (
          id, tenant_id, code, title, document_type, entity_type, entity_id,
          status, current_revision, valid_until, responsible_id, description, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        documentId,
        tenantId,
        code,
        input.title,
        input.documentType,
        input.entityType,
        input.entityId,
        this.databaseStatus(input.status),
        input.validUntil,
        input.responsibleId,
        input.description,
        userId,
      ],
    );
    return requireRow(result.rows, 'O PostgreSQL não retornou o documento criado.');
  }

  async addRevision(
    client: PoolClient,
    tenantId: string,
    userId: string,
    documentId: string,
    revision: number,
    object: StoredDocumentObject,
    observation: string | null,
  ): Promise<GovernanceRow> {
    const result = await client.query<GovernanceRow>(
      `
        INSERT INTO governance.document_revisions (
          tenant_id, technical_document_id, revision, storage_object_id,
          observation, content_hash_sha256, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [tenantId, documentId, revision, object.id, observation, object.checksumSha256, userId],
    );
    return requireRow(result.rows, 'O PostgreSQL não retornou a revisão criada.');
  }

  async updateDocument(
    client: PoolClient,
    documentId: string,
    input: DocumentMetadataInput,
    currentRevision?: number,
  ): Promise<GovernanceRow> {
    const result = await client.query<GovernanceRow>(
      `
        UPDATE governance.technical_documents
        SET code = COALESCE($2, code),
            title = $3,
            document_type = $4,
            entity_type = $5,
            entity_id = $6,
            status = $7,
            valid_until = $8,
            responsible_id = $9,
            description = $10,
            current_revision = COALESCE($11, current_revision),
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *
      `,
      [
        documentId,
        input.code,
        input.title,
        input.documentType,
        input.entityType,
        input.entityId,
        this.databaseStatus(input.status),
        input.validUntil,
        input.responsibleId,
        input.description,
        currentRevision ?? null,
      ],
    );
    return requireRow(result.rows, 'O PostgreSQL não retornou o documento alterado.');
  }

  async writeAudit(
    client: PoolClient,
    tenantId: string,
    userId: string,
    metadata: GovernanceAuditMetadata,
    action: string,
    entityId: string,
    beforeData: Readonly<Record<string, unknown>> | null,
    afterData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO audit.events (
          tenant_id, user_id, role_snapshot, action, entity_type, entity_id,
          before_data, after_data, redacted_fields, trace_id, source,
          user_agent, ip_address
        )
        VALUES ($1, $2, $3, $4, 'technical_document', $5, $6, $7,
                ARRAY['file_content']::text[], $8, 'APPLICATION', $9, $10)
      `,
      [
        tenantId,
        userId,
        metadata.roleSnapshot,
        action,
        entityId,
        beforeData ? JSON.stringify(beforeData) : null,
        JSON.stringify(afterData),
        metadata.traceId,
        metadata.userAgent,
        metadata.ipAddress,
      ],
    );
  }

  private databaseStatus(status: DocumentMetadataInput['status']): string {
    const statuses = {
      RASCUNHO: 'DRAFT',
      EM_REVISAO: 'IN_REVIEW',
      VIGENTE: 'ACTIVE',
      OBSOLETO: 'SUPERSEDED',
    } as const;
    return statuses[status];
  }
}
