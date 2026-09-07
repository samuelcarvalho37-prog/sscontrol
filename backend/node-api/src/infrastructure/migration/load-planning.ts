import {
  activeStatus,
  criticality,
  planType,
  stopMode,
  triggerType,
  versionStatus,
} from './legacy-enums.js';
import {
  booleanValue,
  enumValue,
  hashSha256,
  integerValue,
  jsonValue,
  numberValue,
  optionalNumber,
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
import type { SourceRowSnapshot } from './source-snapshot.js';

const responseTypes: Readonly<Record<string, string>> = {
  CONFIRMACAO: 'CONFIRMACAO',
  CONFIRMAÇÃO: 'CONFIRMACAO',
  BOOLEANO: 'CONFIRMACAO',
  OK_NOK: 'OK_NOK',
  CONFORME_NAO_CONFORME: 'OK_NOK',
  CONFORME: 'OK_NOK',
  NUMERO: 'NUMERO',
  NÚMERO: 'NUMERO',
  PARAMETRO: 'PARAMETRO',
  PARÂMETRO: 'PARAMETRO',
  TEXTO: 'TEXTO',
  SELECAO: 'SELECAO',
  SELEÇÃO: 'SELECAO',
  LISTA: 'SELECAO',
  EVIDENCIA: 'EVIDENCIA',
  EVIDÊNCIA: 'EVIDENCIA',
  FOTO: 'EVIDENCIA',
  LEITURA_OPERACIONAL: 'LEITURA_OPERACIONAL',
  LEITURA: 'LEITURA_OPERACIONAL',
  INSTRUCAO: 'INSTRUCAO',
  INSTRUÇÃO: 'INSTRUCAO',
};

const reviewDecision = {
  APROVADO: 'APPROVED',
  APROVADA: 'APPROVED',
  APPROVED: 'APPROVED',
  VALIDADO: 'APPROVED',
  DEVOLVIDO: 'CHANGES_REQUESTED',
  DEVOLVIDA: 'CHANGES_REQUESTED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJEITADO: 'REJECTED',
  REPROVADO: 'REJECTED',
  REJECTED: 'REJECTED',
} as const;

function revision(row: SourceRowSnapshot): number {
  return Math.max(1, integerValue(row.payload.revisao, 'revisao', 1));
}

function templateId(context: MigrationLoadContext, planLegacyId: string): string {
  return targetId(context, 'planos_manutencao:template', planLegacyId);
}

export function templateVersionId(context: MigrationLoadContext, planLegacyId: string): string {
  return targetId(context, 'planos_manutencao:template_version', planLegacyId);
}

export function planVersionId(context: MigrationLoadContext, planLegacyId: string): string {
  return targetId(context, 'planos_manutencao:plan_version', planLegacyId);
}

export async function loadMaintenancePlan(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const assetId = referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id');
  const componentId = referenceId(
    context,
    'componentes',
    row.payload.componente_id,
    'componente_id',
    true,
  );
  const planId = targetId(context, 'planos_manutencao', legacyId);
  const checklistId = templateId(context, legacyId);
  const checklistVersionId = templateVersionId(context, legacyId);
  const maintenanceVersionId = planVersionId(context, legacyId);
  const sourceStatus = enumValue(
    row.payload.workflow_status ?? row.payload.status,
    'workflow_status',
    versionStatus,
    'DRAFT',
  );
  const status = ['APPROVED', 'PUBLISHED'].includes(sourceStatus) ? 'DRAFT' : sourceStatus;
  const lifecycleToken = upper(row.payload.status);
  const lifecycle =
    lifecycleToken && lifecycleToken in activeStatus
      ? activeStatus[lifecycleToken as keyof typeof activeStatus]
      : 'ACTIVE';
  const rev = revision(row);
  const createdAt = timestamp(row.payload.criado_em, 'criado_em', context.timeZone);
  const updatedAt = timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone);
  const submittedAt = timestamp(
    row.payload.enviado_validacao_em,
    'enviado_validacao_em',
    context.timeZone,
  );
  const effectiveSubmittedAt = ['APPROVED', 'PUBLISHED'].includes(sourceStatus)
    ? (submittedAt ?? updatedAt)
    : submittedAt;
  const publishedAt =
    sourceStatus === 'PUBLISHED' || sourceStatus === 'APPROVED'
      ? (timestamp(row.payload.validado_em, 'validado_em', context.timeZone) ?? updatedAt)
      : null;
  const technicalAnalysis = jsonValue(row.payload.analise_tecnica_json, 'analise_tecnica_json', {});
  if (
    !technicalAnalysis ||
    Array.isArray(technicalAnalysis) ||
    typeof technicalAnalysis !== 'object'
  ) {
    throw new Error('analise_tecnica_json deve ser um objeto.');
  }

  await context.client.query(
    `INSERT INTO maintenance.checklist_templates
     (id,tenant_id,legacy_id,code,name,asset_id,component_id,checklist_type,criticality,
      lifecycle_status,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,clock_timestamp()),
             COALESCE($13::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       code=EXCLUDED.code,name=EXCLUDED.name,asset_id=EXCLUDED.asset_id,
       component_id=EXCLUDED.component_id,checklist_type=EXCLUDED.checklist_type,
       criticality=EXCLUDED.criticality,lifecycle_status=EXCLUDED.lifecycle_status,
       updated_at=EXCLUDED.updated_at`,
    [
      checklistId,
      context.tenantId,
      `${legacyId}:CHECKLIST`,
      `CHK-${legacyId}`,
      text(row.payload, 'nome'),
      assetId,
      componentId,
      enumValue(row.payload.tipo, 'tipo', planType, 'PREVENTIVE'),
      enumValue(row.payload.criticidade, 'criticidade', criticality, 'MEDIUM'),
      lifecycle,
      context.actorId,
      createdAt,
      updatedAt,
    ],
  );
  await context.client.query(
    `INSERT INTO maintenance.checklist_template_versions
     (id,tenant_id,legacy_id,checklist_template_id,revision,status,signature_policy,
      required_signatures,segregation_required,manager_guidance,safety_requirements,
      content_hash_sha256,created_by,submitted_at,published_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'QUALIDADE_OU_SEGURANCA',$7,true,$8,'[]'::jsonb,$9,$10,$11,$12,
             COALESCE($13::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       revision=EXCLUDED.revision,status=EXCLUDED.status,required_signatures=EXCLUDED.required_signatures,
       manager_guidance=EXCLUDED.manager_guidance,content_hash_sha256=EXCLUDED.content_hash_sha256,
       submitted_at=EXCLUDED.submitted_at,published_at=EXCLUDED.published_at`,
    [
      checklistVersionId,
      context.tenantId,
      `${legacyId}:V${rev}`,
      checklistId,
      rev,
      status,
      booleanValue(row.payload.validado_gestao, false) ? 1 : 0,
      optionalText(row.payload.devolvido_motivo),
      row.hashSha256,
      context.actorId,
      effectiveSubmittedAt,
      publishedAt,
      createdAt,
    ],
  );
  await context.client.query(
    `INSERT INTO maintenance.maintenance_plans
     (id,tenant_id,legacy_id,code,name,asset_id,component_id,plan_type,lifecycle_status,
      created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,clock_timestamp()),
             COALESCE($12::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       code=EXCLUDED.code,name=EXCLUDED.name,asset_id=EXCLUDED.asset_id,
       component_id=EXCLUDED.component_id,plan_type=EXCLUDED.plan_type,
       lifecycle_status=EXCLUDED.lifecycle_status,updated_at=EXCLUDED.updated_at`,
    [
      planId,
      context.tenantId,
      legacyId,
      `PLN-${legacyId}`,
      text(row.payload, 'nome'),
      assetId,
      componentId,
      enumValue(row.payload.tipo, 'tipo', planType, 'PREVENTIVE'),
      lifecycle,
      context.actorId,
      createdAt,
      updatedAt,
    ],
  );
  await context.client.query(
    `INSERT INTO maintenance.maintenance_plan_versions
     (id,tenant_id,legacy_id,maintenance_plan_id,checklist_template_version_id,revision,status,
      criticality,trigger_type,trigger_value,trigger_unit,recurrence_days,
      estimated_duration_minutes,lockout_required,evidence_required,maximum_sessions,
      maintenance_stop_mode,technical_analysis,content_hash_sha256,created_by,
      submitted_at,published_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,
             $21,$22,COALESCE($23::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       checklist_template_version_id=EXCLUDED.checklist_template_version_id,
       revision=EXCLUDED.revision,status=EXCLUDED.status,criticality=EXCLUDED.criticality,
       trigger_type=EXCLUDED.trigger_type,trigger_value=EXCLUDED.trigger_value,
       trigger_unit=EXCLUDED.trigger_unit,recurrence_days=EXCLUDED.recurrence_days,
       estimated_duration_minutes=EXCLUDED.estimated_duration_minutes,
       lockout_required=EXCLUDED.lockout_required,evidence_required=EXCLUDED.evidence_required,
       maximum_sessions=EXCLUDED.maximum_sessions,maintenance_stop_mode=EXCLUDED.maintenance_stop_mode,
       technical_analysis=EXCLUDED.technical_analysis,content_hash_sha256=EXCLUDED.content_hash_sha256,
       submitted_at=EXCLUDED.submitted_at,published_at=EXCLUDED.published_at`,
    [
      maintenanceVersionId,
      context.tenantId,
      `${legacyId}:V${rev}`,
      planId,
      checklistVersionId,
      rev,
      status,
      enumValue(row.payload.criticidade, 'criticidade', criticality, 'MEDIUM'),
      enumValue(row.payload.gatilho_tipo, 'gatilho_tipo', triggerType, 'MANUAL'),
      optionalNumber(row.payload.gatilho_valor, 'gatilho_valor'),
      optionalText(row.payload.unidade),
      optionalText(row.payload.recorrencia_dias) === null
        ? null
        : Math.max(1, integerValue(row.payload.recorrencia_dias, 'recorrencia_dias')),
      optionalText(row.payload.tempo_estimado_min) === null
        ? null
        : Math.max(1, integerValue(row.payload.tempo_estimado_min, 'tempo_estimado_min')),
      booleanValue(row.payload.requer_bloqueio, false),
      booleanValue(row.payload.requer_evidencia, false),
      optionalText(row.payload.max_sessoes) === null
        ? null
        : Math.max(1, integerValue(row.payload.max_sessoes, 'max_sessoes')),
      enumValue(
        row.payload.modo_parada_manutencao,
        'modo_parada_manutencao',
        stopMode,
        'EXECUTOR_DECISION',
      ),
      JSON.stringify(technicalAnalysis),
      row.hashSha256,
      context.actorId,
      effectiveSubmittedAt,
      publishedAt,
      createdAt,
    ],
  );
  return {
    schema: 'maintenance',
    table: 'maintenance_plans',
    id: planId,
    auxiliary: [
      {
        sourceName: 'planos_manutencao:template',
        legacyId,
        schema: 'maintenance',
        table: 'checklist_templates',
        id: checklistId,
      },
      {
        sourceName: 'planos_manutencao:template_version',
        legacyId,
        schema: 'maintenance',
        table: 'checklist_template_versions',
        id: checklistVersionId,
      },
      {
        sourceName: 'planos_manutencao:plan_version',
        legacyId,
        schema: 'maintenance',
        table: 'maintenance_plan_versions',
        id: maintenanceVersionId,
      },
    ],
  };
}

