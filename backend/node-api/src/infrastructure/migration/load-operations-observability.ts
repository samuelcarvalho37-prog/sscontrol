import {
  activeStatus,
  equipmentStopStatus,
  occurrenceStatus,
  priority,
  stopMode,
  treatmentStatus,
} from './legacy-enums.js';
import {
  booleanValue,
  enumValue,
  hashSha256,
  integerValue,
  jsonValue,
  optionalNumber,
  optionalText,
  text,
  timestamp,
} from './legacy-values.js';
import {
  referenceId,
  requiredLegacyId,
  targetId,
  type LoadedTarget,
  type MigrationLoadContext,
} from './loader-context.js';
import type { SourceRowSnapshot, SourceScalar } from './source-snapshot.js';

const maintenanceStopStatus = {
  ABERTA: 'OPEN',
  OPEN: 'OPEN',
  EM_EXECUCAO: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  FINALIZADA: 'COMPLETED',
  CONCLUIDA: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  CANCELADA: 'CANCELLED',
  CANCELLED: 'CANCELLED',
} as const;

function parameterKey(row: SourceRowSnapshot): string {
  return [
    text(row.payload, 'ativo_id'),
    optionalText(row.payload.componente_id) ?? '-',
    text(row.payload, 'parametro').toUpperCase(),
  ].join(':');
}

function parameterDefinitionId(context: MigrationLoadContext, row: SourceRowSnapshot): string {
  return targetId(context, 'parameter_definitions', parameterKey(row));
}

function valueColumns(value: SourceScalar | undefined): {
  readonly type: 'DECIMAL' | 'BOOLEAN' | 'TEXT';
  readonly numeric: number | null;
  readonly boolean: boolean | null;
  readonly text: string | null;
} {
  if (typeof value === 'number')
    return { type: 'DECIMAL', numeric: value, boolean: null, text: null };
  if (typeof value === 'boolean')
    return { type: 'BOOLEAN', numeric: null, boolean: value, text: null };
  const normalized = optionalText(value);
  if (normalized === null)
    return { type: 'TEXT', numeric: null, boolean: null, text: '(vazio legado)' };
  const canonical = normalized.replace(/\s/g, '').replace(',', '.');
  const numeric = Number(canonical);
  if (Number.isFinite(numeric)) return { type: 'DECIMAL', numeric, boolean: null, text: null };
  if (['SIM', 'TRUE', 'YES', 'NAO', 'NÃO', 'FALSE', 'NO'].includes(normalized.toUpperCase())) {
    return { type: 'BOOLEAN', numeric: null, boolean: booleanValue(normalized), text: null };
  }
  return { type: 'TEXT', numeric: null, boolean: null, text: normalized };
}

