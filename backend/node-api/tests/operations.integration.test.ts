import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { MonitoringRepository } from '../src/modules/monitoring/monitoring.repository.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = randomUUID();

const ids = {
  admin: randomUUID(),
  quality: randomUUID(),
  safety: randomUUID(),
  operator: randomUUID(),
  support: randomUUID(),
  adminRole: randomUUID(),
  validatorRole: randomUUID(),
  operatorRole: randomUUID(),
  qualityArea: randomUUID(),
  safetyArea: randomUUID(),
  qualityTechnicalRole: randomUUID(),
  safetyTechnicalRole: randomUUID(),
  plant: randomUUID(),
  sector: randomUUID(),
  line: randomUUID(),
  asset: randomUUID(),
  component: randomUUID(),
  parameter: randomUUID(),
  policy: randomUUID(),
  checklist: randomUUID(),
  checklistVersion: randomUUID(),
  confirmationItem: randomUUID(),
  inspectionItem: randomUUID(),
  parameterItem: randomUUID(),
  evidenceItem: randomUUID(),
  plan: randomUUID(),
  planVersion: randomUUID(),
  storageObject: randomUUID(),
} as const;

interface Identities {
  readonly admin: string;
  readonly quality: string;
  readonly safety: string;
  readonly operator: string;
  readonly support: string;
}

interface SeededIdentities extends Identities {
  readonly tenantSlug: string;
}

