import type { PoolClient } from 'pg';

import type {
  AlertListQuery,
  AnalyticsQuery,
  CreateOccurrenceInput,
  CreateStopInput,
  NotificationListQuery,
  OccurrenceListQuery,
  RequestAuditMetadata,
  StopListQuery,
  TechnicalAnalysisInput,
  ParameterActionRequestInput,
  TransitionStopInput,
} from './monitoring.types.js';

export type MonitoringRow = Record<string, unknown>;

function first(rows: readonly MonitoringRow[]): MonitoringRow | null {
  return rows[0] ?? null;
}

export class MonitoringRepository {
  async findParameterReadingContext(
    client: PoolClient,
    readingId: string,
    lock = false,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT reading.id,reading.parameter_definition_id,reading.numeric_value,
              reading.text_value,reading.boolean_value,reading.unit,reading.classification,
              reading.recorded_by,reading.recorded_at,definition.asset_id,definition.component_id,
              definition.code AS parameter_code,definition.name AS parameter_name,
              definition.status AS parameter_status,asset.tag AS asset_tag,asset.name AS asset_name,
              asset.lifecycle_status AS asset_status,component.tag AS component_tag,
              component.name AS component_name,component.lifecycle_status AS component_status,
              policy.warning_min,policy.warning_max,policy.critical_min,policy.critical_max
       FROM cmms.parameter_readings reading
       JOIN cmms.parameter_definitions definition
         ON definition.id=reading.parameter_definition_id AND definition.deleted_at IS NULL
       JOIN cmms.assets asset ON asset.id=definition.asset_id AND asset.deleted_at IS NULL
       LEFT JOIN cmms.components component
         ON component.id=definition.component_id AND component.deleted_at IS NULL
       LEFT JOIN cmms.parameter_policies policy
         ON policy.id=reading.parameter_policy_id
       WHERE reading.id=$1
       ${lock ? 'FOR UPDATE OF reading' : ''}`,
      [readingId],
    );
    return first(result.rows);
  }

  async findParameterActionRequest(
    client: PoolClient,
    readingId: string,
    requestType: ParameterActionRequestInput['requestType'],
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT occurrence.id,occurrence.technical_analysis_id,occurrence.status,
              occurrence.treatment_status
       FROM maintenance.operational_occurrences occurrence
       JOIN workflow.technical_analyses analysis ON analysis.id=occurrence.technical_analysis_id
       WHERE occurrence.occurrence_type='TECHNICAL_PARAMETER'
         AND analysis.report->'parametro_contexto'->>'leitura_id'=$1
         AND analysis.report->'parametro_contexto'->>'tipo_solicitacao'=$2
         AND occurrence.status NOT IN ('CANCELLED','CLOSED')
       ORDER BY occurrence.created_at DESC LIMIT 1`,
      [readingId, requestType],
    );
    return first(result.rows);
  }

  async findAssetContext(
    client: PoolClient,
    assetId: string,
    componentId: string | null,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT asset.id AS asset_id, asset.tag AS asset_tag, asset.name AS asset_name,
              asset.lifecycle_status AS asset_lifecycle_status,
              asset.operational_status AS asset_operational_status,
              component.id AS component_id, component.tag AS component_tag,
              component.name AS component_name,
              component.lifecycle_status AS component_lifecycle_status
       FROM cmms.assets asset
       LEFT JOIN cmms.components component
         ON component.tenant_id = asset.tenant_id
        AND component.id = $2
        AND component.asset_id = asset.id
        AND component.deleted_at IS NULL
       WHERE asset.id = $1 AND asset.deleted_at IS NULL`,
      [assetId, componentId],
    );
    return first(result.rows);
  }

  async listOccurrences(
    client: PoolClient,
    query: OccurrenceListQuery,
  ): Promise<readonly MonitoringRow[]> {
    const result = await client.query<MonitoringRow>(
      `SELECT occurrence.id, occurrence.occurrence_type AS tipo, occurrence.title AS titulo,
              occurrence.description AS descricao, occurrence.severity AS severidade,
              occurrence.status, occurrence.treatment_status AS tratamento_status,
              occurrence.asset_id AS ativo_id, asset.tag AS ativo_tag, asset.name AS ativo_nome,
              occurrence.component_id AS componente_id, component.tag AS componente_tag,
              component.name AS componente_nome, occurrence.reported_by AS registrada_por_id,
              reporter.name AS registrada_por_nome, occurrence.equipment_stop_id AS parada_id,
              occurrence.technical_analysis_id AS analise_tecnica_id,
              occurrence.work_order_id AS ordem_servico_id,
              occurrence.created_at AS criada_em, occurrence.updated_at AS atualizada_em,
              occurrence.closed_at AS encerrada_em
       FROM maintenance.operational_occurrences occurrence
       JOIN cmms.assets asset ON asset.id = occurrence.asset_id
       LEFT JOIN cmms.components component ON component.id = occurrence.component_id
       JOIN iam.users reporter ON reporter.id = occurrence.reported_by
       WHERE ($1 = '' OR occurrence.title ILIKE '%' || $1 || '%'
              OR occurrence.description ILIKE '%' || $1 || '%'
              OR asset.tag ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR occurrence.status = $2)
         AND ($3::text IS NULL OR occurrence.treatment_status = $3)
         AND ($4::text IS NULL OR occurrence.severity = $4)
         AND ($5::uuid IS NULL OR occurrence.asset_id = $5)
       ORDER BY CASE occurrence.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                occurrence.created_at DESC, occurrence.id DESC
       LIMIT $6`,
      [
        query.search,
        query.status,
        query.treatmentStatus,
        query.severity,
        query.assetId,
        query.limit,
      ],
    );
    return result.rows;
  }

  async createOccurrence(
    client: PoolClient,
    tenantId: string,
    id: string,
    userId: string,
    roleSnapshot: string,
    input: CreateOccurrenceInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO maintenance.operational_occurrences
       (id,tenant_id,asset_id,component_id,occurrence_type,title,description,severity,
        reported_by,reporter_role_snapshot,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,clock_timestamp()),clock_timestamp())`,
      [
        id,
        tenantId,
        input.assetId,
        input.componentId,
        input.occurrenceType,
        input.title,
        input.description,
        input.severity,
        userId,
        roleSnapshot,
        input.occurredAt,
      ],
    );
  }

  async findOccurrence(
    client: PoolClient,
    occurrenceId: string,
    lock = false,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT * FROM maintenance.operational_occurrences WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [occurrenceId],
    );
    return first(result.rows);
  }

  async findOccurrenceByStop(client: PoolClient, stopId: string): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT *
       FROM maintenance.operational_occurrences
       WHERE equipment_stop_id=$1
         AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [stopId],
    );
    return first(result.rows);
  }

  async getOccurrenceDetail(
    client: PoolClient,
    occurrenceId: string,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT occurrence.id, occurrence.occurrence_type AS tipo, occurrence.title AS titulo,
              occurrence.description AS descricao, occurrence.severity AS severidade,
              occurrence.status, occurrence.treatment_status AS tratamento_status,
              occurrence.asset_id AS ativo_id, asset.tag AS ativo_tag, asset.name AS ativo_nome,
              occurrence.component_id AS componente_id, component.tag AS componente_tag,
              component.name AS componente_nome, occurrence.created_at AS criada_em,
              occurrence.updated_at AS atualizada_em, occurrence.closed_at AS encerrada_em,
              CASE WHEN stop.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id',stop.id,'status',stop.status,'tipo',stop.stop_type,'motivo',stop.reason,
                'iniciada_em',stop.started_at,'concluida_em',stop.completed_at,
                'indisponibilidade_segundos',stop.downtime_seconds
              ) END AS parada,
              CASE WHEN analysis.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id',analysis.id,'titulo',analysis.title,'diagnostico',analysis.diagnosis,
                'risco',analysis.risk,'causa_provavel',analysis.probable_cause,
                'recomendacao',analysis.recommendation,'recomenda_checklist',analysis.recommends_checklist,
                'recomenda_ordem_servico',analysis.recommends_work_order,
                'prioridade',analysis.priority,'status',analysis.status,'relatorio',analysis.report,
                'enviada_admin_em',analysis.sent_to_admin_at,'autor_id',analysis.author_id
              ) END AS analise_tecnica,
              CASE WHEN work_order.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id',work_order.id,'codigo',work_order.code,'titulo',work_order.title,'status',work_order.status
              ) END AS ordem_servico
       FROM maintenance.operational_occurrences occurrence
       JOIN cmms.assets asset ON asset.id=occurrence.asset_id
       LEFT JOIN cmms.components component ON component.id=occurrence.component_id
       LEFT JOIN maintenance.equipment_stops stop ON stop.id=occurrence.equipment_stop_id
       LEFT JOIN workflow.technical_analyses analysis ON analysis.id=occurrence.technical_analysis_id
       LEFT JOIN maintenance.work_orders work_order ON work_order.id=occurrence.work_order_id
       WHERE occurrence.id=$1`,
      [occurrenceId],
    );
    return first(result.rows);
  }

  async attachStopToOccurrence(
    client: PoolClient,
    occurrenceId: string,
    stopId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE maintenance.operational_occurrences SET equipment_stop_id=$2 WHERE id=$1`,
      [occurrenceId, stopId],
    );
  }

  async createTechnicalAnalysis(
    client: PoolClient,
    tenantId: string,
    id: string,
    occurrence: MonitoringRow,
    userId: string,
    technicalAreaId: string,
    technicalRoleId: string | null,
    input: TechnicalAnalysisInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.technical_analyses
       (id,tenant_id,occurrence_id,asset_id,component_id,author_id,technical_area_id,
        technical_role_id,title,diagnosis,risk,probable_cause,recommendation,
        recommends_checklist,recommends_work_order,priority,status,report,sent_to_admin_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'SENT_TO_ADMIN',$17::jsonb,clock_timestamp())`,
      [
        id,
        tenantId,
        occurrence.id,
        occurrence.asset_id,
        occurrence.component_id,
        userId,
        technicalAreaId,
        technicalRoleId,
        input.title,
        input.diagnosis,
        input.risk,
        input.probableCause,
        input.recommendation,
        input.recommendsChecklist,
        input.recommendsWorkOrder,
        input.priority,
        JSON.stringify(input.report),
      ],
    );
    await client.query(
      `UPDATE maintenance.operational_occurrences
       SET technical_analysis_id=$2,status='IN_TREATMENT',
           treatment_status=CASE WHEN $3 THEN 'CHECKLIST_REQUESTED' ELSE 'DEMAND_CREATED' END
       WHERE id=$1`,
      [occurrence.id, id, input.recommendsChecklist],
    );
  }

  async technicalContext(client: PoolClient, userId: string): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT assignment.technical_area_id, assignment.technical_role_id,
              area.code AS area_code, role.code AS role_code
       FROM iam.user_technical_assignments assignment
       JOIN iam.technical_areas area ON area.id=assignment.technical_area_id
       LEFT JOIN iam.technical_roles role ON role.id=assignment.technical_role_id
       WHERE assignment.user_id=$1 AND assignment.status='ACTIVE'
         AND assignment.valid_from<=clock_timestamp()
         AND (assignment.valid_until IS NULL OR assignment.valid_until>clock_timestamp())
       ORDER BY assignment.is_primary DESC LIMIT 1`,
      [userId],
    );
    return first(result.rows);
  }

  async listStops(client: PoolClient, query: StopListQuery): Promise<readonly MonitoringRow[]> {
    const result = await client.query<MonitoringRow>(
      `SELECT stop.id,stop.asset_id AS ativo_id,asset.tag AS ativo_tag,asset.name AS ativo_nome,
              stop.component_id AS componente_id,component.tag AS componente_tag,
              component.name AS componente_nome,stop.origin AS origem,stop.stop_type AS tipo,
              stop.status,stop.started_at AS iniciada_em,stop.maintenance_started_at AS manutencao_iniciada_em,
              stop.maintenance_completed_at AS manutencao_concluida_em,stop.completed_at AS concluida_em,
              stop.downtime_seconds AS indisponibilidade_segundos,
              stop.maintenance_wait_seconds AS espera_manutencao_segundos,
              stop.execution_seconds AS execucao_segundos,
              stop.operational_return_seconds AS retorno_operacional_segundos,
              stop.reason AS motivo,stop.return_category AS categoria_retorno,
              stop.divergence_justification AS justificativa_divergencia,
              stop.return_tolerance_minutes AS tolerancia_retorno_minutos,
              starter.name AS iniciada_por_nome,completer.name AS concluida_por_nome,
              CASE WHEN stop.status NOT IN ('COMPLETED','CANCELLED')
                   THEN EXTRACT(EPOCH FROM (clock_timestamp()-stop.started_at))::bigint
                   ELSE stop.downtime_seconds END AS duracao_atual_segundos
       FROM maintenance.equipment_stops stop
       JOIN cmms.assets asset ON asset.id=stop.asset_id
       LEFT JOIN cmms.components component ON component.id=stop.component_id
       JOIN iam.users starter ON starter.id=stop.started_by
       LEFT JOIN iam.users completer ON completer.id=stop.completed_by
       WHERE ($1='' OR asset.tag ILIKE '%'||$1||'%' OR asset.name ILIKE '%'||$1||'%'
              OR stop.reason ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR stop.status=$2)
         AND ($3::uuid IS NULL OR stop.asset_id=$3)
         AND (NOT $4::boolean OR stop.status NOT IN ('COMPLETED','CANCELLED'))
       ORDER BY CASE WHEN stop.status NOT IN ('COMPLETED','CANCELLED') THEN 0 ELSE 1 END,
                stop.started_at DESC,stop.id DESC LIMIT $5`,
      [query.search, query.status, query.assetId, query.openedOnly, query.limit],
    );
    return result.rows;
  }

  async createStop(
    client: PoolClient,
    tenantId: string,
    id: string,
    userId: string,
    input: CreateStopInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO maintenance.equipment_stops
       (id,tenant_id,asset_id,component_id,origin,stop_type,started_at,started_by,
        reason,return_tolerance_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        tenantId,
        input.assetId,
        input.componentId,
        input.origin,
        input.stopType,
        input.startedAt,
        userId,
        input.reason,
        input.returnToleranceMinutes,
      ],
    );
  }

  async findOpenStopForAsset(
    client: PoolClient,
    assetId: string,
    lock = false,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT *
       FROM maintenance.equipment_stops
       WHERE asset_id=$1 AND status NOT IN ('COMPLETED','CANCELLED')
       ORDER BY started_at DESC
       LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
      [assetId],
    );
    return first(result.rows);
  }

  async findStop(client: PoolClient, stopId: string, lock = false): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT * FROM maintenance.equipment_stops WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [stopId],
    );
    return first(result.rows);
  }

  async transitionStop(
    client: PoolClient,
    stopId: string,
    userId: string,
    input: TransitionStopInput,
  ): Promise<void> {
    await client.query(
      `UPDATE maintenance.equipment_stops
       SET status=$2,return_category=COALESCE($3,return_category),
           divergence_justification=COALESCE($4,divergence_justification),
           completed_by=CASE WHEN $2 IN ('COMPLETED','CANCELLED') THEN $5 ELSE completed_by END
       WHERE id=$1`,
      [stopId, input.status, input.returnCategory, input.divergenceJustification, userId],
    );
  }

  async resolveEntitiesLinkedToStop(
    client: PoolClient,
    stopId: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE maintenance.operational_occurrences
       SET status='RESOLVED',treatment_status='RESOLVED',closed_at=COALESCE(closed_at,clock_timestamp())
       WHERE equipment_stop_id=$1 AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')`,
      [stopId],
    );
    await client.query(
      `UPDATE maintenance.operational_alerts
       SET status='RESOLVED',resolved_by=$2,resolved_at=COALESCE(resolved_at,clock_timestamp())
       WHERE equipment_stop_id=$1 AND status IN ('OPEN','ACKNOWLEDGED','IN_TREATMENT')`,
      [stopId, userId],
    );
  }

  async getStopDetail(client: PoolClient, stopId: string): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT stop.*,asset.tag AS ativo_tag,asset.name AS ativo_nome,
              asset.operational_status AS ativo_status,
              component.tag AS componente_tag,component.name AS componente_nome
       FROM maintenance.equipment_stops stop
       JOIN cmms.assets asset ON asset.id=stop.asset_id
       LEFT JOIN cmms.components component ON component.id=stop.component_id
       WHERE stop.id=$1`,
      [stopId],
    );
    return first(result.rows);
  }

  async listAlerts(client: PoolClient, query: AlertListQuery): Promise<readonly MonitoringRow[]> {
    const result = await client.query<MonitoringRow>(
      `SELECT alert.id,alert.alert_type AS tipo,alert.severity AS severidade,
              alert.title AS titulo,alert.message AS mensagem,alert.status,
              alert.asset_id AS ativo_id,asset.tag AS ativo_tag,asset.name AS ativo_nome,
              alert.component_id AS componente_id,component.tag AS componente_tag,
              component.name AS componente_nome,alert.parameter_reading_id AS leitura_id,
              alert.occurrence_id AS ocorrencia_id,alert.equipment_stop_id AS parada_id,
              alert.first_detected_at AS detectado_primeiro_em,
              alert.last_detected_at AS detectado_ultimo_em,
              alert.acknowledged_at AS reconhecido_em,alert.resolved_at AS resolvido_em,
              alert.metadata AS metadados
       FROM maintenance.operational_alerts alert
       JOIN cmms.assets asset ON asset.id=alert.asset_id
       LEFT JOIN cmms.components component ON component.id=alert.component_id
       WHERE ($1='' OR alert.title ILIKE '%'||$1||'%' OR alert.message ILIKE '%'||$1||'%'
              OR asset.tag ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR alert.status=$2)
         AND ($3::text IS NULL OR alert.severity=$3)
         AND ($4::uuid IS NULL OR alert.asset_id=$4)
       ORDER BY CASE alert.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
                alert.last_detected_at DESC,alert.id DESC LIMIT $5`,
      [query.search, query.status, query.severity, query.assetId, query.limit],
    );
    return result.rows;
  }

  async findAlert(
    client: PoolClient,
    alertId: string,
    lock = false,
  ): Promise<MonitoringRow | null> {
    const result = await client.query<MonitoringRow>(
      `SELECT * FROM maintenance.operational_alerts WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [alertId],
    );
    return first(result.rows);
  }

  async acknowledgeAlert(client: PoolClient, alertId: string, userId: string): Promise<void> {
    await client.query(
      `UPDATE maintenance.operational_alerts
       SET status='ACKNOWLEDGED',acknowledged_by=$2,acknowledged_at=clock_timestamp()
       WHERE id=$1`,
      [alertId, userId],
    );
  }

  async linkAlertOccurrence(
    client: PoolClient,
    alertId: string,
    occurrenceId: string,
    stopId: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE maintenance.operational_alerts
       SET status='IN_TREATMENT',occurrence_id=$2,equipment_stop_id=COALESCE($3,equipment_stop_id)
       WHERE id=$1`,
      [alertId, occurrenceId, stopId],
    );
  }

  async createNotification(
    client: PoolClient,
    tenantId: string,
    input: {
      readonly type: string;
      readonly title: string;
      readonly message: string;
      readonly entityType: string;
      readonly entityId: string;
      readonly priority: string;
      readonly actionRoute: string;
      readonly actionPayload: Readonly<Record<string, unknown>>;
      readonly audience: Readonly<Record<string, unknown>>;
      readonly deduplicationKey: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO workflow.notifications
       (tenant_id,notification_type,title,message,entity_type,entity_id,priority,
        action_route,action_payload,audience,deduplication_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
       ON CONFLICT (tenant_id,deduplication_key)
       WHERE deduplication_key IS NOT NULL AND status='ACTIVE'
       DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message,priority=EXCLUDED.priority,
                     action_route=EXCLUDED.action_route,action_payload=EXCLUDED.action_payload
       RETURNING id`,
      [
        tenantId,
        input.type,
        input.title,
        input.message,
        input.entityType,
        input.entityId,
        input.priority,
        input.actionRoute,
        JSON.stringify(input.actionPayload),
        JSON.stringify(input.audience),
        input.deduplicationKey,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('A notificação não foi persistida.');
    return row.id;
  }

  async attachNotificationToRoleTypes(
    client: PoolClient,
    tenantId: string,
    notificationId: string,
    roleTypes: readonly string[],
    excludedUserId: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow.notification_recipients
       (tenant_id,notification_id,user_id,delivery_status,delivered_at,last_notified_at,delivery_attempts)
       SELECT DISTINCT $1::uuid,$2::uuid,user_role.user_id,'DELIVERED',clock_timestamp(),clock_timestamp(),1
       FROM iam.user_roles user_role
       JOIN iam.roles role ON role.tenant_id=user_role.tenant_id AND role.id=user_role.role_id
       JOIN iam.users user_account ON user_account.tenant_id=user_role.tenant_id AND user_account.id=user_role.user_id
       WHERE user_role.tenant_id=$1 AND role.role_type=ANY($3::text[])
         AND user_account.status='ACTIVE' AND user_account.deleted_at IS NULL
         AND ($4::uuid IS NULL OR user_account.id<>$4)
       ON CONFLICT (tenant_id,notification_id,user_id) DO UPDATE
       SET delivery_status='DELIVERED',delivered_at=COALESCE(workflow.notification_recipients.delivered_at,clock_timestamp()),
           last_notified_at=clock_timestamp(),delivery_attempts=workflow.notification_recipients.delivery_attempts+1`,
      [tenantId, notificationId, roleTypes, excludedUserId],
    );
  }

  async listNotifications(
    client: PoolClient,
    userId: string,
    query: NotificationListQuery,
  ): Promise<readonly MonitoringRow[]> {
    const result = await client.query<MonitoringRow>(
      `SELECT inbox.id,inbox.notification_type AS tipo,inbox.title AS titulo,
              inbox.message AS mensagem,inbox.entity_type AS entidade_tipo,
              inbox.entity_id AS entidade_id,inbox.priority AS prioridade,
              inbox.action_route AS rota_acao,inbox.action_payload AS dados_acao,
              inbox.created_at AS criada_em,inbox.delivered_at AS entregue_em,
              inbox.read_at AS lida_em,inbox.dismissed_at AS dispensada_em,inbox.unread AS nao_lida
       FROM workflow.v_notification_inbox inbox
       WHERE inbox.user_id=$1
         AND ($2='' OR inbox.title ILIKE '%'||$2||'%' OR inbox.message ILIKE '%'||$2||'%')
         AND (NOT $3::boolean OR inbox.unread)
         AND ($4::text IS NULL OR inbox.priority=$4)
         AND ($5::text IS NULL OR inbox.notification_type=$5 OR inbox.entity_type=$5)
       ORDER BY inbox.unread DESC,
                CASE inbox.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
                inbox.created_at DESC,inbox.id DESC LIMIT $6`,
      [userId, query.search, query.unreadOnly, query.priority, query.context, query.limit],
    );
    return result.rows;
  }

  async markNotificationRead(
    client: PoolClient,
    notificationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE workflow.notification_recipients
       SET read_at=COALESCE(read_at,clock_timestamp()),delivery_status='DELIVERED',
           delivered_at=COALESCE(delivered_at,clock_timestamp())
       WHERE notification_id=$1 AND user_id=$2 AND dismissed_at IS NULL`,
      [notificationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async dismissNotification(
    client: PoolClient,
    notificationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE workflow.notification_recipients
       SET dismissed_at=COALESCE(dismissed_at,clock_timestamp()),
           read_at=COALESCE(read_at,clock_timestamp())
       WHERE notification_id=$1 AND user_id=$2`,
      [notificationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markAllNotificationsRead(client: PoolClient, userId: string): Promise<number> {
    const result = await client.query(
      `UPDATE workflow.notification_recipients
       SET read_at=clock_timestamp(),delivery_status='DELIVERED',
           delivered_at=COALESCE(delivered_at,clock_timestamp())
       WHERE user_id=$1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async notificationCounters(client: PoolClient, userId: string): Promise<MonitoringRow> {
    const result = await client.query<MonitoringRow>(
      `SELECT count(*) FILTER (WHERE unread)::integer AS nao_lidas,
              count(*) FILTER (WHERE unread AND priority='CRITICAL')::integer AS criticas,
              count(*) FILTER (WHERE created_at>=date_trunc('day',clock_timestamp()))::integer AS hoje
       FROM workflow.v_notification_inbox WHERE user_id=$1`,
      [userId],
    );
    return result.rows[0] ?? { nao_lidas: 0, criticas: 0, hoje: 0 };
  }

  async technicalSummary(client: PoolClient, query: AnalyticsQuery): Promise<MonitoringRow> {
    const result = await client.query<MonitoringRow>(
      `WITH bounds AS (
         SELECT $1::timestamptz AS start_at,$2::timestamptz AS end_at,
                EXTRACT(EPOCH FROM ($2::timestamptz-$1::timestamptz))::numeric AS window_seconds
       ), asset_scope AS (
         SELECT asset.id FROM cmms.assets asset
         WHERE asset.lifecycle_status='ACTIVE' AND asset.deleted_at IS NULL
           AND ($3::uuid IS NULL OR asset.id=$3)
       ), stops AS (
         SELECT stop.*,
                GREATEST(stop.started_at,bounds.start_at) AS effective_start,
                LEAST(COALESCE(stop.completed_at,bounds.end_at),bounds.end_at) AS effective_end
         FROM maintenance.equipment_stops stop
         JOIN asset_scope scope ON scope.id=stop.asset_id CROSS JOIN bounds
         WHERE stop.started_at<bounds.end_at AND COALESCE(stop.completed_at,bounds.end_at)>bounds.start_at
           AND stop.status<>'CANCELLED'
       ), stop_metrics AS (
         SELECT count(*)::integer AS failure_count,
                COALESCE(sum(GREATEST(0,EXTRACT(EPOCH FROM (effective_end-effective_start)))),0)::bigint AS downtime_seconds,
                COALESCE(avg(GREATEST(0,EXTRACT(EPOCH FROM (effective_end-effective_start))))
                  FILTER (WHERE status='COMPLETED'),0)::numeric AS mttr_seconds
         FROM stops
       ), occurrence_metrics AS (
         SELECT count(*)::integer AS occurrence_count,
                count(*) FILTER (WHERE severity IN ('HIGH','CRITICAL'))::integer AS critical_occurrence_count,
                count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED'))::integer AS open_occurrence_count
         FROM maintenance.operational_occurrences occurrence JOIN asset_scope scope ON scope.id=occurrence.asset_id CROSS JOIN bounds
         WHERE occurrence.created_at>=bounds.start_at AND occurrence.created_at<bounds.end_at
       ), execution_metrics AS (
         SELECT count(*) FILTER (WHERE execution.status='COMPLETED')::integer AS completed_execution_count,
                COALESCE(avg(execution.duration_seconds) FILTER (WHERE execution.status='COMPLETED'),0)::numeric AS average_execution_seconds
         FROM maintenance.executions execution JOIN asset_scope scope ON scope.id=execution.asset_id CROSS JOIN bounds
         WHERE execution.created_at>=bounds.start_at AND execution.created_at<bounds.end_at
       ), sla_metrics AS (
         SELECT count(*) FILTER (WHERE demand.resolution_due_at IS NOT NULL)::integer AS demand_with_sla_count,
                count(*) FILTER (WHERE demand.resolution_due_at IS NOT NULL
                   AND COALESCE(demand.completed_at,bounds.end_at)<=demand.resolution_due_at)::integer AS demand_within_sla_count,
                COALESCE(avg(EXTRACT(EPOCH FROM (demand.first_attended_at-demand.created_at)))
                   FILTER (WHERE demand.first_attended_at IS NOT NULL),0)::numeric AS first_response_seconds
         FROM workflow.technical_demands demand CROSS JOIN bounds
         WHERE demand.created_at>=bounds.start_at AND demand.created_at<bounds.end_at
           AND ($3::uuid IS NULL
             OR EXISTS (
               SELECT 1 FROM maintenance.work_orders work_order
               WHERE demand.entity_type='WORK_ORDER' AND work_order.id=demand.entity_id
                 AND work_order.asset_id=$3
             )
             OR EXISTS (
               SELECT 1 FROM workflow.technical_analyses analysis
               WHERE analysis.technical_demand_id=demand.id AND analysis.asset_id=$3
             ))
       )
       SELECT scope_count.total_assets,
              stop_metrics.failure_count AS falhas_nao_planejadas,
              stop_metrics.downtime_seconds AS indisponibilidade_segundos,
              round(stop_metrics.mttr_seconds,2) AS mttr_segundos,
              CASE WHEN stop_metrics.failure_count=0 THEN NULL
                   ELSE round(((bounds.window_seconds*scope_count.total_assets)-stop_metrics.downtime_seconds)/stop_metrics.failure_count,2) END AS mtbf_segundos,
              CASE WHEN bounds.window_seconds<=0 OR scope_count.total_assets=0 THEN NULL
                   ELSE round(GREATEST(0,100-(stop_metrics.downtime_seconds/(bounds.window_seconds*scope_count.total_assets)*100)),2) END AS disponibilidade_percentual,
              occurrence_metrics.occurrence_count AS ocorrencias,
              occurrence_metrics.critical_occurrence_count AS ocorrencias_criticas,
              occurrence_metrics.open_occurrence_count AS ocorrencias_abertas,
              execution_metrics.completed_execution_count AS execucoes_concluidas,
              round(execution_metrics.average_execution_seconds,2) AS tempo_medio_execucao_segundos,
              sla_metrics.demand_with_sla_count AS demandas_com_sla,
              CASE WHEN sla_metrics.demand_with_sla_count=0 THEN NULL
                   ELSE round(sla_metrics.demand_within_sla_count::numeric/sla_metrics.demand_with_sla_count*100,2) END AS sla_resolucao_percentual,
              round(sla_metrics.first_response_seconds,2) AS primeira_resposta_media_segundos
       FROM bounds,stop_metrics,occurrence_metrics,execution_metrics,sla_metrics,
            (SELECT count(*)::integer AS total_assets FROM asset_scope) scope_count`,
      [query.startAt, query.endAt, query.assetId],
    );
    return result.rows[0] ?? {};
  }

  async assetRanking(client: PoolClient, query: AnalyticsQuery): Promise<readonly MonitoringRow[]> {
    const result = await client.query<MonitoringRow>(
      `WITH stop_metrics AS (
         SELECT stop.asset_id,
                count(*)::integer AS quantidade_paradas,
                COALESCE(sum(GREATEST(0,EXTRACT(EPOCH FROM (
                  LEAST(COALESCE(stop.completed_at,$2::timestamptz),$2::timestamptz)-
                  GREATEST(stop.started_at,$1::timestamptz)
                )))),0)::bigint AS indisponibilidade_segundos
         FROM maintenance.equipment_stops stop
         WHERE stop.status<>'CANCELLED' AND stop.started_at<$2::timestamptz
           AND COALESCE(stop.completed_at,$2::timestamptz)>$1::timestamptz
         GROUP BY stop.asset_id
       ), occurrence_metrics AS (
         SELECT occurrence.asset_id,
                count(*) FILTER (WHERE occurrence.severity IN ('HIGH','CRITICAL'))::integer AS ocorrencias_criticas
         FROM maintenance.operational_occurrences occurrence
         WHERE occurrence.created_at>=$1::timestamptz AND occurrence.created_at<$2::timestamptz
         GROUP BY occurrence.asset_id
       )
       SELECT asset.id AS ativo_id,asset.tag AS ativo_tag,asset.name AS ativo_nome,
              COALESCE(stop_metrics.quantidade_paradas,0) AS quantidade_paradas,
              COALESCE(stop_metrics.indisponibilidade_segundos,0) AS indisponibilidade_segundos,
              COALESCE(occurrence_metrics.ocorrencias_criticas,0) AS ocorrencias_criticas
       FROM cmms.assets asset
       LEFT JOIN stop_metrics ON stop_metrics.asset_id=asset.id
       LEFT JOIN occurrence_metrics ON occurrence_metrics.asset_id=asset.id
       WHERE asset.lifecycle_status='ACTIVE' AND asset.deleted_at IS NULL
         AND ($3::uuid IS NULL OR asset.id=$3)
       ORDER BY indisponibilidade_segundos DESC,quantidade_paradas DESC,asset.tag
       LIMIT $4`,
      [query.startAt, query.endAt, query.assetId, query.rankingLimit],
    );
    return result.rows;
  }

  async writeHistory(
    client: PoolClient,
    tenantId: string,
    assetId: string,
    componentId: string | null,
    userId: string,
    roleSnapshot: string,
    eventType: string,
    description: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO maintenance.history_events
       (tenant_id,asset_id,component_id,event_type,description,user_id,role_snapshot,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        tenantId,
        assetId,
        componentId,
        eventType,
        description,
        userId,
        roleSnapshot,
        JSON.stringify(payload),
      ],
    );
  }

  async writeAudit(
    client: PoolClient,
    tenantId: string,
    userId: string,
    metadata: RequestAuditMetadata,
    action: string,
    entityType: string,
    entityId: string,
    afterData: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.events
       (tenant_id,user_id,role_snapshot,action,entity_type,entity_id,after_data,
        redacted_fields,trace_id,source,user_agent,ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,ARRAY[]::text[],$8,'APPLICATION',$9,$10)`,
      [
        tenantId,
        userId,
        metadata.roleSnapshot,
        action,
        entityType,
        entityId,
        JSON.stringify(afterData),
        metadata.traceId,
        metadata.userAgent,
        metadata.ipAddress,
      ],
    );
  }
}
