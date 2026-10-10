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
  production: randomUUID(),
  support: randomUUID(),
  supportSecond: randomUUID(),
  supportThird: randomUUID(),
  supportDecline: randomUUID(),
  otherPlantTechnician: randomUUID(),
  adminRole: randomUUID(),
  validatorRole: randomUUID(),
  safetyRole: randomUUID(),
  operatorRole: randomUUID(),
  productionRole: randomUUID(),
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
  readonly production: string;
  readonly support: string;
  readonly supportSecond: string;
  readonly supportThird: string;
  readonly supportDecline: string;
  readonly otherPlantTechnician: string;
}

interface SeededIdentities extends Identities {
  readonly tenantSlug: string;
}

interface PendingExecutionItem {
  readonly item_id: string;
  readonly tipo: string;
}

interface ExecutionChecklistItem {
  readonly id: string;
  readonly resposta_opcao: string | null;
  readonly observacao: string | null;
}

interface ExecutionValidationResponse {
  readonly data: {
    readonly pode_concluir: boolean;
    readonly evidencias_pendentes: number;
    readonly pendencias: readonly PendingExecutionItem[];
  };
}

interface ExecutionDetailResponse {
  readonly data: {
    readonly quantidade_salva?: number;
    readonly execucao: {
      readonly itens: readonly ExecutionChecklistItem[];
    };
  };
}

interface ExecutionSupportDetailResponse {
  readonly data: {
    readonly operador_id: string;
    readonly tecnicos_auxiliares: readonly {
      readonly id: string;
      readonly nome: string;
    }[];
  };
}

interface OperatorActionQueueResponse {
  readonly data: {
    readonly itens: readonly { readonly id: string; readonly ordem_id: string }[];
  };
}

interface TechnicalReportListResponse {
  readonly data: {
    readonly total: number;
    readonly relatorios: readonly {
      readonly os_titulo: string;
      readonly tipo: 'QUALITY' | 'SAFETY';
      readonly assinante: string;
      readonly aprovada_em: string;
      readonly assinado_em: string;
      readonly assinatura_referencia: string;
      readonly hash: string;
      readonly status: 'ASSINADO';
    }[];
  };
}

interface TechnicalDemandListResponse {
  readonly data: {
    readonly demandas: readonly {
      readonly id: string;
      readonly ordem_codigo: string;
      readonly ativo_tag: string;
      readonly ativo_nome: string;
      readonly historico: readonly { readonly acao: string }[];
    }[];
  };
}

interface NotificationListResponse {
  readonly data: {
    readonly itens: readonly {
      readonly id: string;
      readonly tipo: string;
      readonly entidade_id: string;
      readonly entidade_tipo?: string;
      readonly titulo?: string;
    }[];
  };
}