function token(): { readonly raw: string; readonly hash: string } {
  const raw = `fcs_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: createHash('sha256').update(raw, 'utf8').digest('hex') };
}

function bearer(raw: string) {
  return { authorization: `Bearer ${raw}` };
}

function multipartPhoto(file: Buffer, fileName = 'condicao-final.jpg', mediaType = 'image/jpeg') {
  const boundary = `fab-control-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="observacao"\r\n\r\nCondição final segura.\r\n`,
      'utf8',
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${fileName}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
      'utf8',
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
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

async function seed(pool: Pool): Promise<SeededIdentities> {
  const admin = token();
  const quality = token();
  const safety = token();
  const operator = token();
  const support = token();
  const tenantSlug = `operations-${randomUUID()}`;
  await transaction(pool, async (client) => {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
      VALUES ($1,'Operações Testes','Operações Testes',$2,'DEVELOPMENT','ACTIVE')`,
       [tenantId, tenantSlug],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected) VALUES
      ($1,$4,'OPS_ADMIN','Administrador','Administra o fluxo.','ADMIN',true),
      ($2,$4,'OPS_VALIDATOR','Validador','Valida o fluxo.','MANAGER',true),
      ($3,$4,'OPS_OPERATOR','Operador','Executa o fluxo.','OPERATOR',true)`,
      [ids.adminRole, ids.validatorRole, ids.operatorRole, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required) VALUES
      ($1,$6,'USR-OPS-ADM','Admin Operações','ops.admin@fabcontrol.local',false),
      ($2,$6,'USR-OPS-QUA','Qualidade Operações','ops.quality@fabcontrol.local',false),
      ($3,$6,'USR-OPS-SEG','Segurança Operações','ops.safety@fabcontrol.local',false),
      ($4,$6,'USR-OPS-OPE','Operador Operações','ops.operator@fabcontrol.local',false),
      ($5,$6,'USR-OPS-SUP','Apoio Operações','ops.support@fabcontrol.local',false)`,
      [ids.admin, ids.quality, ids.safety, ids.operator, ids.support, tenantId],
    );
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES
      ($1,$2,$7),($1,$3,$8),($1,$4,$8),($1,$5,$9),($1,$6,$9)`,
      [
        tenantId,
        ids.admin,
        ids.quality,
        ids.safety,
        ids.operator,
        ids.support,
        ids.adminRole,
        ids.validatorRole,
        ids.operatorRole,
      ],
    );
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
      SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code=ANY($3::text[])`,
      [
        tenantId,
        ids.adminRole,
        [
          'maintenance.work-orders.read',
          'maintenance.work-orders.manage',
          'maintenance.work-orders.release',
          'maintenance.executions.read',
          'analytics.technical.read',
        ],
      ],
    );
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
      SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code=ANY($3::text[])`,
      [
        tenantId,
        ids.validatorRole,
        [
          'maintenance.work-orders.read',
          'maintenance.work-orders.review',
          'maintenance.executions.read',
        ],
      ],
    );
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
      SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code=ANY($3::text[])`,
      [
        tenantId,
        ids.operatorRole,
        ['maintenance.executions.read', 'maintenance.executions.perform'],
      ],
    );
    await client.query(
      `INSERT INTO iam.technical_areas
      (id,tenant_id,code,name,description,validation_area,default_signature_required,created_by) VALUES
      ($1,$3,'QUALITY','Qualidade','Validação de qualidade.',true,true,$4),
      ($2,$3,'SAFETY','Segurança','Validação de segurança.',true,true,$4)`,
      [ids.qualityArea, ids.safetyArea, tenantId, ids.admin],
    );
    await client.query(
      `INSERT INTO iam.technical_roles
      (id,tenant_id,technical_area_id,code,name,description,can_sign,created_by) VALUES
      ($1,$3,$4,'QUALITY_INSPECTOR','Inspetor','Assinante.',true,$6),
      ($2,$3,$5,'SAFETY_TECHNICIAN','Técnico de segurança','Assinante.',true,$6)`,
      [
        ids.qualityTechnicalRole,
        ids.safetyTechnicalRole,
        tenantId,
        ids.qualityArea,
        ids.safetyArea,
        ids.admin,
      ],
    );
    await client.query(
      `INSERT INTO iam.user_technical_assignments
      (tenant_id,user_id,technical_area_id,technical_role_id,is_primary,assigned_by) VALUES
      ($1,$2,$4,$5,true,$6),($1,$3,$7,$8,true,$6)`,
      [
        tenantId,
        ids.quality,
        ids.safety,
        ids.qualityArea,
        ids.qualityTechnicalRole,
        ids.admin,
        ids.safetyArea,
        ids.safetyTechnicalRole,
      ],
    );
    for (const [userId, session] of [
      [ids.admin, admin],
      [ids.quality, quality],
      [ids.safety, safety],
      [ids.operator, operator],
      [ids.support, support],
    ] as const) {
      await client.query(
        `INSERT INTO iam.sessions
        (tenant_id,user_id,token_hash_sha256,environment,scope,ip_address,expires_at)
        VALUES ($1,$2,$3,'DEVELOPMENT','{"purpose":"APPLICATION"}'::jsonb,'127.0.0.1',clock_timestamp()+interval '1 hour')`,
        [tenantId, userId, session.hash],
      );
    }
    await client.query(
      `INSERT INTO cmms.plants (id,tenant_id,tag,name) VALUES ($1,$2,'PLT-OPS','Planta Operações')`,
      [ids.plant, tenantId],
    );
    await client.query(
      `INSERT INTO cmms.sectors (id,tenant_id,plant_id,tag,name) VALUES ($1,$2,$3,'SET-OPS','Manutenção')`,
      [ids.sector, tenantId, ids.plant],
    );
    await client.query(
      `INSERT INTO cmms.lines (id,tenant_id,sector_id,tag,name) VALUES ($1,$2,$3,'LIN-OPS','Linha Operações')`,
      [ids.line, tenantId, ids.sector],
    );
    await client.query(
      `INSERT INTO cmms.assets
      (id,tenant_id,line_id,tag,qr_payload,name,asset_type,manufacturer,model,serial_number,criticality,lifecycle_status,technical_location)
      VALUES ($1,$2,$3,'EQ-OPS-001','FAB:ASSET:EQ-OPS-001','Prensa de teste','PRESS','Fab','P1','OPS001','HIGH','ACTIVE','Linha Operações')`,
      [ids.asset, tenantId, ids.line],
    );
    await client.query(
      `INSERT INTO cmms.components
      (id,tenant_id,asset_id,tag,qr_payload,name,component_type,criticality,lifecycle_status)
      VALUES ($1,$2,$3,'MOT-OPS-001','FAB:COMPONENT:MOT-OPS-001','Motor principal','MOTOR','HIGH','ACTIVE')`,
      [ids.component, tenantId, ids.asset],
    );
    await client.query(
      `INSERT INTO cmms.parameter_definitions
      (id,tenant_id,asset_id,component_id,code,name,unit,value_type,source_type,status)
      VALUES ($1,$2,$3,$4,'TEMP-OPS','Temperatura','°C','DECIMAL','MANUAL','ACTIVE')`,
      [ids.parameter, tenantId, ids.asset, ids.component],
    );
    await client.query(
      `INSERT INTO cmms.parameter_policies
      (id,tenant_id,parameter_definition_id,version,warning_min,warning_max,critical_min,critical_max,effective_from,status,content_hash_sha256,created_by,approved_by,approved_at)
      VALUES ($1,$2,$3,1,150,170,140,180,clock_timestamp(),'ACTIVE',$4,$5,$5,clock_timestamp())`,
      [ids.policy, tenantId, ids.parameter, 'a'.repeat(64), ids.admin],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_templates
      (id,tenant_id,code,name,asset_id,component_id,checklist_type,criticality,created_by)
      VALUES ($1,$2,'CHK-OPS-001','Checklist operacional completo',$3,$4,'PREVENTIVE','HIGH',$5)`,
      [ids.checklist, tenantId, ids.asset, ids.component, ids.admin],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_template_versions
      (id,tenant_id,checklist_template_id,revision,status,signature_policy,required_signatures,segregation_required,content_hash_sha256,created_by,submitted_at)
      VALUES ($1,$2,$3,1,'DRAFT','QUALIDADE_E_SEGURANCA',2,true,$4,$5,clock_timestamp())`,
      [ids.checklistVersion, tenantId, ids.checklist, 'b'.repeat(64), ids.admin],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_items
      (id,tenant_id,checklist_template_version_id,sequence,title,instruction,response_type_code,category,required,evidence_required,minimum_evidence_photos,blocks_completion,parameter_definition_id,minimum_value,maximum_value,unit)
      VALUES
      ($1,$5,$6,1,'Confirmar bloqueio','Confirme o bloqueio seguro.','CONFIRMACAO','SEGURANCA',true,false,0,true,NULL,NULL,NULL,NULL),
      ($2,$5,$6,2,'Inspecionar condição do rolamento','Registre a condição encontrada.','OK_NOK','MECANICA',true,false,0,true,NULL,NULL,NULL,NULL),
      ($3,$5,$6,3,'Medir temperatura','Registre a temperatura.','PARAMETRO','TECNICO',true,false,0,true,$7,150,170,'°C'),
      ($4,$5,$6,4,'Fotografar condição','Registre evidência.','EVIDENCIA','TECNICO',true,true,1,true,NULL,NULL,NULL,NULL)`,
      [
        ids.confirmationItem,
        ids.inspectionItem,
        ids.parameterItem,
        ids.evidenceItem,
        tenantId,
        ids.checklistVersion,
        ids.parameter,
      ],
    );
    await client.query(
      `UPDATE maintenance.checklist_template_versions SET status='APPROVED' WHERE id=$1`,
      [ids.checklistVersion],
    );
    await client.query(
      `UPDATE maintenance.checklist_template_versions SET status='PUBLISHED',published_at=clock_timestamp() WHERE id=$1`,
      [ids.checklistVersion],
    );
    await client.query(
      `INSERT INTO maintenance.maintenance_plans
      (id,tenant_id,code,name,asset_id,component_id,plan_type,created_by)
      VALUES ($1,$2,'PLN-OPS-001','Plano operacional completo',$3,$4,'PREVENTIVE',$5)`,
      [ids.plan, tenantId, ids.asset, ids.component, ids.admin],
    );
    await client.query(
      `INSERT INTO maintenance.maintenance_plan_versions
      (id,tenant_id,maintenance_plan_id,checklist_template_version_id,revision,status,criticality,trigger_type,recurrence_days,
       estimated_duration_minutes,lockout_required,evidence_required,maintenance_stop_mode,technical_analysis,content_hash_sha256,created_by,published_at)
      VALUES ($1,$2,$3,$4,1,'PUBLISHED','HIGH','PERIODICITY',30,45,true,true,'MANDATORY_STOP',
       '{"objetivo":"Validar fluxo completo"}'::jsonb,$5,$6,clock_timestamp())`,
      [ids.planVersion, tenantId, ids.plan, ids.checklistVersion, 'c'.repeat(64), ids.admin],
    );
    await client.query(
      `INSERT INTO platform.storage_objects
      (id,tenant_id,provider,bucket,object_key,original_name,media_type,byte_size,checksum_sha256,status,created_by)
      VALUES ($1,$2,'LOCAL_TEST','operations','evidence/test.jpg','teste.jpg','image/jpeg',128,$3,'AVAILABLE',$4)`,
      [ids.storageObject, tenantId, 'd'.repeat(64), ids.operator],
    );
  });
  return {
    admin: admin.raw,
    quality: quality.raw,
    safety: safety.raw,
    operator: operator.raw,
    support: support.raw,
    tenantSlug,
  };
}

test(
  'fluxo operacional: OS, dupla assinatura permanente, liberação, checklist, evidência e conclusão',
  { skip: !integrationEnabled },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const identities = await seed(pool);
    const app = await buildApp({ environment: createTestEnvironment(databaseUrl, tenantId, identities.tenantSlug) });
    context.after(async () => {
      await app.close();
      await pool.end();
      await rm('./var/test-private-storage', { recursive: true, force: true });
    });

    const correctionDraft = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN',
        entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE',
        titulo: 'OS destinada ao teste de correção',
        descricao: 'Conteúdo inicial que será devolvido pela Qualidade.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: new Date(Date.now() - 60000).toISOString(),
        analise_tecnica: { situacao: 'Análise inicial', exige_liberacao_pos_intervencao: true },
      },
    });
    assert.equal(correctionDraft.statusCode, 200, correctionDraft.body);
    const correctionWorkOrderId: string = correctionDraft.json().data.id;

    const correctionSubmitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${correctionWorkOrderId}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE',
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(correctionSubmitted.statusCode, 200, correctionSubmitted.body);
    const previousDemandId: string = correctionSubmitted.json().data.validacao.id;

    const changesRequested = await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${previousDemandId}/request-changes`,
      headers: bearer(identities.quality),
      payload: { motivo: 'Detalhar os riscos e o resultado técnico esperado antes da aprovação.' },
    });
    assert.equal(changesRequested.statusCode, 200, changesRequested.body);
    assert.equal(changesRequested.json().data.status, 'CHANGES_REQUESTED');

    const corrected = await app.inject({
      method: 'PATCH',
      url: `/v1/maintenance/work-orders/${correctionWorkOrderId}`,
      headers: bearer(identities.admin),
      payload: {
        titulo: 'OS corrigida após revisão da Qualidade',
        descricao: 'Riscos, bloqueio e resultado técnico foram detalhados para nova validação.',
        prioridade: 'HIGH',
        responsavel_id: null,
        programada_para: new Date(Date.now() - 60000).toISOString(),
        analise_tecnica: {
          situacao: 'Revisão preventiva',
          exige_liberacao_pos_intervencao: true,
          riscos: ['energia residual'],
          resultado_esperado: 'Equipamento seguro e liberado',
        },
      },
    });
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.equal(corrected.json().data.status, 'DRAFT');
    assert.equal(corrected.json().data.validacao, null);

    const correctionResubmitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${correctionWorkOrderId}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE',
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(correctionResubmitted.statusCode, 200, correctionResubmitted.body);
    assert.notEqual(correctionResubmitted.json().data.validacao.id, previousDemandId);

    await transaction(pool, async (client) => {
      const history = await client.query(
        `SELECT
          (SELECT status FROM workflow.technical_demands WHERE id=$1) AS previous_status,
          (SELECT count(*) FROM workflow.technical_demands WHERE entity_id=$2) AS review_count`,
        [previousDemandId, correctionWorkOrderId],
      );
      assert.equal(history.rows[0]!.previous_status, 'CHANGES_REQUESTED');
      assert.equal(Number(history.rows[0]!.review_count), 2);
    });

    await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${correctionResubmitted.json().data.validacao.id}/request-changes`,
      headers: bearer(identities.quality),
      payload: { motivo: 'Manter esta ordem de teste em correção, sem execução disponível.' },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN',
        entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE',
        titulo: 'Preventiva integral da prensa',
        descricao: 'Executar checklist validado.',
        prioridade: 'HIGH',
        responsavel_id: ids.operator,
        programada_para: new Date(Date.now() - 60000).toISOString(),
        analise_tecnica: {
          situacao: 'Manutenção programada',
          exige_liberacao_pos_intervencao: true,
          resultado_esperado: 'Equipamento seguro',
        },
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    const workOrderId: string = created.json().data.id;

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${workOrderId}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE_E_SEGURANCA',
        assinaturas_exigidas: 2,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    const demandId: string = submitted.json().data.validacao.id;
    await transaction(pool, async (client) => {
      const postIntervention = await client.query(
        `SELECT demand_type, status FROM workflow.technical_demands WHERE id=$1`,
        [demandId],
      );
      assert.deepEqual(postIntervention.rows[0], {
        demand_type: 'POST_INTERVENTION_RELEASE',
        status: 'OPEN',
      });
    });
    // O cenário completo inclui confirmação, inspeção, parâmetro e evidência.
    assert.equal(submitted.json().data.checklist_itens.length, 4);

    const technicalContext = await app.inject({
      method: 'GET',
      url: '/v1/workflow/technical-context',
      headers: bearer(identities.quality),
    });
    assert.equal(technicalContext.statusCode, 200, technicalContext.body);
    assert.equal(technicalContext.json().data.identidade.area_codigo, 'QUALITY');
    assert.equal(technicalContext.json().data.pode_assinar, true);

    const technicalQueue = await app.inject({
      method: 'GET',
      url: '/v1/workflow/technical-demands?status=OPEN',
      headers: bearer(identities.quality),
    });
    assert.equal(technicalQueue.statusCode, 200, technicalQueue.body);
    assert.match(technicalQueue.body, new RegExp(demandId));

    const assumedDemand = await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${demandId}/assume`,
      headers: bearer(identities.quality),
    });
    assert.equal(assumedDemand.statusCode, 200, assumedDemand.body);
    assert.equal(assumedDemand.json().data.demanda.responsavel_atual_id, ids.quality);

    const qualitySigned = await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${demandId}/sign`,
      headers: bearer(identities.quality),
      payload: {
        declaracao: 'Confirmo a conformidade técnica e a rastreabilidade desta ordem.',
        significado: 'Aprovação de Qualidade',
      },
    });
    assert.equal(qualitySigned.statusCode, 409, qualitySigned.body);

    const safetySigned = await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${demandId}/sign`,
      headers: bearer(identities.safety),
      payload: {
        declaracao: 'Confirmo os requisitos de segurança, bloqueio e evidências da ordem.',
        significado: 'Aprovação de Segurança',
      },
    });
    assert.equal(safetySigned.statusCode, 409, safetySigned.body);
    assert.equal(submitted.json().data.status, 'APPROVED');
    assert.equal(submitted.json().data.validacao.assinaturas.length, 0);
    assert.equal(submitted.json().data.acoes.length, 0);

    const releasedByPcm = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${workOrderId}/release`,
      headers: bearer(identities.admin),
    });
    assert.equal(releasedByPcm.statusCode, 200, releasedByPcm.body);
    assert.equal(releasedByPcm.json().data.status, 'RELEASED');
    assert.equal(releasedByPcm.json().data.acoes.length, 1);

    const workOrderList = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
    });
    assert.equal(workOrderList.statusCode, 200, workOrderList.body);
    const workOrderListBody: {
      data: { itens: (Record<string, unknown> & { id: string })[] };
    } = workOrderList.json();
    const listedWorkOrder = workOrderListBody.data.itens.find((item) => item.id === workOrderId);
    assert.ok(listedWorkOrder);
    assert.equal(listedWorkOrder.plano_id, ids.plan);
    assert.equal(listedWorkOrder.plano_versao_id, ids.planVersion);
    assert.equal(listedWorkOrder.plano_itens_count, 4);
    assert.equal(listedWorkOrder.acao_status, 'READY');
    assert.equal(listedWorkOrder.assinaturas_realizadas, 0);

    const managerActions = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/actions?status=READY',
      headers: bearer(identities.quality),
    });
    assert.equal(managerActions.statusCode, 200, managerActions.body);
    assert.equal(managerActions.json().data.total, 1);
    assert.equal(managerActions.json().data.acoes[0].ativo_tag, 'EQ-OPS-001');

    const queue = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/operator-actions',
      headers: bearer(identities.operator),
    });
    assert.equal(queue.statusCode, 200, queue.body);
    assert.equal(queue.json().data.itens.length, 1);
    const actionId: string = queue.json().data.itens[0].id;
    assert.equal(queue.json().data.itens[0].componente_tag, 'MOT-OPS-001');

    await transaction(pool, async (client) => {
      await client.query(
        `UPDATE maintenance.work_order_actions
         SET technical_analysis=jsonb_set(COALESCE(technical_analysis, '{}'::jsonb),
             '{tecnicos_apoio_ids}', $2::jsonb, true)
         WHERE id=$1`,
        [actionId, JSON.stringify([ids.support])],
      );
    });
    const supportQueue = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/operator-actions',
      headers: bearer(identities.support),
    });
    assert.equal(supportQueue.statusCode, 200, supportQueue.body);
    assert.equal(supportQueue.json().data.itens.length, 1);
    assert.equal(supportQueue.json().data.itens[0].id, actionId);
    const supportContext = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/operator-actions/${actionId}`,
      headers: bearer(identities.support),
    });
    assert.equal(supportContext.statusCode, 200, supportContext.body);
    const actionContext = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/operator-actions/${actionId}`,
      headers: bearer(identities.operator),
    });
    assert.equal(actionContext.statusCode, 200, actionContext.body);
    assert.equal(actionContext.json().data.acao.checklist_itens.length, 4);
    assert.equal(actionContext.json().data.execucao, null);

    const assumed = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/operator-actions/${actionId}/assume`,
      headers: bearer(identities.operator),
    });
    assert.equal(assumed.statusCode, 200, assumed.body);
    const executionId: string = assumed.json().data.id;
    assert.equal(assumed.json().data.itens.length, 4);

    const started = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/executions/${executionId}/start`,
      headers: bearer(identities.operator),
      payload: { modo_parada: 'STOPPED' },
    });
    assert.equal(started.statusCode, 200, started.body);
    const pcmUrl = `/v1/analytics/technical-summary?inicio=${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&fim=${encodeURIComponent(new Date(Date.now()+60000).toISOString())}`;
    const activePcm = await app.inject({method:'GET',url:pcmUrl,headers:bearer(identities.admin)});
    assert.equal(activePcm.statusCode,200,activePcm.body);
    assert.equal(activePcm.json().data.pcm.atual.tecnicos_em_atividade,1);
    assert.equal(activePcm.json().data.pcm.tecnicos[0].id,ids.operator);

    const resumedAtomically = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/operator-actions/${actionId}/start`,
      headers: bearer(identities.operator),
      payload: { modo_parada: 'STOPPED' },
    });
    assert.equal(resumedAtomically.statusCode, 200, resumedAtomically.body);
    assert.equal(resumedAtomically.json().data.ja_iniciada, true);
    assert.equal(resumedAtomically.json().data.execucao.id, executionId);

    const executionItems: readonly { id: string; tipo_resposta: string }[] =
      started.json().data.itens;
    const confirmation = executionItems.find((item) => item.tipo_resposta === 'CONFIRMACAO')!;
    const inspection = executionItems.find((item) => item.tipo_resposta === 'OK_NOK')!;
    const parameter = executionItems.find((item) => item.tipo_resposta === 'PARAMETRO')!;
    const evidence = executionItems.find((item) => item.tipo_resposta === 'EVIDENCIA')!;

    const validationBeforeInspection = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/executions/${executionId}/validation`,
      headers: bearer(identities.operator),
    });
    assert.equal(validationBeforeInspection.statusCode, 200, validationBeforeInspection.body);
    assert.equal(validationBeforeInspection.json().data.pode_concluir, false);
    assert.equal(
      validationBeforeInspection.json().data.pendencias.some(
        (item: { item_id: string; tipo: string }) =>
          item.item_id === inspection.id && item.tipo === 'RESPOSTA_OBRIGATORIA',
      ),
      true,
    );

    const answered = await app.inject({
      method: 'PUT',
      url: `/v1/maintenance/operator-actions/${actionId}/responses`,
      headers: bearer(identities.operator),
      payload: {
        itens: [
          {
            item_id: confirmation.id,
            resposta: 'SIM',
            valor: null,
            observacao: null,
          },
          {
            item_id: inspection.id,
            resposta: 'OK',
            valor: null,
            observacao: 'Sem anormalidades.',
          },
          {
            item_id: parameter.id,
            resposta: null,
            valor: 160,
            observacao: 'Dentro da faixa.',
          },
        ],
      },
    });
    assert.equal(answered.statusCode, 200, answered.body);
    assert.equal(answered.json().data.quantidade_salva, 3);
    const savedInspection = answered.json().data.execucao.itens.find(
      (item: { id: string }) => item.id === inspection.id,
    );
    assert.equal(savedInspection.resposta_opcao, 'OK');
    assert.equal(savedInspection.observacao, 'Sem anormalidades.');

    const reloadedAction = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/operator-actions/${actionId}`,
      headers: bearer(identities.operator),
    });
    assert.equal(reloadedAction.statusCode, 200, reloadedAction.body);
    const reloadedInspection = reloadedAction.json().data.execucao.itens.find(
      (item: { id: string }) => item.id === inspection.id,
    );
    assert.equal(reloadedInspection.resposta_opcao, 'OK');
    assert.equal(reloadedInspection.observacao, 'Sem anormalidades.');

    const blockedCompletion = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/executions/${executionId}/complete`,
      headers: bearer(identities.operator),
      payload: {
        resultado: 'Preventiva concluída com sucesso.',
        observacao: null,
        modo_parada: 'STOPPED',
      },
    });
    assert.equal(blockedCompletion.statusCode, 409, blockedCompletion.body);
    assert.equal(blockedCompletion.json().error.code, 'EXECUTION_HAS_BLOCKERS');

    const blockedValidation = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/executions/${executionId}/validation`,
      headers: bearer(identities.operator),
    });
    assert.equal(blockedValidation.statusCode, 200, blockedValidation.body);
    assert.equal(blockedValidation.json().data.pode_concluir, false);
    assert.equal(blockedValidation.json().data.evidencias_pendentes, 1);
    assert.equal(
      blockedValidation.json().data.pendencias.some(
        (item: { item_id: string; tipo: string }) =>
          item.item_id === inspection.id && item.tipo === 'RESPOSTA_OBRIGATORIA',
      ),
      false,
    );
    const evidenceBlocker = blockedValidation.json().data.pendencias.find(
      (item: { item_id: string; tipo: string }) =>
        item.item_id === evidence.id && item.tipo === 'EVIDENCIA_OBRIGATORIA',
    );
    assert.deepEqual(evidenceBlocker, {
      item_id: evidence.id,
      titulo: 'Fotografar condição',
      sequencia: 4,
      tipo: 'EVIDENCIA_OBRIGATORIA',
      mensagem: 'Evidência obrigatória não anexada.',
    });

    const evidenced = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/executions/${executionId}/items/${evidence.id}/evidence`,
      headers: bearer(identities.operator),
      payload: {
        objeto_armazenamento_id: ids.storageObject,
        tipo: 'PHOTO',
        observacao: 'Condição final segura.',
        capturada_em: null,
      },
    });
    assert.equal(evidenced.statusCode, 200, evidenced.body);
    const evidenceItems = evidenced.json().data.itens as readonly {
      readonly id: string;
      readonly quantidade_evidencias: number;
      readonly evidencias: readonly { readonly nome_arquivo: string }[];
    }[];
    const evidenceDetails = evidenceItems.find((item) => item.id === evidence.id);
    assert.ok(evidenceDetails);
    assert.equal(evidenceDetails.quantidade_evidencias, 1);
    const evidenceFile = evidenceDetails.evidencias.at(0);
    assert.ok(evidenceFile);
    assert.equal(evidenceFile.nome_arquivo, 'teste.jpg');

    const invalidPhoto = multipartPhoto(Buffer.from('não é uma foto', 'utf8'));
    const rejectedUpload = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/executions/${executionId}/items/${evidence.id}/evidence-file`,
      headers: {
        ...bearer(identities.operator),
        'content-type': invalidPhoto.contentType,
      },
      payload: invalidPhoto.body,
    });
    assert.equal(rejectedUpload.statusCode, 422, rejectedUpload.body);
    assert.equal(rejectedUpload.json().error.code, 'FILE_CONTENT_INVALID');

    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
    ]);
    const validPhoto = multipartPhoto(jpeg);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/executions/${executionId}/items/${evidence.id}/evidence-file`,
      headers: {
        ...bearer(identities.operator),
        'content-type': validPhoto.contentType,
      },
      payload: validPhoto.body,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const uploadedItems = uploaded.json().data.itens as readonly {
      readonly id: string;
      readonly quantidade_evidencias: number;
      readonly evidencias: readonly {
        readonly objeto_armazenamento_id: string;
        readonly nome_arquivo: string;
        readonly url: string;
      }[];
    }[];
    const uploadedEvidence = uploadedItems
      .find((item) => item.id === evidence.id)
      ?.evidencias.at(-1);
    assert.ok(uploadedEvidence);
    assert.equal(uploadedEvidence.nome_arquivo, 'condicao-final.jpg');
    assert.match(uploadedEvidence.url, /\/v1\/maintenance\/evidence-files\//u);

    const unauthorizedDownload = await app.inject({
      method: 'GET',
      url: uploadedEvidence.url,
    });
    assert.equal(unauthorizedDownload.statusCode, 401, unauthorizedDownload.body);

    const downloaded = await app.inject({
      method: 'GET',
      url: uploadedEvidence.url,
      headers: bearer(identities.operator),
    });
    assert.equal(downloaded.statusCode, 200, downloaded.body);
    assert.equal(downloaded.headers['content-type'], 'image/jpeg');
    assert.deepEqual(downloaded.rawPayload, jpeg);

    const validCompletion = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/operator-actions/${actionId}/validation`,
      headers: bearer(identities.operator),
    });
    assert.equal(validCompletion.statusCode, 200, validCompletion.body);
    assert.equal(validCompletion.json().data.pode_concluir, true);

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/operator-actions/${actionId}/complete`,
      headers: bearer(identities.operator),
      payload: {
        resultado: 'Preventiva concluída com sucesso.',
        observacao: 'Equipamento liberado.',
        relatorio_tecnico: {
          diagnostico_tecnico: 'Desgaste no rolamento confirmado.',
          acao_realizada: 'Rolamento substituído e conjunto alinhado.',
          pecas_materiais: '1 rolamento 6204; 30 g de graxa.',
          medicoes: 'Vibração após intervenção: 1,2 mm/s.',
        },
        modo_parada: 'STOPPED',
      },
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json().data.execucao.status, 'COMPLETED');
    assert.equal(
      completed.json().data.execucao.relatorio_tecnico.diagnostico_tecnico,
      'Desgaste no rolamento confirmado.',
    );
    assert.equal(
      completed.json().data.execucao.relatorio_tecnico.pecas_materiais,
      '1 rolamento 6204; 30 g de graxa.',
    );

    const awaitingTechnicalReview = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/work-orders/${workOrderId}`,
      headers: bearer(identities.admin),
    });
    assert.equal(awaitingTechnicalReview.statusCode, 200, awaitingTechnicalReview.body);
    // IN_TECHNICAL_REVIEW é o valor canônico persistido para “aguardando validação”.
    assert.equal(awaitingTechnicalReview.json().data.status, 'IN_TECHNICAL_REVIEW');

    await transaction(pool, async client => {
      assert.equal(await new MonitoringRepository().hasPendingPostInterventionRelease(client,ids.asset),true);
    });
    const bypassRelease = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/actions/${actionId}/review`,
      headers: bearer(identities.quality),
      payload: { decisao: 'APPROVE', comentario: 'Tentativa de aprovação sem as assinaturas.' },
    });
    assert.equal(bypassRelease.statusCode, 409, bypassRelease.body);
    for (const token of [identities.quality, identities.safety]) {
      const signedAfterExecution = await app.inject({
        method: 'POST',
        url: `/v1/workflow/technical-demands/${demandId}/sign`,
        headers: bearer(token),
        payload: {
          declaracao:
            'Confirmo a liberação após verificar o relatório e as evidências da intervenção.',
          significado: 'Liberação pós-intervenção',
        },
      });
      assert.equal(signedAfterExecution.statusCode, 200, signedAfterExecution.body);
      assert.equal(
        signedAfterExecution.json().data.acoes.length,
        1,
        'Assinar a liberação não deve gerar outra ação',
      );
    }

    await transaction(pool, async client => {
      assert.equal(await new MonitoringRepository().hasPendingPostInterventionRelease(client,ids.asset),false);
    });
    const completedAction = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/actions/${actionId}`,
      headers: bearer(identities.quality),
    });
    assert.equal(completedAction.statusCode, 200, completedAction.body);
    assert.equal(completedAction.json().data.acao.status, 'COMPLETED');
    assert.equal(completedAction.json().data.execucao.status, 'COMPLETED');
    assert.equal(completedAction.json().data.execucao.itens.length, 4);

    const emptyQueue = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/operator-actions',
      headers: bearer(identities.operator),
    });
    assert.equal(emptyQueue.statusCode, 200, emptyQueue.body);
    assert.equal(emptyQueue.json().data.itens.length, 0);

    const reviewed = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/actions/${actionId}/review`,
      headers: bearer(identities.quality),
      payload: {
        decisao: 'APPROVE',
        comentario: 'Execucao e evidencias conferidas pelo filtro tecnico.',
      },
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().data.status, 'COMPLETED');
    assert.equal(reviewed.json().data.already_validated, true);

    const repeatedReview = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/actions/${actionId}/review`,
      headers: bearer(identities.quality),
      payload: {
        decisao: 'APPROVE',
        comentario: 'Confirmacao idempotente da revisao.',
      },
    });
    assert.equal(repeatedReview.statusCode, 200, repeatedReview.body);
    assert.equal(repeatedReview.json().data.already_validated, true);

    await transaction(pool, async (client) => {
      const persisted = await client.query(
        `SELECT
      (SELECT count(*) FROM workflow.technical_signatures WHERE technical_demand_id=$1) AS signatures,
      (SELECT count(*) FROM cmms.parameter_readings WHERE source_entity_id=$2) AS readings,
      (SELECT status FROM maintenance.work_orders WHERE id=$3) AS work_order_status`,
        [demandId, executionId, workOrderId],
      );
      assert.equal(Number(persisted.rows[0]!.signatures), 2);
      assert.equal(Number(persisted.rows[0]!.readings), 1);
      assert.equal(persisted.rows[0]!.work_order_status, 'COMPLETED');
    });
    for (const scenario of [
      { type: 'CORRECTIVE', scheduled: true, release: true },
      { type: 'INSPECTION', scheduled: true, release: true },
      { type: 'PREVENTIVE', scheduled: true, release: false },
      { type: 'PREVENTIVE', scheduled: false, release: true },
    ]) {
      const ordinary = await app.inject({
        method: 'POST',
        url: '/v1/maintenance/work-orders',
        headers: bearer(identities.admin),
        payload: {
          plano_versao_id: ids.planVersion,
          tipo_origem: 'ADMIN',
          entidade_origem_id: null,
          tipo_trabalho: scenario.type,
          titulo: 'Atividade sem validação obrigatória',
          descricao: 'Fluxo comum sem exigência de Qualidade/Segurança.',
          prioridade: scenario.type === 'CORRECTIVE' ? 'CRITICAL' : 'LOW',
          responsavel_id: null,
          programada_para: scenario.scheduled ? new Date(Date.now() + (scenario.type === 'PREVENTIVE' ? 86400000 : -60000)).toISOString() : null,
          analise_tecnica: { exige_liberacao_pos_intervencao: scenario.release },
        },
      });
      assert.equal(ordinary.statusCode, 200, ordinary.body);
      const approved = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${ordinary.json().data.id}/submit-review`,
        headers: bearer(identities.admin),
        payload: {
          politica_assinatura: 'QUALIDADE_E_SEGURANCA',
          assinaturas_exigidas: 2,
          primeira_resposta_ate: null,
          resolucao_ate: null,
        },
      });
      assert.equal(approved.statusCode, 200, approved.body);
      assert.equal(approved.json().data.validacao, null);
      assert.equal(approved.json().data.status, 'APPROVED');
      const released = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${ordinary.json().data.id}/release`,
        headers: bearer(identities.admin),
      });
      assert.equal(released.statusCode, 200, released.body);
      assert.equal(released.json().data.status, 'RELEASED');
    }
    const finalPcm = await app.inject({method:'GET',url:pcmUrl,headers:bearer(identities.admin)});
    assert.equal(finalPcm.statusCode,200,finalPcm.body);
    assert.equal(finalPcm.json().data.pcm.atual.tecnicos_em_atividade,0);
    assert.equal(finalPcm.json().data.pcm.atual.ordens_abertas,5);
    assert.equal(finalPcm.json().data.pcm.atual.backlog_horas_estimadas,3.75);
    assert.equal(finalPcm.json().data.pcm.atual.ordens_criticas,1);
    assert.equal(finalPcm.json().data.pcm.atual.ordens_atrasadas,3);
    assert.equal(finalPcm.json().data.pcm.atual.preventivas_proximas,1);
    assert.equal(finalPcm.json().data.pcm.preventivas.length,1);

    const normalWorkOrder = await app.inject({
      method: 'POST', url: '/v1/maintenance/work-orders', headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion, tipo_origem: 'ADMIN', entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE', titulo: 'Preventiva normal concluída pelo técnico',
        descricao: 'Fluxo normal sem validação posterior.', prioridade: 'MEDIUM',
        responsavel_id: null, programada_para: new Date(Date.now() + 86400000).toISOString(),
        analise_tecnica: { resultado_esperado: 'Equipamento liberado.' },
      },
    });
    assert.equal(normalWorkOrder.statusCode, 200, normalWorkOrder.body);
    const normalWorkOrderId: string = normalWorkOrder.json().data.id;
    const normalApproved = await app.inject({
      method: 'POST', url: `/v1/maintenance/work-orders/${normalWorkOrderId}/submit-review`, headers: bearer(identities.admin),
      payload: { politica_assinatura: 'QUALIDADE', assinaturas_exigidas: 1, primeira_resposta_ate: null, resolucao_ate: null },
    });
    assert.equal(normalApproved.statusCode, 200, normalApproved.body);
    assert.equal(normalApproved.json().data.status, 'APPROVED');
    assert.equal(normalApproved.json().data.validacao, null);

    const normalReleased = await app.inject({
      method: 'POST', url: `/v1/maintenance/work-orders/${normalWorkOrderId}/release`, headers: bearer(identities.admin),
    });
    assert.equal(normalReleased.statusCode, 200, normalReleased.body);
    assert.equal(normalReleased.json().data.status, 'RELEASED');

    await transaction(pool, async (client) => {
      const legacyDemandId = randomUUID();
      const legacyRequirementId = randomUUID();
      await client.query(
        `INSERT INTO workflow.technical_demands
         (id,tenant_id,demand_type,entity_type,entity_id,origin_type,title,description,priority,status,created_by,
          creator_role_snapshot,signature_required,required_signature_count,segregation_required,signature_policy,payload_hash_sha256)
         VALUES ($1,$2,'WORK_ORDER_VALIDATION','WORK_ORDER',$3,'TEST','Assinatura isolada',
          'Não deve reter uma OS normal após a conclusão técnica.','MEDIUM','AWAITING_SIGNATURE',$4,
          'ADMIN:ADMIN',true,1,true,'QUALIDADE',$5)`,
        [legacyDemandId, tenantId, normalWorkOrderId, ids.admin, 'e'.repeat(64)],
      );
      await client.query(
        `INSERT INTO workflow.demand_validator_requirements
         (id,tenant_id,technical_demand_id,requirement_code,technical_area_id,required_count,status)
         VALUES ($1,$2,$3,'QUALITY_SIGNATURE',$4,1,'PENDING')`,
        [legacyRequirementId, tenantId, legacyDemandId, ids.qualityArea],
      );
      await client.query(
        `UPDATE maintenance.work_orders SET technical_demand_id=$2 WHERE id=$1`,
        [normalWorkOrderId, legacyDemandId],
      );
    });

    const normalQueue = await app.inject({ method: 'GET', url: '/v1/maintenance/operator-actions', headers: bearer(identities.operator) });
    assert.equal(normalQueue.statusCode, 200, normalQueue.body);
    const normalAction = normalQueue.json().data.itens.find(
      (item: { ordem_id: string }) => item.ordem_id === normalWorkOrderId,
    );
    assert.ok(normalAction);
    const normalActionId: string = normalAction.id;
    const normalStarted = await app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/start`, headers: bearer(identities.operator),
      payload: { modo_parada: 'NO_STOP' },
    });
    assert.equal(normalStarted.statusCode, 200, normalStarted.body);
    assert.equal(normalStarted.json().data.execucao.operador_id, ids.operator);
    const normalExecutionId: string = normalStarted.json().data.execucao.id;
    const normalItems: readonly { id: string; tipo_resposta: string }[] = normalStarted.json().data.execucao.itens;
    const normalConfirmation = normalItems.find((item) => item.tipo_resposta === 'CONFIRMACAO')!;
    const normalInspection = normalItems.find((item) => item.tipo_resposta === 'OK_NOK')!;
    const normalParameter = normalItems.find((item) => item.tipo_resposta === 'PARAMETRO')!;
    const normalEvidence = normalItems.find((item) => item.tipo_resposta === 'EVIDENCIA')!;
    const normalResponses = await app.inject({
      method: 'PUT', url: `/v1/maintenance/operator-actions/${normalActionId}/responses`, headers: bearer(identities.operator),
      payload: { itens: [
        { item_id: normalConfirmation.id, resposta: 'SIM', valor: null, observacao: null },
        { item_id: normalInspection.id, resposta: 'OK', valor: null, observacao: 'Condição normal.' },
        { item_id: normalParameter.id, resposta: null, valor: 160, observacao: null },
      ] },
    });
    assert.equal(normalResponses.statusCode, 200, normalResponses.body);
    const normalEvidenceSaved = await app.inject({
      method: 'POST', url: `/v1/maintenance/executions/${normalExecutionId}/items/${normalEvidence.id}/evidence`, headers: bearer(identities.operator),
      payload: { objeto_armazenamento_id: ids.storageObject, tipo: 'PHOTO', observacao: 'Evidência normal.', capturada_em: null },
    });
    assert.equal(normalEvidenceSaved.statusCode, 200, normalEvidenceSaved.body);
    const normalCompleted = await app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/complete`, headers: bearer(identities.operator),
      payload: { resultado: 'Preventiva normal concluída.', observacao: null, modo_parada: 'NO_STOP' },
    });
    assert.equal(normalCompleted.statusCode, 200, normalCompleted.body);
    const normalClosed = await app.inject({
      method: 'GET', url: `/v1/maintenance/work-orders/${normalWorkOrderId}`, headers: bearer(identities.admin),
    });
    assert.equal(normalClosed.statusCode, 200, normalClosed.body);
    assert.equal(normalClosed.json().data.status, 'COMPLETED');
    assert.equal(normalClosed.json().data.acoes[0].status, 'COMPLETED');
    await transaction(pool, async (client) => {
      const isolatedSignatureRequirement = await client.query(
        `SELECT demand.demand_type, requirement.requirement_code
         FROM maintenance.work_orders work_order
         JOIN workflow.technical_demands demand ON demand.id=work_order.technical_demand_id
         JOIN workflow.demand_validator_requirements requirement ON requirement.technical_demand_id=demand.id
         WHERE work_order.id=$1`,
        [normalWorkOrderId],
      );
      assert.deepEqual(isolatedSignatureRequirement.rows[0], {
        demand_type: 'WORK_ORDER_VALIDATION',
        requirement_code: 'QUALITY_SIGNATURE',
      });
    });
  },
);
