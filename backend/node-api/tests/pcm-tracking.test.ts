import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { OperationsRepository } from '../src/modules/operations/operations.repository.js';
import { OperationsService } from '../src/modules/operations/operations.service.js';
import type { Database } from '../src/infrastructure/database/database.js';
import type { ObjectStorage } from '../src/infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';
import { randomUUID } from 'node:crypto';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service.js';
import { MonitoringRepository } from '../src/modules/monitoring/monitoring.repository.js';
import { archiveSignedRecords } from '../src/modules/governance/signed-record-archive.js';

test(
  'fila de acompanhamento consulta executor e pausa no banco real sem alterar dados',
  { skip: !process.env.PCM_IMPORT_TEST_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PCM_IMPORT_TEST_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const identity = await client.query(
        "SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1",
      );
      assert.ok(identity.rows[0]);
      await client.query('SET LOCAL ROLE fab_control_api_local');
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [identity.rows[0].tenant_id, identity.rows[0].id],
      );
      const rows = await new OperationsRepository().listWorkOrders(client, {
        search: '',
        status: null,
        assetId: null,
        limit: 500,
      });
      assert.ok(Array.isArray(rows));
      for (const row of rows) {
        assert.ok('executor_nome' in row);
        assert.ok('motivo_pausa' in row);
      }
      const summary = await new OperationsRepository().trackingSummary(client, '', null);
      assert.ok(Number(summary.contadores.all) >= rows.length);
      assert.ok(Array.isArray(summary.setores));
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);

test(
  'decisão da ocorrência informa produção e lembrete de tratamento é idempotente',
  { skip: !process.env.PCM_IMPORT_TEST_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PCM_IMPORT_TEST_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query(
        "SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1",
      );
      const account = identity.rows[0];
      assert.ok(account);
      const fixture = await client.query(
        `INSERT INTO maintenance.operational_occurrences (tenant_id,asset_id,occurrence_type,title,description,reported_by,reporter_role_snapshot)
      SELECT $1,id,'FAILURE','Teste de decisão PCM','Ocorrência temporária revertida',$2,'PRODUCAO' FROM cmms.assets WHERE tenant_id=$1 LIMIT 1 RETURNING id`,
        [account.tenant_id, account.id],
      );
      const occurrenceId = fixture.rows[0].id;
      await client.query('SET LOCAL ROLE fab_control_api_local');
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [account.tenant_id, account.id],
      );
      const db = {
        withTransaction: async (_context: unknown, run: (connection: typeof client) => unknown) =>
          run(client),
      } as Database;
      const service = new MonitoringService(db);
      const actor = { id: account.id, tenantId: account.tenant_id } as AuthenticatedUser;
      const audit = {
        traceId: randomUUID(),
        userAgent: null,
        ipAddress: '127.0.0.1',
        roleSnapshot: 'PCM',
      };
      await service.decideOccurrence(
        actor,
        occurrenceId,
        {
          decisao: 'AGENDAR',
          observacao: 'Tratamento programado para o próximo turno.',
          agendada_para: new Date(Date.now() + 86400000).toISOString(),
        },
        audit,
      );
      const scheduled = await client.query(
        'SELECT treatment_scheduled_for,status FROM maintenance.operational_occurrences WHERE id=$1',
        [occurrenceId],
      );
      assert.ok(scheduled.rows[0].treatment_scheduled_for);
      assert.equal(scheduled.rows[0].status, 'IN_TREATMENT');
      await client.query(
        "UPDATE maintenance.operational_occurrences SET treatment_scheduled_for=clock_timestamp()-interval '1 minute' WHERE id=$1",
        [occurrenceId],
      );
      const repo = new MonitoringRepository();
      await repo.notifyDueOccurrenceTreatments(client, account.tenant_id, account.id);
      await repo.notifyDueOccurrenceTreatments(client, account.tenant_id, account.id);
      const reminders = await client.query(
        "SELECT count(*) FROM workflow.notifications WHERE entity_id=$1 AND notification_type='PCM_OCCURRENCE_TREATMENT_DUE'",
        [occurrenceId],
      );
      assert.equal(Number(reminders.rows[0].count), 1);
      await service.decideOccurrence(
        actor,
        occurrenceId,
        {
          decisao: 'RECUSAR',
          observacao: 'Registro duplicado, atendimento permanece na ocorrência original.',
        },
        audit,
      );
      const closed = await client.query(
        'SELECT status,treatment_scheduled_for FROM maintenance.operational_occurrences WHERE id=$1',
        [occurrenceId],
      );
      assert.equal(closed.rows[0].status, 'CANCELLED');
      assert.equal(closed.rows[0].treatment_scheduled_for, null);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);

