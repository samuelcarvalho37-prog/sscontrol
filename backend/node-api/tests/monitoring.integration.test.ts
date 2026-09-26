import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { createTestEnvironment } from './helpers/environment.js';
import { loadPcmDashboard } from '../src/modules/monitoring/pcm-dashboard.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = randomUUID();
const tenantSlug = `monitoring-${randomUUID()}`;

const ids = {
  admin: randomUUID(),
  manager: randomUUID(),
  pcm: randomUUID(),
  operator: randomUUID(),
  adminRole: randomUUID(),
  managerRole: randomUUID(),
  pcmRole: randomUUID(),
  operatorRole: randomUUID(),
  technicalArea: randomUUID(),
  technicalRole: randomUUID(),
  plant: randomUUID(),
  sector: randomUUID(),
  line: randomUUID(),
  asset: randomUUID(),
  alert: randomUUID(),
  parameter: randomUUID(),
  parameterPolicy: randomUUID(),
  parameterReading: randomUUID(),
} as const;

interface Tokens {
  readonly admin: string;
  readonly manager: string;
  readonly pcm: string;
  readonly operator: string;
}

interface PcmDashboardPayload {
  readonly atual: {
    readonly ativos_parados: number;
    readonly ordens_abertas: number;
  };
  readonly confiabilidade: {
    readonly ativos_considerados: number;
    readonly falhas: number;
    readonly mttr_segundos: number | null;
    readonly mtbf_segundos: number | null;
    readonly disponibilidade_percentual: number | null;
    readonly reincidencias: number;
  };
  readonly falhas_por_ativo: readonly { readonly ativo_id: string }[];
  readonly falhas_por_setor: readonly { readonly falhas: number }[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isPcmDashboardPayload(value: unknown): value is PcmDashboardPayload {
  if (!isRecord(value) || !isRecord(value.atual) || !isRecord(value.confiabilidade)) return false;
  const { atual, confiabilidade } = value;
  return (
    typeof atual.ativos_parados === 'number' &&
    typeof atual.ordens_abertas === 'number' &&
    typeof confiabilidade.ativos_considerados === 'number' &&
    typeof confiabilidade.falhas === 'number' &&
    isNumberOrNull(confiabilidade.mttr_segundos) &&
    isNumberOrNull(confiabilidade.mtbf_segundos) &&
    isNumberOrNull(confiabilidade.disponibilidade_percentual) &&
    typeof confiabilidade.reincidencias === 'number' &&
    Array.isArray(value.falhas_por_ativo) &&
    value.falhas_por_ativo.every(
      (item) => isRecord(item) && typeof item.ativo_id === 'string',
    ) &&
    Array.isArray(value.falhas_por_setor) &&
    value.falhas_por_setor.every(
      (item) => isRecord(item) && typeof item.falhas === 'number',
    )
  );
}

function pcmDashboardPayload(value: unknown): PcmDashboardPayload {
  assert.ok(isPcmDashboardPayload(value), 'Payload do Dashboard PCM fora do contrato esperado.');
  return value;
}

function sessionToken(): { readonly raw: string; readonly hash: string } {
  const raw = `fcs_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: createHash('sha256').update(raw, 'utf8').digest('hex') };
}

function bearer(raw: string) {
  return { authorization: `Bearer ${raw}` };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`,
      [tenantId, ids.admin],
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  } finally {
    client.release();
  }
}

async function seed(pool: Pool): Promise<Tokens> {
  const admin = sessionToken();
  const manager = sessionToken();
  const pcm = sessionToken();
  const operator = sessionToken();
  await transaction(pool, async (client) => {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
       VALUES ($1,'Monitoramento Testes','Monitoramento Testes',$2,'DEVELOPMENT','ACTIVE')`,
      [tenantId, tenantSlug],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected) VALUES
       ($1,$5,'MON_ADMIN','Administrador','Administra monitoramento.','ADMIN',true),
       ($2,$5,'MON_MANAGER','Gestor técnico','Trata eventos técnicos.','MANAGER',true),
       ($3,$5,'PCM','Planejador PCM','Planeja e libera ordens.','CUSTOM',true),
       ($4,$5,'MON_OPERATOR','Operador','Registra ocorrências.','OPERATOR',true)`,
      [ids.adminRole, ids.managerRole, ids.pcmRole, ids.operatorRole, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required) VALUES
       ($1,$5,'USR-MON-ADM','Admin Monitoramento','mon.admin@fabcontrol.local',false),
       ($2,$5,'USR-MON-GES','Gestor Monitoramento','mon.manager@fabcontrol.local',false),
       ($3,$5,'USR-MON-PCM','PCM Monitoramento','mon.pcm@fabcontrol.local',false),
       ($4,$5,'USR-MON-OPE','Operador Monitoramento','mon.operator@fabcontrol.local',false)`,
      [ids.admin, ids.manager, ids.pcm, ids.operator, tenantId],
    );
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES
       ($1,$2,$6),($1,$3,$7),($1,$4,$8),($1,$5,$9)`,
      [
        tenantId,
        ids.admin,
        ids.manager,
        ids.pcm,
        ids.operator,
        ids.adminRole,
        ids.managerRole,
        ids.pcmRole,
        ids.operatorRole,
      ],
    );

    for (const [roleId, capabilities] of [
      [
        ids.adminRole,
        [
          'maintenance.occurrences.read',
          'maintenance.stops.read',
          'maintenance.alerts.read',
          'workflow.notifications.read',
          'analytics.technical.read',
        ],
      ],
      [
        ids.managerRole,
        [
          'maintenance.occurrences.read',
          'maintenance.occurrences.report',
          'maintenance.occurrences.triage',
          'maintenance.stops.read',
          'maintenance.stops.manage',
          'maintenance.alerts.read',
          'maintenance.alerts.manage',
          'workflow.notifications.read',
          'analytics.technical.read',
        ],
      ],
      [
        ids.pcmRole,
        [
          'maintenance.occurrences.read',
          'workflow.notifications.read',
        ],
      ],
      [
        ids.operatorRole,
        [
          'maintenance.occurrences.read',
          'maintenance.occurrences.report',
          'maintenance.stops.read',
          'workflow.notifications.read',
        ],
      ],
    ] as const) {
      await client.query(
        `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
         SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code=ANY($3::text[])`,
        [tenantId, roleId, capabilities],
      );
    }

    await client.query(
      `INSERT INTO iam.technical_areas
       (id,tenant_id,code,name,description,validation_area,default_signature_required,created_by)
       VALUES ($1,$2,'MAINTENANCE','Manutenção','Análise e confiabilidade.',false,false,$3)`,
      [ids.technicalArea, tenantId, ids.admin],
    );
    await client.query(
      `INSERT INTO iam.technical_roles
       (id,tenant_id,technical_area_id,code,name,description,can_sign,created_by)
       VALUES ($1,$2,$3,'MAINTENANCE_TECHNICIAN','Técnico de manutenção','Emite análise.',false,$4)`,
      [ids.technicalRole, tenantId, ids.technicalArea, ids.admin],
    );
    await client.query(
      `INSERT INTO iam.user_technical_assignments
       (tenant_id,user_id,technical_area_id,technical_role_id,is_primary,assigned_by)
       VALUES ($1,$2,$3,$4,true,$5)`,
      [tenantId, ids.manager, ids.technicalArea, ids.technicalRole, ids.admin],
    );

    for (const [userId, session] of [
      [ids.admin, admin],
      [ids.manager, manager],
      [ids.pcm, pcm],
      [ids.operator, operator],
    ] as const) {
      await client.query(
        `INSERT INTO iam.sessions
         (tenant_id,user_id,token_hash_sha256,environment,scope,ip_address,expires_at)
         VALUES ($1,$2,$3,'DEVELOPMENT','{"purpose":"APPLICATION"}'::jsonb,'127.0.0.1',clock_timestamp()+interval '1 hour')`,
        [tenantId, userId, session.hash],
      );
    }

    await client.query(
      `INSERT INTO cmms.plants (id,tenant_id,tag,name) VALUES ($1,$2,'PLT-MON','Planta Monitoramento')`,
      [ids.plant, tenantId],
    );
    await client.query(
      `INSERT INTO cmms.sectors (id,tenant_id,plant_id,tag,name) VALUES ($1,$2,$3,'SET-MON','Manutenção')`,
      [ids.sector, tenantId, ids.plant],
    );
    await client.query(
      `INSERT INTO cmms.lines (id,tenant_id,sector_id,tag,name) VALUES ($1,$2,$3,'LIN-MON','Linha Monitoramento')`,
      [ids.line, tenantId, ids.sector],
    );
    await client.query(
      `INSERT INTO cmms.assets
       (id,tenant_id,line_id,tag,qr_payload,name,asset_type,criticality,lifecycle_status,operational_status)
       VALUES ($1,$2,$3,'EQ-MON-001','FAB:ASSET:EQ-MON-001','Virador de tambor','MACHINE','CRITICAL','ACTIVE','OPERATING')`,
      [ids.asset, tenantId, ids.line],
    );
    await client.query(
      `INSERT INTO cmms.parameter_definitions
         (id,tenant_id,asset_id,code,name,unit,value_type,source_type,status)
       VALUES ($1,$2,$3,'TEMPERATURE','Temperatura do mancal','°C','DECIMAL','MANUAL','ACTIVE')`,
      [ids.parameter, tenantId, ids.asset],
    );
    await client.query(
      `INSERT INTO cmms.parameter_policies
         (id,tenant_id,parameter_definition_id,version,warning_min,warning_max,
          critical_min,critical_max,effective_from,status,content_hash_sha256,created_by,approved_by,approved_at)
       VALUES ($1,$2,$3,1,20,70,10,90,clock_timestamp(),'ACTIVE',$4,$5,$5,clock_timestamp())`,
      [ids.parameterPolicy, tenantId, ids.parameter, 'a'.repeat(64), ids.admin],
    );
    await client.query(
      `INSERT INTO cmms.parameter_readings
         (id,tenant_id,parameter_definition_id,parameter_policy_id,numeric_value,unit,
          classification,source,recorded_by,recorded_at,raw_value)
       VALUES ($1,$2,$3,$4,82,'°C','WARNING_HIGH','MANUAL',$5,clock_timestamp(),'82')`,
      [ids.parameterReading, tenantId, ids.parameter, ids.parameterPolicy, ids.manager],
    );
  });
  return { admin: admin.raw, manager: manager.raw, pcm: pcm.raw, operator: operator.raw };
}