export async function finalizePlanningStatuses(context: MigrationLoadContext): Promise<void> {
  const plans = context.snapshot.sheets.find((candidate) => candidate.name === 'planos_manutencao');
  for (const row of plans?.rows ?? []) {
    const legacyId = requiredLegacyId(row);
    const status = enumValue(
      row.payload.workflow_status ?? row.payload.status,
      'workflow_status',
      versionStatus,
      'DRAFT',
    );
    if (status === 'PUBLISHED') {
      await context.client.query(
        `UPDATE maintenance.checklist_template_versions
         SET status='APPROVED'
         WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM 'APPROVED'`,
        [context.tenantId, templateVersionId(context, legacyId)],
      );
    }
    await context.client.query(
      `UPDATE maintenance.checklist_template_versions
       SET status=$3
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [context.tenantId, templateVersionId(context, legacyId), status],
    );
    await context.client.query(
      `UPDATE maintenance.maintenance_plan_versions
       SET status=$3
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [context.tenantId, planVersionId(context, legacyId), status],
    );
  }
}

export async function loadPlanItem(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const planLegacyId = text(row.payload, 'plano_id');
  const id = targetId(context, 'plano_itens', legacyId);
  const options = jsonValue(row.payload.opcoes_json, 'opcoes_json', []);
  if (!Array.isArray(options)) throw new Error('opcoes_json deve ser uma lista.');
  const responseType = responseTypes[upper(row.payload.tipo_resposta) ?? ''] ?? 'TEXTO';
  await context.client.query(
    `INSERT INTO maintenance.checklist_items
     (id,tenant_id,legacy_id,checklist_template_version_id,sequence,title,instruction,
      response_type_code,category,required,evidence_required,minimum_evidence_photos,
      blocks_completion,expected_value,minimum_value,maximum_value,unit,options,
      validation_rule_code,weight,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,
             $19,$20,$21,COALESCE($22::timestamptz,clock_timestamp()),
             COALESCE($23::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       checklist_template_version_id=EXCLUDED.checklist_template_version_id,
       sequence=EXCLUDED.sequence,title=EXCLUDED.title,instruction=EXCLUDED.instruction,
       response_type_code=EXCLUDED.response_type_code,category=EXCLUDED.category,
       required=EXCLUDED.required,evidence_required=EXCLUDED.evidence_required,
       minimum_evidence_photos=EXCLUDED.minimum_evidence_photos,
       blocks_completion=EXCLUDED.blocks_completion,expected_value=EXCLUDED.expected_value,
       minimum_value=EXCLUDED.minimum_value,maximum_value=EXCLUDED.maximum_value,
       unit=EXCLUDED.unit,options=EXCLUDED.options,validation_rule_code=EXCLUDED.validation_rule_code,
       weight=EXCLUDED.weight,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      templateVersionId(context, planLegacyId),
      Math.max(1, integerValue(row.payload.ordem, 'ordem')),
      text(row.payload, 'titulo'),
      optionalText(row.payload.instrucao),
      responseType,
      text(row.payload, 'categoria', 'OPERACIONAL').toUpperCase(),
      booleanValue(row.payload.obrigatorio, true),
      booleanValue(row.payload.evidencia_obrigatoria, false),
      Math.max(0, integerValue(row.payload.evidencia_min_fotos, 'evidencia_min_fotos', 0)),
      booleanValue(row.payload.bloqueia_finalizacao, false),
      optionalText(row.payload.valor_esperado),
      optionalNumber(row.payload.limite_min, 'limite_min'),
      optionalNumber(row.payload.limite_max, 'limite_max'),
      optionalText(row.payload.unidade),
      JSON.stringify(options),
      optionalText(row.payload.validacao_regra),
      Math.max(0, numberValue(row.payload.peso, 'peso', 1)),
      ['ATIVO', 'ACTIVE', 'SIM', 'TRUE', '1'].includes(upper(row.payload.status) ?? '')
        ? 'ACTIVE'
        : 'INACTIVE',
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'checklist_items', id };
}

export async function loadChecklistItemType(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const code =
    responseTypes[upper(row.payload.tipo) ?? ''] ?? text(row.payload, 'tipo').toUpperCase();
  await context.client.query(
    `INSERT INTO maintenance.checklist_item_types
     (code,name,description,requires_response,requires_value,requires_options,supports_limit,
      supports_evidence,default_category,active,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
       requires_response=EXCLUDED.requires_response,requires_value=EXCLUDED.requires_value,
       requires_options=EXCLUDED.requires_options,supports_limit=EXCLUDED.supports_limit,
       supports_evidence=EXCLUDED.supports_evidence,default_category=EXCLUDED.default_category,
       active=EXCLUDED.active`,
    [
      code,
      text(row.payload, 'nome'),
      text(row.payload, 'descricao'),
      booleanValue(row.payload.requer_resposta, false),
      booleanValue(row.payload.requer_valor, false),
      booleanValue(row.payload.requer_opcoes, false),
      booleanValue(row.payload.suporta_limite, false),
      booleanValue(row.payload.suporta_evidencia, false),
      text(row.payload, 'categoria_padrao', 'OPERACIONAL'),
      booleanValue(row.payload.ativo, true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return {
    schema: 'maintenance',
    table: 'checklist_item_types',
    id: targetId(context, 'checklist_tipos_item', legacyId),
  };
}

export async function loadChecklistValidationRule(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'checklist_validacao_regras', legacyId);
  const typeCode =
    responseTypes[upper(row.payload.tipo_item) ?? ''] ??
    text(row.payload, 'tipo_item').toUpperCase();
  const rule = jsonValue(row.payload.regra_json, 'regra_json', {});
  await context.client.query(
    `INSERT INTO maintenance.checklist_validation_rules
     (id,item_type_code,code,name,description,rule,active,created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,COALESCE($8::timestamptz,clock_timestamp()))
     ON CONFLICT (item_type_code,code) DO UPDATE SET name=EXCLUDED.name,
       description=EXCLUDED.description,rule=EXCLUDED.rule,active=EXCLUDED.active`,
    [
      id,
      typeCode,
      text(row.payload, 'codigo'),
      text(row.payload, 'nome'),
      text(row.payload, 'descricao'),
      JSON.stringify(rule),
      booleanValue(row.payload.ativo, true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'checklist_validation_rules', id };
}

export async function loadChecklistReview(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const planLegacyId = text(row.payload, 'plano_id');
  const id = targetId(context, 'checklist_modelo_validacoes', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.checklist_model_reviews
     (id,tenant_id,legacy_id,checklist_template_version_id,decision,justification,
      reviewer_id,reviewer_role_snapshot,payload_hash_sha256,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      templateVersionId(context, planLegacyId),
      enumValue(row.payload.decisao, 'decisao', reviewDecision),
      text(row.payload, 'justificativa', 'Registro legado sem justificativa.'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      text(row.payload, 'perfil', 'GESTOR'),
      row.hashSha256,
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'checklist_model_reviews', id };
}

export async function loadChecklistAudit(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'modelo_checklist_auditoria', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.checklist_model_audit
     (id,tenant_id,legacy_id,checklist_template_version_id,checklist_item_id,event_type,
      before_data,after_data,user_id,role_snapshot,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      templateVersionId(context, text(row.payload, 'plano_id')),
      referenceId(context, 'plano_itens', row.payload.item_id, 'item_id', true),
      text(row.payload, 'evento'),
      JSON.stringify(jsonValue(row.payload.antes_json, 'antes_json', null)),
      JSON.stringify(jsonValue(row.payload.depois_json, 'depois_json', null)),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id', true),
      optionalText(row.payload.perfil),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'checklist_model_audit', id };
}

export async function loadPlanTriggerState(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const planId = targetId(context, 'planos_manutencao', legacyId);
  const lastActionLegacyId = optionalText(row.payload.ultima_acao_id);
  const actionRow = context.snapshot.sheets
    .find((candidate) => candidate.name === 'os_acoes')
    ?.rows.find((candidate) => candidate.legacyId === lastActionLegacyId);
  const lastWorkOrderId = actionRow
    ? referenceId(context, 'ordens_servico', actionRow.payload.os_id, 'os_id')
    : null;
  await context.client.query(
    `INSERT INTO maintenance.plan_trigger_state
     (tenant_id,maintenance_plan_id,maintenance_plan_version_id,last_processed_value,
      next_trigger_value,last_triggered_at,last_work_order_id,last_work_order_status,updated_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,COALESCE($8::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,maintenance_plan_id) DO UPDATE SET
       maintenance_plan_version_id=EXCLUDED.maintenance_plan_version_id,
       last_processed_value=EXCLUDED.last_processed_value,next_trigger_value=EXCLUDED.next_trigger_value,
       last_work_order_id=EXCLUDED.last_work_order_id,last_work_order_status=EXCLUDED.last_work_order_status,
       updated_at=EXCLUDED.updated_at`,
    [
      context.tenantId,
      planId,
      planVersionId(context, legacyId),
      optionalNumber(row.payload.ultimo_valor_processado, 'ultimo_valor_processado'),
      optionalNumber(row.payload.proximo_valor_gatilho, 'proximo_valor_gatilho'),
      lastWorkOrderId,
      optionalText(row.payload.ultima_acao_status),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'plan_trigger_state', id: planId };
}

export function configurationSnapshotHash(rows: readonly SourceRowSnapshot[]): string {
  return hashSha256(JSON.stringify(rows.map((row) => row.payload)));
}