test(
  'solicitação PCM persiste notificação e auditoria na mesma transação',
  { skip: !process.env.PCM_IMPORT_TEST_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PCM_IMPORT_TEST_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query(
        "SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1",
      );
      const account = identity.rows[0];
      assert.ok(account);
      const work = await client.query(
        `INSERT INTO maintenance.work_orders
      (tenant_id,code,asset_id,maintenance_plan_version_id,origin_type,work_type,title,description,requester_id,responsible_id,content_hash_sha256)
      SELECT $1,$2,plan.asset_id,version.id,'PCM','PREVENTIVE','Teste de acompanhamento','Registro temporário revertido ao final do teste',$3,$3,repeat('a',64)
      FROM maintenance.maintenance_plans plan JOIN maintenance.maintenance_plan_versions version ON version.maintenance_plan_id=plan.id
      WHERE plan.tenant_id=$1 LIMIT 1 RETURNING id`,
        [account.tenant_id, `TEST-${randomUUID()}`, account.id],
      );
      assert.ok(
        work.rows[0],
        'É necessário um plano cadastrado na homologação para este contrato.',
      );
      const workId = work.rows[0].id;
      await client.query('UPDATE maintenance.work_orders SET responsible_id=$1 WHERE id=$2', [
        account.id,
        workId,
      ]);
      await client.query('SET LOCAL ROLE fab_control_api_local');
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [account.tenant_id, account.id],
      );
      const db = {
        withTransaction: async (_context: unknown, run: (connection: typeof client) => unknown) =>
          run(client),
      } as Database;
      const service = new OperationsService(db, {} as ObjectStorage);
      const result = await service.requestWorkOrderUpdate(
        { id: account.id, tenantId: account.tenant_id } as AuthenticatedUser,
        workId,
        'Informe a justificativa do atraso e a previsão de retomada.',
        { traceId: randomUUID(), userAgent: null, ipAddress: '127.0.0.1', roleSnapshot: 'PCM' },
      );
      assert.equal(result.sent, true);
      assert.ok(result.recipients >= 1);
      const notice = await client.query(
        "SELECT n.id FROM workflow.notifications n JOIN workflow.notification_recipients r ON r.notification_id=n.id WHERE n.entity_id=$1 AND n.notification_type='PCM_WORK_ORDER_FOLLOWUP' AND r.user_id=$2",
        [workId, account.id],
      );
      assert.ok(notice.rows.length > 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);

test(
  'checklist publicado gera um único plano de execução e preserva suas pré-configurações',
  { skip: !process.env.PCM_IMPORT_TEST_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PCM_IMPORT_TEST_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query(
        "SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1",
      );
      const account = identity.rows[0];
      assert.ok(account);
      const template = await client.query(
        `INSERT INTO maintenance.checklist_templates (tenant_id,code,name,asset_id,checklist_type,criticality,lifecycle_status,created_by)
      SELECT $1,$2,'Checklist temporário de integração',id,'INSPECTION','MEDIUM','ACTIVE',$3 FROM cmms.assets WHERE tenant_id=$1 AND lifecycle_status='ACTIVE' LIMIT 1 RETURNING id`,
        [account.tenant_id, `TEST-${randomUUID()}`, account.id],
      );
      const version = await client.query(
        `INSERT INTO maintenance.checklist_template_versions (tenant_id,checklist_template_id,revision,status,signature_policy,required_signatures,segregation_required,manager_guidance,safety_requirements,content_hash_sha256,created_by,execution_defaults)
      VALUES ($1,$2,1,'DRAFT','QUALIDADE_OU_SEGURANCA',1,false,'Teste','[]',repeat('b',64),$3,'{"modo_parada":"MANDATORY_STOP","requer_bloqueio":true,"tempo_estimado_min":75}') RETURNING id`,
        [account.tenant_id, template.rows[0].id, account.id],
      );
      const versionId = version.rows[0].id;
      await client.query(
        `INSERT INTO maintenance.checklist_items (tenant_id,checklist_template_version_id,sequence,title,response_type_code,category,required,evidence_required,blocks_completion,status)
      VALUES ($1,$2,1,'Verificar condição','CONFIRMACAO','OPERACIONAL',true,false,true,'ACTIVE')`,
        [account.tenant_id, versionId],
      );
      await client.query(
        "UPDATE maintenance.checklist_template_versions SET status='APPROVED',submitted_at=clock_timestamp() WHERE id=$1",
        [versionId],
      );
      await client.query(
        "UPDATE maintenance.checklist_template_versions SET status='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
        [versionId],
      );
      await client.query('SET LOCAL ROLE fab_control_api_local');
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [account.tenant_id, account.id],
      );
      const repo = new OperationsRepository();
      const first = await repo.ensurePlanFromChecklist(
        client,
        account.tenant_id,
        account.id,
        versionId,
      );
      const second = await repo.ensurePlanFromChecklist(
        client,
        account.tenant_id,
        account.id,
        versionId,
      );
      assert.ok(first);
      assert.equal(first.id, second?.id);
      assert.equal(first.checklist_template_version_id, versionId);
      assert.equal(first.estimated_duration_minutes, 75);
      assert.equal(first.maintenance_stop_mode, 'MANDATORY_STOP');
      const db = {
        withTransaction: async (_context: unknown, run: (connection: typeof client) => unknown) =>
          run(client),
      } as Database;
      const service = new OperationsService(db, {} as ObjectStorage);
      const actor = {
        id: account.id,
        tenantId: account.tenant_id,
        roles: ['PCM'],
        capabilities: ['maintenance.work-orders.manage', 'maintenance.work-orders.release'],
      } as AuthenticatedUser;
      const audit = {
        traceId: randomUUID(),
        userAgent: null,
        ipAddress: '127.0.0.1',
        roleSnapshot: 'PCM',
      };
      const created = await service.createWorkOrder(
        actor,
        {
          checklistVersionId: versionId,
          planVersionId: null,
          assetId: null,
          assetTag: null,
          originType: 'PCM',
          originEntityId: null,
          workType: 'PREVENTIVE',
          executionMode: 'INTERNAL',
          improvementCategory: null,
          title: 'Inspeção de integração',
          description: 'Executar o checklist publicado sem revisão adicional.',
          priority: 'MEDIUM',
          responsibleId: null,
          scheduledFor: null,
          technicalAnalysis: { exige_liberacao_pos_intervencao: false },
        },
        audit,
      );
      const orderId = String(created.id);
      const approved = await service.submitForReview(
        actor,
        orderId,
        {
          signaturePolicy: 'QUALIDADE_OU_SEGURANCA',
          requiredSignatures: 1,
          firstResponseDueAt: null,
          resolutionDueAt: null,
        },
        audit,
      );
      assert.equal(approved.status, 'APPROVED');
      const released = await service.releaseWorkOrder(actor, orderId, audit);
      assert.equal(released.status, 'RELEASED');
      await client.query(
        `INSERT INTO maintenance.checklist_model_reviews (tenant_id,checklist_template_version_id,decision,justification,reviewer_id,reviewer_role_snapshot,payload_hash_sha256)
      VALUES ($1,$2,'APPROVED','Parecer autenticado de teste',$3,'Qualidade',repeat('c',64))`,
        [account.tenant_id, versionId, account.id],
      );
      let archivedFiles = 0;
      const storage = {
        storeDocument: async (input: {
          stream: AsyncIterable<Buffer>;
          originalName: string;
          mediaType: string;
        }) => {
          let content = '';
          for await (const chunk of input.stream) content += chunk.toString();
          assert.ok(content.includes('Identificador do registro'));
          archivedFiles++;
          return {
            id: randomUUID(),
            provider: 'LOCAL_PRIVATE',
            bucket: 'governed-documents',
            objectKey: `${account.tenant_id}/${randomUUID()}.csv`,
            originalName: input.originalName,
            mediaType: input.mediaType,
            byteSize: Buffer.byteLength(content),
            checksumSha256: 'd'.repeat(64),
          };
        },
        remove: async () => undefined,
      } as unknown as ObjectStorage;
      await archiveSignedRecords(db, storage, actor, audit);
      const firstArchiveCount = archivedFiles;
      await archiveSignedRecords(db, storage, actor, audit);
      assert.ok(firstArchiveCount >= 1);
      assert.equal(archivedFiles, firstArchiveCount);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);