test(
  'monitoramento: ocorrência, parada, análise, notificação persistente, alerta e indicadores',
  { skip: !integrationEnabled },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const tokens = await seed(pool);
    const app = await buildApp({ environment: createTestEnvironment(databaseUrl, tenantId, tenantSlug) });
    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const occurrenceResponse = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/occurrences',
      headers: bearer(tokens.operator),
      payload: {
        ativo_id: ids.asset,
        componente_id: null,
        tipo: 'FALHA_OPERACIONAL',
        titulo: 'Ruído anormal e equipamento parado',
        descricao: 'O equipamento apresentou ruído anormal e interrompeu a operação.',
        severidade: 'LOW',
        equipamento_parado: false,
        triagem: {
          situacao_atual: 'Equipamento parou durante a produção',
          equipamento_parado: true, risco_parada: true, risco_seguranca: false,
          impacto_producao: true, impacto_qualidade: false, existe_redundancia: false,
        },
        tipo_parada: 'NAO_PLANEJADA',
        motivo_parada: 'Falha mecânica sob investigação.',
        ocorrida_em: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    assert.equal(occurrenceResponse.statusCode, 200, occurrenceResponse.body);
    const occurrence = occurrenceResponse.json().data;
    const occurrenceId: string = occurrence.id;
    const stopId: string = occurrence.parada.id;
    assert.equal(occurrence.status, 'OPEN');
    assert.equal(occurrence.severidade, 'CRITICAL', 'A API deve recalcular a prioridade e a condição de parada');
    const reported = await app.inject({ method: 'GET',
      url: `/v1/maintenance/occurrences/${occurrenceId}`, headers: bearer(tokens.operator) });
    assert.equal(reported.statusCode, 200, reported.body);
    assert.equal(reported.json().data.relato_producao.triagem.impacto_producao, true);
    assert.equal(reported.json().data.relato_producao.regra_prioridade, 'v1');

    const assetStopped = await transaction(pool, async (client) =>
      client.query(`SELECT operational_status FROM cmms.assets WHERE id=$1`, [ids.asset]),
    );
    assert.equal(assetStopped.rows[0]!.operational_status, 'STOPPED');

    const notifications = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true',
      headers: bearer(tokens.manager),
    });
    assert.equal(notifications.statusCode, 200, notifications.body);
    assert.equal(notifications.json().data.contadores.nao_lidas, 1);
    const notificationId: string = notifications.json().data.itens[0].id;
    assert.equal(notifications.json().data.itens[0].entidade_id, occurrenceId);

    const pcmNotifications = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true',
      headers: bearer(tokens.pcm),
    });
    assert.equal(pcmNotifications.statusCode, 200, pcmNotifications.body);
    assert.equal(pcmNotifications.json().data.contadores.nao_lidas, 1);
    assert.equal(pcmNotifications.json().data.itens[0].entidade_id, occurrenceId);

    const read = await app.inject({
      method: 'PATCH',
      url: `/v1/notifications/${notificationId}/read`,
      headers: bearer(tokens.manager),
    });
    assert.equal(read.statusCode, 200, read.body);
    const unreadAfterRead = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true',
      headers: bearer(tokens.manager),
    });
    assert.equal(unreadAfterRead.json().data.contadores.nao_lidas, 0);
    assert.equal(unreadAfterRead.json().data.itens.length, 0);

    const analysis = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/occurrences/${occurrenceId}/technical-analysis`,
      headers: bearer(tokens.manager),
      payload: {
        titulo: 'Análise do ruído anormal',
        diagnostico: 'Inspeção preliminar indica desgaste no conjunto mecânico do acionamento.',
        risco: 'Risco de dano progressivo e parada prolongada.',
        causa_provavel: 'Desgaste de rolamento',
        recomendacao: 'Criar checklist de inspeção mecânica e plano de correção.',
        recomenda_checklist: true,
        recomenda_ordem_servico: true,
        prioridade: 'CRITICAL',
        relatorio: { origem: 'inspeção local', bloqueio_recomendado: true },
      },
    });
    assert.equal(analysis.statusCode, 200, analysis.body);
    assert.equal(analysis.json().data.status, 'IN_TREATMENT');
    assert.equal(analysis.json().data.tratamento_status, 'CHECKLIST_REQUESTED');

    const adminNotifications = await app.inject({
      method: 'GET',
      url: '/v1/notifications?somente_nao_lidas=true&contexto=TECHNICAL_ANALYSIS',
      headers: bearer(tokens.admin),
    });
    assert.equal(adminNotifications.statusCode, 200, adminNotifications.body);
    assert.equal(adminNotifications.json().data.itens.length, 1);

    const parameterAction = await app.inject({
      method: 'POST',
      url: '/v1/monitoring/parameter-action-requests',
      headers: bearer(tokens.manager),
      payload: {
        leitura_id: ids.parameterReading,
        tipo_solicitacao: 'CHECKLIST',
        prioridade: null,
        observacao: 'Confirmar aquecimento e condição de lubrificação do mancal.',
        causa_provavel: 'Lubrificação insuficiente.',
        risco: 'Falha prematura do rolamento.',
        limite_minimo_proposto: null,
        limite_maximo_proposto: null,
      },
    });
    assert.equal(parameterAction.statusCode, 200, parameterAction.body);
    assert.equal(parameterAction.json().data.requested, true);
    assert.equal(parameterAction.json().data.already_requested, false);
    assert.equal(parameterAction.json().data.status_parametro, 'ACIMA_LIMITE');
    assert.equal(parameterAction.json().data.ocorrencia.tratamento_status, 'CHECKLIST_REQUESTED');
    assert.equal(parameterAction.json().data.analise.status, 'SENT_TO_ADMIN');

    const repeatedParameterAction = await app.inject({
      method: 'POST',
      url: '/v1/monitoring/parameter-action-requests',
      headers: bearer(tokens.manager),
      payload: {
        leitura_id: ids.parameterReading,
        tipo_solicitacao: 'CHECKLIST',
        prioridade: null,
        observacao: null,
        causa_provavel: null,
        risco: null,
        limite_minimo_proposto: null,
        limite_maximo_proposto: null,
      },
    });
    assert.equal(repeatedParameterAction.statusCode, 200, repeatedParameterAction.body);
    assert.equal(repeatedParameterAction.json().data.already_requested, true);

    for (const status of ['IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN', 'COMPLETED'] as const) {
      const transition = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/stops/${stopId}/transition`,
        headers: bearer(tokens.manager),
        payload: {
          status,
          categoria_retorno: status === 'COMPLETED' ? 'REPARO_CONFIRMADO' : null,
          justificativa_divergencia: null,
        },
      });
      assert.equal(transition.statusCode, 200, transition.body);
      assert.equal(transition.json().data.status, status);
    }

    const assetOperating = await transaction(pool, async (client) =>
      client.query(
        `SELECT asset.operational_status,
                (SELECT status FROM maintenance.operational_occurrences WHERE id=$2) AS occurrence_status
         FROM cmms.assets asset WHERE asset.id=$1`,
        [ids.asset, occurrenceId],
      ),
    );
    assert.equal(assetOperating.rows[0]!.operational_status, 'OPERATING');
    assert.equal(assetOperating.rows[0]!.occurrence_status, 'RESOLVED');

    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO maintenance.operational_alerts
         (id,tenant_id,asset_id,alert_type,severity,title,message,status,deduplication_key,first_detected_at,last_detected_at)
         VALUES ($1,$2,$3,'PARAMETER_OUT_OF_RANGE','HIGH','Temperatura elevada',
                 'Temperatura acima do limite técnico.','OPEN',$4,clock_timestamp(),clock_timestamp())`,
        [ids.alert, tenantId, ids.asset, `alert-${ids.alert}`],
      );
    });

    const acknowledged = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/alerts/${ids.alert}/acknowledge`,
      headers: bearer(tokens.manager),
    });
    assert.equal(acknowledged.statusCode, 200, acknowledged.body);
    assert.equal(acknowledged.json().data.status, 'ACKNOWLEDGED');

    const alertOccurrence = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/alerts/${ids.alert}/create-occurrence`,
      headers: bearer(tokens.manager),
      payload: { equipamento_parado: false },
    });
    assert.equal(alertOccurrence.statusCode, 200, alertOccurrence.body);
    assert.equal(alertOccurrence.json().data.titulo, 'Temperatura elevada');

    const analytics = await app.inject({
      method: 'GET',
      url: `/v1/analytics/technical-summary?inicio=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&fim=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&ativo_id=${ids.asset}`,
      headers: bearer(tokens.manager),
    });
    assert.equal(analytics.statusCode, 200, analytics.body);
    assert.equal(analytics.json().data.resumo.total_assets, 1);
    assert.equal(analytics.json().data.resumo.falhas_nao_planejadas, 1);
    assert.equal(analytics.json().data.ranking_ativos.length, 1);
    assert.equal('oee' in analytics.json().data.resumo, false);

    const invalidTransition = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/stops/${stopId}/transition`,
      headers: bearer(tokens.manager),
      payload: {
        status: 'IN_MAINTENANCE',
        categoria_retorno: null,
        justificativa_divergencia: null,
      },
    });
    assert.equal(invalidTransition.statusCode, 409, invalidTransition.body);
    assert.equal(invalidTransition.json().error.code, 'INVALID_STOP_TRANSITION');

    const directStop = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/stops',
      headers: bearer(tokens.manager),
      payload: {
        ativo_id: ids.asset,
        componente_id: null,
        origem: 'MANAGER',
        tipo: 'UNPLANNED',
        motivo: 'Parada direta aguardando triagem tÃ©cnica.',
        iniciada_em: new Date().toISOString(),
        tolerancia_retorno_minutos: 10,
      },
    });
    assert.equal(directStop.statusCode, 200, directStop.body);
    const directStopId: string = directStop.json().data.id;

    const firstTreatment = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/stops/${directStopId}/create-treatment`,
      headers: bearer(tokens.manager),
    });
    assert.equal(firstTreatment.statusCode, 200, firstTreatment.body);
    assert.equal(firstTreatment.json().data.created, true);
    const treatmentOccurrenceId: string = firstTreatment.json().data.occurrence.id;

    const repeatedTreatment = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/stops/${directStopId}/create-treatment`,
      headers: bearer(tokens.manager),
    });
    assert.equal(repeatedTreatment.statusCode, 200, repeatedTreatment.body);
    assert.equal(repeatedTreatment.json().data.already_exists, true);
    assert.equal(repeatedTreatment.json().data.occurrence.id, treatmentOccurrenceId);

    // Two 30-minute failures and one overlapping planned stop: 1 hour of actual downtime.
    await transaction(pool, async (client) => {
      for (const status of ['IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN', 'COMPLETED']) {
        await client.query('UPDATE maintenance.equipment_stops SET status=$2 WHERE id=$1', [directStopId, status]);
      }
      const plannedId = randomUUID();
      await client.query(`INSERT INTO maintenance.equipment_stops
        (id,tenant_id,asset_id,origin,stop_type,started_at,started_by,reason)
        VALUES ($1,$2,$3,'MANAGER','PLANNED',now()-interval '2 hours',$4,'Preventiva programada')`,
      [plannedId,tenantId,ids.asset,ids.manager]);
      for (const status of ['IN_MAINTENANCE', 'WAITING_OPERATIONAL_RETURN', 'COMPLETED']) {
        await client.query('UPDATE maintenance.equipment_stops SET status=$2 WHERE id=$1', [plannedId, status]);
      }
      const end = new Date(Date.now()-60_000);
      const start = new Date(end.getTime()-4*3600_000);
      for (const [id, offset] of [[stopId,120],[directStopId,90],[plannedId,120]] as const) {
        await client.query(`UPDATE maintenance.equipment_stops SET started_at=$2,completed_at=$3 WHERE id=$1`,
          [id,new Date(end.getTime()-offset*60_000),new Date(end.getTime()-(offset-30)*60_000)]);
      }
      const query = {startAt:start.toISOString(),endAt:end.toISOString(),assetId:null,rankingLimit:10};
       const pcm = pcmDashboardPayload(await loadPcmDashboard(client,query));
      assert.equal(pcm.confiabilidade.falhas,2);
      assert.equal(pcm.confiabilidade.mttr_segundos,1800);
      assert.equal(pcm.confiabilidade.mtbf_segundos,5400);
      assert.equal(pcm.confiabilidade.disponibilidade_percentual,75);
      assert.equal(pcm.confiabilidade.reincidencias,1);
       const firstFailureByAsset = pcm.falhas_por_ativo[0];
       assert.ok(firstFailureByAsset, 'O Dashboard PCM deve listar a falha do ativo de teste.');
       assert.equal(firstFailureByAsset.ativo_id,ids.asset);
       const firstFailureBySector = pcm.falhas_por_setor[0];
       assert.ok(firstFailureBySector, 'O Dashboard PCM deve listar a falha do setor de teste.');
       assert.equal(firstFailureBySector.falhas,2);
      assert.equal(pcm.atual.ativos_parados,0);
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[randomUUID()]);
       const otherTenant = pcmDashboardPayload(await loadPcmDashboard(client,query));
      assert.equal(otherTenant.confiabilidade.ativos_considerados,0);
      assert.equal(otherTenant.confiabilidade.disponibilidade_percentual,null);
      assert.equal(otherTenant.atual.ordens_abertas,0);
      assert.deepEqual(otherTenant.falhas_por_ativo,[]);
    });
  },
);
