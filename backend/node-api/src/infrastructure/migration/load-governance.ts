import {
  dateValue,
  hashSha256,
  integerValue,
  jsonValue,
  optionalText,
  text,
  timestamp,
  upper,
} from './legacy-values.js';
import {
  referenceId,
  requiredLegacyId,
  targetId,
  type LoadedTarget,
  type MigrationLoadContext,
} from './loader-context.js';
import { resolvePolymorphicEntityId } from './load-workflow.js';
import type { SourceRowSnapshot, SourceScalar } from './source-snapshot.js';

const configurationVersionStatus: Readonly<Record<string, string>> = {
  RASCUNHO: 'DRAFT',
  DRAFT: 'DRAFT',
  VALIDADA: 'VALIDATED',
  VALIDADO: 'VALIDATED',
  VALIDATED: 'VALIDATED',
  PUBLICADA: 'PUBLISHED',
  PUBLICADO: 'PUBLISHED',
  PUBLISHED: 'PUBLISHED',
  SUBSTITUIDA: 'SUPERSEDED',
  SUPERSEDED: 'SUPERSEDED',
  REJEITADA: 'REJECTED',
  REJECTED: 'REJECTED',
};
const configurationDraftStatus: Readonly<Record<string, string>> = {
  EDICAO: 'EDITING',
  EDIÇÃO: 'EDITING',
  RASCUNHO: 'EDITING',
  EDITING: 'EDITING',
  VALIDO: 'VALID',
  VÁLIDO: 'VALID',
  VALID: 'VALID',
  INVALIDO: 'INVALID',
  INVÁLIDO: 'INVALID',
  INVALID: 'INVALID',
  PUBLICADO: 'PUBLISHED',
  PUBLISHED: 'PUBLISHED',
  DESCARTADO: 'DISCARDED',
  DISCARDED: 'DISCARDED',
};
const importStatus: Readonly<Record<string, string>> = {
  ENVIADO: 'UPLOADED',
  UPLOADED: 'UPLOADED',
  VALIDANDO: 'VALIDATING',
  VALIDATING: 'VALIDATING',
  VALIDADO: 'VALIDATED',
  VALIDATED: 'VALIDATED',
  REJEITADO: 'REJECTED',
  REJECTED: 'REJECTED',
  CONFIRMADO: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  ROLLBACK: 'ROLLING_BACK',
  ROLLING_BACK: 'ROLLING_BACK',
  REVERTIDO: 'ROLLED_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  FALHA: 'FAILED',
  FAILED: 'FAILED',
};
const recordStatus: Readonly<Record<string, string>> = {
  PENDENTE: 'PENDING',
  PENDING: 'PENDING',
  VALIDO: 'VALID',
  VÁLIDO: 'VALID',
  VALID: 'VALID',
  INVALIDO: 'INVALID',
  INVÁLIDO: 'INVALID',
  INVALID: 'INVALID',
  APLICADO: 'APPLIED',
  APPLIED: 'APPLIED',
  IGNORADO: 'SKIPPED',
  SKIPPED: 'SKIPPED',
  REVERTIDO: 'ROLLED_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  FALHA: 'FAILED',
  FAILED: 'FAILED',
};
const documentStatus: Readonly<Record<string, string>> = {
  RASCUNHO: 'DRAFT',
  DRAFT: 'DRAFT',
  EM_REVISAO: 'IN_REVIEW',
  IN_REVIEW: 'IN_REVIEW',
  ATIVO: 'ACTIVE',
  ACTIVE: 'ACTIVE',
  EXPIRADO: 'EXPIRED',
  EXPIRED: 'EXPIRED',
  SUBSTITUIDO: 'SUPERSEDED',
  SUPERSEDED: 'SUPERSEDED',
  ARQUIVADO: 'ARCHIVED',
  ARCHIVED: 'ARCHIVED',
};

