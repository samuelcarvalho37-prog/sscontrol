import { activeStatus, priority, technicalDemandStatus } from './legacy-enums.js';
import {
  booleanValue,
  enumValue,
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
import { templateVersionId } from './load-planning.js';
import type { SourceRowSnapshot, SourceScalar } from './source-snapshot.js';

const analysisStatus = {
  RASCUNHO: 'DRAFT',
  DRAFT: 'DRAFT',
  ENVIADA_ADMIN: 'SENT_TO_ADMIN',
  ENVIADO_ADMIN: 'SENT_TO_ADMIN',
  SENT_TO_ADMIN: 'SENT_TO_ADMIN',
  ACEITA: 'ACCEPTED',
  ACEITO: 'ACCEPTED',
  ACCEPTED: 'ACCEPTED',
  SUBSTITUIDA: 'SUPERSEDED',
  SUPERSEDED: 'SUPERSEDED',
  ARQUIVADA: 'ARCHIVED',
  ARCHIVED: 'ARCHIVED',
} as const;

const signaturePolicies = {
  QUALIDADE_OU_SEGURANCA: 'QUALIDADE_OU_SEGURANCA',
  QUALIDADE: 'QUALIDADE',
  SEGURANCA: 'SEGURANCA',
  QUALIDADE_E_SEGURANCA: 'QUALIDADE_E_SEGURANCA',
  PERSONALIZADA: 'PERSONALIZADA',
  CUSTOM: 'PERSONALIZADA',
} as const;

function normalizedToken(value: SourceScalar | undefined): string {
  return (upper(value) ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function resolvePolymorphicEntityId(
  context: MigrationLoadContext,
  entityTypeValue: SourceScalar | undefined,
  legacyIdValue: SourceScalar | undefined,
): string {
  const legacyId = optionalText(legacyIdValue);
  if (!legacyId) throw new Error('entidade_id obrigatorio ausente.');
  const type = normalizedToken(entityTypeValue);
  if (type.includes('CHECKLIST') || type.includes('MODELO'))
    return templateVersionId(context, legacyId);
  if (type.includes('PLANO')) return targetId(context, 'planos_manutencao:plan_version', legacyId);
  if (type.includes('WORK_ORDER') || type === 'OS' || type.includes('ORDEM'))
    return targetId(context, 'ordens_servico', legacyId);
  if (type.includes('ACAO') || type.includes('ACTION'))
    return targetId(context, 'os_acoes', legacyId);
  if (type.includes('EXECUCAO') || type.includes('EXECUTION'))
    return targetId(context, 'execucoes', legacyId);
  if (type.includes('OCORRENCIA') || type.includes('OCCURRENCE'))
    return targetId(context, 'ocorrencias_operacionais', legacyId);
  if (type.includes('ANALISE') || type.includes('ANALYSIS'))
    return targetId(context, 'analises_tecnicas', legacyId);
  if (type.includes('PARADA') || type.includes('STOP'))
    return targetId(context, 'paradas_equipamento', legacyId);
  if (type.includes('COMPONENT')) return targetId(context, 'componentes', legacyId);
  if (type.includes('ATIVO') || type.includes('ASSET') || type.includes('EQUIP'))
    return targetId(context, 'ativos', legacyId);
  return targetId(context, `legacy-entity:${type || 'UNKNOWN'}`, legacyId);
}

export async function ensureDefaultServiceCalendar(context: MigrationLoadContext): Promise<string> {
  const id = targetId(context, 'service_calendars', 'DEFAULT');
  await context.client.query(
    `INSERT INTO workflow.service_calendars (id,tenant_id,code,name,timezone,status)
     VALUES ($1,$2,'DEFAULT','Calendario padrao',$3,'ACTIVE')
     ON CONFLICT (tenant_id,code) DO UPDATE SET timezone=EXCLUDED.timezone,status='ACTIVE'`,
    [id, context.tenantId, context.timeZone],
  );
  return id;
}

function validatorList(value: SourceScalar | undefined, field: string): readonly string[] {
  const parsed = jsonValue(value, field, []);
  if (!Array.isArray(parsed)) throw new Error(`${field} deve ser uma lista.`);
  return parsed
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function loadTechnicalDemand(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'demandas_tecnicas', legacyId);
  const requiredCount = Math.max(
    0,
    integerValue(row.payload.assinaturas_necessarias, 'assinaturas_necessarias', 0),
  );
  const completedCount = Math.min(
    requiredCount,
    Math.max(0, integerValue(row.payload.assinaturas_realizadas, 'assinaturas_realizadas', 0)),
  );
  const entityType = text(row.payload, 'entidade_tipo').toUpperCase();
  const entityId = resolvePolymorphicEntityId(context, entityType, row.payload.entidade_id);
  const sourceStatus = enumValue(row.payload.status, 'status', technicalDemandStatus, 'OPEN');
  const entityLegacyId = optionalText(row.payload.entidade_id);
  const workOrderHasExecution =
    (entityType.includes('WORK_ORDER') || entityType === 'OS' || entityType.includes('ORDEM')) &&
    entityLegacyId !== null &&
    (context.snapshot.sheets
      .find((candidate) => candidate.name === 'execucoes')
      ?.rows.some((execution) => optionalText(execution.payload.os_id) === entityLegacyId) ??
      false);
  const loadStatus = workOrderHasExecution ? 'TECHNICALLY_APPROVED' : sourceStatus;
  const policy = enumValue(
    row.payload.politica_assinatura,
    'politica_assinatura',
    signaturePolicies,
    'QUALIDADE_OU_SEGURANCA',
  );
  await context.client.query(
    `INSERT INTO workflow.technical_demands
     (id,tenant_id,legacy_id,demand_type,entity_type,entity_id,origin_type,origin_id,title,
      description,priority,status,origin_area_id,current_area_id,current_technical_role_id,
      current_responsible_id,created_by,creator_role_snapshot,signature_required,
      required_signature_count,completed_signature_count,segregation_required,signature_policy,
      first_response_due_at,resolution_due_at,first_attended_at,completed_at,entity_version,
      payload_hash_sha256,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,
             COALESCE($30::timestamptz,clock_timestamp()),COALESCE($31::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       demand_type=EXCLUDED.demand_type,entity_type=EXCLUDED.entity_type,entity_id=EXCLUDED.entity_id,
       title=EXCLUDED.title,description=EXCLUDED.description,priority=EXCLUDED.priority,
       status=EXCLUDED.status,current_area_id=EXCLUDED.current_area_id,
       current_technical_role_id=EXCLUDED.current_technical_role_id,
       current_responsible_id=EXCLUDED.current_responsible_id,
       signature_required=EXCLUDED.signature_required,
       required_signature_count=EXCLUDED.required_signature_count,
       completed_signature_count=EXCLUDED.completed_signature_count,
       segregation_required=EXCLUDED.segregation_required,signature_policy=EXCLUDED.signature_policy,
       first_response_due_at=EXCLUDED.first_response_due_at,resolution_due_at=EXCLUDED.resolution_due_at,
       first_attended_at=EXCLUDED.first_attended_at,completed_at=EXCLUDED.completed_at,
       entity_version=EXCLUDED.entity_version,payload_hash_sha256=EXCLUDED.payload_hash_sha256,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'tipo'),
      entityType,
      entityId,
      text(row.payload, 'origem_tipo', 'MIGRATION'),
      optionalText(row.payload.origem_id)
        ? resolvePolymorphicEntityId(context, row.payload.origem_tipo, row.payload.origem_id)
        : null,
      text(row.payload, 'titulo'),
      text(row.payload, 'descricao', text(row.payload, 'titulo')),
      enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      loadStatus,
      referenceId(context, 'areas_tecnicas', row.payload.area_origem_id, 'area_origem_id', true),
      referenceId(context, 'areas_tecnicas', row.payload.area_atual_id, 'area_atual_id', true),
      referenceId(context, 'cargos_tecnicos', row.payload.cargo_atual_id, 'cargo_atual_id', true),
      referenceId(
        context,
        'usuarios',
        row.payload.responsavel_atual_id,
        'responsavel_atual_id',
        true,
      ),
      referenceId(context, 'usuarios', row.payload.criado_por, 'criado_por'),
      text(row.payload, 'criado_perfil', 'GESTOR'),
      booleanValue(row.payload.exige_assinatura, false),
      requiredCount,
      completedCount,
      booleanValue(row.payload.exige_segregacao, true),
      policy,
      timestamp(
        row.payload.prazo_primeira_resposta_em,
        'prazo_primeira_resposta_em',
        context.timeZone,
      ),
      timestamp(row.payload.prazo_resolucao_em, 'prazo_resolucao_em', context.timeZone),
      timestamp(row.payload.primeiro_atendimento_em, 'primeiro_atendimento_em', context.timeZone),
      timestamp(row.payload.concluido_em, 'concluido_em', context.timeZone),
      Math.max(1, integerValue(row.payload.versao_entidade, 'versao_entidade', 1)),
      optionalText(row.payload.payload_hash) ?? row.hashSha256,
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );

  const areas = validatorList(row.payload.areas_validadoras_json, 'areas_validadoras_json');
  const users = validatorList(row.payload.usuarios_validadores_json, 'usuarios_validadores_json');
  for (const [index, areaLegacyId] of areas.entries()) {
    const requirementId = targetId(
      context,
      'demand_validator_requirements',
      `${legacyId}:AREA:${areaLegacyId}`,
    );
    await context.client.query(
      `INSERT INTO workflow.demand_validator_requirements
       (id,tenant_id,technical_demand_id,requirement_code,technical_area_id,required_count,
        fulfilled_count,status,fulfilled_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
       ON CONFLICT (tenant_id,technical_demand_id,requirement_code) DO UPDATE SET
         technical_area_id=EXCLUDED.technical_area_id,fulfilled_count=EXCLUDED.fulfilled_count,
         status=EXCLUDED.status,fulfilled_at=EXCLUDED.fulfilled_at`,
      [
        requirementId,
        context.tenantId,
        id,
        `AREA_${index + 1}`,
        targetId(context, 'areas_tecnicas', areaLegacyId),
        completedCount > index ? 1 : 0,
        completedCount > index ? 'FULFILLED' : 'PENDING',
        completedCount > index
          ? timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone)
          : null,
      ],
    );
  }
  for (const [index, userLegacyId] of users.entries()) {
    const requirementId = targetId(
      context,
      'demand_validator_requirements',
      `${legacyId}:USER:${userLegacyId}`,
    );
    await context.client.query(
      `INSERT INTO workflow.demand_validator_requirements
       (id,tenant_id,technical_demand_id,requirement_code,user_id,required_count,
        fulfilled_count,status,fulfilled_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
       ON CONFLICT (tenant_id,technical_demand_id,requirement_code) DO UPDATE SET
         user_id=EXCLUDED.user_id,fulfilled_count=EXCLUDED.fulfilled_count,
         status=EXCLUDED.status,fulfilled_at=EXCLUDED.fulfilled_at`,
      [
        requirementId,
        context.tenantId,
        id,
        `USER_${index + 1}`,
        targetId(context, 'usuarios', userLegacyId),
        completedCount > areas.length + index ? 1 : 0,
        completedCount > areas.length + index ? 'FULFILLED' : 'PENDING',
        completedCount > areas.length + index
          ? timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone)
          : null,
      ],
    );
  }
  return { schema: 'workflow', table: 'technical_demands', id };
}

export async function loadDemandEvent(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'demanda_tramitacoes', legacyId);
  await context.client.query(
    `INSERT INTO workflow.demand_events
     (id,tenant_id,legacy_id,technical_demand_id,sequence,action,from_area_id,
      from_technical_role_id,from_user_id,to_area_id,to_technical_role_id,to_user_id,
      decision,opinion,reason,payload_hash_sha256,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             COALESCE($17::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'demandas_tecnicas', row.payload.demanda_id, 'demanda_id'),
      Math.max(1, integerValue(row.payload.sequencia, 'sequencia')),
      text(row.payload, 'acao'),
      referenceId(context, 'areas_tecnicas', row.payload.de_area_id, 'de_area_id', true),
      referenceId(context, 'cargos_tecnicos', row.payload.de_cargo_id, 'de_cargo_id', true),
      referenceId(context, 'usuarios', row.payload.de_usuario_id, 'de_usuario_id', true),
      referenceId(context, 'areas_tecnicas', row.payload.para_area_id, 'para_area_id', true),
      referenceId(context, 'cargos_tecnicos', row.payload.para_cargo_id, 'para_cargo_id', true),
      referenceId(context, 'usuarios', row.payload.para_usuario_id, 'para_usuario_id', true),
      optionalText(row.payload.decisao),
      optionalText(row.payload.parecer),
      optionalText(row.payload.motivo),
      optionalText(row.payload.payload_hash) ?? row.hashSha256,
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'workflow', table: 'demand_events', id };
}

export async function loadTechnicalSignature(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'assinaturas_tecnicas', legacyId);
  const entityType = text(row.payload, 'entidade_tipo').toUpperCase();
  const entityId = resolvePolymorphicEntityId(context, entityType, row.payload.entidade_id);
  const payloadHash = optionalText(row.payload.payload_hash) ?? row.hashSha256;
  const userId = referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id');
  const signedAt = timestamp(row.payload.criado_em, 'criado_em', context.timeZone);
  await context.client.query(
    `INSERT INTO workflow.technical_signatures
     (id,tenant_id,legacy_id,technical_demand_id,entity_type,entity_id,entity_version,user_id,
      role_snapshot,technical_area_id,technical_role_id,meaning,declaration,payload_hash_sha256,
      signature_hash_sha256,signed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             COALESCE($16::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'demandas_tecnicas', row.payload.demanda_id, 'demanda_id'),
      entityType,
      entityId,
      Math.max(1, integerValue(row.payload.versao_entidade, 'versao_entidade', 1)),
      userId,
      text(row.payload, 'perfil', 'GESTOR'),
      referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id'),
      referenceId(context, 'cargos_tecnicos', row.payload.cargo_id, 'cargo_id', true),
      text(row.payload, 'significado'),
      text(row.payload, 'declaracao'),
      payloadHash,
      hashSha256([context.tenantId, legacyId, userId, entityId, payloadHash, signedAt].join('|')),
      signedAt,
    ],
  );
  const revokedAt = timestamp(row.payload.revogado_em, 'revogado_em', context.timeZone);
  if (revokedAt) {
    await context.client.query(
      `INSERT INTO workflow.technical_signature_revocations
       (id,tenant_id,technical_signature_id,reason,revoked_by,payload_hash_sha256,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,technical_signature_id) DO NOTHING`,
      [
        targetId(context, 'assinaturas_tecnicas:revocation', legacyId),
        context.tenantId,
        id,
        text(row.payload, 'motivo_revogacao', 'Revogacao importada do ambiente legado.'),
        userId,
        hashSha256(`${payloadHash}|revoked|${revokedAt}`),
        revokedAt,
      ],
    );
  }
  return { schema: 'workflow', table: 'technical_signatures', id };
}

export async function loadTechnicalAnalysis(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'analises_tecnicas', legacyId);
  const report = jsonValue(row.payload.relatorio_tecnico_json, 'relatorio_tecnico_json', {});
  if (!report || Array.isArray(report) || typeof report !== 'object')
    throw new Error('relatorio_tecnico_json deve ser um objeto.');
  await context.client.query(
    `INSERT INTO workflow.technical_analyses
     (id,tenant_id,legacy_id,technical_demand_id,occurrence_id,asset_id,component_id,
      author_id,technical_area_id,technical_role_id,title,diagnosis,risk,probable_cause,
      recommendation,recommends_checklist,recommends_work_order,priority,status,report,
      sent_to_admin_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20::jsonb,$21,COALESCE($22::timestamptz,clock_timestamp()),
             COALESCE($23::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       title=EXCLUDED.title,diagnosis=EXCLUDED.diagnosis,risk=EXCLUDED.risk,
       probable_cause=EXCLUDED.probable_cause,recommendation=EXCLUDED.recommendation,
       recommends_checklist=EXCLUDED.recommends_checklist,
       recommends_work_order=EXCLUDED.recommends_work_order,priority=EXCLUDED.priority,
       status=EXCLUDED.status,report=EXCLUDED.report,sent_to_admin_at=EXCLUDED.sent_to_admin_at,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'demandas_tecnicas', row.payload.demanda_id, 'demanda_id', true),
      referenceId(
        context,
        'ocorrencias_operacionais',
        row.payload.ocorrencia_id,
        'ocorrencia_id',
        true,
      ),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      referenceId(context, 'usuarios', row.payload.autor_id, 'autor_id'),
      referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id'),
      referenceId(context, 'cargos_tecnicos', row.payload.cargo_id, 'cargo_id', true),
      text(row.payload, 'titulo'),
      text(row.payload, 'diagnostico'),
      text(row.payload, 'risco'),
      optionalText(row.payload.causa_provavel),
      text(row.payload, 'recomendacao'),
      booleanValue(row.payload.recomenda_checklist, false),
      booleanValue(row.payload.recomenda_os, false),
      enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      enumValue(row.payload.status, 'status', analysisStatus, 'DRAFT'),
      JSON.stringify(report),
      timestamp(row.payload.enviado_admin_em, 'enviado_admin_em', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'workflow', table: 'technical_analyses', id };
}

export async function loadNotification(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'notificacoes', legacyId);
  const entityType = optionalText(row.payload.entidade_tipo)?.toUpperCase() ?? null;
  const entityId =
    entityType && optionalText(row.payload.entidade_id)
      ? resolvePolymorphicEntityId(context, entityType, row.payload.entidade_id)
      : null;
  const userId = referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id', true);
  const areaId = referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id', true);
  const readAt = timestamp(row.payload.lida_em, 'lida_em', context.timeZone);
  const audience = {
    legacy_profile: optionalText(row.payload.perfil),
    technical_area_id: areaId,
    direct_user_id: userId,
  };
  await context.client.query(
    `INSERT INTO workflow.notifications
     (id,tenant_id,legacy_id,notification_type,title,message,entity_type,entity_id,priority,
      status,action_payload,audience,deduplication_key,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10::jsonb,$11::jsonb,$12,
             COALESCE($13::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       notification_type=EXCLUDED.notification_type,title=EXCLUDED.title,message=EXCLUDED.message,
       entity_type=EXCLUDED.entity_type,entity_id=EXCLUDED.entity_id,priority=EXCLUDED.priority,
       action_payload=EXCLUDED.action_payload,audience=EXCLUDED.audience,
       deduplication_key=EXCLUDED.deduplication_key`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'tipo'),
      text(row.payload, 'titulo'),
      text(row.payload, 'mensagem'),
      entityType,
      entityId,
      upper(row.payload.prioridade) === 'INFO'
        ? 'INFO'
        : enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      JSON.stringify({
        legacy_entity_type: entityType,
        legacy_entity_id: optionalText(row.payload.entidade_id),
      }),
      JSON.stringify(audience),
      `legacy:notificacoes:${legacyId}`,
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  if (userId) {
    await context.client.query(
      `INSERT INTO workflow.notification_recipients
       (tenant_id,notification_id,user_id,delivery_status,delivered_at,read_at,last_notified_at,
        delivery_attempts,created_at)
       VALUES ($1,$2,$3,'DELIVERED',$4,$5,$4,1,$4)
       ON CONFLICT (tenant_id,notification_id,user_id) DO UPDATE SET
         delivery_status='DELIVERED',delivered_at=EXCLUDED.delivered_at,
         read_at=EXCLUDED.read_at,last_notified_at=EXCLUDED.last_notified_at`,
      [
        context.tenantId,
        id,
        userId,
        timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
        readAt,
      ],
    );
  }
  return { schema: 'workflow', table: 'notifications', id };
}

export async function loadSlaPolicy(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'sla_politicas', legacyId);
  const calendarId = await ensureDefaultServiceCalendar(context);
  await context.client.query(
    `INSERT INTO workflow.sla_policies
     (id,tenant_id,legacy_id,demand_type,priority,technical_area_id,first_response_minutes,
      resolution_minutes,service_calendar_id,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE($11::timestamptz,clock_timestamp()),COALESCE($12::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       demand_type=EXCLUDED.demand_type,priority=EXCLUDED.priority,
       technical_area_id=EXCLUDED.technical_area_id,
       first_response_minutes=EXCLUDED.first_response_minutes,
       resolution_minutes=EXCLUDED.resolution_minutes,status=EXCLUDED.status,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'tipo_demanda'),
      enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      referenceId(context, 'areas_tecnicas', row.payload.area_id, 'area_id', true),
      Math.max(1, integerValue(row.payload.resposta_minutos, 'resposta_minutos')),
      Math.max(1, integerValue(row.payload.resolucao_minutos, 'resolucao_minutos')),
      calendarId,
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE') === 'ACTIVE'
        ? 'ACTIVE'
        : 'INACTIVE',
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'workflow', table: 'sla_policies', id };
}

export async function linkWorkflowReferences(context: MigrationLoadContext): Promise<void> {
  const occurrences = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'ocorrencias_operacionais',
  );
  for (const row of occurrences?.rows ?? []) {
    await context.client.query(
      `UPDATE maintenance.operational_occurrences SET
         technical_demand_id=$3,technical_analysis_id=$4
       WHERE tenant_id=$1 AND id=$2`,
      [
        context.tenantId,
        targetId(context, 'ocorrencias_operacionais', requiredLegacyId(row)),
        referenceId(
          context,
          'demandas_tecnicas',
          row.payload.demanda_tecnica_id,
          'demanda_tecnica_id',
          true,
        ),
        referenceId(
          context,
          'analises_tecnicas',
          row.payload.analise_tecnica_id,
          'analise_tecnica_id',
          true,
        ),
      ],
    );
  }
  const workOrders = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'ordens_servico',
  );
  const demands =
    context.snapshot.sheets.find((candidate) => candidate.name === 'demandas_tecnicas')?.rows ?? [];
  const demandByWorkOrder = new Map<string, string>();
  for (const demand of demands) {
    const type = normalizedToken(demand.payload.entidade_tipo);
    if (type.includes('WORK_ORDER') || type === 'OS' || type.includes('ORDEM')) {
      const entityLegacyId = optionalText(demand.payload.entidade_id);
      if (entityLegacyId) demandByWorkOrder.set(entityLegacyId, requiredLegacyId(demand));
    }
  }
  for (const workOrder of workOrders?.rows ?? []) {
    const workOrderLegacyId = requiredLegacyId(workOrder);
    const demandLegacyId = demandByWorkOrder.get(workOrderLegacyId);
    if (!demandLegacyId) continue;
    await context.client.query(
      `UPDATE maintenance.work_orders SET technical_demand_id=$3
       WHERE tenant_id=$1 AND id=$2`,
      [
        context.tenantId,
        targetId(context, 'ordens_servico', workOrderLegacyId),
        targetId(context, 'demandas_tecnicas', demandLegacyId),
      ],
    );
  }
}