export async function loadParameterReading(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'parametros', legacyId);
  const definitionId = parameterDefinitionId(context, row);
  const policyId = targetId(context, 'parameter_policies', parameterKey(row));
  const parsed = valueColumns(row.payload.valor);
  const code = text(row.payload, 'parametro')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const createdAt = timestamp(row.payload.criado_em, 'criado_em', context.timeZone);
  await context.client.query(
    `INSERT INTO cmms.parameter_definitions
     (id,tenant_id,legacy_id,asset_id,component_id,code,name,unit,value_type,source_type,
      description,status,metadata,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IMPORT','Definicao reconstruida da leitura legada.',
             'ACTIVE',$10::jsonb,COALESCE($11::timestamptz,clock_timestamp()),
             COALESCE($11::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       asset_id=EXCLUDED.asset_id,component_id=EXCLUDED.component_id,code=EXCLUDED.code,
       name=EXCLUDED.name,unit=EXCLUDED.unit,value_type=EXCLUDED.value_type,
       metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`,
    [
      definitionId,
      context.tenantId,
      parameterKey(row),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      code || 'PARAMETRO',
      text(row.payload, 'parametro'),
      text(row.payload, 'unidade', '-'),
      parsed.type,
      JSON.stringify({ migrated_from: 'parametros' }),
      createdAt,
    ],
  );
  await context.client.query(
    `INSERT INTO cmms.parameter_policies
     (id,tenant_id,parameter_definition_id,version,validation_rule,effective_from,status,
      content_hash_sha256,created_by,approved_by,created_at,approved_at)
     VALUES ($1,$2,$3,1,'{}'::jsonb,COALESCE($4::timestamptz,clock_timestamp()),'ACTIVE',$5,$6,$6,
             COALESCE($4::timestamptz,clock_timestamp()),COALESCE($4::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,parameter_definition_id,version) DO UPDATE SET
       status='ACTIVE',content_hash_sha256=EXCLUDED.content_hash_sha256`,
    [
      policyId,
      context.tenantId,
      definitionId,
      createdAt,
      hashSha256(`legacy-default-policy:${parameterKey(row)}`),
      context.actorId,
    ],
  );
  await context.client.query(
    `INSERT INTO cmms.parameter_readings
     (id,tenant_id,legacy_id,parameter_definition_id,parameter_policy_id,numeric_value,
      text_value,boolean_value,unit,classification,source,source_entity_type,source_entity_id,
      recorded_by,recorded_at,raw_value,metadata,created_at,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UNCLASSIFIED','MIGRATION','LEGACY_PARAMETER',$10,
             $11,COALESCE($12::timestamptz,clock_timestamp()),$13,$14::jsonb,
             COALESCE($15::timestamptz,clock_timestamp()),$16)
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      definitionId,
      policyId,
      parsed.numeric,
      parsed.text,
      parsed.boolean,
      text(row.payload, 'unidade', '-'),
      id,
      referenceId(context, 'usuarios', row.payload.registrado_por, 'registrado_por', true) ??
        context.actorId,
      timestamp(row.payload.registrado_em, 'registrado_em', context.timeZone),
      String(row.payload.valor ?? ''),
      JSON.stringify({
        legacy_origin: optionalText(row.payload.origem),
        source_hash_sha256: row.hashSha256,
      }),
      createdAt,
      `legacy:parametros:${legacyId}`,
    ],
  );
  return {
    schema: 'cmms',
    table: 'parameter_readings',
    id,
    auxiliary: [
      {
        sourceName: 'parametros:definition',
        legacyId: parameterKey(row),
        schema: 'cmms',
        table: 'parameter_definitions',
        id: definitionId,
      },
      {
        sourceName: 'parametros:policy',
        legacyId: parameterKey(row),
        schema: 'cmms',
        table: 'parameter_policies',
        id: policyId,
      },
    ],
  };
}

export async function loadEquipmentStop(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'paradas_equipamento', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.equipment_stops
     (id,tenant_id,legacy_id,asset_id,component_id,work_order_id,work_order_action_id,
      execution_id,origin,stop_type,status,started_at,started_by,maintenance_started_at,
      maintenance_completed_at,completed_at,completed_by,downtime_seconds,
      maintenance_wait_seconds,execution_seconds,operational_return_seconds,reason,
      return_category,divergence_justification,return_tolerance_minutes,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,clock_timestamp()),
             $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
             COALESCE($26::timestamptz,clock_timestamp()),COALESCE($27::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       maintenance_started_at=EXCLUDED.maintenance_started_at,
       maintenance_completed_at=EXCLUDED.maintenance_completed_at,completed_at=EXCLUDED.completed_at,
       completed_by=EXCLUDED.completed_by,downtime_seconds=EXCLUDED.downtime_seconds,
       maintenance_wait_seconds=EXCLUDED.maintenance_wait_seconds,
       execution_seconds=EXCLUDED.execution_seconds,
       operational_return_seconds=EXCLUDED.operational_return_seconds,
       reason=EXCLUDED.reason,return_category=EXCLUDED.return_category,
       divergence_justification=EXCLUDED.divergence_justification,
       return_tolerance_minutes=EXCLUDED.return_tolerance_minutes,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id', true),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id', true),
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id', true),
      text(row.payload, 'origem', 'MIGRATION'),
      text(row.payload, 'tipo', 'TECHNICAL'),
      'OPEN',
      timestamp(row.payload.iniciada_em, 'iniciada_em', context.timeZone),
      referenceId(context, 'usuarios', row.payload.iniciada_por, 'iniciada_por'),
      timestamp(row.payload.manutencao_iniciada_em, 'manutencao_iniciada_em', context.timeZone),
      timestamp(row.payload.manutencao_finalizada_em, 'manutencao_finalizada_em', context.timeZone),
      timestamp(row.payload.finalizada_em, 'finalizada_em', context.timeZone),
      referenceId(context, 'usuarios', row.payload.finalizada_por, 'finalizada_por', true),
      optionalNonNegativeInteger(row.payload.tempo_parada_segundos, 'tempo_parada_segundos'),
      optionalNonNegativeInteger(
        row.payload.tempo_espera_manutencao_segundos,
        'tempo_espera_manutencao_segundos',
      ),
      optionalNonNegativeInteger(row.payload.tempo_execucao_segundos, 'tempo_execucao_segundos'),
      optionalNonNegativeInteger(
        row.payload.tempo_retorno_operacional_segundos,
        'tempo_retorno_operacional_segundos',
      ),
      text(row.payload, 'motivo_parada', 'Parada importada do ambiente legado.'),
      optionalText(row.payload.categoria_retorno),
      optionalText(row.payload.justificativa_divergencia),
      Math.max(0, integerValue(row.payload.tolerancia_retorno_min, 'tolerancia_retorno_min', 10)),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'equipment_stops', id };
}

export async function finalizeObservabilityStatuses(context: MigrationLoadContext): Promise<void> {
  const stops = context.snapshot.sheets.find(
    (candidate) => candidate.name === 'paradas_equipamento',
  );
  for (const row of stops?.rows ?? []) {
    const desired = enumValue(row.payload.status, 'status', equipmentStopStatus, 'OPEN');
    const transitions: readonly string[] =
      desired === 'WAITING_MAINTENANCE'
        ? ['WAITING_MAINTENANCE']
        : desired === 'IN_MAINTENANCE'
          ? ['IN_MAINTENANCE']
          : desired === 'WAITING_OPERATIONAL_RETURN'
            ? ['IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN']
            : desired === 'COMPLETED'
              ? ['IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN', 'COMPLETED']
              : desired === 'CANCELLED'
                ? ['CANCELLED']
                : [];
    const id = targetId(context, 'paradas_equipamento', requiredLegacyId(row));
    for (const status of transitions) {
      const result = await context.client.query<{ status: string }>(
        `SELECT status FROM maintenance.equipment_stops WHERE tenant_id=$1 AND id=$2`,
        [context.tenantId, id],
      );
      const current = result.rows[0]?.status;
      if (!current || current === desired || current === status) continue;
      await context.client.query(
        `UPDATE maintenance.equipment_stops
         SET status=$3,updated_at=COALESCE($4::timestamptz,updated_at)
         WHERE tenant_id=$1 AND id=$2`,
        [
          context.tenantId,
          id,
          status,
          timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
        ],
      );
    }
  }
}

function optionalNonNegativeInteger(value: SourceScalar | undefined, field: string): number | null {
  return optionalText(value) === null ? null : Math.max(0, integerValue(value, field));
}

function sessionScope(value: SourceScalar | undefined): unknown {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { legacy_scope: value.trim() };
  }
}

export async function loadMaintenanceStop(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'paradas_manutencao', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.maintenance_stops
     (id,tenant_id,legacy_id,asset_id,component_id,work_order_id,work_order_action_id,
      execution_id,configured_mode,execution_decision,status,equipment_already_stopped,
      changed_asset_status,started_at,completed_at,duration_seconds,user_id,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             COALESCE($18::timestamptz,clock_timestamp()),COALESCE($19::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       configured_mode=EXCLUDED.configured_mode,execution_decision=EXCLUDED.execution_decision,
       status=EXCLUDED.status,equipment_already_stopped=EXCLUDED.equipment_already_stopped,
       changed_asset_status=EXCLUDED.changed_asset_status,started_at=EXCLUDED.started_at,
       completed_at=EXCLUDED.completed_at,duration_seconds=EXCLUDED.duration_seconds,
       user_id=EXCLUDED.user_id,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id'),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id'),
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id', true),
      enumValue(row.payload.modo_configurado, 'modo_configurado', stopMode, 'EXECUTOR_DECISION'),
      optionalText(row.payload.decisao_execucao),
      enumValue(row.payload.status, 'status', maintenanceStopStatus, 'OPEN'),
      booleanValue(row.payload.equipamento_ja_parado, false),
      booleanValue(row.payload.alterou_status_ativo, false),
      timestamp(row.payload.iniciada_em, 'iniciada_em', context.timeZone),
      timestamp(row.payload.finalizada_em, 'finalizada_em', context.timeZone),
      optionalNonNegativeInteger(row.payload.duracao_segundos, 'duracao_segundos'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'maintenance_stops', id };
}

export async function loadOccurrence(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'ocorrencias_operacionais', legacyId);
  const status = enumValue(row.payload.status, 'status', occurrenceStatus, 'OPEN');
  await context.client.query(
    `INSERT INTO maintenance.operational_occurrences
     (id,tenant_id,legacy_id,asset_id,component_id,occurrence_type,title,description,severity,
      status,treatment_status,reported_by,reporter_role_snapshot,work_order_id,
      work_order_action_id,equipment_stop_id,created_at,updated_at,closed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             COALESCE($17::timestamptz,clock_timestamp()),
             COALESCE($18::timestamptz,clock_timestamp()),$19)
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       title=EXCLUDED.title,description=EXCLUDED.description,severity=EXCLUDED.severity,
       status=EXCLUDED.status,treatment_status=EXCLUDED.treatment_status,
       work_order_id=EXCLUDED.work_order_id,work_order_action_id=EXCLUDED.work_order_action_id,
       equipment_stop_id=EXCLUDED.equipment_stop_id,updated_at=EXCLUDED.updated_at,
       closed_at=EXCLUDED.closed_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      text(row.payload, 'tipo', 'OPERATIONAL'),
      text(row.payload, 'titulo'),
      text(row.payload, 'descricao', text(row.payload, 'titulo')),
      enumValue(row.payload.severidade, 'severidade', priority, 'MEDIUM'),
      status,
      enumValue(row.payload.tratamento_status, 'tratamento_status', treatmentStatus, 'UNTRIAGED'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      text(row.payload, 'perfil', 'OPERADOR'),
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id', true),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id', true),
      referenceId(context, 'paradas_equipamento', row.payload.parada_id, 'parada_id', true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
      ['RESOLVED', 'CLOSED', 'CANCELLED'].includes(status)
        ? timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone)
        : null,
    ],
  );
  return { schema: 'maintenance', table: 'operational_occurrences', id };
}

