import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Database } from '../../infrastructure/database/database.js';
import type {
  ObjectStorage,
  StoredObjectReference,
} from '../../infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { GovernanceRepository } from './governance.repository.js';
import type { GovernanceAuditMetadata } from './governance.types.js';

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^\s*[=+@-]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

// Materializa cópias de registros imutáveis; não altera nem substitui a assinatura original.
export async function archiveSignedRecords(
  database: Database,
  storage: ObjectStorage,
  user: AuthenticatedUser,
  audit: GovernanceAuditMetadata,
): Promise<void> {
  const repository = new GovernanceRepository();
  const candidates = await database.withTransaction(
    { tenantId: user.tenantId, userId: user.id, readOnly: true },
    async (client) => {
      const result = await client.query(`SELECT source.* FROM (
      SELECT signature.id, 'SIGNATURE'::text AS kind, 'Assinatura técnica'::text AS title,
        signature.user_id AS signer_id, account.name AS signer_name, area.name AS area_name,
        signature.role_snapshot AS role_name, signature.signed_at AS signed_at,
        signature.entity_type,signature.entity_id,signature.entity_version AS revision,
        signature.declaration AS declaration,signature.payload_hash_sha256 AS payload_hash,
        signature.signature_hash_sha256 AS signature_hash,work_order.asset_id
      FROM workflow.technical_signatures signature JOIN iam.users account ON account.id=signature.user_id
      JOIN iam.technical_areas area ON area.id=signature.technical_area_id
      LEFT JOIN maintenance.work_orders work_order ON work_order.id=signature.entity_id
      UNION ALL
      SELECT review.id,'CHECKLIST_REVIEW','Parecer de checklist aprovado',review.reviewer_id,account.name,
        review.reviewer_role_snapshot,review.reviewer_role_snapshot,review.created_at,
        'CHECKLIST_TEMPLATE_VERSION',version.id,version.revision,review.justification,review.payload_hash_sha256,
        NULL,template.asset_id
      FROM maintenance.checklist_model_reviews review JOIN iam.users account ON account.id=review.reviewer_id
      JOIN maintenance.checklist_template_versions version ON version.id=review.checklist_template_version_id
      JOIN maintenance.checklist_templates template ON template.id=version.checklist_template_id
      WHERE review.decision='APPROVED'
    ) source WHERE NOT EXISTS (SELECT 1 FROM governance.technical_documents document WHERE document.code='REG-'||source.id::text)
    ORDER BY source.signed_at,source.id LIMIT 100`);
      return result.rows;
    },
  );
  for (const record of candidates) {
    let reference: StoredObjectReference | undefined;
    try {
      await database.withTransaction(
        { tenantId: user.tenantId, userId: user.id },
        async (client) => {
          const code = `REG-${String(record.id)}`;
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `${user.tenantId}:${code}`,
          ]);
          const existing = await client.query(
            'SELECT id FROM governance.technical_documents WHERE code=$1',
            [code],
          );
          if (existing.rows.length) return;
          const fields: Record<string, unknown> = {
            'Identificador do registro': record.id,
            Tipo: record.title,
            'Responsável pelo registro': record.signer_name,
            Área: record.area_name,
            Perfil: record.role_name,
            Data: record.signed_at,
            'Tipo de origem': record.entity_type,
            'Identificador de origem': record.entity_id,
            Revisão: record.revision,
            'Declaração ou parecer': record.declaration,
            'Hash do conteúdo original': record.payload_hash,
            'Hash da assinatura':
              record.signature_hash ??
              'Parecer autenticado; não é assinatura criptográfica independente',
          };
          const content =
            '\uFEFFCampo,Valor\r\n' +
            Object.entries(fields)
              .map(([name, value]) => `${csvCell(name)},${csvCell(value)}`)
              .join('\r\n');
          const stored = await storage.storeDocument({
            tenantId: user.tenantId,
            originalName: `${code}.csv`,
            mediaType: 'text/csv',
            stream: Readable.from([Buffer.from(content, 'utf8')]),
          });
          reference = stored;
          const documentId = randomUUID();
          await repository.insertStorageObject(client, user.tenantId, user.id, stored);
          await repository.createDocument(client, user.tenantId, user.id, documentId, code, {
            documentId: null,
            code,
            title: `${String(record.title)} · ${String(record.signer_name)}`,
            documentType: record.kind === 'SIGNATURE' ? 'CERTIFICADO' : 'LAUDO',
            entityType: record.asset_id ? 'ATIVO' : 'EMPRESA',
            entityId: record.asset_id ? String(record.asset_id) : null,
            status: 'VIGENTE',
            validUntil: null,
            responsibleId: String(record.signer_id),
            description: `Registro ${String(record.id)} · origem ${String(record.entity_type)} · revisão ${String(record.revision)}.`,
            observation: 'Cópia rastreável do registro autenticado no sistema.',
          });
          await repository.addRevision(
            client,
            user.tenantId,
            user.id,
            documentId,
            1,
            stored,
            'Arquivo gerado a partir do registro original imutável.',
          );
          await repository.writeAudit(
            client,
            user.tenantId,
            user.id,
            audit,
            'SIGNED_RECORD_ARCHIVED',
            documentId,
            null,
            { source_id: record.id, source_kind: record.kind, checksum: stored.checksumSha256 },
          );
        },
      );
    } catch (cause) {
      if (reference) await storage.remove(reference).catch(() => undefined);
      throw cause;
    }
  }
}