function mapped(
  value: SourceScalar | undefined,
  mapping: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return mapping[upper(value) ?? ''] ?? fallback;
}

function objectJson(value: SourceScalar | undefined, field: string): string {
  const parsed = jsonValue(value, field, {});
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
    throw new Error(`${field} deve ser um objeto.`);
  return JSON.stringify(parsed);
}

function arrayJson(value: SourceScalar | undefined, field: string): string {
  const parsed = jsonValue(value, field, []);
  if (!Array.isArray(parsed)) throw new Error(`${field} deve ser uma lista.`);
  return JSON.stringify(parsed);
}

export async function loadConfigEntry(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const key = legacyId.trim();
  const value = row.payload.valor;
  await context.client.query(
    `INSERT INTO platform.company_profiles (tenant_id,trade_name,metadata,updated_by)
     SELECT tenant.id,tenant.display_name,
            jsonb_build_object('legacy_config',jsonb_build_object($2::text,$3::text)),$4
     FROM platform.tenants tenant WHERE tenant.id=$1
     ON CONFLICT (tenant_id) DO UPDATE SET
       trade_name=CASE WHEN upper($2::text) IN ('EMPRESA_NOME','COMPANY_NAME','NOME_EMPRESA')
                       AND length(trim($3::text))>0 THEN trim($3::text)
                       ELSE platform.company_profiles.trade_name END,
       metadata=jsonb_set(platform.company_profiles.metadata,
                          ARRAY['legacy_config',$2::text],to_jsonb($3::text),true),
       updated_by=$4,updated_at=clock_timestamp()`,
    [context.tenantId, key, String(value ?? ''), context.actorId],
  );
  return { schema: 'platform', table: 'company_profiles', id: context.tenantId };
}

export async function loadConfigurationVersion(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'configuracao_versoes', legacyId);
  const status = mapped(row.payload.status, configurationVersionStatus, 'DRAFT');
  await context.client.query(
    `INSERT INTO platform.configuration_versions
     (id,tenant_id,legacy_id,version_number,status,source,base_version_id,configuration,
      content_hash_sha256,validation_result,created_by,created_at,published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,
             COALESCE($12::timestamptz,clock_timestamp()),$13)
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       version_number=EXCLUDED.version_number,status=EXCLUDED.status,source=EXCLUDED.source,
       base_version_id=EXCLUDED.base_version_id,configuration=EXCLUDED.configuration,
       content_hash_sha256=EXCLUDED.content_hash_sha256,
       validation_result=EXCLUDED.validation_result,created_by=EXCLUDED.created_by,
       published_at=EXCLUDED.published_at`,
    [
      id,
      context.tenantId,
      legacyId,
      Math.max(1, integerValue(row.payload.numero, 'numero')),
      status,
      text(row.payload, 'origem', 'LEGACY_MIGRATION'),
      null,
      objectJson(row.payload.configuracao_json, 'configuracao_json'),
      optionalText(row.payload.hash_sha256) ?? row.hashSha256,
      objectJson(row.payload.validacao_json, 'validacao_json'),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por', true) ??
        context.actorId,
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      status === 'PUBLISHED'
        ? timestamp(row.payload.criado_em, 'criado_em', context.timeZone)
        : null,
    ],
  );
  return { schema: 'platform', table: 'configuration_versions', id };
}

export async function linkConfigurationVersionReferences(
  context: MigrationLoadContext,
): Promise<void> {
  const versions = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'configuracao_versoes',
  );
  for (const row of versions?.rows ?? []) {
    await context.client.query(
      `UPDATE platform.configuration_versions SET base_version_id=$3
       WHERE tenant_id=$1 AND id=$2`,
      [
        context.tenantId,
        targetId(context, 'configuracao_versoes', requiredLegacyId(row)),
        referenceId(
          context,
          'configuracao_versoes',
          row.payload.base_versao_id,
          'base_versao_id',
          true,
        ),
      ],
    );
  }
}

