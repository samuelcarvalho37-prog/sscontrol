import type { PoolClient } from 'pg';
import type { AnalyticsQuery } from './monitoring.types.js';

/** Runs inside the caller's read-only tenant transaction (including RLS). */
export async function loadPcmDashboard(client: PoolClient, query: AnalyticsQuery) {
  const result = await client.query(
    `WITH bounds AS (
       SELECT $1::timestamptz AS start_at, LEAST($2::timestamptz,now()) AS end_at,
         GREATEST(0,EXTRACT(EPOCH FROM (LEAST($2::timestamptz,now())-$1::timestamptz))) AS seconds
     ), assets AS (
       SELECT asset.id,asset.tenant_id,asset.tag,asset.name,asset.operational_status,
         sector.id AS sector_id,sector.name AS sector_name
       FROM cmms.assets asset
       JOIN cmms.lines line ON line.id=asset.line_id AND line.tenant_id=asset.tenant_id
       JOIN cmms.sectors sector ON sector.id=line.sector_id AND sector.tenant_id=line.tenant_id
       WHERE asset.lifecycle_status='ACTIVE' AND asset.deleted_at IS NULL
         AND ($3::uuid IS NULL OR asset.id=$3)
     ), orders AS (
       SELECT work_order.*,plan.estimated_duration_minutes,asset.tag AS asset_tag
       FROM maintenance.work_orders work_order
       JOIN assets asset ON asset.id=work_order.asset_id AND asset.tenant_id=work_order.tenant_id
       JOIN maintenance.maintenance_plan_versions plan ON plan.id=work_order.maintenance_plan_version_id
         AND plan.tenant_id=work_order.tenant_id
       WHERE work_order.status NOT IN ('COMPLETED','CANCELLED')
     ), technicians AS (
       SELECT person.id,person.name,count(*)::integer AS executions
       FROM maintenance.executions execution
       JOIN assets asset ON asset.id=execution.asset_id AND asset.tenant_id=execution.tenant_id
       JOIN iam.users person ON person.id=execution.operator_id AND person.tenant_id=execution.tenant_id
       WHERE execution.status='IN_PROGRESS'
       GROUP BY person.id,person.name
     ), stops AS (
       SELECT stop.*,GREATEST(stop.started_at,bounds.start_at) AS effective_start,
         LEAST(COALESCE(stop.completed_at,bounds.end_at),bounds.end_at) AS effective_end
       FROM maintenance.equipment_stops stop
       JOIN assets asset ON asset.id=stop.asset_id AND asset.tenant_id=stop.tenant_id CROSS JOIN bounds
       WHERE stop.status<>'CANCELLED' AND stop.started_at<bounds.end_at
         AND COALESCE(stop.completed_at,bounds.end_at)>bounds.start_at
     ), ordered_stops AS (
       SELECT *,max(effective_end) OVER (PARTITION BY asset_id ORDER BY effective_start,effective_end,id
         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM stops
     ), stop_groups AS (
       SELECT *,sum(CASE WHEN previous_end IS NULL OR effective_start>previous_end THEN 1 ELSE 0 END)
         OVER (PARTITION BY asset_id ORDER BY effective_start,effective_end,id) AS group_id FROM ordered_stops
     ), intervals AS (
       SELECT asset_id,min(effective_start) AS start_at,max(effective_end) AS end_at
       FROM stop_groups GROUP BY asset_id,group_id
     ), downtime AS (
       SELECT COALESCE(sum(EXTRACT(EPOCH FROM (end_at-start_at))),0) AS seconds FROM intervals
     ), failures AS (
       SELECT stop.* FROM stops stop CROSS JOIN bounds
       WHERE stop.stop_type IN ('UNPLANNED','NAO_PLANEJADA','TECHNICAL_ALERT') AND stop.started_at>=bounds.start_at
     ), failures_by_asset AS (
       SELECT asset.id AS ativo_id,asset.tag AS ativo_tag,asset.name AS ativo_nome,
         asset.sector_id AS setor_id,asset.sector_name AS setor_nome,count(*)::integer AS falhas
       FROM failures failure JOIN assets asset ON asset.id=failure.asset_id AND asset.tenant_id=failure.tenant_id
       GROUP BY asset.id,asset.tag,asset.name,asset.sector_id,asset.sector_name
     ), failures_by_sector AS (
       SELECT setor_id,setor_nome,sum(falhas)::integer AS falhas FROM failures_by_asset GROUP BY setor_id,setor_nome
     ), upcoming AS (
       SELECT id,code AS codigo,asset_tag AS ativo_tag,scheduled_for AS programada_para
       FROM orders WHERE work_type='PREVENTIVE' AND scheduled_for>=now() AND scheduled_for<now()+interval '7 days'
       ORDER BY scheduled_for,id
     )
     SELECT jsonb_build_object(
       'atualizado_em',now(),
       'atual',jsonb_build_object(
         'ativos_parados',(SELECT count(*) FROM assets asset WHERE asset.operational_status='STOPPED'
           OR EXISTS (SELECT 1 FROM maintenance.equipment_stops stop WHERE stop.asset_id=asset.id
             AND stop.tenant_id=asset.tenant_id AND stop.status NOT IN ('COMPLETED','CANCELLED'))),
         'ordens_abertas',(SELECT count(*) FROM orders),
         'ordens_criticas',(SELECT count(*) FROM orders WHERE priority='CRITICAL'),
         'ordens_atrasadas',(SELECT count(*) FROM orders WHERE scheduled_for<now()),
         'preventivas_proximas',(SELECT count(*) FROM upcoming),
         'backlog_horas_estimadas',(SELECT round(COALESCE(sum(estimated_duration_minutes),0)/60.0,2) FROM orders),
         'ordens_sem_estimativa',(SELECT count(*) FROM orders WHERE estimated_duration_minutes IS NULL),
         'tecnicos_em_atividade',(SELECT count(*) FROM technicians)),
       'confiabilidade',jsonb_build_object(
         'ativos_considerados',(SELECT count(*) FROM assets),
         'falhas',(SELECT count(*) FROM failures),
         'mttr_segundos',(SELECT round(avg(EXTRACT(EPOCH FROM (completed_at-started_at))),2)
           FROM failures CROSS JOIN bounds WHERE status='COMPLETED' AND completed_at<=bounds.end_at),
         'mtbf_segundos',CASE WHEN (SELECT count(*) FROM failures)=0 THEN NULL
           ELSE round(GREATEST(0,bounds.seconds*(SELECT count(*) FROM assets)-downtime.seconds)/(SELECT count(*) FROM failures),2) END,
         'disponibilidade_percentual',CASE WHEN bounds.seconds*(SELECT count(*) FROM assets)=0 THEN NULL
           ELSE round(GREATEST(0,100*(1-downtime.seconds/(bounds.seconds*(SELECT count(*) FROM assets)))),2) END,
         'reincidencias',(SELECT COALESCE(sum(GREATEST(falhas-1,0)),0) FROM failures_by_asset),
         'ativos_reincidentes',(SELECT count(*) FROM failures_by_asset WHERE falhas>1)),
       'falhas_por_ativo',COALESCE((SELECT jsonb_agg(row) FROM
         (SELECT * FROM failures_by_asset ORDER BY falhas DESC,ativo_tag,ativo_id LIMIT $4) row),'[]'::jsonb),
       'falhas_por_setor',COALESCE((SELECT jsonb_agg(row) FROM
         (SELECT * FROM failures_by_sector ORDER BY falhas DESC,setor_nome,setor_id LIMIT $4) row),'[]'::jsonb),
       'ativos_parados_lista',COALESCE((SELECT jsonb_agg(row) FROM
         (SELECT asset.id,asset.tag AS ativo_tag,asset.name AS ativo_nome,asset.sector_name AS setor_nome,
            COALESCE(current_stop.reason, CASE WHEN asset.operational_status='STOPPED'
              THEN 'Parada operacional sinalizada.' ELSE 'Parada aberta aguardando tratamento.' END) AS motivo_parada,
            current_stop.started_at AS parada_iniciada_em,
            current_stop.status AS parada_status
          FROM assets asset
          LEFT JOIN LATERAL (
            SELECT stop.reason,stop.started_at,stop.status
            FROM maintenance.equipment_stops stop
            WHERE stop.asset_id=asset.id AND stop.tenant_id=asset.tenant_id
              AND stop.status NOT IN ('COMPLETED','CANCELLED')
            ORDER BY stop.started_at DESC,stop.id DESC LIMIT 1
          ) current_stop ON true
          WHERE asset.operational_status='STOPPED'
            OR EXISTS (SELECT 1 FROM maintenance.equipment_stops stop WHERE stop.asset_id=asset.id
              AND stop.tenant_id=asset.tenant_id AND stop.status NOT IN ('COMPLETED','CANCELLED'))
          ORDER BY asset.tag,asset.id LIMIT 50) row),'[]'::jsonb),
       'preventivas',COALESCE((SELECT jsonb_agg(row) FROM (SELECT * FROM upcoming LIMIT 50) row),'[]'::jsonb),
       'tecnicos',COALESCE((SELECT jsonb_agg(row) FROM
         (SELECT id,name AS nome,executions AS execucoes FROM technicians ORDER BY name,id LIMIT $4) row),'[]'::jsonb)
     ) AS dashboard FROM bounds,downtime`,
    [query.startAt, query.endAt, query.assetId, query.rankingLimit],
  );
  return result.rows[0]?.dashboard;
}
