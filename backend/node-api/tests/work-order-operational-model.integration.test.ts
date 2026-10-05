import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const enabled = Boolean(runtimeUrl && migrationUrl);

interface Fixture {
  readonly tenantId: string;
  readonly userId: string;
  readonly assetId: string;
  readonly componentId: string;
  readonly planVersionId: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function expectDatabaseRejection(
  client: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await client.query('SAVEPOINT expected_model_rejection');
  let rejection: unknown;
  try { await operation(); } catch (error) { rejection = error; }
  await client.query('ROLLBACK TO SAVEPOINT expected_model_rejection');
  await client.query('RELEASE SAVEPOINT expected_model_rejection');
  assert.ok(rejection instanceof Error, 'A operação inválida deveria ser rejeitada.');
  const databaseError = rejection as Error & { code?: string };
  assert.equal(databaseError.code, code, `Erro inesperado da operação: ${databaseError.message}`);
}

async function createFixture(client: PoolClient, label: string): Promise<Fixture> {
  const fixture = {
    tenantId: randomUUID(), userId: randomUUID(), assetId: randomUUID(), componentId: randomUUID(),
    planVersionId: randomUUID(),
  };
  const plantId = randomUUID();
  const sectorId = randomUUID();
  const lineId = randomUUID();
  const checklistId = randomUUID();
  const checklistVersionId = randomUUID();
  const checklistItemId = randomUUID();
  const planId = randomUUID();

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
       VALUES ($1,$2,$2,$3,'DEVELOPMENT','ACTIVE')`,
      [fixture.tenantId, `Tenant numeração ${label}`, `numbering-${label.toLowerCase()}-${randomUUID()}`],
    );
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [fixture.tenantId]);
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,$3,$4,$5,false)`,
      [fixture.userId, fixture.tenantId, `USR-${label}`, `Usuário ${label}`, `${label}-${randomUUID()}@test.invalid`],
    );
    await client.query(`INSERT INTO cmms.plants (id,tenant_id,tag,name) VALUES ($1,$2,$3,$4)`, [plantId, fixture.tenantId, `PLT-${label}`, `Planta ${label}`]);
    await client.query(`INSERT INTO cmms.sectors (id,tenant_id,plant_id,tag,name) VALUES ($1,$2,$3,$4,$5)`, [sectorId, fixture.tenantId, plantId, `SEC-${label}`, `Setor ${label}`]);
    await client.query(`INSERT INTO cmms.lines (id,tenant_id,sector_id,tag,name) VALUES ($1,$2,$3,$4,$5)`, [lineId, fixture.tenantId, sectorId, `LIN-${label}`, `Linha ${label}`]);
    await client.query(
      `INSERT INTO cmms.assets
       (id,tenant_id,line_id,tag,qr_payload,name,asset_type,manufacturer,model,serial_number,criticality,lifecycle_status,technical_location)
       VALUES ($1,$2,$3,$4,$5,$6,'TEST','VORQIX','V1',$7,'MEDIUM','ACTIVE',$8)`,
      [fixture.assetId, fixture.tenantId, lineId, `EQ-${label}`, `TEST:${label}`, `Equipamento ${label}`, `SER-${label}`, `Linha ${label}`],
    );
    await client.query(
      `INSERT INTO cmms.components
       (id,tenant_id,asset_id,tag,qr_payload,name,component_type,criticality,lifecycle_status)
       VALUES ($1,$2,$3,$4,$5,$6,'TEST','MEDIUM','ACTIVE')`,
      [fixture.componentId, fixture.tenantId, fixture.assetId, `CMP-${label}`, `TEST:CMP:${label}`, `Componente ${label}`],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_templates
       (id,tenant_id,code,name,asset_id,component_id,checklist_type,criticality,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PREVENTIVE','MEDIUM',$7)`,
      [checklistId, fixture.tenantId, `CHK-${label}`, `Checklist ${label}`, fixture.assetId, fixture.componentId, fixture.userId],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_template_versions
       (id,tenant_id,checklist_template_id,revision,status,signature_policy,required_signatures,segregation_required,content_hash_sha256,created_by,submitted_at)
       VALUES ($1,$2,$3,1,'DRAFT','QUALIDADE',1,false,$4,$5,clock_timestamp())`,
      [checklistVersionId, fixture.tenantId, checklistId, digest(`checklist-${label}`), fixture.userId],
    );
    await client.query(
      `INSERT INTO maintenance.checklist_items
       (id,tenant_id,checklist_template_version_id,sequence,title,instruction,response_type_code,required,evidence_required,blocks_completion)
       VALUES ($1,$2,$3,1,'Confirmar','Confirmar execução.','CONFIRMACAO',true,false,true)`,
      [checklistItemId, fixture.tenantId, checklistVersionId],
    );
    await client.query(`UPDATE maintenance.checklist_template_versions SET status='APPROVED' WHERE id=$1`, [checklistVersionId]);
    await client.query(`UPDATE maintenance.checklist_template_versions SET status='PUBLISHED',published_at=clock_timestamp() WHERE id=$1`, [checklistVersionId]);
    await client.query(
      `INSERT INTO maintenance.maintenance_plans (id,tenant_id,code,name,asset_id,component_id,plan_type,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PREVENTIVE',$7)`,
      [planId, fixture.tenantId, `PLN-${label}`, `Plano ${label}`, fixture.assetId, fixture.componentId, fixture.userId],
    );
    await client.query(
      `INSERT INTO maintenance.maintenance_plan_versions
       (id,tenant_id,maintenance_plan_id,checklist_template_version_id,revision,status,trigger_type,recurrence_days,
        estimated_duration_minutes,content_hash_sha256,created_by,published_at)
       VALUES ($1,$2,$3,$4,1,'PUBLISHED','PERIODICITY',30,30,$5,$6,clock_timestamp())`,
      [fixture.planVersionId, fixture.tenantId, planId, checklistVersionId, digest(`plan-${label}`), fixture.userId],
    );
    await client.query('COMMIT');
    return fixture;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function insertOrder(pool: Pool, fixture: Fixture, code: string, type = 'PREVENTIVE', mode = 'INTERNAL'): Promise<{ id: string; number: number; code: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`, [fixture.tenantId, fixture.userId]);
    const result = await client.query<{ id: string; operational_number: string; operational_code: string }>(
      `INSERT INTO maintenance.work_orders
       (tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,work_type,execution_mode,
        improvement_category,title,description,priority,requester_id,content_hash_sha256)
       VALUES ($1,$2,$3,$4,$5,'TEST',$6,$7,CASE WHEN $6='IMPROVEMENT' THEN 'OTHER' ELSE NULL END,
               'Teste de numeração','Teste concorrente e multiempresa.','LOW',$8,$9)
       RETURNING id,operational_number::text,operational_code`,
      [fixture.tenantId, code, fixture.assetId, fixture.componentId, fixture.planVersionId, type, mode, fixture.userId, digest(code)],
    );
    await client.query('COMMIT');
    return { id: result.rows[0]!.id, number: Number(result.rows[0]!.operational_number), code: result.rows[0]!.operational_code };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test('numeração operacional é atômica, independente por tenant, transacional e protegida por FORCE RLS', { skip: !enabled }, async () => {
  assert.ok(runtimeUrl);
  assert.ok(migrationUrl);
  const databaseName = new URL(runtimeUrl).pathname.replace(/^\//u, '');
  assert.notEqual(databaseName, 'vorqix_dev');
  assert.match(databaseName, /test/u);

  const administrator = new Pool({ connectionString: migrationUrl, max: 16 });
  const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
  try {
    const setup = await administrator.connect();
    let tenantA: Fixture;
    let tenantB: Fixture;
    try {
      tenantA = await createFixture(setup, 'A');
      tenantB = await createFixture(setup, 'B');
    } finally {
      setup.release();
    }

    const [ordersA, ordersB] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, (_, index) => insertOrder(administrator, tenantA, `A-${index}-${randomUUID()}`, index % 2 ? 'PREDICTIVE' : 'PREVENTIVE', (['INTERNAL', 'EXTERNAL', 'MIXED'] as const)[index % 3]))),
      Promise.all(Array.from({ length: 7 }, (_, index) => insertOrder(administrator, tenantB, `B-${index}-${randomUUID()}`))),
    ]);
    assert.deepEqual(ordersA.map(order => order.number).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.deepEqual(ordersB.map(order => order.number).sort((a, b) => a - b), Array.from({ length: 7 }, (_, index) => index + 1));
    assert.ok([...ordersA, ...ordersB].every(order => /^OS-\d{8}$/u.test(order.code)));

    const rollbackClient = await administrator.connect();
    await rollbackClient.query('BEGIN');
    await rollbackClient.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA.tenantId]);
    const rolledBack = await rollbackClient.query<{ operational_number: string }>(
      `INSERT INTO maintenance.work_orders
       (tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,work_type,title,description,priority,requester_id,content_hash_sha256)
       VALUES ($1,$2,$3,$4,$5,'TEST','PREVENTIVE','Rollback','Rollback seguro.','LOW',$6,$7)
       RETURNING operational_number::text`,
      [tenantA.tenantId, `ROLLBACK-${randomUUID()}`, tenantA.assetId, tenantA.componentId, tenantA.planVersionId, tenantA.userId, digest('rollback')],
    );
    await rollbackClient.query('ROLLBACK');
    rollbackClient.release();
    const afterRollback = await insertOrder(administrator, tenantA, `AFTER-ROLLBACK-${randomUUID()}`);
    assert.equal(afterRollback.number, Number(rolledBack.rows[0]!.operational_number));

    const retryCode = `RETRY-${randomUUID()}`;
    const firstRetry = await insertOrder(administrator, tenantA, retryCode);
    const retryClient = await administrator.connect();
    await retryClient.query('BEGIN');
    await retryClient.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA.tenantId]);
    const beforeRetry = await retryClient.query<{ next_number: string }>(`SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`, [tenantA.tenantId]);
    const retried = await retryClient.query<{ operational_number: string }>(
      `INSERT INTO maintenance.work_orders
       (tenant_id,code,asset_id,component_id,maintenance_plan_version_id,origin_type,work_type,title,description,priority,requester_id,content_hash_sha256)
       VALUES ($1,$2,$3,$4,$5,'TEST','PREVENTIVE','Retry','Retry idempotente.','LOW',$6,$7)
       ON CONFLICT (tenant_id,code) DO UPDATE SET updated_at=clock_timestamp()
       RETURNING operational_number::text`,
      [tenantA.tenantId, retryCode, tenantA.assetId, tenantA.componentId, tenantA.planVersionId, tenantA.userId, digest(retryCode)],
    );
    const afterRetry = await retryClient.query<{ next_number: string }>(`SELECT next_number::text FROM maintenance.work_order_number_counters WHERE tenant_id=$1`, [tenantA.tenantId]);
    await retryClient.query('COMMIT');
    retryClient.release();
    assert.equal(Number(retried.rows[0]!.operational_number), firstRetry.number);
    assert.equal(afterRetry.rows[0]!.next_number, beforeRetry.rows[0]!.next_number);

    let workOrderId = '';
    const externalServiceId = randomUUID();
    const improvementRequestId = randomUUID();
    const runtimeExternalServiceId = randomUUID();
    const runtimeImprovementRequestId = randomUUID();
    const costClient = await administrator.connect();
    try {
      await costClient.query('BEGIN');
      await costClient.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`, [tenantA.tenantId, tenantA.userId]);
    const workOrder = await costClient.query<{ id: string }>(`SELECT id FROM maintenance.work_orders WHERE tenant_id=$1 AND code=$2`, [tenantA.tenantId, retryCode]);
    workOrderId = workOrder.rows[0]!.id;
    await costClient.query(`UPDATE maintenance.work_orders SET status='RELEASED',released_at=clock_timestamp() WHERE id=$1`, [workOrderId]);
    const actionId = randomUUID();
    const executionId = randomUUID();
    const materialId = randomUUID();
    const usageId = randomUUID();
    await costClient.query(
      `INSERT INTO maintenance.work_order_actions
       (id,tenant_id,work_order_id,asset_id,component_id,maintenance_plan_version_id,origin,action_type,title,description,priority,status)
       VALUES ($1,$2,$3,$4,$5,$6,'TEST','MAINTENANCE','Ação de custo','Ação para validar custo.','LOW','READY')`,
      [actionId, tenantA.tenantId, workOrderId, tenantA.assetId, tenantA.componentId, tenantA.planVersionId],
    );
    await costClient.query(
      `INSERT INTO maintenance.executions
       (id,tenant_id,work_order_action_id,work_order_id,asset_id,component_id,operator_id,status,result,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS','Em execução sem preço.',NULL)`,
      [executionId, tenantA.tenantId, actionId, workOrderId, tenantA.assetId, tenantA.componentId, tenantA.userId],
    );
    await costClient.query(
      `INSERT INTO cmms.materials (id,tenant_id,sku,name,unit,current_stock,minimum_stock,unit_cost)
       VALUES ($1,$2,$3,'Rolamento sem preço','UN',8,1,NULL)`,
      [materialId, tenantA.tenantId, `MAT-${randomUUID()}`],
    );
    await costClient.query(
      `INSERT INTO maintenance.material_usage
       (id,tenant_id,execution_id,work_order_action_id,material_id,quantity,unit,user_id,
        sku_snapshot,material_name_snapshot,unit_cost,total_cost)
       VALUES ($1,$2,$3,$4,$5,2,'UN',$6,'MAT-TEST','Rolamento sem preço',NULL,NULL)`,
      [usageId, tenantA.tenantId, executionId, actionId, materialId, tenantA.userId],
    );
    const pendingCost = await costClient.query<{ realized_total: string; materials_pending_price: number }>(
      `SELECT realized_total::text,materials_pending_price FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`,
      [workOrderId],
    );
    assert.equal(Number(pendingCost.rows[0]!.realized_total), 0);
    assert.equal(pendingCost.rows[0]!.materials_pending_price, 1);
    await costClient.query(`UPDATE maintenance.material_usage SET unit_cost=50,total_cost=100 WHERE id=$1`, [usageId]);
    await costClient.query(
      `INSERT INTO maintenance.external_services
       (id,tenant_id,work_order_id,provider_name,description,amount,recorded_by)
       VALUES ($4,$1,$2,'Prestador A','Serviço externo principal',250,$3),
              ($5,$1,$2,'Prestador B','Serviço externo ainda sem preço',NULL,$3)`,
      [tenantA.tenantId, workOrderId, tenantA.userId, externalServiceId, randomUUID()],
    );
    await costClient.query(
      `INSERT INTO maintenance.improvement_requests
       (id,tenant_id,asset_id,category,suggestion,reason,requested_by)
       VALUES ($1,$2,$3,'OTHER','Melhoria isolada','Solicitação para teste RLS de tenants.',$4)`,
      [improvementRequestId, tenantA.tenantId, tenantA.assetId, tenantA.userId],
    );
    const consolidated = await costClient.query<{
      material_cost: string; external_service_cost: string; realized_total: string;
      materials_pending_price: number; external_services_pending_price: number;
    }>(
      `SELECT material_cost::text,external_service_cost::text,realized_total::text,
              materials_pending_price,external_services_pending_price
         FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`,
      [workOrderId],
    );
    assert.equal(Number(consolidated.rows[0]!.material_cost), 100);
    assert.equal(Number(consolidated.rows[0]!.external_service_cost), 250);
    assert.equal(Number(consolidated.rows[0]!.realized_total), 350);
    assert.equal(consolidated.rows[0]!.materials_pending_price, 0);
    assert.equal(consolidated.rows[0]!.external_services_pending_price, 1);
    const protectedTables = await costClient.query<{
      readonly relname: string;
      readonly relrowsecurity: boolean;
      readonly relforcerowsecurity: boolean;
    }>(
      `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity
         FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='maintenance'
          AND relation.relname=ANY($1::text[]) ORDER BY relation.relname`,
      [['work_order_number_counters', 'external_services', 'improvement_requests']],
    );
    assert.equal(protectedTables.rows.length, 3);
    assert.ok(protectedTables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity));
    const temporaryPolicy = await costClient.query(
      `SELECT policyname FROM pg_policies
        WHERE policyname='migration_0039_tenant_enumeration'`,
    );
    assert.equal(temporaryPolicy.rowCount, 0);
    const newPolicies = await costClient.query<{ readonly policyname: string; readonly qual: string | null }>(
      `SELECT policyname,qual FROM pg_policies
        WHERE schemaname='maintenance'
          AND tablename=ANY($1::text[])`,
      [['work_order_number_counters', 'external_services', 'improvement_requests']],
    );
    assert.ok(newPolicies.rows.every((policy) => (policy.qual ?? '').replace(/[\s()]/gu, '').toLowerCase() !== 'true'));
      await costClient.query('COMMIT');
    } catch (error) {
      await costClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      costClient.release();
    }