export async function loadConfigurationDraft(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'configuracao_rascunhos', legacyId);
  await context.client.query(
    `INSERT INTO platform.configuration_drafts
     (id,tenant_id,legacy_id,user_id,base_version_id,configuration,content_hash_sha256,
      validation_result,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,
             COALESCE($10::timestamptz,clock_timestamp()),COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,base_version_id=EXCLUDED.base_version_id,
       configuration=EXCLUDED.configuration,content_hash_sha256=EXCLUDED.content_hash_sha256,
       validation_result=EXCLUDED.validation_result,status=EXCLUDED.status,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      referenceId(
        context,
        'configuracao_versoes',
        row.payload.base_versao_id,
        'base_versao_id',
        true,
      ),
      objectJson(row.payload.configuracao_json, 'configuracao_json'),
      optionalText(row.payload.hash_sha256) ?? row.hashSha256,
      objectJson(row.payload.validacao_json, 'validacao_json'),
      mapped(row.payload.status, configurationDraftStatus, 'EDITING'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'platform', table: 'configuration_drafts', id };
}

export async function loadImportBatch(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'importacao_lotes', legacyId);
  const total = Math.max(0, integerValue(row.payload.total_linhas, 'total_linhas', 0));
  const valid = Math.min(
    total,
    Math.max(0, integerValue(row.payload.linhas_validas, 'linhas_validas', 0)),
  );
  const invalid = Math.min(
    total - valid,
    Math.max(0, integerValue(row.payload.linhas_invalidas, 'linhas_invalidas', 0)),
  );
  await context.client.query(
    `INSERT INTO governance.import_batches
     (id,tenant_id,legacy_id,import_type,entity_type,source_file_name,source_sheet_name,status,
      total_rows,valid_rows,invalid_rows,validation_hash_sha256,headers,ignored_headers,result,
      created_by,confirmed_by,rolled_back_by,created_at,confirmed_at,rolled_back_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,
             $16,$17,$18,COALESCE($19::timestamptz,clock_timestamp()),$20,$21,
             COALESCE($22::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       status=EXCLUDED.status,total_rows=EXCLUDED.total_rows,valid_rows=EXCLUDED.valid_rows,
       invalid_rows=EXCLUDED.invalid_rows,validation_hash_sha256=EXCLUDED.validation_hash_sha256,
       headers=EXCLUDED.headers,ignored_headers=EXCLUDED.ignored_headers,result=EXCLUDED.result,
       confirmed_by=EXCLUDED.confirmed_by,rolled_back_by=EXCLUDED.rolled_back_by,
       confirmed_at=EXCLUDED.confirmed_at,rolled_back_at=EXCLUDED.rolled_back_at,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'tipo'),
      text(row.payload, 'entidade'),
      text(row.payload, 'arquivo_nome'),
      optionalText(row.payload.aba_nome),
      mapped(row.payload.status, importStatus, 'UPLOADED'),
      total,
      valid,
      invalid,
      optionalText(row.payload.validacao_hash),
      arrayJson(row.payload.cabecalhos_json, 'cabecalhos_json'),
      arrayJson(row.payload.cabecalhos_ignorados_json, 'cabecalhos_ignorados_json'),
      objectJson(row.payload.resultado_json, 'resultado_json'),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por'),
      referenceId(context, 'usuarios', row.payload.confirmado_por, 'confirmado_por', true),
      referenceId(context, 'usuarios', row.payload.rollback_por, 'rollback_por', true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.confirmado_em, 'confirmado_em', context.timeZone),
      timestamp(row.payload.rollback_em, 'rollback_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'governance', table: 'import_batches', id };
}

export async function loadImportRecord(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'importacao_registros', legacyId);
  const entityType = text(row.payload, 'entidade');
  const entityId = optionalText(row.payload.entidade_id)
    ? resolvePolymorphicEntityId(context, entityType, row.payload.entidade_id)
    : null;
  await context.client.query(
    `INSERT INTO governance.import_records
     (id,tenant_id,legacy_id,import_batch_id,source_row_number,entity_type,entity_id,operation,
      status,raw_data,normalized_data,errors,before_data,after_data,applied_at,rolled_back_at,
      created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
             $14::jsonb,$15,$16,COALESCE($17::timestamptz,clock_timestamp()),
             COALESCE($18::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       entity_id=EXCLUDED.entity_id,operation=EXCLUDED.operation,status=EXCLUDED.status,
       raw_data=EXCLUDED.raw_data,normalized_data=EXCLUDED.normalized_data,errors=EXCLUDED.errors,
       before_data=EXCLUDED.before_data,after_data=EXCLUDED.after_data,
       applied_at=EXCLUDED.applied_at,rolled_back_at=EXCLUDED.rolled_back_at,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'importacao_lotes', row.payload.lote_id, 'lote_id'),
      Math.max(1, integerValue(row.payload.linha_numero, 'linha_numero')),
      entityType,
      entityId,
      optionalText(row.payload.operacao),
      mapped(row.payload.status, recordStatus, 'PENDING'),
      objectJson(row.payload.raw_json, 'raw_json'),
      objectJson(row.payload.normalizado_json, 'normalizado_json'),
      arrayJson(row.payload.erros_json, 'erros_json'),
      objectJson(row.payload.antes_json, 'antes_json'),
      objectJson(row.payload.depois_json, 'depois_json'),
      timestamp(row.payload.aplicado_em, 'aplicado_em', context.timeZone),
      timestamp(row.payload.rollback_em, 'rollback_em', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'governance', table: 'import_records', id };
}

function storageObjectValues(
  context: MigrationLoadContext,
  storageLegacyId: string,
  row: SourceRowSnapshot,
): unknown[] {
  const fileName = text(row.payload, 'arquivo_nome', storageLegacyId);
  const key = `legacy/documents/${storageLegacyId}/${fileName}`;
  return [
    targetId(context, 'storage_objects', storageLegacyId),
    context.tenantId,
    storageLegacyId,
    key,
    fileName,
    text(row.payload, 'mime_type', 'application/octet-stream'),
    Math.max(0, integerValue(row.payload.tamanho_bytes, 'tamanho_bytes', 0)),
    hashSha256(key),
    referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por'),
    timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
  ];
}

async function upsertStorage(context: MigrationLoadContext, values: unknown[]): Promise<void> {
  await context.client.query(
    `INSERT INTO platform.storage_objects
     (id,tenant_id,legacy_id,provider,bucket,object_key,original_name,media_type,byte_size,
      checksum_sha256,status,metadata,created_by,created_at)
     VALUES ($1,$2,$3,'LEGACY_GOOGLE','legacy-import',$4,$5,$6,$7,$8,'AVAILABLE',
             '{"migrated":true}'::jsonb,$9,COALESCE($10::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       object_key=EXCLUDED.object_key,original_name=EXCLUDED.original_name,
       media_type=EXCLUDED.media_type,byte_size=EXCLUDED.byte_size,
       checksum_sha256=EXCLUDED.checksum_sha256,status='AVAILABLE'`,
    values,
  );
}

export async function loadTechnicalDocument(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'documentos_tecnicos', legacyId);
  const entityType = optionalText(row.payload.entidade_tipo)?.toUpperCase() ?? null;
  const entityId =
    entityType && optionalText(row.payload.entidade_id)
      ? resolvePolymorphicEntityId(context, entityType, row.payload.entidade_id)
      : null;
  await context.client.query(
    `INSERT INTO governance.technical_documents
     (id,tenant_id,legacy_id,code,title,document_type,entity_type,entity_id,status,
      current_revision,valid_until,responsible_id,description,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             COALESCE($15::timestamptz,clock_timestamp()),COALESCE($16::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       code=EXCLUDED.code,title=EXCLUDED.title,document_type=EXCLUDED.document_type,
       entity_type=EXCLUDED.entity_type,entity_id=EXCLUDED.entity_id,status=EXCLUDED.status,
       current_revision=EXCLUDED.current_revision,valid_until=EXCLUDED.valid_until,
       responsible_id=EXCLUDED.responsible_id,description=EXCLUDED.description,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'codigo'),
      text(row.payload, 'titulo'),
      text(row.payload, 'tipo'),
      entityType,
      entityId,
      mapped(row.payload.status, documentStatus, 'DRAFT'),
      Math.max(1, integerValue(row.payload.revisao_atual, 'revisao_atual', 1)),
      dateValue(row.payload.validade_em, 'validade_em'),
      referenceId(context, 'usuarios', row.payload.responsavel_id, 'responsavel_id', true),
      optionalText(row.payload.descricao),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'governance', table: 'technical_documents', id };
}

export async function loadDocumentRevision(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'documento_revisoes', legacyId);
  const storageLegacyId = optionalText(row.payload.arquivo_id) ?? `document-revision:${legacyId}`;
  const storageId = targetId(context, 'storage_objects', storageLegacyId);
  const values = storageObjectValues(context, storageLegacyId, row);
  await upsertStorage(context, values);
  await context.client.query(
    `INSERT INTO governance.document_revisions
     (id,tenant_id,legacy_id,technical_document_id,revision,storage_object_id,observation,
      content_hash_sha256,created_by,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'documentos_tecnicos', row.payload.documento_id, 'documento_id'),
      Math.max(1, integerValue(row.payload.revisao, 'revisao')),
      storageId,
      optionalText(row.payload.observacao),
      hashSha256(String(values[3])),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return {
    schema: 'governance',
    table: 'document_revisions',
    id,
    auxiliary: [
      {
        sourceName: 'documento_revisoes:storage',
        legacyId: storageLegacyId,
        schema: 'platform',
        table: 'storage_objects',
        id: storageId,
      },
    ],
  };
}

export async function loadLegacyQuarantine(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'legado_quarentena', legacyId);
  await context.client.query(
    `INSERT INTO governance.legacy_quarantine
     (id,tenant_id,legacy_id,source_name,source_row,reason_code,reason_detail,payload,
      migration_run_id,quarantined_at)
     VALUES ($1,$2,$3,$4,$5,'LEGACY_QUARANTINE',$6,$7::jsonb,$8,
             COALESCE($9::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       source_name=EXCLUDED.source_name,source_row=EXCLUDED.source_row,
       reason_detail=EXCLUDED.reason_detail,payload=EXCLUDED.payload,
       migration_run_id=EXCLUDED.migration_run_id,quarantined_at=EXCLUDED.quarantined_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'aba_origem'),
      optionalText(row.payload.linha_origem),
      text(row.payload, 'motivo'),
      objectJson(row.payload.payload_json, 'payload_json'),
      context.runId,
      timestamp(row.payload.movido_em, 'movido_em', context.timeZone),
    ],
  );
  return { schema: 'governance', table: 'legacy_quarantine', id };
}

export async function loadAuditEvent(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'audit_log', legacyId);
  await context.client.query(
    `INSERT INTO audit.events
     (id,tenant_id,legacy_id,user_id,role_snapshot,action,entity_type,entity_id,before_data,
      after_data,redacted_fields,source,user_agent,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,
             ARRAY['senha','password','pin','token','hash'],'MIGRATION',$11,
             COALESCE($12::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id', true),
      optionalText(row.payload.perfil),
      text(row.payload, 'acao'),
      text(row.payload, 'entidade'),
      optionalText(row.payload.entidade_id),
      objectJson(row.payload.antes_json, 'antes_json'),
      objectJson(row.payload.depois_json, 'depois_json'),
      optionalText(row.payload.user_agent),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'audit', table: 'events', id };
}