export async function loadShift(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'turnos', legacyId);
  const weekdays = jsonValue(row.payload.dias_semana_json, 'dias_semana_json', [1, 2, 3, 4, 5]);
  if (
    !Array.isArray(weekdays) ||
    weekdays.length === 0 ||
    weekdays.some((value) => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 6)
  ) {
    throw new Error('dias_semana_json deve conter dias inteiros entre 0 e 6.');
  }
  await context.client.query(
    `INSERT INTO maintenance.shifts
     (id,tenant_id,legacy_id,plant_id,sector_id,line_id,name,start_time,end_time,weekdays,
      timezone,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::time,$9::time,$10::smallint[],$11,$12,
             COALESCE($13::timestamptz,clock_timestamp()),COALESCE($14::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       plant_id=EXCLUDED.plant_id,sector_id=EXCLUDED.sector_id,line_id=EXCLUDED.line_id,
       name=EXCLUDED.name,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,
       weekdays=EXCLUDED.weekdays,timezone=EXCLUDED.timezone,status=EXCLUDED.status,
       updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'plantas', row.payload.planta_id, 'planta_id'),
      referenceId(context, 'setores', row.payload.setor_id, 'setor_id', true),
      referenceId(context, 'linhas', row.payload.linha_id, 'linha_id', true),
      text(row.payload, 'nome'),
      text(row.payload, 'inicio_hora'),
      text(row.payload, 'fim_hora'),
      weekdays.map(Number),
      text(row.payload, 'timezone', context.timeZone),
      enumValue(row.payload.status, 'status', activeStatus, 'ACTIVE') === 'ACTIVE'
        ? 'ACTIVE'
        : 'INACTIVE',
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'shifts', id };
}

export async function loadProductionEntry(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'apontamentos_producao', legacyId);
  const planned = Math.max(
    0,
    integerValue(row.payload.tempo_planejado_segundos, 'tempo_planejado_segundos', 0),
  );
  const operating = Math.min(
    planned,
    Math.max(0, integerValue(row.payload.tempo_operacao_segundos, 'tempo_operacao_segundos', 0)),
  );
  await context.client.query(
    `INSERT INTO maintenance.production_entries
     (id,tenant_id,legacy_id,shift_id,asset_id,started_at,ended_at,planned_seconds,
      operating_seconds,ideal_cycle_seconds,total_quantity,good_quantity,rejected_quantity,
      source,user_id,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             COALESCE($16::timestamptz,clock_timestamp()),COALESCE($17::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,
       planned_seconds=EXCLUDED.planned_seconds,operating_seconds=EXCLUDED.operating_seconds,
       ideal_cycle_seconds=EXCLUDED.ideal_cycle_seconds,total_quantity=EXCLUDED.total_quantity,
       good_quantity=EXCLUDED.good_quantity,rejected_quantity=EXCLUDED.rejected_quantity,
       source=EXCLUDED.source,user_id=EXCLUDED.user_id,updated_at=EXCLUDED.updated_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'turnos', row.payload.turno_id, 'turno_id'),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      timestamp(row.payload.inicio_em, 'inicio_em', context.timeZone),
      timestamp(row.payload.fim_em, 'fim_em', context.timeZone),
      planned,
      operating,
      optionalNumber(row.payload.ciclo_ideal_segundos, 'ciclo_ideal_segundos'),
      optionalNumber(row.payload.quantidade_total, 'quantidade_total'),
      optionalNumber(row.payload.quantidade_boas, 'quantidade_boas'),
      optionalNumber(row.payload.quantidade_refugo, 'quantidade_refugo'),
      text(row.payload, 'fonte', 'MIGRATION'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id', true),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
      timestamp(row.payload.atualizado_em, 'atualizado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'production_entries', id };
}

export async function loadHistoryEvent(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'historico', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.history_events
     (id,tenant_id,legacy_id,asset_id,component_id,work_order_id,work_order_action_id,
      execution_id,event_type,description,user_id,role_snapshot,payload,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
             COALESCE($14::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO NOTHING`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id'),
      referenceId(context, 'componentes', row.payload.componente_id, 'componente_id', true),
      referenceId(context, 'ordens_servico', row.payload.os_id, 'os_id', true),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id', true),
      referenceId(context, 'execucoes', row.payload.execucao_id, 'execucao_id', true),
      text(row.payload, 'evento'),
      text(row.payload, 'descricao'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id', true),
      optionalText(row.payload.perfil),
      JSON.stringify({ migrated_from: 'historico' }),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'history_events', id };
}

export async function loadArchivedSession(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'sessoes', legacyId);
  const expiresAt =
    timestamp(row.payload.expira_em, 'expira_em', context.timeZone) ?? new Date(0).toISOString();
  await context.client.query(
    `INSERT INTO iam.sessions
     (id,tenant_id,legacy_id,user_id,token_hash_sha256,status,environment,scope,user_agent,
      expires_at,last_used_at,revoked_at,revocation_reason,created_at)
     VALUES ($1,$2,$3,$4,$5,'REVOKED',$6,$7::jsonb,$8,$9,$10,
             COALESCE($11::timestamptz,clock_timestamp()),$12,
             COALESCE($13::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET status='REVOKED',
       expires_at=EXCLUDED.expires_at,last_used_at=EXCLUDED.last_used_at,
       revoked_at=EXCLUDED.revoked_at,revocation_reason=EXCLUDED.revocation_reason`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      hashSha256(legacyId),
      text(row.payload, 'ambiente', 'DEVELOPMENT').toUpperCase(),
      JSON.stringify(sessionScope(row.payload.escopo)),
      optionalText(row.payload.user_agent),
      expiresAt,
      timestamp(row.payload.ultimo_uso_em, 'ultimo_uso_em', context.timeZone),
      timestamp(row.payload.revogado_em, 'revogado_em', context.timeZone),
      text(row.payload, 'motivo_revogacao', 'Sessao legada invalidada durante a migracao.'),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'iam', table: 'sessions', id };
}

export async function loadTelemetry(
  context: MigrationLoadContext,
  row: SourceRowSnapshot,
): Promise<LoadedTarget> {
  const legacyId = requiredLegacyId(row);
  const id = targetId(context, 'telemetria_sessoes', legacyId);
  await context.client.query(
    `INSERT INTO maintenance.telemetry_sessions
     (id,tenant_id,legacy_id,session_id,user_id,asset_id,work_order_action_id,event_type,
      visibility,delta_seconds,total_seconds,visible_seconds,hidden_seconds,user_agent,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             COALESCE($15::timestamptz,clock_timestamp()))
     ON CONFLICT (tenant_id,legacy_id) DO UPDATE SET
       event_type=EXCLUDED.event_type,visibility=EXCLUDED.visibility,
       delta_seconds=EXCLUDED.delta_seconds,total_seconds=EXCLUDED.total_seconds,
       visible_seconds=EXCLUDED.visible_seconds,hidden_seconds=EXCLUDED.hidden_seconds,
       user_agent=EXCLUDED.user_agent,occurred_at=EXCLUDED.occurred_at`,
    [
      id,
      context.tenantId,
      legacyId,
      referenceId(context, 'sessoes', row.payload.sessao_id, 'sessao_id'),
      referenceId(context, 'usuarios', row.payload.usuario_id, 'usuario_id'),
      referenceId(context, 'ativos', row.payload.ativo_id, 'ativo_id', true),
      referenceId(context, 'os_acoes', row.payload.acao_id, 'acao_id', true),
      text(row.payload, 'evento'),
      optionalText(row.payload.visibilidade),
      Math.max(0, integerValue(row.payload.delta_segundos, 'delta_segundos', 0)),
      Math.max(0, integerValue(row.payload.tempo_total_segundos, 'tempo_total_segundos', 0)),
      Math.max(0, integerValue(row.payload.tempo_visivel_segundos, 'tempo_visivel_segundos', 0)),
      Math.max(0, integerValue(row.payload.tempo_oculto_segundos, 'tempo_oculto_segundos', 0)),
      optionalText(row.payload.user_agent),
      timestamp(row.payload.criado_em, 'criado_em', context.timeZone),
    ],
  );
  return { schema: 'maintenance', table: 'telemetry_sessions', id };
}
