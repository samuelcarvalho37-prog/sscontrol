import type { PoolClient } from 'pg';
import type { AnalyticsQuery } from './monitoring.types.js';

/**
 * Consolidated report data for the PCM view.  This query deliberately reads the
 * same time window chosen in the dashboard; it never manufactures an MTTR for
 * a month without completed failures.
 */
export async function loadPcmReports(client: PoolClient, query: AnalyticsQuery) {
  const result = await client.query(
    `WITH bounds AS (
       SELECT $1::timestamptz AS start_at, LEAST($2::timestamptz, now()) AS end_at
     ), scoped_orders AS (
       SELECT work_order.*, asset.tag AS ativo_tag, asset.name AS ativo_nome,
         sector.name AS setor_nome, responsible.name AS responsavel_nome
       FROM maintenance.work_orders work_order
       JOIN cmms.assets asset ON asset.id=work_order.asset_id AND asset.tenant_id=work_order.tenant_id
       JOIN cmms.lines line ON line.id=asset.line_id AND line.tenant_id=asset.tenant_id
       JOIN cmms.sectors sector ON sector.id=line.sector_id AND sector.tenant_id=line.tenant_id
       LEFT JOIN iam.users responsible ON responsible.id=work_order.responsible_id AND responsible.tenant_id=work_order.tenant_id
       CROSS JOIN bounds
       WHERE asset.lifecycle_status='ACTIVE' AND asset.deleted_at IS NULL
         AND ($3::uuid IS NULL OR asset.id=$3)
         AND work_order.created_at < bounds.end_at
     ), period_orders AS (
       SELECT * FROM scoped_orders CROSS JOIN bounds
       WHERE COALESCE(completed_at, scheduled_for, opened_at, created_at) >= bounds.start_at
         AND COALESCE(completed_at, scheduled_for, opened_at, created_at) <= bounds.end_at
     ), execution_by_technician AS (
       SELECT execution.operator_id, person.name AS nome,
         count(*)::integer AS execucoes,
         COALESCE(sum(execution.duration_seconds), 0)::bigint AS segundos_apontados
       FROM maintenance.executions execution
       JOIN iam.users person ON person.id=execution.operator_id AND person.tenant_id=execution.tenant_id
       JOIN scoped_orders work_order ON work_order.id=execution.work_order_id AND work_order.tenant_id=execution.tenant_id
       CROSS JOIN bounds
       WHERE execution.completed_at IS NOT NULL
         AND execution.completed_at >= bounds.start_at AND execution.completed_at <= bounds.end_at
       GROUP BY execution.operator_id, person.name
     ), execution_details AS (
       SELECT execution.id, person.name AS tecnico_nome, work_order.code AS ordem_codigo,
         work_order.title AS titulo, asset.tag AS ativo_tag,
         execution.started_at AS iniciada_em, execution.completed_at AS concluida_em,
         execution.duration_seconds AS duracao_segundos,
         COALESCE(execution.paused_seconds, 0)::bigint AS segundos_pausados,
         COALESCE((SELECT sum(usage.total_cost)
                   FROM maintenance.material_usage usage
                   WHERE usage.execution_id=execution.id), 0)::numeric AS custo_materiais_total,
         (SELECT count(*)::integer
          FROM maintenance.material_usage usage
          WHERE usage.execution_id=execution.id) AS itens_materiais
       FROM maintenance.executions execution
       JOIN iam.users person ON person.id=execution.operator_id AND person.tenant_id=execution.tenant_id
       JOIN scoped_orders work_order ON work_order.id=execution.work_order_id AND work_order.tenant_id=execution.tenant_id
       JOIN cmms.assets asset ON asset.id=work_order.asset_id AND asset.tenant_id=work_order.tenant_id
       CROSS JOIN bounds
       WHERE execution.completed_at IS NOT NULL
         AND execution.completed_at >= bounds.start_at AND execution.completed_at <= bounds.end_at
       ORDER BY execution.completed_at DESC
       LIMIT 100
     ), material_costs AS (
       SELECT usage.total_cost, action.work_order_id, work_order.asset_id,
         asset.tag AS ativo_tag, asset.name AS ativo_nome
       FROM maintenance.material_usage usage
       JOIN maintenance.executions execution ON execution.id=usage.execution_id
       JOIN maintenance.work_order_actions action ON action.id=execution.work_order_action_id
       JOIN scoped_orders work_order ON work_order.id=action.work_order_id AND work_order.tenant_id=action.tenant_id
       JOIN cmms.assets asset ON asset.id=work_order.asset_id AND asset.tenant_id=work_order.tenant_id
       CROSS JOIN bounds
       WHERE execution.completed_at IS NOT NULL
         AND execution.completed_at >= bounds.start_at AND execution.completed_at <= bounds.end_at
     ), low_stock_materials AS (
       SELECT material.sku, COALESCE(NULLIF(material.friendly_name, ''), material.name) AS nome,
         material.unit AS unidade, material.current_stock AS estoque_atual,
         material.minimum_stock AS estoque_minimo, material.unit_cost AS valor_unitario
       FROM cmms.materials material
       WHERE material.status='ACTIVE'
         AND material.deleted_at IS NULL
         AND material.current_stock <= material.minimum_stock
     ), monthly_mttr AS (
       SELECT month_start,
         round(avg(EXTRACT(EPOCH FROM (stop.completed_at-stop.started_at)))
           FILTER (WHERE stop.status='COMPLETED' AND stop.completed_at IS NOT NULL), 2) AS mttr_segundos
       FROM bounds
       CROSS JOIN LATERAL generate_series(
         date_trunc('month', bounds.start_at), date_trunc('month', bounds.end_at), interval '1 month'
       ) AS calendar(month_start)
       LEFT JOIN maintenance.equipment_stops stop
         ON stop.started_at >= calendar.month_start
         AND stop.started_at < calendar.month_start + interval '1 month'
         AND stop.stop_type IN ('UNPLANNED','NAO_PLANEJADA','TECHNICAL_ALERT')
         AND stop.status <> 'CANCELLED'
       LEFT JOIN cmms.assets asset ON asset.id=stop.asset_id AND asset.tenant_id=stop.tenant_id
         AND asset.lifecycle_status='ACTIVE' AND asset.deleted_at IS NULL
         AND ($3::uuid IS NULL OR asset.id=$3)
       WHERE stop.id IS NULL OR asset.id IS NOT NULL
       GROUP BY month_start
     )
     SELECT jsonb_build_object(
       'ordens', jsonb_build_object(
         'abertas', (SELECT count(*) FROM scoped_orders WHERE status NOT IN ('COMPLETED','CANCELLED')),
         'concluidas_no_periodo', (SELECT count(*) FROM period_orders WHERE status='COMPLETED'),
         'atrasadas', (SELECT count(*) FROM scoped_orders WHERE status NOT IN ('COMPLETED','CANCELLED') AND scheduled_for < now()),
         'por_tipo', COALESCE((SELECT jsonb_agg(row) FROM (
           SELECT work_type AS tipo, count(*)::integer AS quantidade FROM period_orders GROUP BY work_type ORDER BY quantidade DESC, tipo
         ) row), '[]'::jsonb),
         'por_prioridade', COALESCE((SELECT jsonb_agg(row) FROM (
           SELECT priority AS prioridade, count(*)::integer AS quantidade FROM scoped_orders
           WHERE status NOT IN ('COMPLETED','CANCELLED') GROUP BY priority ORDER BY quantidade DESC, prioridade
         ) row), '[]'::jsonb)
       ),
       'preventivas', jsonb_build_object(
         'programadas_no_periodo', (SELECT count(*) FROM period_orders WHERE work_type='PREVENTIVE' AND scheduled_for IS NOT NULL),
         'concluidas_no_prazo', (SELECT count(*) FROM period_orders WHERE work_type='PREVENTIVE' AND status='COMPLETED' AND completed_at <= scheduled_for),
         'concluidas_com_atraso', (SELECT count(*) FROM period_orders WHERE work_type='PREVENTIVE' AND status='COMPLETED' AND completed_at > scheduled_for),
         'pendentes', (SELECT count(*) FROM scoped_orders WHERE work_type='PREVENTIVE' AND status NOT IN ('COMPLETED','CANCELLED'))
       ),
       'tecnicos', COALESCE((SELECT jsonb_agg(row) FROM (
         SELECT operator_id AS id, nome, execucoes, segundos_apontados FROM execution_by_technician
         ORDER BY segundos_apontados DESC, execucoes DESC, nome LIMIT 20
       ) row), '[]'::jsonb),
       'custos_materiais', jsonb_build_object(
         'total', COALESCE((SELECT sum(total_cost) FROM material_costs), 0),
         'itens_consumidos', (SELECT count(*)::integer FROM material_costs),
         'ordens_com_consumo', (SELECT count(DISTINCT work_order_id)::integer FROM material_costs),
         'por_ativo', COALESCE((SELECT jsonb_agg(row) FROM (
           SELECT ativo_tag, ativo_nome, sum(total_cost) AS custo_total, count(*)::integer AS itens_consumidos
           FROM material_costs
           GROUP BY ativo_tag, ativo_nome
           ORDER BY custo_total DESC, ativo_tag
           LIMIT 5
         ) row), '[]'::jsonb)
       ),
       'estoque_baixo', jsonb_build_object(
         'quantidade', (SELECT count(*)::integer FROM low_stock_materials),
         'itens', COALESCE((SELECT jsonb_agg(row) FROM (
           SELECT sku, nome, unidade, estoque_atual, estoque_minimo, valor_unitario
           FROM low_stock_materials
           ORDER BY (estoque_atual - estoque_minimo), sku
           LIMIT 10
         ) row), '[]'::jsonb)
       ),
       'execucoes_detalhadas', COALESCE((SELECT jsonb_agg(row) FROM (
         SELECT id, tecnico_nome, ordem_codigo, titulo, ativo_tag, iniciada_em,
           concluida_em, duracao_segundos, segundos_pausados,
           custo_materiais_total, itens_materiais
         FROM execution_details ORDER BY concluida_em DESC
       ) row), '[]'::jsonb),
       'mttr_mensal', COALESCE((SELECT jsonb_agg(row) FROM (
         SELECT to_char(month_start, 'YYYY-MM') AS mes, mttr_segundos FROM monthly_mttr ORDER BY month_start
       ) row), '[]'::jsonb)
     ) AS relatorios`,
    [query.startAt, query.endAt, query.assetId],
  );
  return result.rows[0]?.relatorios;
}
