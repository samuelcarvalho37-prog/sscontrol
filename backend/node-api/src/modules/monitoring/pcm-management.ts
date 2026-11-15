import type { PoolClient } from 'pg';
import type { AnalyticsQuery } from './monitoring.types.js';

/** Event-based costs: service date, material issue and individual work interval end.
 * Missing prices remain visible; no salary or invoice split is inferred. */
export async function loadPcmManagement(client: PoolClient, query: AnalyticsQuery) {
  const result = await client.query(
    `WITH bounds AS (
 SELECT $1::timestamptz start_at,LEAST($2::timestamptz,now()) end_at,
 date_trunc('year',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' year_start,
 date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' month_start
 ), orders AS (
 SELECT w.*,a.tag asset_tag,a.name asset_name,l.id line_id,l.name line_name,s.name sector_name
 FROM maintenance.work_orders w JOIN cmms.assets a ON a.id=w.asset_id AND a.tenant_id=w.tenant_id
 JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id
 JOIN cmms.sectors s ON s.id=l.sector_id AND s.tenant_id=l.tenant_id
 WHERE ($3::uuid IS NULL OR a.id=$3)
 ), events AS (
 SELECT e.work_order_id,u.created_at event_at,u.total_cost amount,'MATERIAL' category,NULL::text provider
 FROM maintenance.material_usage u JOIN maintenance.executions e ON e.id=u.execution_id AND e.tenant_id=u.tenant_id
 UNION ALL
 SELECT s.work_order_id,COALESCE(s.service_date::timestamp AT TIME ZONE 'America/Sao_Paulo',s.created_at),s.amount,
 'EXTERNAL_'||s.cost_category,s.provider_name FROM maintenance.external_services s
 UNION ALL
 SELECT e.work_order_id,COALESCE(i.ended_at,now()),
 CASE WHEN i.ended_at IS NOT NULL THEN EXTRACT(EPOCH FROM(i.ended_at-i.started_at))/3600*i.hourly_cost_snapshot END,
 'INTERNAL_LABOR',NULL FROM maintenance.execution_participant_work_intervals i
 JOIN maintenance.executions e ON e.id=i.execution_id AND e.tenant_id=i.tenant_id
 UNION ALL
 SELECT e.work_order_id,e.completed_at,NULL::numeric,'INTERNAL_LABOR',NULL FROM maintenance.executions e
 WHERE e.completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM maintenance.execution_participant_work_intervals i WHERE i.execution_id=e.id AND i.tenant_id=e.tenant_id)
 ), period_events AS (
 SELECT ev.*,o.line_id,o.line_name,o.sector_name,o.asset_tag,o.asset_name,o.operational_code,o.title
 FROM events ev JOIN orders o ON o.id=ev.work_order_id CROSS JOIN bounds b
 WHERE ev.event_at>=b.start_at AND ev.event_at<=b.end_at
 ), goals AS (
 SELECT p.periodo,count(o.id)::integer previstas,
 count(o.id) FILTER(WHERE o.scheduled_for<=now())::integer vencimento_ate_hoje,
 count(o.id) FILTER(WHERE o.completed_at<=o.scheduled_for AND o.status='COMPLETED')::integer no_prazo,
 count(o.id) FILTER(WHERE o.completed_at>o.scheduled_for AND o.status='COMPLETED')::integer com_atraso,
 count(o.id) FILTER(WHERE o.scheduled_for<now() AND o.status NOT IN('COMPLETED','CANCELLED'))::integer vencidas_abertas,
 count(o.id) FILTER(WHERE o.scheduled_for>now() AND o.status NOT IN('COMPLETED','CANCELLED'))::integer futuras,
 round(100.0*count(o.id) FILTER(WHERE o.scheduled_for<=now() AND o.completed_at<=o.scheduled_for AND o.status='COMPLETED')/
 NULLIF(count(o.id) FILTER(WHERE o.scheduled_for<=now()),0),1) cumprimento_percentual
 FROM bounds b CROSS JOIN LATERAL(VALUES('MES',b.month_start,b.month_start+interval '1 month'),('ANO',b.year_start,b.year_start+interval '1 year')) p(periodo,inicio,fim)
 LEFT JOIN orders o ON o.scheduled_for>=p.inicio AND o.scheduled_for<p.fim AND o.status NOT IN('CANCELLED','DRAFT')
 GROUP BY p.periodo
 ), recurrence AS (
 SELECT line_id,line_name,sector_name,asset_id,asset_tag,asset_name,count(*)::integer corretivas,
 max(opened_at) ultima FROM orders CROSS JOIN bounds b
 WHERE work_type='CORRECTIVE' AND status<>'CANCELLED' AND COALESCE(opened_at,created_at)>=b.start_at AND COALESCE(opened_at,created_at)<=b.end_at
 GROUP BY line_id,line_name,sector_name,asset_id,asset_tag,asset_name
 )
 SELECT jsonb_build_object(
 'orcamentos_externos',COALESCE((SELECT jsonb_agg(jsonb_build_object('mes',to_char(month_start,'YYYY-MM'),'valor',amount)) FROM maintenance.external_labor_budgets WHERE month_start>=date_trunc('year',now() AT TIME ZONE 'America/Sao_Paulo')::date AND month_start<(date_trunc('year',now() AT TIME ZONE 'America/Sao_Paulo')+interval '1 year')::date),'[]'::jsonb),
 'mes_atual',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),
 'metas',COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM goals g),'[]'::jsonb),
 'custos_linhas',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT line_id,line_name,sector_name,
 COALESCE(sum(amount) FILTER(WHERE category='MATERIAL'),0) materiais,
 COALESCE(sum(amount) FILTER(WHERE category='INTERNAL_LABOR'),0) mao_obra_interna,
 COALESCE(sum(amount) FILTER(WHERE category LIKE 'EXTERNAL_%'),0) externos,
 COALESCE(sum(amount),0) total,count(*) FILTER(WHERE amount IS NULL)::integer pendencias
 FROM period_events GROUP BY line_id,line_name,sector_name ORDER BY sum(amount) DESC NULLS LAST)c),'[]'::jsonb),
 'custos_equipamentos',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT asset_tag tag,asset_name nome,COALESCE(sum(amount),0) total,count(*) FILTER(WHERE amount IS NULL)::integer pendencias FROM period_events GROUP BY asset_tag,asset_name ORDER BY sum(amount) DESC NULLS LAST LIMIT 20)c),'[]'::jsonb),
 'lancamentos',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT work_order_id,operational_code,title,line_id,line_name,asset_tag,asset_name,category,provider,event_at,amount FROM period_events ORDER BY event_at DESC LIMIT 500)c),'[]'::jsonb),
 'externos_mensais',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT to_char(ev.event_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') mes,
 COALESCE(sum(ev.amount) FILTER(WHERE ev.category='EXTERNAL_LABOR'),0) mao_obra,
 COALESCE(sum(ev.amount) FILTER(WHERE ev.category='EXTERNAL_PARTS'),0) pecas,
 COALESCE(sum(ev.amount) FILTER(WHERE ev.category='EXTERNAL_OTHER'),0) outros,
 COALESCE(sum(ev.amount) FILTER(WHERE ev.category='EXTERNAL_UNCLASSIFIED'),0) nao_classificado,
 count(*) FILTER(WHERE ev.amount IS NULL)::integer pendencias
 FROM events ev JOIN orders o ON o.id=ev.work_order_id CROSS JOIN bounds b
 WHERE ev.category LIKE 'EXTERNAL_%' AND ev.event_at>=b.year_start-interval '1 month' AND ev.event_at<=now()
 GROUP BY mes ORDER BY mes)c),'[]'::jsonb),
 'corretivas_recorrentes',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM recurrence r WHERE corretivas>=2),'[]'::jsonb),
 'corretivas_linhas',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT line_id,line_name,sector_name,sum(corretivas)::integer corretivas,count(*)::integer equipamentos FROM recurrence GROUP BY line_id,line_name,sector_name HAVING sum(corretivas)>=2)r),'[]'::jsonb),
 'esperas',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM(SELECT reason_code motivo,count(*)::integer ocorrencias,
 sum(EXTRACT(EPOCH FROM(LEAST(COALESCE(g.ended_at,b.end_at),b.end_at)-GREATEST(g.started_at,b.start_at)))) segundos
 FROM maintenance.execution_global_pause_periods g JOIN maintenance.executions e ON e.id=g.execution_id AND e.tenant_id=g.tenant_id
 JOIN orders o ON o.id=e.work_order_id CROSS JOIN bounds b
 WHERE g.started_at<b.end_at AND COALESCE(g.ended_at,b.end_at)>b.start_at GROUP BY reason_code)p),'[]'::jsonb),
 'pendencias',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM(SELECT priority prioridade,count(*)::integer abertas,count(*) FILTER(WHERE scheduled_for<now())::integer atrasadas FROM orders WHERE status NOT IN('COMPLETED','CANCELLED','DRAFT') GROUP BY priority)p),'[]'::jsonb),
 'assinaturas_pendentes',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM(SELECT o.id,o.operational_code codigo,o.title titulo,o.asset_tag,o.line_name FROM orders o JOIN workflow.technical_demands d ON d.id=o.technical_demand_id AND d.tenant_id=o.tenant_id WHERE d.demand_type='POST_INTERVENTION_RELEASE' AND d.status='AWAITING_SIGNATURE')p),'[]'::jsonb),
 'paradas',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM(SELECT l.id line_id,l.name line_name,a.tag asset_tag,a.name asset_name,count(*)::integer paradas,
 sum(EXTRACT(EPOCH FROM(LEAST(COALESCE(stop.completed_at,b.end_at),b.end_at)-GREATEST(stop.started_at,b.start_at)))) segundos
 FROM maintenance.equipment_stops stop JOIN cmms.assets a ON a.id=stop.asset_id AND a.tenant_id=stop.tenant_id
 JOIN cmms.lines l ON l.id=a.line_id AND l.tenant_id=a.tenant_id CROSS JOIN bounds b
 WHERE stop.status<>'CANCELLED' AND stop.started_at<b.end_at AND COALESCE(stop.completed_at,b.end_at)>b.start_at AND($3::uuid IS NULL OR a.id=$3)
 GROUP BY l.id,l.name,a.tag,a.name)p),'[]'::jsonb),
 'planejamento', (SELECT jsonb_build_object('horas_planejadas',COALESCE(sum(e.duration_seconds) FILTER(WHERE o.work_type='PREVENTIVE'),0)/3600.0,
 'horas_totais',COALESCE(sum(e.duration_seconds),0)/3600.0,'sem_prazo',count(*) FILTER(WHERE o.scheduled_for IS NULL))
 FROM maintenance.executions e JOIN orders o ON o.id=e.work_order_id CROSS JOIN bounds b WHERE e.completed_at>=b.start_at AND e.completed_at<=b.end_at)
 ) gestao`,
    [query.startAt, query.endAt, query.assetId],
  );
  return result.rows[0]?.gestao;
}