    const runtimeClient = await runtime.connect();
    const role = await runtimeClient.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
    const runtimeRole = role.rows[0];
    assert.ok(runtimeRole);
    assert.equal(runtimeRole.rolsuper, false);
    assert.equal(runtimeRole.rolbypassrls, false);
    try {
      await runtimeClient.query('BEGIN');
      await runtimeClient.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`, [tenantA.tenantId, tenantA.userId]);
      const own = await runtimeClient.query(`SELECT id FROM maintenance.work_orders WHERE tenant_id=$1`, [tenantA.tenantId]);
      const foreign = await runtimeClient.query(`SELECT id FROM maintenance.work_orders WHERE tenant_id=$1`, [tenantB.tenantId]);
      assert.ok(own.rowCount && own.rowCount > 0);
      assert.equal(foreign.rowCount, 0);
      assert.equal((await runtimeClient.query(`SELECT id FROM maintenance.external_services WHERE id=$1`, [externalServiceId])).rowCount, 1);
      assert.equal((await runtimeClient.query(`SELECT id FROM maintenance.improvement_requests WHERE id=$1`, [improvementRequestId])).rowCount, 1);
      assert.equal((await runtimeClient.query(`SELECT work_order_id FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`, [workOrderId])).rowCount, 1);
      await runtimeClient.query(
        `INSERT INTO maintenance.external_services (id,tenant_id,work_order_id,provider_name,description,amount,recorded_by)
         VALUES ($1,$2,$3,'Prestador Tenant A','Registro criado pelo runtime A',10,$4)`,
        [runtimeExternalServiceId, tenantA.tenantId, workOrderId, tenantA.userId],
      );
      await runtimeClient.query(
        `INSERT INTO maintenance.improvement_requests (id,tenant_id,asset_id,category,suggestion,reason,requested_by)
         VALUES ($1,$2,$3,'OTHER','Melhoria Tenant A','Registro criado pelo runtime A.',$4)`,
        [runtimeImprovementRequestId, tenantA.tenantId, tenantA.assetId, tenantA.userId],
      );
      await runtimeClient.query('COMMIT');
    } catch (error) {
      await runtimeClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      runtimeClient.release();
    }

    const tenantBClient = await runtime.connect();
    try {
      await tenantBClient.query('BEGIN');
      await tenantBClient.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`, [tenantB.tenantId, tenantB.userId]);
      assert.equal((await tenantBClient.query(`SELECT id FROM maintenance.external_services WHERE id=$1`, [externalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`SELECT id FROM maintenance.external_services WHERE id=$1`, [runtimeExternalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.external_services SET notes='cross-tenant' WHERE id=$1`, [externalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.external_services SET notes='cross-tenant' WHERE id=$1`, [runtimeExternalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.external_services SET work_order_id=$2 WHERE id=$1`, [externalServiceId, ordersB[0]!.id])).rowCount, 0);
      assert.equal((await tenantBClient.query(`DELETE FROM maintenance.external_services WHERE id=$1`, [externalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`DELETE FROM maintenance.external_services WHERE id=$1`, [runtimeExternalServiceId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`SELECT id FROM maintenance.improvement_requests WHERE id=$1`, [improvementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`SELECT id FROM maintenance.improvement_requests WHERE id=$1`, [runtimeImprovementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.improvement_requests SET status='REJECTED' WHERE id=$1`, [improvementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.improvement_requests SET status='REJECTED' WHERE id=$1`, [runtimeImprovementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.improvement_requests SET status='CONVERTED',converted_work_order_id=$2 WHERE id=$1`, [improvementRequestId, ordersB[0]!.id])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.improvement_requests SET status='CONVERTED',converted_work_order_id=$2 WHERE id=$1`, [runtimeImprovementRequestId, ordersB[0]!.id])).rowCount, 0);
      assert.equal((await tenantBClient.query(`DELETE FROM maintenance.improvement_requests WHERE id=$1`, [improvementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`DELETE FROM maintenance.improvement_requests WHERE id=$1`, [runtimeImprovementRequestId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`SELECT work_order_id FROM maintenance.work_order_realized_costs WHERE work_order_id=$1`, [workOrderId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`SELECT tenant_id FROM maintenance.work_order_number_counters WHERE tenant_id=$1`, [tenantA.tenantId])).rowCount, 0);
      assert.equal((await tenantBClient.query(`UPDATE maintenance.work_order_number_counters SET next_number=next_number+1 WHERE tenant_id=$1`, [tenantA.tenantId])).rowCount, 0);
      assert.equal((await tenantBClient.query(
        `DELETE FROM maintenance.work_order_number_counters WHERE tenant_id=$1`,
        [tenantA.tenantId],
      )).rowCount, 0);
      await expectDatabaseRejection(tenantBClient, () => tenantBClient.query(
        `INSERT INTO maintenance.external_services (tenant_id,work_order_id,provider_name,description,recorded_by)
         VALUES ($1,$2,'Prestador teste','Associação cross-tenant',$3)`,
        [tenantA.tenantId, ordersB[0]!.id, tenantB.userId],
      ), '42501');
      await expectDatabaseRejection(tenantBClient, () => tenantBClient.query(
        `INSERT INTO maintenance.work_order_number_counters (tenant_id,next_number) VALUES ($1,1)`,
        [tenantA.tenantId],
      ), '42501');
      await expectDatabaseRejection(tenantBClient, () => tenantBClient.query(
        `INSERT INTO maintenance.external_services (tenant_id,work_order_id,provider_name,description,recorded_by)
         VALUES ($1,$2,'Prestador teste','OS pertence ao tenant A',$3)`,
        [tenantB.tenantId, workOrderId, tenantB.userId],
      ), '23503');
      await expectDatabaseRejection(tenantBClient, () => tenantBClient.query(
        `INSERT INTO maintenance.improvement_requests (tenant_id,asset_id,category,suggestion,reason,requested_by)
         VALUES ($1,$2,'OTHER','Solicitação cruzada','Ativo pertence ao tenant A.',$3)`,
        [tenantB.tenantId, tenantA.assetId, tenantB.userId],
      ), '23503');
      await expectDatabaseRejection(tenantBClient, () => tenantBClient.query(
        `INSERT INTO maintenance.improvement_requests (tenant_id,asset_id,category,suggestion,reason,requested_by)
         VALUES ($1,$2,'OTHER','Inserção cruzada','Contexto do tenant B.',$3)`,
        [tenantA.tenantId, tenantA.assetId, tenantA.userId],
      ), '42501');
      await tenantBClient.query('ROLLBACK');
    } finally {
      tenantBClient.release();
    }
  } finally {
    await runtime.end();
    await administrator.end();
  }
});
