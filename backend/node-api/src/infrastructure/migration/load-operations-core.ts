import {
  actionStatus,
  checklistExecutionStatus,
  executionStatus,
  priority,
  stopMode,
  technicalDemandStatus,
  workOrderStatus,
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
import { planVersionId } from './load-planning.js';
import type { SourceRowSnapshot, SourceScalar } from './source-snapshot.js';

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

function analysis(value: SourceScalar | undefined, field: string): string {
  const parsed = jsonValue(value, field, {});
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${field} deve ser um objeto.`);
  }
  return JSON.stringify(parsed);
}

function executionStopMode(value: SourceScalar | undefined): string | null {
  const normalized = upper(value);
  if (!normalized) return null;
  if (['SEM_PARADA', 'NO_STOP', 'EXECUTAR_SEM_PARADA'].includes(normalized)) return 'NO_STOP';
  if (['PARADO', 'STOPPED', 'PARADA_OBRIGATORIA'].includes(normalized)) return 'STOPPED';
  return 'EXECUTOR_DECISION';
}

function evidenceType(value: SourceScalar | undefined): string {
  const normalized = upper(value) ?? 'OTHER';
  if (['FOTO', 'PHOTO', 'IMAGE', 'IMAGEM'].includes(normalized)) return 'PHOTO';
  if (['VIDEO', 'VÍDEO'].includes(normalized)) return 'VIDEO';
  if (['DOCUMENTO', 'DOCUMENT', 'PDF'].includes(normalized)) return 'DOCUMENT';
  if (['AUDIO', 'ÁUDIO'].includes(normalized)) return 'AUDIO';
  return 'OTHER';
}

export async function loadWorkOrder(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'ordens_servico', legacyId);
  const sourceStatus = enumValue(row.payload.status, 'status', workOrderStatus, 'DRAFT');
  const hasExecution =
    context.snapshot.sheets
      .find((candidate) => candidate.name === 'execucoes')
      ?.rows.some((execution) => optionalText(execution.payload.os_id) === legacyId) ?? false;
  const status = hasExecution ? 'RELEASED' : sourceStatus;
  const demandRow = context.snapshot.sheets
    .find((candidate) => candidate.name === 'demandas_tecnicas')
    ?.rows.find((candidate) => {
      const type = upper(candidate.payload.entidade_tipo) ?? '';
      return (
        optionalText(candidate.payload.entidade_id) === legacyId &&
        (type.includes('WORK_ORDER') || type === 'OS' || type.includes('ORDEM'))
      );
    });
  const technicalDemandId = demandRow
    ? targetId(context, 'demandas_tecnicas', requiredLegacyId(demandRow))
    : null;
  const contentHash = demandRow
    ? (optionalText(demandRow.payload.payload_hash) ?? demandRow.hashSha256)
    : row.hashSha256;
  if (status === 'RELEASED' && !technicalDemandId) {
    throw new Error(
      `A OS ${legacyId} possui execução histórica, mas não possui demanda técnica vinculável.`,
    );
  }
  await context.client.query(
    `INSERT INTO maintenance.work_orders
     (id,tenant_id,legacy_id,code,asset_id,component_id,maintenance_plan_version_id,technical_demand_id,
      origin_type,work_type,title,description,priority,status,requester_id,responsible_id,
      maintenance_stop_mode,technical_analysis,opened_at,scheduled_for,started_at,
      completed_at,created_at,updated_at,content_hash_sha256,submitted_at,released_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,
             $21,$22,COALESCE($23::timestamptz,clock_timestamp()),
             COALESCE($24::timestamptz,clock_timestamp()),$25,$26,$27)
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       code=EXCLUDED.code,asset_id=EXCLUDED.asset_id,component_id=EXCLUDED.component_id,
       maintenance_plan_version_id=EXCLUDED.maintenance_plan_version_id,
       technical_demand_id=EXCLUDED.technical_demand_id,
       origin_type=EXCLUDED.origin_type,work_type=EXCLUDED.work_type,title=EXCLUDED.title,
       description=EXCLUDED.description,priority=EXCLUDED.priority,status=EXCLUDED.status,
       requester_id=EXCLUDED.requester_id,responsible_id=EXCLUDED.responsible_id,
       maintenance_stop_mode=EXCLUDED.maintenance_stop_mode,
       technical_analysis=EXCLUDED.technical_analysis,opened_at=EXCLUDED.opened_at,
       scheduled_for=EXCLUDED.scheduled_for,started_at=EXCLUDED.started_at,
       completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at,
       content_hash_sha256=EXCLUDED.content_hash_sha256,submitted_at=EXCLUDED.submitted_at,
       released_at=EXCLUDED.released_at`,
    [
      id,
      context.tenantId,
      legacyId,
      text(row.payload, 'codigo', legacyId),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      planVersionId(context, text(row.payload, 'plano_id')),
      technicalDemandId,
      text(row.payload, 'origem', 'MIGRATION'),
      text(row.payload, 'tipo', 'MAINTENANCE'),
      text(row.payload, 'titulo'),
      text(row.payload, 'descricao', text(row.payload, 'titulo')),
      enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      status,
      referenceId(context, 'usuarios', row.payload.solicitante_id, 'solicitante_id'),
      referenceId(context, 'usuarios', row.payload.responsavel_id, 'responsavel_id', true),
      enumValue(
        row.payload.modo_parada_manutencao,
        'modo_parada_manutencao',
        stopMode,
        'EXECUTOR_DECISION',
      ),
      analysis(row.payload.analise_tecnica_json, 'analise_tecnica_json'),
      timestamp(row.payload.aberta_em, 'aberta_em', context.timeZone),
      timestamp(row.payload.planejada_para, 'planejada_para', context.timeZone),
      timestamp(row.payload.iniciada_em, 'iniciada_em', context.timeZone),
      timestamp(row.payload.finalizada_em, 'finalizada_em', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      contentHash,
      [
        'IN_TECHNICAL_REVIEW',
        'CHANGES_REQUESTED',
        'APPROVED',
        'RELEASED',
        'IN_PROGRESS',
        'BLOCKED',
        'COMPLETED',
      ].includes(status)
        ? timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone)
        : null,
      ['RELEASED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'].includes(status)
        ? timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone)
        : null,
    ],
  );
  return { schema: 'maintenance', table: 'work_orders', id };
}

export async function loadWorkOrderAction(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'os_acoes', legacyId);
  const sourceStatus = enumValue(row.payload.status, 'status', actionStatus, 'PENDING');
  const hasExecution =
    context.snapshot.sheets
      .find((candidate) => candidate.name === 'execucoes')
      ?.rows.some((execution) => optionalText(execution.payload.acao_id) === legacyId) ?? false;
  const loadStatus = hasExecution ? 'READY' : sourceStatus;
  await context.client.query(
    `INSERT INTO maintenance.work_order_actions
     (id,tenant_id,legacy_id,work_order_id,asset_id,component_id,maintenance_plan_version_id,
      origin,action_type,title,description,priority,status,responsible_id,maintenance_stop_mode,
      technical_analysis,generated_at,started_at,completed_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,
             COALESCE($17::timestamptz,clock_timestamp()),$18,$19,
             COALESCE($20::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       work_order_id=EXCLUDED.work_order_id,asset_id=EXCLUDED.asset_id,
       component_id=EXCLUDED.component_id,maintenance_plan_version_id=EXCLUDED.maintenance_plan_version_id,
       origin=EXCLUDED.origin,action_type=EXCLUDED.action_type,title=EXCLUDED.title,
       description=EXCLUDED.description,priority=EXCLUDED.priority,status=EXCLUDED.status,
       responsible_id=EXCLUDED.responsible_id,maintenance_stop_mode=EXCLUDED.maintenance_stop_mode,
       technical_analysis=EXCLUDED.technical_analysis,generated_at=EXCLUDED.generated_at,
       started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id'),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      planVersionId(context, text(row.payload, 'plano_id')),
      text(row.payload, 'origem', 'MIGRATION'),
      text(row.payload, 'tipo', 'CHECKLIST'),
      text(row.payload, 'titulo'),
      text(row.payload, 'descricao', text(row.payload, 'titulo')),
      enumValue(row.payload.prioridade, 'prioridade', priority, 'MEDIUM'),
      loadStatus,
      referenceId(context, 'usuarios', row.payload.responsavel_id, 'responsavel_id', true),
      enumValue(
        row.payload.modo_parada_manutencao,
        'modo_parada_manutencao',
        stopMode,
        'EXECUTOR_DECISION',
      ),
      analysis(row.payload.analise_tecnica_json, 'analise_tecnica_json'),
      timestamp(row.payload.gerado_em, 'gerado_em', context.timeZone),
      timestamp(row.payload.iniciado_em, 'iniciado_em', context.timeZone),
      timestamp(row.payload.finalizado_em, 'finalizado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'work_order_actions', id };
}

export async function loadExecution(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'execucoes', legacyId);
  const sourceStatus = enumValue(row.payload.status, 'status', executionStatus, 'OPEN');
  const loadStatus = ['COMPLETED', 'CANCELLED'].includes(sourceStatus)
    ? 'IN_PROGRESS'
    : sourceStatus;
  await context.client.query(
    `INSERT INTO maintenance.executions
     (id,tenant_id,legacy_id,work_order_action_id,work_order_id,asset_id,component_id,
      operator_id,status,result,observation,duration_seconds,execution_stop_mode,opened_at,
      started_at,completed_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             COALESCE($14::timestamptz,clock_timestamp()),$15,$16,
             COALESCE($17::timestamptz,clock_timestamp()),
             COALESCE($18::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       work_order_action_id=EXCLUDED.work_order_action_id,work_order_id=EXCLUDED.work_order_id,
       asset_id=EXCLUDED.asset_id,component_id=EXCLUDED.component_id,operator_id=EXCLUDED.operator_id,
       status=EXCLUDED.status,result=EXCLUDED.result,observation=EXCLUDED.observation,
       duration_seconds=EXCLUDED.duration_seconds,execution_stop_mode=EXCLUDED.execution_stop_mode,
       opened_at=EXCLUDED.opened_at,started_at=EXCLUDED.started_at,
       completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id'),
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id'),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      referenceId(context, 'usuarios', row.payload.operador_id, 'operador_id'),
      loadStatus,
      optionalText(row.payload.resultado),
      optionalText(row.payload.observacao),
      optionalText(row.payload.duracao_segundos) === null
        ? null
        : Math.max(0, integerValue(row.payload.duracao_segundos, 'duracao_segundos')),
      executionStopMode(row.payload.modo_execucao_manutencao),
      timestamp(row.payload.abriu_em, 'abriu_em', context.timeZone),
      timestamp(row.payload.iniciou_em, 'iniciou_em', context.timeZone),
      timestamp(row.payload.finalizou_em, 'finalizou_em', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'executions', id };
}

export async function finalizeOperationalStatuses(context: MigrationLoadContext): Promise<void> {
  const executions = context.snapshot.sheets.find((candidate) => candidate.name === 'execucoes');
  for (const row of executions?.rows ?? []) {
    const status = enumValue(row.payload.status, 'status', executionStatus, 'OPEN');
    await context.client.query(
      `UPDATE maintenance.executions
       SET status=$3,updated_at=COALESCE($4::timestamptz,updated_at)
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [
        context.tenantId,
        targetId(context, 'execucoes', requiredLegacyId(row)),
        status,
        timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ],
    );
  }

  const actions = context.snapshot.sheets.find((candidate) => candidate.name === 'os_acoes');
  for (const row of actions?.rows ?? []) {
    const status = enumValue(row.payload.status, 'status', actionStatus, 'PENDING');
    await context.client.query(
      `UPDATE maintenance.work_order_actions
       SET status=$3,updated_at=COALESCE($4::timestamptz,updated_at)
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [
        context.tenantId,
        targetId(context, 'os_acoes', requiredLegacyId(row)),
        status,
        timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ],
    );
  }

  const workOrders = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'ordens_servico',
  );
  for (const row of workOrders?.rows ?? []) {
    const status = enumValue(row.payload.status, 'status', workOrderStatus, 'DRAFT');
    await context.client.query(
      `UPDATE maintenance.work_orders
       SET status=$3,updated_at=COALESCE($4::timestamptz,updated_at)
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [
        context.tenantId,
        targetId(context, 'ordens_servico', requiredLegacyId(row)),
        status,
        timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ],
    );
  }

  const demands = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'demandas_tecnicas',
  );
  for (const row of demands?.rows ?? []) {
    const status = enumValue(row.payload.status, 'status', technicalDemandStatus, 'OPEN');
    await context.client.query(
      `UPDATE workflow.technical_demands
       SET status=$3,updated_at=COALESCE($4::timestamptz,updated_at)
       WHERE tenant_id=$1 AND id=$2 AND status IS DISTINCT FROM $3`,
      [
        context.tenantId,
        targetId(context, 'demandas_tecnicas', requiredLegacyId(row)),
        status,
        timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ],
    );
  }
}

function parsedResponse(
  value: SourceScalar | undefined,
  typeCode: string,
): {
  readonly text: string | null;
  readonly number: number | null;
  readonly boolean: boolean | null;
  readonly option: string | null;
} {
  if (optionalText(value) === null)
    return { text: null, number: null, boolean: null, option: null };
  if (['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].includes(typeCode)) {
    return { text: null, number: numberValue(value, 'resposta'), boolean: null, option: null };
  }
  if (typeCode === 'CONFIRMACAO') {
    return { text: null, number: null, boolean: booleanValue(value), option: null };
  }
  if (typeCode === 'SELECAO' || typeCode === 'OK_NOK') {
    return { text: null, number: null, boolean: null, option: optionalText(value) };
  }
  return { text: optionalText(value), number: null, boolean: null, option: null };
}

export async function loadExecutionChecklistItem(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'checklist_execucao', legacyId);
  const typeCode = responseTypes[upper(row.payload.tipo_resposta) ?? ''] ?? 'TEXTO';
  const response = parsedResponse(row.payload.resposta, typeCode);
  const options = jsonValue(row.payload.opcoes_json, 'opcoes_json', []);
  if (!Array.isArray(options)) throw new Error('opcoes_json deve ser uma lista.');
  await context.client.query(
    `INSERT INTO maintenance.execution_checklist_items
     (id,tenant_id,legacy_id,execution_id,work_order_action_id,checklist_item_id,sequence,
      title_snapshot,instruction_snapshot,response_type_code,category_snapshot,required,
      evidence_required,minimum_evidence_photos,blocks_completion,expected_value_snapshot,
      minimum_value_snapshot,maximum_value_snapshot,unit_snapshot,options_snapshot,
      validation_rule_snapshot,response_text,response_number,response_boolean,response_option,
      observation,compliant,validation_message,evidence_count,status,answered_by,answered_at,
      created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20::jsonb,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
             COALESCE($33::timestamptz,clock_timestamp()),
             COALESCE($34::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       response_text=EXCLUDED.response_text,response_number=EXCLUDED.response_number,
       response_boolean=EXCLUDED.response_boolean,response_option=EXCLUDED.response_option,
       observation=EXCLUDED.observation,compliant=EXCLUDED.compliant,
       validation_message=EXCLUDED.validation_message,evidence_count=EXCLUDED.evidence_count,
       status=EXCLUDED.status,answered_by=EXCLUDED.answered_by,answered_at=EXCLUDED.answered_at,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id'),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id'),
      referenceId(context, 'plano_itens', row.payload.plano_item_id, 'plano_item_id'),
      Math.max(1, integerValue(row.payload.ordem, 'ordem')),
      text(row.payload, 'titulo'),
      optionalText(row.payload.instrucao),
      typeCode,
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
      JSON.stringify(
        optionalText(row.payload.validacao_msg)
          ? { legacy_message: optionalText(row.payload.validacao_msg) }
          : {},
      ),
      response.text,
      response.number,
      response.boolean,
      response.option,
      optionalText(row.payload.observacao),
      optionalText(row.payload.conforme) === null ? null : booleanValue(row.payload.conforme),
      optionalText(row.payload.validacao_msg),
      Math.max(0, integerValue(row.payload.evidencias_count, 'evidencias_count', 0)),
      enumValue(row.payload.status, 'status', checklistExecutionStatus, 'PENDING'),
      referenceId(context, 'usuarios', row.payload.responsavel_id, 'responsavel_id', true),
      timestamp(row.payload.data_hora, 'data_hora', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'execution_checklist_items', id };
}

export async function loadEvidence(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const storageLegacyId = optionalText(row.payload.arquivo_id) ?? `evidence:${legacyId}`;
  const storageId = targetId(context, 'storage_objects', storageLegacyId);
  const id = targetId(context, 'evidencias', legacyId);
  const objectKey = optionalText(row.payload.url) ?? `legacy/evidence/${storageLegacyId}`;
  await context.client.query(
    `INSERT INTO platform.storage_objects
     (id,tenant_id,legacy_id,provider,bucket,object_key,original_name,media_type,byte_size,
      checksum_sha256,status,metadata,created_by,created_at)
     VALUES ($1,$2,$3,'LEGACY_GOOGLE','legacy-import',$4,$5,$6,$7,$8,'AVAILABLE',$9::jsonb,$10,
             COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       object_key=EXCLUDED.object_key,original_name=EXCLUDED.original_name,
       media_type=EXCLUDED.media_type,byte_size=EXCLUDED.byte_size,
       checksum_sha256=EXCLUDED.checksum_sha256,status='AVAILABLE',metadata=EXCLUDED.metadata`,
    [
      storageId,
      context.tenantId,
      storageLegacyId,
      objectKey,
      text(row.payload, 'nome_arquivo', storageLegacyId),
      text(row.payload, 'mime_type', 'application/octet-stream'),
      Math.max(0, integerValue(row.payload.tamanho_bytes, 'tamanho_bytes', 0)),
      hashSha256(objectKey),
      JSON.stringify({
        legacy_url: optionalText(row.payload.url),
        thumbnail_url: optionalText(row.payload.thumbnail_url),
      }),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  await context.client.query(
    `INSERT INTO maintenance.evidence
     (id,tenant_id,legacy_id,execution_id,work_order_action_id,execution_checklist_item_id,
      asset_id,component_id,evidence_type,storage_object_id,observation,user_id,captured_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             COALESCE($14::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       execution_checklist_item_id=EXCLUDED.execution_checklist_item_id,
       evidence_type=EXCLUDED.evidence_type,storage_object_id=EXCLUDED.storage_object_id,
       observation=EXCLUDED.observation,user_id=EXCLUDED.user_id,captured_at=EXCLUDED.captured_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id'),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id'),
      referenceId(
        context,
        'checklist_execucao',
        row.payload.checklist_execucao_id,
        'checklist_execucao_id',
        true,
      ),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      evidenceType(row.payload.tipo),
      storageId,
      optionalText(row.payload.observacao),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return {
    schema: 'maintenance',
    table: 'evidence',
    id,
    auxiliary: [
      {
        sourceName: 'evidencias:storage',
        legacyId: storageLegacyId,
        schema: 'platform',
        table: 'storage_objects',
        id: storageId,
      },
    ],
  };
}

export async function loadMaterialUsage(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'materiais_uso', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.material_usage
     (id,tenant_id,legacy_id,execution_id,work_order_action_id,material_id,quantity,unit,
      observation,user_id,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET quantity=EXCLUDED.quantity,
       unit=EXCLUDED.unit,observation=EXCLUDED.observation,user_id=EXCLUDED.user_id`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id'),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id'),
      referenceId(context, 'materiais', row.payload.material_id, 'material_id'),
      Math.max(Number.EPSILON, numberValue(row.payload.quantidade, 'quantidade')),
      text(row.payload, 'unidade'),
      optionalText(row.payload.observacao),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'material_usage', id };
}