interface ImprovementRequestListResponse {
  readonly data: {
    readonly solicitacoes: readonly { readonly id: string }[];
  };
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

function multipartFields(fields: Readonly<Record<string,string>>, photo?: Buffer) {
  const boundary=`vorqix-${randomUUID()}`;
  const fieldParts=Object.entries(fields).map(([name,value])=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,'utf8'));
  const fileParts=photo ? [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="foto"; filename="peca.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,'utf8'),
    photo,
    Buffer.from('\r\n','utf8'),
  ] : [];
  const body=Buffer.concat([...fieldParts,...fileParts,Buffer.from(`--${boundary}--\r\n`,'utf8')]);
  return {body,contentType:`multipart/form-data; boundary=${boundary}`};
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

async function expectDatabaseRejection(
  client: PoolClient,
  operation: () => Promise<unknown>,
  expected: {
    readonly code: string;
    readonly constraint?: string;
    readonly messageIncludes?: string;
  },
): Promise<void> {
  await client.query('SAVEPOINT expected_database_rejection');
  let rejection: unknown;
  try {
    await operation();
  } catch (cause) {
    rejection = cause;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_database_rejection');
    await client.query('RELEASE SAVEPOINT expected_database_rejection');
  }
  assert.ok(rejection instanceof Error, 'A operação deveria ter sido rejeitada pelo PostgreSQL.');
  const databaseError = rejection as Error & { readonly code?: string; readonly constraint?: string };
  assert.equal(databaseError.code, expected.code);
  if (expected.constraint) assert.equal(databaseError.constraint, expected.constraint);
  if (expected.messageIncludes) assert.match(databaseError.message, new RegExp(expected.messageIncludes, 'u'));
}

async function seed(pool: Pool): Promise<SeededIdentities> {
  const admin = token();
  const quality = token();
  const safety = token();
  const operator = token();
  const production = token();
  const support = token();
  const supportSecond = token();
  const supportThird = token();
  const supportDecline = token();
  const otherPlantTechnician = token();
  const tenantSlug = `operations-${randomUUID()}`;
  await transaction(pool, async (client) => {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
      VALUES ($1,'Operações Testes','Operações Testes',$2,'DEVELOPMENT','ACTIVE')`,
       [tenantId, tenantSlug],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected) VALUES
      ($1,$5,'PCM','Planejamento e Controle da Manutenção','Administra o fluxo.','MANAGER',true),
      ($2,$5,'QUALIDADE','Qualidade','Valida requisitos de qualidade.','MANAGER',true),
      ($3,$5,'SEGURANCA','Segurança','Valida requisitos de segurança.','MANAGER',true),
      ($4,$5,'TECNICO','Operador','Executa o fluxo.','OPERATOR',true)`,
      [ids.adminRole, ids.validatorRole, ids.safetyRole, ids.operatorRole, tenantId],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected)
       VALUES ($1,$2,'PRODUCAO','Produção','Relata ocorrências sem executar manutenção.','CUSTOM',true)`,
      [ids.productionRole, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required) VALUES
      ($1,$7,'USR-OPS-ADM','Admin Operações','ops.admin@fabcontrol.local',false),
      ($2,$7,'USR-OPS-QUA','Qualidade Operações','ops.quality@fabcontrol.local',false),
      ($3,$7,'USR-OPS-SEG','Segurança Operações','ops.safety@fabcontrol.local',false),
      ($4,$7,'USR-OPS-OPE','Operador Operações','ops.operator@fabcontrol.local',false),
      ($5,$7,'USR-OPS-SUP','Apoio Operações','ops.support@fabcontrol.local',false),
      ($6,$7,'USR-OPS-SUP-02','Apoio Operações Dois','ops.support-2@fabcontrol.local',false)`,
      [ids.admin, ids.quality, ids.safety, ids.operator, ids.support, ids.supportSecond, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,'USR-OPS-PRO','Produção Operações','ops.production@fabcontrol.local',false)`,
      [ids.production, tenantId],
    );
    await client.query(`INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required) VALUES ($1,$2,'USR-OPS-OTHER-PLANT','Técnico Outra Planta','ops.other.plant@fabcontrol.local',false)`, [ids.otherPlantTechnician, tenantId]);
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required) VALUES
       ($1,$3,'USR-OPS-SUP-03','Apoio Operações Três','ops.support-3@fabcontrol.local',false),
       ($2,$3,'USR-OPS-SUP-04','Apoio Operações Quatro','ops.support-4@fabcontrol.local',false)`,
      [ids.supportThird, ids.supportDecline, tenantId],
    );
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES
      ($1,$2,$8),($1,$3,$9),($1,$4,$10),($1,$5,$11),($1,$6,$11),($1,$7,$11)`,
      [
        tenantId,
        ids.admin,
        ids.quality,
        ids.safety,
        ids.operator,
        ids.support,
        ids.supportSecond,
        ids.adminRole,
        ids.validatorRole,
        ids.safetyRole,
        ids.operatorRole,
      ],
    );
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)`,
      [tenantId, ids.production, ids.productionRole],
    );
    await client.query(`INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)`, [tenantId, ids.otherPlantTechnician, ids.operatorRole]);
    await client.query(
      `INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3),($1,$4,$3)`,
      [tenantId, ids.supportThird, ids.operatorRole, ids.supportDecline],
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
          'maintenance.actions.assign',
          'maintenance.executions.read',
          'analytics.technical.read',
        ],
      ],
    );
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
       SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code='maintenance.occurrences.report'`,
      [tenantId, ids.productionRole],
    );
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
      SELECT $1,roles.role_id,id,'ALLOW'
      FROM iam.capabilities
      CROSS JOIN unnest($2::uuid[]) AS roles(role_id)
      WHERE code=ANY($3::text[])`,
      [
        tenantId,
        [ids.validatorRole, ids.safetyRole],
        [
          'maintenance.work-orders.review',
          'maintenance.executions.read',
          'workflow.notifications.read',
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
    await client.query(
      `INSERT INTO iam.user_technical_assignments (tenant_id,user_id,technical_area_id,assigned_by) VALUES
       ($1,$2,$4,$5),($1,$3,$4,$5),($1,$6,$4,$5),($1,$7,$4,$5),($1,$8,$4,$5),($1,$9,$4,$5)`,
      [tenantId, ids.operator, ids.support, ids.qualityArea, ids.admin, ids.supportSecond, ids.otherPlantTechnician, ids.supportThird, ids.supportDecline],
    );
    for (const [userId, session] of [
      [ids.admin, admin],
      [ids.quality, quality],
      [ids.safety, safety],
      [ids.operator, operator],
      [ids.production, production],
      [ids.support, support],
      [ids.supportSecond, supportSecond],
      [ids.supportThird, supportThird],
      [ids.supportDecline, supportDecline],
      [ids.otherPlantTechnician, otherPlantTechnician],
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
    const otherPlantId = randomUUID();
    await client.query(`INSERT INTO cmms.plants (id,tenant_id,tag,name) VALUES ($1,$2,'PLT-OPS-2','Outra Planta')`, [otherPlantId, tenantId]);
    await client.query(`INSERT INTO iam.user_scope_assignments (tenant_id,user_id,plant_id,scope_type,assigned_by) VALUES ($1,$2,$3,'PLANT',$4)`, [tenantId, ids.otherPlantTechnician, otherPlantId, ids.admin]);
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
      `INSERT INTO iam.user_scope_assignments (tenant_id,user_id,plant_id,scope_type,assigned_by) VALUES
       ($1,$2,$3,'PLANT',$4),($1,$5,$3,'PLANT',$4),($1,$6,$3,'PLANT',$4),($1,$7,$3,'PLANT',$4),($1,$8,$3,'PLANT',$4),($1,$9,$3,'PLANT',$4)`,
      [tenantId, ids.operator, ids.plant, ids.admin, ids.support, ids.supportSecond, ids.supportThird, ids.supportDecline, ids.admin],
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
    production: production.raw,
    support: support.raw,
    supportSecond: supportSecond.raw,
    supportThird: supportThird.raw,
    supportDecline: supportDecline.raw,
    otherPlantTechnician: otherPlantTechnician.raw,
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

    const occurrenceId = randomUUID();
    const occurrenceNotificationId = randomUUID();
    const occurrenceAliasNotificationIds: string[] = [];
    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO maintenance.operational_occurrences
         (id,tenant_id,asset_id,occurrence_type,title,description,severity,reported_by,reporter_role_snapshot)
         VALUES ($1,$2,$3,'MECHANICAL_FAILURE','Falha mecânica para conversão concorrente',
           'Ocorrência isolada usada para validar conversão idempotente em OS.','HIGH',$4,'PCM:MANAGER')`,
        [occurrenceId, tenantId, ids.asset, ids.admin],
      );
      await client.query(
        `INSERT INTO workflow.notifications
         (id,tenant_id,notification_type,title,message,entity_type,entity_id,priority,status,
          action_payload,audience,deduplication_key)
         VALUES ($1,$2,'OCCURRENCE_REPORTED','Falha mecânica para conversão concorrente',
           'Ocorrência aguarda conversão.','OPERATIONAL_OCCURRENCE',$3::uuid,'HIGH','ACTIVE',
           jsonb_build_object('entityId',$3::text),jsonb_build_object('roleCodes',jsonb_build_array('PCM')),$4)`,
        [
          occurrenceNotificationId,
          tenantId,
          occurrenceId,
          `occurrence:${occurrenceId}:reported`,
        ],
      );
      await client.query(
        `INSERT INTO workflow.notification_recipients
         (tenant_id,notification_id,user_id,delivery_status,delivered_at)
         VALUES ($1,$2,$3,'DELIVERED',clock_timestamp()),
                ($1,$2,$4,'DELIVERED',clock_timestamp()),
                ($1,$2,$5,'DELIVERED',clock_timestamp())`,
        [tenantId, occurrenceNotificationId, ids.admin, ids.quality, ids.safety],
      );
      for (const entityType of ['OCORRENCIAS_OPERACIONAIS', 'PARADAS_EQUIPAMENTO']) {
        const notificationId = randomUUID();
        occurrenceAliasNotificationIds.push(notificationId);
        await client.query(
          `INSERT INTO workflow.notifications
           (id,tenant_id,notification_type,title,message,entity_type,entity_id,priority,status,
            action_payload,audience,deduplication_key)
           VALUES ($1,$2,'OCCURRENCE_REPORTED','Ocorrência operacional histórica',
             'Notificação legada não deve chegar à fila de validação.',$3,$4::uuid,'HIGH','ACTIVE',
             jsonb_build_object('entityId',$4::text),jsonb_build_object('roleCodes',jsonb_build_array('PCM')),$5)`,
          [notificationId, tenantId, entityType, occurrenceId, `occurrence:${occurrenceId}:${entityType}`],
        );
        await client.query(
          `INSERT INTO workflow.notification_recipients
           (tenant_id,notification_id,user_id,delivery_status,delivered_at)
           VALUES ($1,$2,$3,'DELIVERED',clock_timestamp()),
                  ($1,$2,$4,'DELIVERED',clock_timestamp()),
                  ($1,$2,$5,'DELIVERED',clock_timestamp())`,
          [tenantId, notificationId, ids.admin, ids.quality, ids.safety],
        );
      }
    });

    for (const identity of [identities.quality, identities.safety]) {
      const legacyOccurrenceInbox = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(identity),
      });
      assert.equal(legacyOccurrenceInbox.statusCode, 200, legacyOccurrenceInbox.body);
      assert.equal(
        legacyOccurrenceInbox.json<NotificationListResponse>().data.itens.some((item) =>
          [occurrenceNotificationId, ...occurrenceAliasNotificationIds].includes(item.id)),
        false,
      );
    }
    const preservedHistoricalNotification = await transaction(pool, async (client) =>
      client.query(`SELECT status FROM workflow.notifications WHERE id=$1`, [occurrenceNotificationId]),
    );
    assert.equal(preservedHistoricalNotification.rows[0]?.status, 'ACTIVE');

    await transaction(pool, async (client) => {
      await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [randomUUID()]);
      const crossTenantOccurrence = await client.query(
        `SELECT id FROM maintenance.operational_occurrences WHERE id=$1`,
        [occurrenceId],
      );
      assert.equal(crossTenantOccurrence.rowCount, 0);
    });

    const occurrenceWorkOrderPayload = {
      plano_versao_id: ids.planVersion,
      tipo_origem: 'OCCURRENCE',
      entidade_origem_id: occurrenceId,
      tipo_trabalho: 'CORRECTIVE',
      modo_execucao: 'INTERNAL',
      titulo: 'Corretiva originada por ocorrência',
      descricao: 'Conversão atômica e idempotente da ocorrência operacional.',
      prioridade: 'HIGH',
      responsavel_id: null,
      programada_para: null,
      analise_tecnica: { exige_liberacao_pos_intervencao: false },
    };
    const [firstOccurrenceConversion, concurrentOccurrenceConversion] = await Promise.all([
      app.inject({
        method: 'POST',url: '/v1/maintenance/work-orders',headers: bearer(identities.admin),
        payload: occurrenceWorkOrderPayload,
      }),
      app.inject({
        method: 'POST',url: '/v1/maintenance/work-orders',headers: bearer(identities.admin),
        payload: occurrenceWorkOrderPayload,
      }),
    ]);
    assert.equal(firstOccurrenceConversion.statusCode, 200, firstOccurrenceConversion.body);
    assert.equal(concurrentOccurrenceConversion.statusCode, 200, concurrentOccurrenceConversion.body);
    const occurrenceWorkOrderId: string = firstOccurrenceConversion.json().data.id;
    assert.equal(concurrentOccurrenceConversion.json().data.id, occurrenceWorkOrderId);

    const repeatedOccurrenceConversion = await app.inject({
      method: 'POST',url: '/v1/maintenance/work-orders',headers: bearer(identities.admin),
      payload: occurrenceWorkOrderPayload,
    });
    assert.equal(repeatedOccurrenceConversion.statusCode, 200, repeatedOccurrenceConversion.body);
    assert.equal(repeatedOccurrenceConversion.json().data.id, occurrenceWorkOrderId);

    await transaction(pool, async (client) => {
      const occurrenceState = await client.query(
        `SELECT status,treatment_status,work_order_id,work_order_action_id
         FROM maintenance.operational_occurrences WHERE id=$1`,
        [occurrenceId],
      );
      assert.deepEqual(occurrenceState.rows[0], {
        status: 'IN_TREATMENT',
        treatment_status: 'WORK_ORDER_CREATED',
        work_order_id: occurrenceWorkOrderId,
        work_order_action_id: null,
      });
      const workOrders = await client.query(
        `SELECT id,asset_id,origin_type FROM maintenance.work_orders WHERE origin_entity_id=$1`,
        [occurrenceId],
      );
      assert.equal(workOrders.rowCount, 1);
      assert.deepEqual(workOrders.rows[0], {
        id: occurrenceWorkOrderId,
        asset_id: ids.asset,
        origin_type: 'OCCURRENCE',
      });
      await expectDatabaseRejection(
        client,
        () => client.query(
          `INSERT INTO maintenance.work_orders
           (id,tenant_id,code,asset_id,component_id,maintenance_plan_version_id,
            origin_type,origin_entity_id,work_type,title,description,priority,
            requester_id,responsible_id,maintenance_stop_mode,technical_analysis,content_hash_sha256)
           SELECT $2,tenant_id,$3,asset_id,component_id,maintenance_plan_version_id,
                  'OCCURRENCE',origin_entity_id,work_type,title,description,priority,
                  requester_id,responsible_id,maintenance_stop_mode,technical_analysis,content_hash_sha256
           FROM maintenance.work_orders WHERE id=$1`,
          [occurrenceWorkOrderId, randomUUID(), `OS-TEST-DUPLICATE-${randomUUID()}`],
        ),
        { code: '23505', constraint: 'work_orders_one_occurrence_idx' },
      );
      const notification = await client.query(
        `SELECT status FROM workflow.notifications WHERE id=$1`,
        [occurrenceNotificationId],
      );
      assert.equal(notification.rows[0].status, 'RETRACTED');
    });

    const missingOccurrenceConversion = await app.inject({
      method: 'POST',url: '/v1/maintenance/work-orders',headers: bearer(identities.admin),
      payload: { ...occurrenceWorkOrderPayload, entidade_origem_id: randomUUID() },
    });
    assert.equal(missingOccurrenceConversion.statusCode, 404, missingOccurrenceConversion.body);
    assert.equal(missingOccurrenceConversion.json().error.code, 'OCCURRENCE_NOT_FOUND');

    const occurrenceApproved = await app.inject({
      method: 'POST',url: `/v1/maintenance/work-orders/${occurrenceWorkOrderId}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE',assinaturas_exigidas: 1,
        primeira_resposta_ate: null,resolucao_ate: null,
      },
    });
    assert.equal(occurrenceApproved.statusCode, 200, occurrenceApproved.body);
    assert.equal(occurrenceApproved.json().data.status, 'APPROVED');
    const occurrenceReleased = await app.inject({
      method: 'POST',url: `/v1/maintenance/work-orders/${occurrenceWorkOrderId}/release`,
      headers: bearer(identities.admin),
    });
    assert.equal(occurrenceReleased.statusCode, 200, occurrenceReleased.body);
    assert.equal(occurrenceReleased.json().data.status, 'RELEASED');
    assert.ok(occurrenceReleased.json().data.liberada_em);
    await transaction(pool, async (client) => {
      const releasedOccurrence = await client.query(
        `SELECT occurrence.work_order_action_id,action.work_order_id
         FROM maintenance.operational_occurrences occurrence
         JOIN maintenance.work_order_actions action
           ON action.tenant_id=occurrence.tenant_id AND action.id=occurrence.work_order_action_id
         WHERE occurrence.id=$1`,
        [occurrenceId],
      );
      assert.equal(releasedOccurrence.rowCount, 1);
      assert.equal(releasedOccurrence.rows[0].work_order_id, occurrenceWorkOrderId);
      await client.query(
        `UPDATE maintenance.work_order_actions SET status='CANCELLED' WHERE work_order_id=$1`,
        [occurrenceWorkOrderId],
      );
      await client.query(
        `UPDATE maintenance.work_orders SET status='CANCELLED' WHERE id=$1`,
        [occurrenceWorkOrderId],
      );
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
        modo_execucao: 'INTERNAL',
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
        modo_execucao: 'INTERNAL',
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
        modo_execucao: 'INTERNAL',
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

    const productionOccurrence = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/occurrences',
      headers: bearer(identities.production),
      payload: {
        ativo_id: ids.asset,
        componente_id: null,
        tipo: 'FALHA_OPERACIONAL',
        titulo: 'Ocorrência comum sem validação de Qualidade ou Segurança',
        descricao: 'O PCM deve receber esta ocorrência para triagem.',
        severidade: 'HIGH',
        equipamento_parado: false,
        tipo_parada: null,
        motivo_parada: null,
        ocorrida_em: new Date().toISOString(),
      },
    });
    assert.equal(productionOccurrence.statusCode, 200, productionOccurrence.body);
    const productionOccurrenceId: string = productionOccurrence.json().data.id;
    for (const identity of [identities.quality, identities.safety]) {
      const inbox = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(identity),
      });
      assert.equal(inbox.statusCode, 200, inbox.body);
      assert.equal(
        inbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === productionOccurrenceId),
        false,
      );
    }
    assert.equal(created.statusCode, 200, created.body);
    const workOrderId: string = created.json().data.id;

    const missingPostInterventionPolicy = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${workOrderId}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(missingPostInterventionPolicy.statusCode, 400, missingPostInterventionPolicy.body);

    for (const unauthorizedIdentity of [identities.operator, identities.production]) {
      const unauthorizedConfiguration = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${workOrderId}/submit-review`,
        headers: bearer(unauthorizedIdentity),
        payload: {
          politica_assinatura: 'QUALIDADE',
          assinaturas_exigidas: 1,
          primeira_resposta_ate: null,
          resolucao_ate: null,
        },
      });
      assert.equal(unauthorizedConfiguration.statusCode, 403, unauthorizedConfiguration.body);
    }

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
    for (const identity of [identities.quality, identities.safety]) {
      const inbox = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(identity),
      });
      assert.equal(inbox.statusCode, 200, inbox.body);
      const validationNotification = inbox.json<NotificationListResponse>().data.itens.find((item) =>
        item.tipo === 'POST_INTERVENTION_VALIDATION_REQUESTED' && item.entidade_id === demandId);
      assert.ok(validationNotification);
      assert.equal(validationNotification.entidade_tipo, 'DEMANDAS_TECNICAS');
      assert.match(validationNotification.titulo ?? '', new RegExp(created.json().data.codigo));
    }
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
    const listedPostIntervention = technicalQueue.json<TechnicalDemandListResponse>().data.demandas.find(
      (item) => item.id === demandId,
    );
    assert.ok(listedPostIntervention);
    assert.equal(listedPostIntervention.ordem_codigo, created.json().data.codigo);
    assert.equal(listedPostIntervention.ativo_tag, 'EQ-OPS-001');
    assert.equal(listedPostIntervention.ativo_nome, 'Prensa de teste');
    const lastDemandEvent = listedPostIntervention.historico.at(-1);
    assert.ok(lastDemandEvent);
    assert.equal(lastDemandEvent.acao, 'SUBMITTED');
    const generalWorkOrders = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.quality),
    });
    assert.equal(generalWorkOrders.statusCode, 403, generalWorkOrders.body);
    const hiddenPostInterventionDemand = await transaction(pool, async (client) => {
      await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [randomUUID()]);
      const hidden = await client.query(
        `SELECT id FROM workflow.technical_demands WHERE id=$1`,
        [demandId],
      );
      return hidden.rowCount;
    });
    assert.equal(hiddenPostInterventionDemand, 0);
    const productionSignature = await app.inject({
      method: 'POST',
      url: `/v1/workflow/technical-demands/${demandId}/sign`,
      headers: bearer(identities.production),
      payload: {
        declaracao: 'Tentativa não autorizada de validação.',
        significado: 'Tentativa',
      },
    });
    assert.equal(productionSignature.statusCode, 403, productionSignature.body);

    const qualityOnlyWorkOrder = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN',
        entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE',
        modo_execucao: 'INTERNAL',
        titulo: 'Validação excepcional somente Qualidade',
        descricao: 'Somente a área selecionada deve ser necessária.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: new Date(Date.now() + 86400000).toISOString(),
        analise_tecnica: { exige_liberacao_pos_intervencao: true },
      },
    });
    assert.equal(qualityOnlyWorkOrder.statusCode, 200, qualityOnlyWorkOrder.body);
    await transaction(pool, async (client) => {
      await client.query(`UPDATE iam.technical_areas SET status='INACTIVE' WHERE id=$1`, [ids.safetyArea]);
    });
    const qualityOnlySubmitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${qualityOnlyWorkOrder.json().data.id}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE',
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(qualityOnlySubmitted.statusCode, 200, qualityOnlySubmitted.body);
    const qualityOnlyDemandId: string = qualityOnlySubmitted.json().data.validacao.id;
    const qualityOnlyInbox = await app.inject({
      method: 'GET', url: '/v1/notifications?somente_nao_lidas=true', headers: bearer(identities.quality),
    });
    const safetyQualityOnlyInbox = await app.inject({
      method: 'GET', url: '/v1/notifications?somente_nao_lidas=true', headers: bearer(identities.safety),
    });
    assert.equal(qualityOnlyInbox.statusCode, 200, qualityOnlyInbox.body);
    assert.equal(safetyQualityOnlyInbox.statusCode, 200, safetyQualityOnlyInbox.body);
    assert.equal(qualityOnlyInbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === qualityOnlyDemandId), true);
    assert.equal(safetyQualityOnlyInbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === qualityOnlyDemandId), false);
    await transaction(pool, async (client) => {
      const requirements = await client.query<{ readonly code: string }>(
        `SELECT area.code FROM workflow.demand_validator_requirements requirement
         JOIN iam.technical_areas area ON area.id=requirement.technical_area_id
         WHERE requirement.technical_demand_id=$1 AND requirement.status='PENDING'`,
        [qualityOnlyDemandId],
      );
      assert.deepEqual(requirements.rows.map((row) => row.code), ['QUALITY']);
      await client.query(`UPDATE iam.technical_areas SET status='ACTIVE' WHERE id=$1`, [ids.safetyArea]);
      await client.query(`UPDATE iam.technical_areas SET status='INACTIVE' WHERE id=$1`, [ids.qualityArea]);
    });

    const safetyOnlyWorkOrder = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN',
        entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE',
        modo_execucao: 'INTERNAL',
        titulo: 'Validação excepcional somente Segurança',
        descricao: 'Somente a área selecionada deve ser necessária.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: new Date(Date.now() + 86400000).toISOString(),
        analise_tecnica: { exige_liberacao_pos_intervencao: true },
      },
    });
    assert.equal(safetyOnlyWorkOrder.statusCode, 200, safetyOnlyWorkOrder.body);
    const safetyOnlySubmitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${safetyOnlyWorkOrder.json().data.id}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'SEGURANCA',
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(safetyOnlySubmitted.statusCode, 200, safetyOnlySubmitted.body);
    const safetyOnlyDemandId: string = safetyOnlySubmitted.json().data.validacao.id;
    const safetyOnlyInbox = await app.inject({
      method: 'GET', url: '/v1/notifications?somente_nao_lidas=true', headers: bearer(identities.safety),
    });
    const qualitySafetyOnlyInbox = await app.inject({
      method: 'GET', url: '/v1/notifications?somente_nao_lidas=true', headers: bearer(identities.quality),
    });
    assert.equal(safetyOnlyInbox.statusCode, 200, safetyOnlyInbox.body);
    assert.equal(qualitySafetyOnlyInbox.statusCode, 200, qualitySafetyOnlyInbox.body);
    assert.equal(safetyOnlyInbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === safetyOnlyDemandId), true);
    assert.equal(qualitySafetyOnlyInbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === safetyOnlyDemandId), false);
    await transaction(pool, async (client) => {
      const requirements = await client.query<{ readonly code: string }>(
        `SELECT area.code FROM workflow.demand_validator_requirements requirement
         JOIN iam.technical_areas area ON area.id=requirement.technical_area_id
         WHERE requirement.technical_demand_id=$1 AND requirement.status='PENDING'`,
        [safetyOnlyDemandId],
      );
      assert.deepEqual(requirements.rows.map((row) => row.code), ['SAFETY']);
      await client.query(`UPDATE iam.technical_areas SET status='ACTIVE' WHERE id=$1`, [ids.qualityArea]);
      await client.query(
        `UPDATE maintenance.work_orders SET status='CANCELLED' WHERE id=ANY($1::uuid[])`,
        [[
          qualityOnlyWorkOrder.json().data.id,
          safetyOnlyWorkOrder.json().data.id,
        ]],
      );
    });

    const eitherAreaWorkOrder = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN',
        entidade_origem_id: null,
        tipo_trabalho: 'PREVENTIVE',
        modo_execucao: 'INTERNAL',
        titulo: 'Validação pós-intervenção por Qualidade ou Segurança',
        descricao: 'Qualquer uma das áreas elegíveis pode atender à política.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: new Date(Date.now() + 86400000).toISOString(),
        analise_tecnica: { exige_liberacao_pos_intervencao: true },
      },
    });
    assert.equal(eitherAreaWorkOrder.statusCode, 200, eitherAreaWorkOrder.body);
    const eitherAreaSubmitted = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/work-orders/${eitherAreaWorkOrder.json().data.id}/submit-review`,
      headers: bearer(identities.admin),
      payload: {
        politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
        assinaturas_exigidas: 1,
        primeira_resposta_ate: null,
        resolucao_ate: null,
      },
    });
    assert.equal(eitherAreaSubmitted.statusCode, 200, eitherAreaSubmitted.body);
    const eitherAreaDemandId: string = eitherAreaSubmitted.json().data.validacao.id;
    for (const identity of [identities.quality, identities.safety]) {
      const inbox = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(identity),
      });
      assert.equal(inbox.statusCode, 200, inbox.body);
      assert.equal(
        inbox.json<NotificationListResponse>().data.itens.some((item) =>
          item.tipo === 'POST_INTERVENTION_VALIDATION_REQUESTED' && item.entidade_id === eitherAreaDemandId),
        true,
      );
    }
    const eitherRequirement = await transaction(pool, async (client) =>
      client.query(
        `SELECT demand.signature_policy,demand.required_signature_count,requirement.requirement_code
         FROM workflow.technical_demands demand
         JOIN workflow.demand_validator_requirements requirement
           ON requirement.tenant_id=demand.tenant_id AND requirement.technical_demand_id=demand.id
         WHERE demand.id=$1`,
        [eitherAreaDemandId],
      ),
    );
    assert.deepEqual(eitherRequirement.rows[0], {
      signature_policy: 'QUALIDADE_OU_SEGURANCA',
      required_signature_count: 1,
      requirement_code: 'QUALITY_OR_SAFETY',
    });
    await transaction(pool, async (client) => {
      await client.query(
        `UPDATE maintenance.work_orders SET status='CANCELLED' WHERE id=$1`,
        [eitherAreaWorkOrder.json().data.id],
      );
    });

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
    const workOrderListBody = workOrderList.json<{
      data: { itens: (Record<string, unknown> & { id: string })[] };
    }>();
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
    const raceActionId = randomUUID();
    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO maintenance.work_order_actions
         (id,tenant_id,work_order_id,asset_id,component_id,maintenance_plan_version_id,origin,action_type,title,description,priority,status,responsible_id,maintenance_stop_mode,technical_analysis)
         SELECT $1,tenant_id,work_order_id,asset_id,component_id,maintenance_plan_version_id,'PHASE2_CLAIM_RACE',action_type,title,description,priority,'READY',NULL,maintenance_stop_mode,technical_analysis
         FROM maintenance.work_order_actions WHERE id=$2`, [raceActionId, actionId],
      );
    });
    const otherPlantQueue = await app.inject({ method: 'GET', url: '/v1/maintenance/operator-actions', headers: bearer(identities.otherPlantTechnician) });
    assert.equal(otherPlantQueue.statusCode, 200, otherPlantQueue.body);
    const otherPlantQueueData = otherPlantQueue.json<{ data: { itens: readonly { id: string }[] } }>();
    assert.equal(otherPlantQueueData.data.itens.some(item => item.id === raceActionId), false);
    const otherPlantLegacyActions = await app.inject({ method: 'GET', url: '/v1/maintenance/actions', headers: bearer(identities.otherPlantTechnician) });
    assert.equal(otherPlantLegacyActions.statusCode, 200, otherPlantLegacyActions.body);
    const otherPlantLegacyActionData = otherPlantLegacyActions.json<{ data: { acoes: readonly { id: string }[] } }>();
    assert.equal(otherPlantLegacyActionData.data.acoes.some(item => item.id === raceActionId), false);
    const otherPlantLegacyDetail = await app.inject({ method: 'GET', url: `/v1/maintenance/actions/${raceActionId}`, headers: bearer(identities.otherPlantTechnician) });
    assert.equal(otherPlantLegacyDetail.statusCode, 404, otherPlantLegacyDetail.body);
    const concurrentClaims = await Promise.all([ids.operator, ids.support].map((userId) => app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${raceActionId}/assume`,
      headers: bearer(userId === ids.operator ? identities.operator : identities.support),
    })));
    assert.deepEqual(concurrentClaims.map(response => response.statusCode).sort(), [200, 409]);
    const winningUserId = concurrentClaims[0]?.statusCode === 200 ? ids.operator : ids.support;
    await transaction(pool, async (client) => {
      const winner = await client.query<{ user_id: string }>(`SELECT user_id FROM maintenance.work_order_action_participants WHERE tenant_id=$1 AND action_id=$2 AND participant_role='PRIMARY' AND invitation_status='PRIMARY'`, [tenantId, raceActionId]);
      assert.equal(winner.rows[0]?.user_id, winningUserId);
    });
    const oldAssignmentAttempt = await app.inject({ method: 'PUT', url: `/v1/maintenance/actions/${raceActionId}/assignment`, headers: bearer(identities.admin), payload: { responsavel_id: ids.operator, tecnicos_apoio_ids: [] } });
    assert.notEqual(oldAssignmentAttempt.statusCode, 200);
    const legacyAssignment = await app.inject({ method: 'PUT', url: `/v1/maintenance/actions/${actionId}/assignment`, headers: bearer(identities.admin), payload: { responsavel_id: ids.operator, tecnicos_apoio_ids: [] } });
    assert.equal(legacyAssignment.statusCode, 409, legacyAssignment.body);

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
    const supportQueueData = supportQueue.json<{ data: { itens: readonly { id: string }[] } }>();
    assert.equal(supportQueueData.data.itens.some(item => item.id === actionId), true);
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
    assert.equal(assumed.json().data.action_id, actionId);
    assert.equal(assumed.json().data.responsavel_id, ids.operator);
    await transaction(pool, async (client) => {
      await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [randomUUID()]);
      const invisibleParticipants = await client.query(
        `SELECT id FROM maintenance.work_order_action_participants WHERE tenant_id=$1 AND action_id=$2`,
        [tenantId, actionId],
      );
      assert.equal(invisibleParticipants.rowCount, 0);
    });

    const started = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/operator-actions/${actionId}/start`,
      headers: bearer(identities.operator),
      payload: { modo_parada: 'STOPPED' },
    });
    assert.equal(started.statusCode, 200, started.body);
    const executionId: string = started.json().data.execucao.id;
    const checklistItemId: string = started.json().data.execucao.itens[0].id;
    await transaction(pool, (client) => client.query(
      `UPDATE maintenance.executions SET paused_seconds=120 WHERE tenant_id=$1 AND id=$2`,
      [tenantId, executionId],
    ));
    const invitedSupport = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators`, headers: bearer(identities.operator), payload: { usuario_id: ids.support } });
    assert.equal(invitedSupport.statusCode, 200, invitedSupport.body);
    const supportParticipantId: string = invitedSupport.json().data.participant_id;
    const acceptedSupport = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators/${supportParticipantId}/accept`, headers: bearer(identities.support) });
    assert.equal(acceptedSupport.statusCode, 200, acceptedSupport.body);
    const writeWithoutSession = await app.inject({
      method: 'PUT',
      url: `/v1/maintenance/executions/${executionId}/items/${checklistItemId}/response`,
      headers: bearer(identities.support),
      payload: { resposta_texto: null, resposta_numero: null, resposta_booleano: true, resposta_opcao: null, observacao: null, nao_aplicavel: false },
    });
    assert.equal(writeWithoutSession.statusCode, 409, writeWithoutSession.body);
    assert.equal(writeWithoutSession.json().error.code, 'EXECUTION_PARTICIPANT_SESSION_REQUIRED');
    const invitedSecond = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators`, headers: bearer(identities.operator), payload: { usuario_id: ids.supportSecond } });
    assert.equal(invitedSecond.statusCode, 200, invitedSecond.body);
    const acceptedSecond = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators/${invitedSecond.json().data.participant_id}/accept`, headers: bearer(identities.supportSecond) });
    assert.equal(acceptedSecond.statusCode, 200, acceptedSecond.body);
    const inviteThird = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators`, headers: bearer(identities.operator), payload: { usuario_id: ids.supportThird } });
    assert.equal(inviteThird.statusCode, 200, inviteThird.body);
    const acceptedThird = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators/${inviteThird.json().data.participant_id}/accept`, headers: bearer(identities.supportThird) });
    assert.equal(acceptedThird.statusCode, 200, acceptedThird.body);
    const inviteDecline = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators`, headers: bearer(identities.operator), payload: { usuario_id: ids.supportDecline } });
    assert.equal(inviteDecline.statusCode, 200, inviteDecline.body);
    const declined = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators/${inviteDecline.json().data.participant_id}/decline`, headers: bearer(identities.supportDecline) });
    assert.equal(declined.statusCode, 200, declined.body);
    const declinedSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/start`, headers: bearer(identities.supportDecline) });
    assert.equal(declinedSession.statusCode, 403, declinedSession.body);
    const otherPlantInvite = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${actionId}/collaborators`, headers: bearer(identities.operator), payload: { usuario_id: ids.otherPlantTechnician } });
    assert.equal(otherPlantInvite.statusCode, 422, otherPlantInvite.body);
    const supportSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/start`, headers: bearer(identities.support) });
    assert.equal(supportSession.statusCode, 200, supportSession.body);
    const collaboratorCompletion = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/operator-actions/${actionId}/complete`,
      headers: bearer(identities.support),
      payload: { resultado: 'Conclusão tentativa do colaborador.', observacao: null, modo_parada: 'STOPPED' },
    });
    assert.equal(collaboratorCompletion.statusCode, 403, collaboratorCompletion.body);
    assert.equal(collaboratorCompletion.json().error.code, 'EXECUTION_PRIMARY_REQUIRED');
    const pausedSupportSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/pause`, headers: bearer(identities.support), payload: { motivo: 'Aguardando ferramenta' } });
    assert.equal(pausedSupportSession.statusCode, 200, pausedSupportSession.body);
    const resumedSupportSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/resume`, headers: bearer(identities.support) });
    assert.equal(resumedSupportSession.statusCode, 200, resumedSupportSession.body);
    const endedSupportSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/end`, headers: bearer(identities.support) });
    assert.equal(endedSupportSession.statusCode, 200, endedSupportSession.body);
    const thirdSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/start`, headers: bearer(identities.supportThird) });
    assert.equal(thirdSession.statusCode, 200, thirdSession.body);
    const nonParticipantSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/start`, headers: bearer(identities.otherPlantTechnician) });
    assert.equal(nonParticipantSession.statusCode, 403, nonParticipantSession.body);
    const globallyPaused = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/pause`, headers: bearer(identities.operator), payload: { motivo_codigo: 'AGUARDANDO_PRODUCAO' } });
    assert.equal(globallyPaused.statusCode, 200, globallyPaused.body);
    const pausedDetail = await app.inject({ method: 'GET', url: `/v1/maintenance/executions/${executionId}`, headers: bearer(identities.operator) });
    assert.equal(pausedDetail.statusCode, 200, pausedDetail.body);
    assert.ok(pausedDetail.json().data.global_paused_seconds >= 120);
    const openAfterGlobalPause = await transaction(pool, (client) => client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM maintenance.execution_participant_work_intervals WHERE tenant_id=$1 AND execution_id=$2 AND ended_at IS NULL`,
      [tenantId, executionId],
    ));
    assert.equal(openAfterGlobalPause.rows[0]?.count, 0);
    const globallyResumed = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/resume`, headers: bearer(identities.operator) });
    assert.equal(globallyResumed.statusCode, 200, globallyResumed.body);
    const resumedDetail = await app.inject({ method: 'GET', url: `/v1/maintenance/executions/${executionId}`, headers: bearer(identities.operator) });
    assert.equal(resumedDetail.statusCode, 200, resumedDetail.body);
    assert.ok(resumedDetail.json().data.global_paused_seconds >= 120);
    const openAfterGlobalResume = await transaction(pool, (client) => client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM maintenance.execution_participant_work_intervals WHERE tenant_id=$1 AND execution_id=$2 AND ended_at IS NULL`,
      [tenantId, executionId],
    ));
    assert.equal(openAfterGlobalResume.rows[0]?.count, 0);
    const resumedPrimarySession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/resume`, headers: bearer(identities.operator) });
    assert.equal(resumedPrimarySession.statusCode, 200, resumedPrimarySession.body);
    const resumedThirdSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/resume`, headers: bearer(identities.supportThird) });
    assert.equal(resumedThirdSession.statusCode, 200, resumedThirdSession.body);
    const endedThirdSession = await app.inject({ method: 'POST', url: `/v1/maintenance/executions/${executionId}/sessions/end`, headers: bearer(identities.supportThird) });
    assert.equal(endedThirdSession.statusCode, 200, endedThirdSession.body);
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
      started.json().data.execucao.itens;
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
    const validationBeforeInspectionBody = validationBeforeInspection.json<ExecutionValidationResponse>();
    assert.equal(validationBeforeInspectionBody.data.pode_concluir, false);
    assert.equal(
      validationBeforeInspectionBody.data.pendencias.some(
        (item) =>
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
    const answeredBody = answered.json<ExecutionDetailResponse>();
    assert.equal(answeredBody.data.quantidade_salva, 3);
    const savedInspection = answeredBody.data.execucao.itens.find((item) => item.id === inspection.id);
    assert.ok(savedInspection);
    assert.equal(savedInspection.resposta_opcao, 'OK');
    assert.equal(savedInspection.observacao, 'Sem anormalidades.');

    const reloadedAction = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/operator-actions/${actionId}`,
      headers: bearer(identities.operator),
    });
    assert.equal(reloadedAction.statusCode, 200, reloadedAction.body);
    const reloadedBody = reloadedAction.json<ExecutionDetailResponse>();
    const reloadedInspection = reloadedBody.data.execucao.itens.find((item) => item.id === inspection.id);
    assert.ok(reloadedInspection);
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
    const blockedValidationBody = blockedValidation.json<ExecutionValidationResponse>();
    assert.equal(blockedValidationBody.data.pode_concluir, false);
    assert.equal(blockedValidationBody.data.evidencias_pendentes, 1);
    assert.equal(
      blockedValidationBody.data.pendencias.some(
        (item) =>
          item.item_id === inspection.id && item.tipo === 'RESPOSTA_OBRIGATORIA',
      ),
      false,
    );
    const evidenceBlocker = blockedValidationBody.data.pendencias.find(
      (item) =>
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
    const evidenceItems = evidenced.json<{
      data: {
        itens: readonly {
          readonly id: string;
          readonly quantidade_evidencias: number;
          readonly evidencias: readonly { readonly nome_arquivo: string }[];
        }[];
      };
    }>().data.itens;
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
    const uploadedItems = uploaded.json<{
      data: {
        itens: readonly {
          readonly id: string;
          readonly quantidade_evidencias: number;
          readonly evidencias: readonly {
            readonly objeto_armazenamento_id: string;
            readonly nome_arquivo: string;
            readonly url: string;
          }[];
        }[];
      };
    }>().data.itens;
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
    const actionCountAfterExecution = awaitingTechnicalReview.json().data.acoes.length;

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
        actionCountAfterExecution,
        'Assinar a liberação não deve gerar outra ação',
      );
    }
    for (const identity of [identities.quality, identities.safety]) {
      const resolvedDemandInbox = await app.inject({
        method: 'GET',
        url: '/v1/notifications?somente_nao_lidas=true',
        headers: bearer(identity),
      });
      assert.equal(resolvedDemandInbox.statusCode, 200, resolvedDemandInbox.body);
      assert.equal(
        resolvedDemandInbox.json<NotificationListResponse>().data.itens.some((item) => item.entidade_id === demandId),
        false,
        'Demanda pós-intervenção concluída não deve reaparecer como pendência.',
      );
    }

    const qualityReports = await app.inject({
      method: 'GET',
      url: '/v1/workflow/technical-reports',
      headers: bearer(identities.quality),
    });
    assert.equal(qualityReports.statusCode, 200, qualityReports.body);
    const qualityReport = qualityReports
      .json<TechnicalReportListResponse>()
      .data.relatorios.find(
        (report) => report.os_titulo === 'Preventiva integral da prensa',
      );
    assert.ok(qualityReport);
    assert.equal(qualityReport.tipo, 'QUALITY');
    assert.equal(qualityReport.status, 'ASSINADO');
    assert.ok(qualityReport.assinante.length > 0);
    assert.ok(Number.isFinite(Date.parse(qualityReport.aprovada_em)));
    assert.ok(Number.isFinite(Date.parse(qualityReport.assinado_em)));
    assert.match(qualityReport.assinatura_referencia, /^[0-9a-f]{8}-/iu);
    assert.match(qualityReport.hash, /^[0-9a-f]{64}$/iu);

    const safetyReports = await app.inject({
      method: 'GET',
      url: '/v1/workflow/technical-reports',
      headers: bearer(identities.safety),
    });
    assert.equal(safetyReports.statusCode, 200, safetyReports.body);
    const safetyReport = safetyReports
      .json<TechnicalReportListResponse>()
      .data.relatorios.find(
        (report) => report.os_titulo === 'Preventiva integral da prensa',
      );
    assert.ok(safetyReport);
    assert.equal(safetyReport.tipo, 'SAFETY');

    const nonTechnicalReports = await app.inject({
      method: 'GET',
      url: '/v1/workflow/technical-reports',
      headers: bearer(identities.admin),
    });
    assert.equal(nonTechnicalReports.statusCode, 403, nonTechnicalReports.body);

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
    const emptyQueueData = emptyQueue.json<{ data: { itens: readonly { id: string }[] } }>();
    assert.equal(emptyQueueData.data.itens.some(item => item.id === actionId), false);

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
      { type: 'CORRECTIVE', scheduled: true, release: false },
      { type: 'PREDICTIVE', scheduled: true, release: false },
      { type: 'PREVENTIVE', scheduled: true, release: false },
      { type: 'PREVENTIVE', scheduled: false, release: false },
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
          modo_execucao: 'INTERNAL',
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
        tipo_trabalho: 'PREVENTIVE', modo_execucao: 'INTERNAL', titulo: 'Preventiva normal concluída pelo técnico',
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
    const normalQueueBody = normalQueue.json<OperatorActionQueueResponse>();
    const normalAction = normalQueueBody.data.itens.find((item) => item.ordem_id === normalWorkOrderId);
    assert.ok(normalAction);
    const normalActionId: string = normalAction.id;
    const normalClaim = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/assume`, headers: bearer(identities.operator) });
    assert.equal(normalClaim.statusCode, 200, normalClaim.body);
    const normalStarted = await app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/start`, headers: bearer(identities.operator),
      payload: { modo_parada: 'NO_STOP' },
    });
    assert.equal(normalStarted.statusCode, 200, normalStarted.body);
    assert.equal(normalStarted.json().data.execucao.operador_id, ids.operator);
    const normalExecutionId: string = normalStarted.json().data.execucao.id;
    const shortageMultipart=multipartFields({codigo_peca:'MAT-TEST-01',descricao:'Rolamento indisponível',quantidade:'2',unidade:'un',observacao:'Aguardando reposição',impeditiva:'true'},Buffer.from([0xff,0xd8,0xff,0xd9]));
    const shortageCreated=await app.inject({
      method:'POST',url:`/v1/maintenance/executions/${normalExecutionId}/part-shortages`,
      headers:{...bearer(identities.operator),'content-type':shortageMultipart.contentType},payload:shortageMultipart.body,
    });
    assert.equal(shortageCreated.statusCode,200,shortageCreated.body);
    const shortageCreatedBody=shortageCreated.json<{readonly data:{readonly status:string;readonly part_shortages:readonly {readonly id:string;readonly evidence_id:string|null}[]}}>();
    assert.equal(shortageCreatedBody.data.status,'IN_PROGRESS','registrar falta não pausa automaticamente a OS');
    assert.equal(shortageCreatedBody.data.part_shortages.length,1);
    const shortageId:string=shortageCreatedBody.data.part_shortages[0]!.id;
    assert.ok(shortageCreatedBody.data.part_shortages[0]!.evidence_id,'foto opcional é vinculada à pendência');
    const pcmShortageInbox=await app.inject({method:'GET',url:'/v1/maintenance/part-shortages',headers:bearer(identities.admin)});
    assert.equal(pcmShortageInbox.statusCode,200,pcmShortageInbox.body);
    const pcmShortageInboxBody=pcmShortageInbox.json<{readonly data:{readonly pendencias_peca:readonly {readonly id:string}[]}}>();
    assert.equal(pcmShortageInboxBody.data.pendencias_peca.some((item)=>item.id===shortageId),true);
    await transaction(pool,client=>client.query(
      `INSERT INTO maintenance.work_order_part_shortages
         (tenant_id,work_order_id,action_id,execution_id,reported_by,description,quantity,unit,blocking,status,created_at)
       SELECT $1,$2,$3,$4,$5,'Pendência recente de teste fora da primeira página.',1,'un',false,'OPEN',
              clock_timestamp() + series * interval '1 second'
       FROM generate_series(1,101) AS series`,
      [tenantId,normalWorkOrderId,normalActionId,normalExecutionId,ids.operator],
    ));
    const firstShortagePage=await app.inject({method:'GET',url:'/v1/maintenance/part-shortages',headers:bearer(identities.admin)});
    assert.equal(firstShortagePage.statusCode,200,firstShortagePage.body);
    assert.equal(firstShortagePage.json<{readonly data:{readonly pendencias_peca:readonly {readonly id:string}[]}}>().data.pendencias_peca.some((item)=>item.id===shortageId),false,'pendência antiga fica fora da primeira página');
    const targetedShortage=await app.inject({method:'GET',url:`/v1/maintenance/part-shortages/${shortageId}`,headers:bearer(identities.admin)});
    assert.equal(targetedShortage.statusCode,200,targetedShortage.body);
    const targetedShortageBody=targetedShortage.json<{readonly data:{readonly pendencia_peca:{readonly id:string;readonly codigo_peca:string|null;readonly descricao:string}}}>();
    assert.equal(targetedShortageBody.data.pendencia_peca.id,shortageId);
    assert.equal(targetedShortageBody.data.pendencia_peca.codigo_peca,'MAT-TEST-01');
    assert.equal(targetedShortageBody.data.pendencia_peca.descricao,'Rolamento indisponível');
    const missingShortage=await app.inject({method:'GET',url:`/v1/maintenance/part-shortages/${randomUUID()}`,headers:bearer(identities.admin)});
    assert.equal(missingShortage.statusCode,404,missingShortage.body);
    const nonPcmShortage=await app.inject({method:'GET',url:`/v1/maintenance/part-shortages/${shortageId}`,headers:bearer(identities.production)});
    assert.equal(nonPcmShortage.statusCode,403,nonPcmShortage.body);
    const shortageNotificationRecipients=await transaction(pool,client=>client.query<{readonly recipient_count:number;readonly pcm_only:boolean}>(
      `SELECT count(*)::integer AS recipient_count,bool_and(role.code='PCM') AS pcm_only
       FROM workflow.notifications notification
       JOIN workflow.notification_recipients recipient ON recipient.tenant_id=notification.tenant_id AND recipient.notification_id=notification.id
       JOIN iam.user_roles user_role ON user_role.tenant_id=recipient.tenant_id AND user_role.user_id=recipient.user_id
       JOIN iam.roles role ON role.tenant_id=user_role.tenant_id AND role.id=user_role.role_id
       WHERE notification.tenant_id=$1 AND notification.entity_id=$2`,[tenantId,shortageId]));
    assert.equal(Number(shortageNotificationRecipients.rows[0]?.recipient_count),1);
    assert.equal(shortageNotificationRecipients.rows[0]?.pcm_only,true);
    const shortagePause=await app.inject({method:'POST',url:`/v1/maintenance/executions/${normalExecutionId}/pause`,headers:bearer(identities.operator),payload:{motivo_codigo:'AGUARDANDO_PECA',motivo_detalhe:'Sem condição segura de continuar.'}});
    assert.equal(shortagePause.statusCode,200,shortagePause.body);
    const deniedShortageResume=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${normalWorkOrderId}/executions/${normalExecutionId}/resume`,headers:bearer(identities.admin)});
    assert.equal(deniedShortageResume.statusCode,409,deniedShortageResume.body);
    const resolvedShortage=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${normalWorkOrderId}/part-shortages/${shortageId}/resolve`,headers:bearer(identities.admin),payload:{justificativa:'Peça separada para esta manutenção.'}});
    assert.equal(resolvedShortage.statusCode,200,resolvedShortage.body);
    const stillPaused=await app.inject({method:'GET',url:`/v1/maintenance/executions/${normalExecutionId}`,headers:bearer(identities.operator)});
    assert.equal(stillPaused.statusCode,200,stillPaused.body);
    assert.equal(stillPaused.json<{readonly data:{readonly status:string}}>().data.status,'PAUSED','resolver a pendência não retoma automaticamente a OS');
    const pcmResume=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${normalWorkOrderId}/executions/${normalExecutionId}/resume`,headers:bearer(identities.admin)});
    assert.equal(pcmResume.statusCode,200,pcmResume.body);
    const pcmResumeBody=pcmResume.json<{readonly data:{readonly status:string;readonly participants:readonly {readonly session_status:string}[]}}>();
    assert.equal(pcmResumeBody.data.status,'IN_PROGRESS');
    assert.equal(pcmResumeBody.data.participants.every((participant)=>participant.session_status!=='WORKING'),true,'retomada global não abre sessões individuais');
    const restartedSession=await app.inject({method:'POST',url:`/v1/maintenance/executions/${normalExecutionId}/sessions/start`,headers:bearer(identities.operator)});
    assert.equal(restartedSession.statusCode,200,restartedSession.body);
    const productionOccurrenceForAuthorization = await app.inject({
      method: 'POST', url: '/v1/maintenance/occurrences', headers: bearer(identities.production),
      payload: {
        ativo_id: ids.asset, componente_id: null, tipo: 'FALHA_OPERACIONAL',
        titulo: 'Ocorrência registrada pela produção',
        descricao: 'Produção relata o problema para avaliação posterior do PCM.',
        severidade: 'MEDIUM', equipamento_parado: false, tipo_parada: null,
        motivo_parada: null, ocorrida_em: null,
      },
    });
    assert.equal(productionOccurrenceForAuthorization.statusCode, 200, productionOccurrenceForAuthorization.body);
    const productionStart = await app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/start`,
      headers: bearer(identities.production), payload: { modo_parada: 'NO_STOP' },
    });
    assert.equal(productionStart.statusCode, 403, productionStart.body);
    const productionRecord = await app.inject({
      method: 'PUT', url: `/v1/maintenance/operator-actions/${normalActionId}/responses`,
      headers: bearer(identities.production), payload: { itens: [{ item_id: randomUUID(), resposta: 'SIM', valor: null, observacao: null }] },
    });
    assert.equal(productionRecord.statusCode, 403, productionRecord.body);
    const productionComplete = await app.inject({
      method: 'POST', url: `/v1/maintenance/executions/${normalExecutionId}/complete`,
      headers: bearer(identities.production), payload: { resultado: 'Não autorizado.', observacao: null, modo_parada: 'NO_STOP' },
    });
    assert.equal(productionComplete.statusCode, 403, productionComplete.body);
    const productionExternalService = await app.inject({
      method: 'POST', url: `/v1/maintenance/work-orders/${normalWorkOrderId}/external-services`,
      headers: bearer(identities.production),
      payload: { prestador: 'Fornecedor teste', descricao: 'Tentativa não autorizada.', valor: null, data_servico: null, observacao: null },
    });
    assert.equal(productionExternalService.statusCode, 403, productionExternalService.body);
    const pendingPriceMaterialId = randomUUID();
    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO cmms.materials (id,tenant_id,sku,name,unit,current_stock,minimum_stock,unit_cost)
         VALUES ($1,$2,$3,'Componente sem preço conhecido','UN',4,0,NULL)`,
        [pendingPriceMaterialId, tenantId, `MAT-PENDING-${randomUUID()}`],
      );
    });
    const pendingConsumption = await app.inject({
      method: 'POST', url: `/v1/maintenance/operator-actions/${normalActionId}/materials`,
      headers: bearer(identities.operator), payload: { material_id: pendingPriceMaterialId, quantidade: 2, observacao: 'Custo ainda não informado.' },
    });
    assert.equal(pendingConsumption.statusCode, 200, pendingConsumption.body);
    assert.equal(pendingConsumption.json().data.consumo.unit_cost, null);
    assert.equal(pendingConsumption.json().data.consumo.total_cost, null);
    const pendingUsageId: string = pendingConsumption.json().data.consumo.id;
    const productionCost = await app.inject({
      method: 'PATCH', url: `/v1/maintenance/material-usage/${pendingUsageId}/cost`,
      headers: bearer(identities.production), payload: { valor_unitario: 99 },
    });
    assert.equal(productionCost.statusCode, 403, productionCost.body);
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
    const completionShortageMultipart=multipartFields({codigo_peca:'MAT-TEST-02',descricao:'Vedação necessária',quantidade:'1',unidade:'un',observacao:'Pendência impeditiva',impeditiva:'true'});
    const completionShortage=await app.inject({method:'POST',url:`/v1/maintenance/executions/${normalExecutionId}/part-shortages`,headers:{...bearer(identities.operator),'content-type':completionShortageMultipart.contentType},payload:completionShortageMultipart.body});
    assert.equal(completionShortage.statusCode,200,completionShortage.body);
    const completionShortageId:string=completionShortage.json<{readonly data:{readonly part_shortages:readonly {readonly id:string;readonly codigo_peca:string|null}[]}}>().data.part_shortages.find((shortage)=>shortage.codigo_peca==='MAT-TEST-02')!.id;
    const blockedByShortage=await app.inject({method:'GET',url:`/v1/maintenance/executions/${normalExecutionId}/validation`,headers:bearer(identities.operator)});
    assert.equal(blockedByShortage.statusCode,200,blockedByShortage.body);
    assert.equal(blockedByShortage.json().data.pode_concluir,false);
    assert.equal(blockedByShortage.json().data.pendencias_peca_impeditivas,1);
    const completionRejectedByShortage=await app.inject({method:'POST',url:`/v1/maintenance/executions/${normalExecutionId}/complete`,headers:bearer(identities.operator),payload:{resultado:'Tentativa bloqueada',observacao:null,modo_parada:'NO_STOP'}});
    assert.equal(completionRejectedByShortage.statusCode,409,completionRejectedByShortage.body);
    const resolvedCompletionShortage=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${normalWorkOrderId}/part-shortages/${completionShortageId}/resolve`,headers:bearer(identities.admin),payload:{justificativa:'Material conferido e aplicado.'}});
    assert.equal(resolvedCompletionShortage.statusCode,200,resolvedCompletionShortage.body);
    const normalCompleted = await app.inject({
      method: 'POST', url: `/v1/maintenance/executions/${normalExecutionId}/complete`, headers: bearer(identities.operator),
      payload: {
        resultado: 'Preventiva normal concluída.', observacao: null, modo_parada: 'NO_STOP',
        tecnicos_auxiliares_ids: [ids.support, ids.supportSecond],
      },
    });
    assert.equal(normalCompleted.statusCode, 200, normalCompleted.body);
    assert.deepEqual(normalCompleted.json().data.tecnicos_auxiliares, [
      { id: ids.support, nome: 'Apoio Operações' },
      { id: ids.supportSecond, nome: 'Apoio Operações Dois' },
    ]);
    assert.equal(normalCompleted.json().data.operador_id, ids.operator);
    const normalExecutionDetail = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/executions/${normalExecutionId}`,
      headers: bearer(identities.quality),
    });
    assert.equal(normalExecutionDetail.statusCode, 200, normalExecutionDetail.body);
    const normalExecutionDetailBody = normalExecutionDetail.json<ExecutionSupportDetailResponse>();
    assert.equal(normalExecutionDetailBody.data.operador_id, ids.operator);
    assert.deepEqual(
      normalExecutionDetailBody.data.tecnicos_auxiliares.map((technician) => technician.id),
      [ids.support, ids.supportSecond],
    );
    const normalClosed = await app.inject({
      method: 'GET', url: `/v1/maintenance/work-orders/${normalWorkOrderId}`, headers: bearer(identities.admin),
    });
    assert.equal(normalClosed.statusCode, 200, normalClosed.body);
    assert.equal(normalClosed.json().data.status, 'COMPLETED');
    assert.equal(normalClosed.json().data.acoes[0].status, 'COMPLETED');
    const handoffWorkOrder=await app.inject({method:'POST',url:'/v1/maintenance/work-orders',headers:bearer(identities.admin),payload:{
      plano_versao_id:ids.planVersion,ativo_id:ids.asset,tipo_origem:'TEST',entidade_origem_id:null,
      tipo_trabalho:'PREVENTIVE',modo_execucao:'INTERNAL',titulo:'OS de passagem de turno',
      descricao:'Validação de encerramento por participante e da pausa do último técnico.',prioridade:'MEDIUM',
      responsavel_id:null,programada_para:null,analise_tecnica:{resultado_esperado:'Continuidade preservada.'},
    }});
    assert.equal(handoffWorkOrder.statusCode,200,handoffWorkOrder.body);
    const handoffWorkOrderId:string=handoffWorkOrder.json().data.id;
    const handoffReview=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${handoffWorkOrderId}/submit-review`,headers:bearer(identities.admin),payload:{politica_assinatura:'QUALIDADE',assinaturas_exigidas:1,primeira_resposta_ate:null,resolucao_ate:null}});
    assert.equal(handoffReview.statusCode,200,handoffReview.body);
    const handoffRelease=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${handoffWorkOrderId}/release`,headers:bearer(identities.admin)});
    assert.equal(handoffRelease.statusCode,200,handoffRelease.body);
    const handoffActionId:string=handoffRelease.json().data.acoes[0].id;
    const handoffClaim=await app.inject({method:'POST',url:`/v1/maintenance/operator-actions/${handoffActionId}/assume`,headers:bearer(identities.operator)});
    assert.equal(handoffClaim.statusCode,200,handoffClaim.body);
    const handoffStarted=await app.inject({method:'POST',url:`/v1/maintenance/operator-actions/${handoffActionId}/start`,headers:bearer(identities.operator),payload:{modo_parada:'NO_STOP'}});
    assert.equal(handoffStarted.statusCode,200,handoffStarted.body);
    const handoffExecutionId:string=handoffStarted.json().data.execucao.id;
    const collaboratorInvite=await app.inject({method:'POST',url:`/v1/maintenance/operator-actions/${handoffActionId}/collaborators`,headers:bearer(identities.operator),payload:{usuario_id:ids.support}});
    assert.equal(collaboratorInvite.statusCode,200,collaboratorInvite.body);
    const collaboratorAccept=await app.inject({method:'POST',url:`/v1/maintenance/operator-actions/${handoffActionId}/collaborators/${collaboratorInvite.json().data.participant_id}/accept`,headers:bearer(identities.support)});
    assert.equal(collaboratorAccept.statusCode,200,collaboratorAccept.body);
    const collaboratorSession=await app.inject({method:'POST',url:`/v1/maintenance/executions/${handoffExecutionId}/sessions/start`,headers:bearer(identities.support)});
    assert.equal(collaboratorSession.statusCode,200,collaboratorSession.body);
    const primaryHandoff=await app.inject({method:'POST',url:`/v1/maintenance/executions/${handoffExecutionId}/shift-handoffs`,headers:bearer(identities.operator),payload:{condicao_equipamento:'Equipamento estável para continuidade.',trabalho_pendente:'Ajuste final de torque.',proximo_passo:'Conferir torque e registrar medição.',ha_trabalho_pendente:true}});
    assert.equal(primaryHandoff.statusCode,200,primaryHandoff.body);
    const primaryHandoffBody=primaryHandoff.json<{readonly data:{readonly status:string;readonly participants:readonly {readonly user_id:string;readonly session_status:string}[]}}>();
    assert.equal(primaryHandoffBody.data.status,'IN_PROGRESS','passagem do principal não pausa enquanto colaborador está trabalhando');
    assert.equal(primaryHandoffBody.data.participants.find((participant)=>participant.user_id===ids.support)?.session_status,'WORKING');
    const finalHandoff=await app.inject({method:'POST',url:`/v1/maintenance/executions/${handoffExecutionId}/shift-handoffs`,headers:bearer(identities.support),payload:{condicao_equipamento:'Equipamento estável e seguro.',trabalho_pendente:'Conferir torque no próximo turno.',proximo_passo:'Validar torque e encerrar checklist.',ha_trabalho_pendente:true}});
    assert.equal(finalHandoff.statusCode,200,finalHandoff.body);
    const finalHandoffBody=finalHandoff.json<{readonly data:{readonly status:string;readonly participants:readonly {readonly session_status:string}[]}}>();
    assert.equal(finalHandoffBody.data.status,'PAUSED','último participante com trabalho pendente pausa globalmente');
    assert.equal(finalHandoffBody.data.participants.every((participant)=>participant.session_status!=='WORKING'),true);
    const handoffResume=await app.inject({method:'POST',url:`/v1/maintenance/work-orders/${handoffWorkOrderId}/executions/${handoffExecutionId}/resume`,headers:bearer(identities.admin)});
    assert.equal(handoffResume.statusCode,200,handoffResume.body);
    const handoffResumeBody=handoffResume.json<{readonly data:{readonly status:string;readonly participants:readonly {readonly session_status:string}[]}}>();
    assert.equal(handoffResumeBody.data.status,'IN_PROGRESS');
    assert.equal(handoffResumeBody.data.participants.every((participant)=>participant.session_status!=='WORKING'),true,'turno seguinte requer sessões novas explícitas');
    const handoffResumeAudit=await transaction(pool,client=>client.query<{readonly total:number}>(
      `SELECT count(*)::integer AS total FROM maintenance.execution_shift_handoffs WHERE tenant_id=$1 AND execution_id=$2`,[tenantId,handoffExecutionId]));
    assert.equal(Number(handoffResumeAudit.rows[0]?.total),2);
    const pendingCostsAfterCompletion = await transaction(pool, (client) => client.query<{
      readonly realized_total: string;
      readonly materials_pending_price: number;
      readonly financial_data_pending: boolean;
    }>(
      `SELECT realized_total::text,materials_pending_price,financial_data_pending
         FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`,
      [normalWorkOrderId],
    ));
    assert.equal(pendingCostsAfterCompletion.rows.length, 1);
    assert.equal(Number(pendingCostsAfterCompletion.rows[0]!.realized_total), 0);
    assert.equal(pendingCostsAfterCompletion.rows[0]!.materials_pending_price, 1);
    assert.equal(pendingCostsAfterCompletion.rows[0]!.financial_data_pending, true);
    const technicianCannotCompleteCost = await app.inject({
      method: 'PATCH', url: `/v1/maintenance/material-usage/${pendingUsageId}/cost`,
      headers: bearer(identities.operator), payload: { valor_unitario: 42.5 },
    });
    assert.equal(technicianCannotCompleteCost.statusCode, 403, technicianCannotCompleteCost.body);
    const costCompleted = await app.inject({
      method: 'PATCH', url: `/v1/maintenance/material-usage/${pendingUsageId}/cost`,
      headers: bearer(identities.admin), payload: { valor_unitario: 42.5 },
    });
    assert.equal(costCompleted.statusCode, 200, costCompleted.body);
    assert.equal(Number(costCompleted.json().data.consumo.unit_cost), 42.5);
    assert.equal(Number(costCompleted.json().data.consumo.total_cost), 85);
    const recalculatedCosts = await transaction(pool, (client) => client.query<{
      readonly material_cost: string;
      readonly realized_total: string;
      readonly materials_pending_price: number;
      readonly financial_data_pending: boolean;
    }>(
      `SELECT material_cost::text,realized_total::text,materials_pending_price,financial_data_pending
         FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`,
      [normalWorkOrderId],
    ));
    assert.equal(recalculatedCosts.rows.length, 1);
    assert.equal(Number(recalculatedCosts.rows[0]!.material_cost), 85);
    assert.equal(Number(recalculatedCosts.rows[0]!.realized_total), 85);
    assert.equal(recalculatedCosts.rows[0]!.materials_pending_price, 0);
    assert.equal(recalculatedCosts.rows[0]!.financial_data_pending, false);
    const costAudit = await transaction(pool, (client) => client.query<{
      readonly action: string;
      readonly entity_id: string;
      readonly after_data: { readonly unit_cost: number | string; readonly total_cost: number | string };
    }>(
      `SELECT action,entity_id,after_data FROM audit.events
        WHERE tenant_id=$1 AND action='MATERIAL_USAGE_COST_COMPLETED' AND entity_id=$2`,
      [tenantId, pendingUsageId],
    ));
    assert.equal(costAudit.rows.length, 1);
    assert.equal(costAudit.rows[0]!.after_data.unit_cost, 42.5);
    assert.equal(Number(costAudit.rows[0]!.after_data.total_cost), 85);
    await transaction(pool, async (client) => {
      const supportTeam = await client.query(
        `SELECT tenant_id, execution_id, user_id, support_slot
           FROM maintenance.execution_support_technicians
          WHERE execution_id=$1
          ORDER BY support_slot`,
        [normalExecutionId],
      );
      assert.deepEqual(supportTeam.rows, [
        { tenant_id: tenantId, execution_id: normalExecutionId, user_id: ids.support, support_slot: 1 },
        { tenant_id: tenantId, execution_id: normalExecutionId, user_id: ids.supportSecond, support_slot: 2 },
      ]);
      const supportHistory = await client.query<{
        readonly tenant_id: string;
        readonly execution_id: string;
        readonly payload: {
          readonly tecnico_principal_id: string;
          readonly tecnicos_auxiliares_ids: readonly string[];
        };
      }>(
        `SELECT tenant_id, execution_id, payload
           FROM maintenance.history_events
          WHERE execution_id=$1
            AND event_type='EXECUTION_SUPPORT_TECHNICIANS_RECORDED'`,
        [normalExecutionId],
      );
      assert.deepEqual(supportHistory.rows, [{
        tenant_id: tenantId,
        execution_id: normalExecutionId,
        payload: {
          tecnico_principal_id: ids.operator,
          tecnicos_auxiliares_ids: [ids.support, ids.supportSecond],
        },
      }]);
      const directExecution = await client.query<{ readonly id: string }>(
        `SELECT id FROM maintenance.executions WHERE work_order_action_id=$1`,
        [actionId],
      );
      const directExecutionId = directExecution.rows[0]?.id;
      assert.ok(directExecutionId);
      const executionWithoutSupport = await client.query<{ readonly total: number }>(
        `SELECT count(*)::integer AS total
           FROM maintenance.execution_support_technicians
          WHERE execution_id=$1`,
        [directExecutionId],
      );
      assert.equal(executionWithoutSupport.rows[0]?.total, 0);
      await expectDatabaseRejection(client, () => client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,3)`,
        [tenantId, directExecutionId, ids.support],
      ), { code: '23514', constraint: 'execution_support_technicians_slot_check' });
      await expectDatabaseRejection(client, () => client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,1)`,
        [tenantId, directExecutionId, ids.operator],
      ), { code: '23514', messageIncludes: 'principal não pode ser registrado como auxiliar' });
      await client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,1)`,
        [tenantId, directExecutionId, ids.support],
      );
      const directSupportTeam = await client.query(
        `SELECT user_id, support_slot
           FROM maintenance.execution_support_technicians
          WHERE execution_id=$1
          ORDER BY support_slot`,
        [directExecutionId],
      );
      assert.deepEqual(
        directSupportTeam.rows,
        [
          { user_id: ids.support, support_slot: 1 },
        ],
      );
      await expectDatabaseRejection(client, () => client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,1)`,
        [tenantId, directExecutionId, ids.supportSecond],
      ), { code: '23505', constraint: 'execution_support_technicians_unique_slot' });
      await expectDatabaseRejection(client, () => client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,2)`,
        [tenantId, directExecutionId, ids.support],
      ), { code: '23505', constraint: 'execution_support_technicians_unique_member' });
      await expectDatabaseRejection(client, () => client.query(
        `UPDATE maintenance.executions SET operator_id=$2 WHERE id=$1`,
        [directExecutionId, ids.support],
      ), { code: '23514', messageIncludes: 'principal não pode coincidir com um auxiliar registrado' });
      await expectDatabaseRejection(client, () => client.query(
        `INSERT INTO maintenance.execution_support_technicians
           (tenant_id, execution_id, user_id, support_slot)
         VALUES ($1,$2,$3,1)`,
        [randomUUID(), directExecutionId, ids.supportSecond],
      ), { code: '42501' });
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

    const improvementRequest = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/improvement-requests',
      headers: bearer(identities.operator),
      payload: {
        ativo_id: ids.asset,
        categoria: 'MODIFICATION',
        sugestao: 'Instalar proteção adicional no conjunto móvel',
        motivo: 'Reduzir exposição e aumentar a confiabilidade do equipamento.',
        objeto_evidencia_id: null,
      },
    });
    assert.equal(improvementRequest.statusCode, 200, improvementRequest.body);
    const improvementRequestId: string = improvementRequest.json().data.solicitacao.id;
    const improvementQueue = await app.inject({
      method: 'GET',
      url: '/v1/maintenance/improvement-requests',
      headers: bearer(identities.admin),
    });
    assert.equal(improvementQueue.statusCode, 200, improvementQueue.body);
    const improvementQueueBody = improvementQueue.json<ImprovementRequestListResponse>();
    assert.ok(improvementQueueBody.data.solicitacoes.some((item) => item.id === improvementRequestId));

    const improvementWorkOrder = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        ativo_id: ids.asset,
        tipo_origem: 'IMPROVEMENT_REQUEST',
        entidade_origem_id: improvementRequestId,
        tipo_trabalho: 'IMPROVEMENT',
        modo_execucao: 'MIXED',
        categoria_melhoria: 'MODIFICATION',
        titulo: 'Melhoria de proteção do conjunto móvel',
        descricao: 'Executar adequação proposta pela equipe técnica.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: null,
        analise_tecnica: { exige_liberacao_pos_intervencao: false },
      },
    });
    assert.equal(improvementWorkOrder.statusCode, 200, improvementWorkOrder.body);
    assert.match(improvementWorkOrder.json().data.codigo, /^OS-\d{8}$/u);
    assert.match(improvementWorkOrder.json().data.codigo_legado, /^OS-\d{14}-[0-9A-F]{8}$/u);
    assert.equal(improvementWorkOrder.json().data.tipo_trabalho, 'IMPROVEMENT');
    assert.equal(improvementWorkOrder.json().data.modo_execucao, 'MIXED');
    assert.equal(improvementWorkOrder.json().data.categoria_melhoria, 'MODIFICATION');
    const improvementWorkOrderId: string = improvementWorkOrder.json().data.id;

    const repeatedImprovementConversion = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        ativo_id: ids.asset,
        tipo_origem: 'IMPROVEMENT_REQUEST',
        entidade_origem_id: improvementRequestId,
        tipo_trabalho: 'IMPROVEMENT',
        modo_execucao: 'MIXED',
        categoria_melhoria: 'MODIFICATION',
        titulo: 'Reenvio da melhoria',
        descricao: 'A conversão idempotente deve devolver a OS já criada.',
        prioridade: 'MEDIUM',
        responsavel_id: null,
        programada_para: null,
        analise_tecnica: {},
      },
    });
    assert.equal(repeatedImprovementConversion.statusCode, 200, repeatedImprovementConversion.body);
    assert.equal(repeatedImprovementConversion.json().data.id, improvementWorkOrderId);

    for (const [provider, description, amount] of [
      ['Oficina Alfa', 'Usinagem do eixo', 100],
      ['Balanceamento Beta', 'Balanceamento dinâmico', 250],
      ['Inspeção Gama', 'Laudo complementar com valor pendente', null],
    ] as const) {
      const service = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${improvementWorkOrderId}/external-services`,
        headers: bearer(identities.admin),
        payload: { prestador: provider, descricao: description, valor: amount, data_servico: null, observacao: null },
      });
      assert.equal(service.statusCode, 200, service.body);
    }
    const improvementDetail = await app.inject({
      method: 'GET',
      url: `/v1/maintenance/work-orders/${improvementWorkOrderId}`,
      headers: bearer(identities.admin),
    });
    assert.equal(improvementDetail.statusCode, 200, improvementDetail.body);
    assert.equal(Number(improvementDetail.json().data.custos.servicos_externos), 350);
    assert.equal(Number(improvementDetail.json().data.custos.total_realizado), 350);
    assert.equal(improvementDetail.json().data.custos.servicos_sem_preco, 1);
    assert.equal(improvementDetail.json().data.custos.dados_financeiros_pendentes, true);

    const invalidType = await app.inject({
      method: 'POST',
      url: '/v1/maintenance/work-orders',
      headers: bearer(identities.admin),
      payload: {
        plano_versao_id: ids.planVersion,
        tipo_origem: 'ADMIN', entidade_origem_id: null, tipo_trabalho: 'INSPECTION',
        modo_execucao: 'INTERNAL', titulo: 'Tipo inválido', descricao: 'Contrato deve rejeitar.',
        prioridade: 'LOW', responsavel_id: null, programada_para: null, analise_tecnica: {},
      },
    });
    assert.equal(invalidType.statusCode, 400, invalidType.body);

    const concurrentCreates = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => app.inject({
        method: 'POST',
        url: '/v1/maintenance/work-orders',
        headers: bearer(identities.admin),
        payload: {
          plano_versao_id: ids.planVersion,
          tipo_origem: 'ADMIN', entidade_origem_id: null,
          tipo_trabalho: index % 2 === 0 ? 'PREVENTIVE' : 'PREDICTIVE',
          modo_execucao: (['INTERNAL', 'EXTERNAL', 'MIXED'] as const)[index % 3],
          titulo: `OS concorrente ${index + 1}`,
          descricao: 'Validação do contador operacional atômico por tenant.',
          prioridade: 'LOW', responsavel_id: null, programada_para: null, analise_tecnica: {},
        },
      })),
    );
    for (const response of concurrentCreates) assert.equal(response.statusCode, 200, response.body);
    const concurrentCodes = concurrentCreates.map(response => response.json().data.codigo as string);
    assert.equal(new Set(concurrentCodes).size, concurrentCodes.length);
    assert.ok(concurrentCodes.every(code => /^OS-\d{8}$/u.test(code)));

    await transaction(pool, async (client) => {
      const sequence = await client.query<{ operational_number: string; operational_code: string }>(
        `SELECT operational_number::text,operational_code
           FROM maintenance.work_orders
          ORDER BY operational_number`,
      );
      assert.equal(sequence.rows[0]!.operational_number, '1');
      assert.equal(sequence.rows[0]!.operational_code, 'OS-00000001');
      assert.equal(new Set(sequence.rows.map(row => row.operational_number)).size, sequence.rows.length);

      const originalCounter = await client.query<{ next_number: string }>(
        `SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`,
        [tenantId],
      );
      await client.query('SAVEPOINT sequence_rollback');
      await client.query(
        `INSERT INTO maintenance.work_orders (
           id,tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,
           work_type,title,description,priority,requester_id,content_hash_sha256
         ) SELECT $1,$2,$3,asset_id,component_id,maintenance_plan_version_id,'ADMIN',
                  'PREVENTIVE','Rollback do contador','A numeração deve voltar com a transação.',
                  'LOW',$4,repeat('e',64)
             FROM maintenance.work_orders WHERE id=$5`,
        [randomUUID(), tenantId, `OS-ROLLBACK-${randomUUID()}`, ids.admin, improvementWorkOrderId],
      );
      await client.query('ROLLBACK TO SAVEPOINT sequence_rollback');
      const afterRollback = await client.query<{ next_number: string }>(
        `SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`,
        [tenantId],
      );
      assert.equal(afterRollback.rows[0]?.next_number, originalCounter.rows[0]?.next_number);

      const retryCode = `OS-IDEMPOTENT-${randomUUID()}`;
      const retryId = randomUUID();
      await client.query(
        `INSERT INTO maintenance.work_orders (
           id,tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,
           work_type,title,description,priority,requester_id,content_hash_sha256
         ) SELECT $1,$2,$3,asset_id,component_id,maintenance_plan_version_id,'ADMIN',
                  'PREVENTIVE','Retry idempotente','Primeira tentativa.',
                  'LOW',$4,repeat('f',64)
             FROM maintenance.work_orders WHERE id=$5`,
        [retryId, tenantId, retryCode, ids.admin, improvementWorkOrderId],
      );
      const firstRetryNumber = await client.query<{ operational_number: string }>(
        `SELECT operational_number::text FROM maintenance.work_orders WHERE id=$1`,
        [retryId],
      );
      const counterAfterFirstRetry = await client.query<{ next_number: string }>(
        `SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO maintenance.work_orders (
           id,tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,
           work_type,title,description,priority,requester_id,content_hash_sha256
         ) SELECT $1,$2,$3,asset_id,component_id,maintenance_plan_version_id,'ADMIN',
                  'PREVENTIVE','Retry idempotente','Segunda tentativa.',
                  'LOW',$4,repeat('f',64)
             FROM maintenance.work_orders WHERE id=$5
         ON CONFLICT (tenant_id,code) DO UPDATE SET updated_at=clock_timestamp()`,
        [randomUUID(), tenantId, retryCode, ids.admin, improvementWorkOrderId],
      );
      const secondRetryNumber = await client.query<{ operational_number: string }>(
        `SELECT operational_number::text FROM maintenance.work_orders WHERE id=$1`,
        [retryId],
      );
      const counterAfterSecondRetry = await client.query<{ next_number: string }>(
        `SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`,
        [tenantId],
      );
      assert.equal(secondRetryNumber.rows[0]?.operational_number, firstRetryNumber.rows[0]?.operational_number);
      assert.equal(counterAfterSecondRetry.rows[0]?.next_number, counterAfterFirstRetry.rows[0]?.next_number);
    });

    const completeSingleAreaPostIntervention = async (
      policy: 'QUALIDADE' | 'SEGURANCA',
      signerToken: string,
      title: string,
    ) => {
      const workOrderResponse = await app.inject({
        method: 'POST',
        url: '/v1/maintenance/work-orders',
        headers: bearer(identities.admin),
        payload: {
          plano_versao_id: ids.planVersion,
          tipo_origem: 'ADMIN',
          entidade_origem_id: null,
          tipo_trabalho: 'PREVENTIVE',
          modo_execucao: 'INTERNAL',
          titulo: title,
          descricao: 'Validação excepcional com somente uma área obrigatória.',
          prioridade: 'MEDIUM',
          responsavel_id: null,
          programada_para: new Date(Date.now() + 86400000).toISOString(),
          analise_tecnica: { exige_liberacao_pos_intervencao: true },
        },
      });
      assert.equal(workOrderResponse.statusCode, 200, workOrderResponse.body);
      const workOrderId: string = workOrderResponse.json().data.id;
      const submitted = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${workOrderId}/submit-review`,
        headers: bearer(identities.admin),
        payload: {
          politica_assinatura: policy,
          assinaturas_exigidas: 1,
          primeira_resposta_ate: null,
          resolucao_ate: null,
        },
      });
      assert.equal(submitted.statusCode, 200, submitted.body);
      const demandId: string = submitted.json().data.validacao.id;
      const released = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/work-orders/${workOrderId}/release`,
        headers: bearer(identities.admin),
      });
      assert.equal(released.statusCode, 200, released.body);

      const actionQueue = await app.inject({
        method: 'GET',
        url: '/v1/maintenance/operator-actions',
        headers: bearer(identities.operator),
      });
      assert.equal(actionQueue.statusCode, 200, actionQueue.body);
      const action = actionQueue.json<OperatorActionQueueResponse>().data.itens.find(
        (item) => item.ordem_id === workOrderId,
      );
      assert.ok(action);
      const actionClaim = await app.inject({ method: 'POST', url: `/v1/maintenance/operator-actions/${action.id}/assume`, headers: bearer(identities.operator) });
      assert.equal(actionClaim.statusCode, 200, actionClaim.body);
      const assumedExecution = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/operator-actions/${action.id}/assume`,
        headers: bearer(identities.operator),
      });
      assert.equal(assumedExecution.statusCode, 200, assumedExecution.body);
      const startedExecution = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/operator-actions/${action.id}/start`,
        headers: bearer(identities.operator),
        payload: { modo_parada: 'STOPPED' },
      });
      assert.equal(startedExecution.statusCode, 200, startedExecution.body);
      const executionId: string = startedExecution.json().data.execucao.id;
      const items: readonly { readonly id: string; readonly tipo_resposta: string }[] =
        startedExecution.json().data.execucao.itens;
      const confirmation = items.find((item) => item.tipo_resposta === 'CONFIRMACAO');
      const inspection = items.find((item) => item.tipo_resposta === 'OK_NOK');
      const parameter = items.find((item) => item.tipo_resposta === 'PARAMETRO');
      const evidence = items.find((item) => item.tipo_resposta === 'EVIDENCIA');
      assert.ok(confirmation && inspection && parameter && evidence);
      const responses = await app.inject({
        method: 'PUT',
        url: `/v1/maintenance/operator-actions/${action.id}/responses`,
        headers: bearer(identities.operator),
        payload: {
          itens: [
            { item_id: confirmation.id, resposta: 'SIM', valor: null, observacao: null },
            { item_id: inspection.id, resposta: 'OK', valor: null, observacao: 'Sem anormalidades.' },
            { item_id: parameter.id, resposta: null, valor: 160, observacao: 'Dentro da faixa.' },
          ],
        },
      });
      assert.equal(responses.statusCode, 200, responses.body);
      const savedEvidence = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/executions/${executionId}/items/${evidence.id}/evidence`,
        headers: bearer(identities.operator),
        payload: {
          objeto_armazenamento_id: ids.storageObject,
          tipo: 'PHOTO',
          observacao: 'Condição final inspecionada.',
          capturada_em: null,
        },
      });
      assert.equal(savedEvidence.statusCode, 200, savedEvidence.body);
      const completion = await app.inject({
        method: 'POST',
        url: `/v1/maintenance/operator-actions/${action.id}/complete`,
        headers: bearer(identities.operator),
        payload: {
          resultado: 'Intervenção concluída e equipamento liberado tecnicamente.',
          observacao: null,
          relatorio_tecnico: {
            diagnostico_tecnico: 'Inspeção concluída.',
            acao_realizada: 'Intervenção executada conforme checklist.',
            pecas_materiais: 'Nenhum material utilizado.',
            medicoes: 'Parâmetros dentro da faixa.',
          },
          modo_parada: 'STOPPED',
        },
      });
      assert.equal(completion.statusCode, 200, completion.body);
      assert.equal(completion.json().data.execucao.status, 'COMPLETED');
      const awaitingSignature = await app.inject({
        method: 'GET',
        url: `/v1/maintenance/work-orders/${workOrderId}`,
        headers: bearer(identities.admin),
      });
      assert.equal(awaitingSignature.statusCode, 200, awaitingSignature.body);
      assert.equal(awaitingSignature.json().data.status, 'IN_TECHNICAL_REVIEW');
      assert.equal(awaitingSignature.json().data.validacao.id, demandId);
      const signed = await app.inject({
        method: 'POST',
        url: `/v1/workflow/technical-demands/${demandId}/sign`,
        headers: bearer(signerToken),
        payload: {
          declaracao: `Validação final da área ${policy}.`,
          significado: `Liberação pós-intervenção — ${policy}.`,
        },
      });
      assert.equal(signed.statusCode, 200, signed.body);
      assert.equal(signed.json().data.status, 'COMPLETED');
    };

    await completeSingleAreaPostIntervention(
      'QUALIDADE',
      identities.quality,
      'Pós-intervenção validada somente pela Qualidade',
    );
    await completeSingleAreaPostIntervention(
      'SEGURANCA',
      identities.safety,
      'Pós-intervenção validada somente pela Segurança',
    );
  },
);
