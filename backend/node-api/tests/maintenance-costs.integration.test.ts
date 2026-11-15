import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { loadPcmManagement } from '../src/modules/monitoring/pcm-management.js';
import { recordHourlyRate } from '../src/modules/operations/labor-costs.js';
import { OperationsRepository } from '../src/modules/operations/operations.repository.js';
import { OperationsService } from '../src/modules/operations/operations.service.js';
import type { Database } from '../src/infrastructure/database/database.js';
import type { ObjectStorage } from '../src/infrastructure/storage/object-storage.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';

const url = process.env.COST_TEST_DATABASE_URL;
const tenant = process.env.COST_TEST_TENANT_ID;
test(
  'custos: consultas reais, vigência, fotografia imutável e isolamento, sem persistir dados',
  { skip: !url || !tenant },
  async () => {
    const pool = new Pool({ connectionString: url });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      const q = {
        assetId: null,
        startAt: new Date(Date.now() - 366 * 86400000).toISOString(),
        endAt: new Date().toISOString(),
        rankingLimit: 10,
      };
      const report = await loadPcmManagement(c, q);
      assert.equal(report.metas.length, 2);
      assert.ok(Array.isArray(report.custos_linhas));
      for (const goal of report.metas) {
        assert.ok(
          goal.cumprimento_percentual === null ||
            (goal.cumprimento_percentual >= 0 && goal.cumprimento_percentual <= 100),
        );
      }
      const fixture = await c.query(
        `SELECT i.*,e.work_order_id FROM maintenance.execution_participant_work_intervals i
 JOIN maintenance.executions e ON e.id=i.execution_id AND e.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.ended_at IS NOT NULL LIMIT 1`,
        [tenant],
      );
      assert.ok(fixture.rows[0], 'Este teste exige um intervalo encerrado de homologação.');
      const f = fixture.rows[0];
      const laborBefore = Number(
        (
          await c.query(
            'SELECT internal_labor_cost FROM maintenance.work_order_labor_costs WHERE work_order_id=$1',
            [f.work_order_id],
          )
        ).rows[0]?.internal_labor_cost ?? 0,
      );
      const repository = new OperationsRepository();
      const database: Pick<Database, 'withTransaction'> = {
        withTransaction: async (_context, operation) => operation(c),
      };
      const operations = new OperationsService(database as Database, {} as ObjectStorage);
      const actor = { id: f.user_id, tenantId: tenant } as AuthenticatedUser;
      const audit = {
        traceId: randomUUID(),
        roleSnapshot: 'PCM',
        ipAddress: '127.0.0.1',
        userAgent: 'transactional-test',
      };
      await operations.saveExternalBudget(actor, report.mes_atual, 1000, audit);
      await operations.saveExternalBudget(actor, report.mes_atual, 1200, audit);
      const budgetReport = await loadPcmManagement(c, q);
      assert.equal(
        Number(
          budgetReport.orcamentos_externos.find((b: { mes: string }) => b.mes === report.mes_atual)
            .valor,
        ),
        1200,
      );
      const internal = await c.query(
        "SELECT id FROM maintenance.work_orders WHERE tenant_id=$1 AND execution_mode='INTERNAL' AND status<>'CANCELLED' LIMIT 1",
        [tenant],
      );
      assert.ok(internal.rows[0]);
      await operations.enableExternalWork(
        actor,
        internal.rows[0].id,
        'Usinagem externa identificada durante diagnóstico de teste.',
        audit,
      );
      assert.equal(
        (
          await c.query('SELECT execution_mode FROM maintenance.work_orders WHERE id=$1', [
            internal.rows[0].id,
          ])
        ).rows[0].execution_mode,
        'MIXED',
      );
      const service = await repository.createExternalService(
        c,
        tenant!,
        f.work_order_id,
        f.user_id,
        {
          providerName: 'Prestador de teste transacional',
          description: 'Somente mão de obra',
          amount: 123.45,
          serviceDate: null,
          notes: null,
          costCategory: 'LABOR',
        },
      );
      const savedService = (await repository.listExternalServices(c, f.work_order_id)).find(
        (row) => row.id === service.id,
      );
      assert.equal(savedService?.categoria_custo, 'LABOR');
      const legacyService = await repository.createExternalService(
        c,
        tenant!,
        f.work_order_id,
        f.user_id,
        {
          providerName: 'Fatura não discriminada',
          description: 'Peças e serviços sem separação',
          amount: 50,
          serviceDate: null,
          notes: null,
        },
      );
      assert.equal(
        (await repository.listExternalServices(c, f.work_order_id)).find(
          (row) => row.id === legacyService.id,
        )?.categoria_custo,
        'UNCLASSIFIED',
      );
      await c.query(
        "UPDATE maintenance.external_services SET created_at=transaction_timestamp()-interval '1 minute' WHERE id=ANY($1::uuid[])",
        [[service.id, legacyService.id]],
      );
      const eventsReport = await loadPcmManagement(c, {
        ...q,
        endAt: new Date(Date.now() + 1000).toISOString(),
      });
      assert.ok(
        eventsReport.lancamentos.some(
          (row: { provider: string; category: string; amount: number }) =>
            row.provider === 'Prestador de teste transacional' &&
            row.category === 'EXTERNAL_LABOR' &&
            Number(row.amount) === 123.45,
        ),
      );
      const currentExternal = eventsReport.externos_mensais.find(
        (m: { mes: string }) => m.mes === report.mes_atual,
      );
      const previousExternal = report.externos_mensais.find(
        (m: { mes: string }) => m.mes === report.mes_atual,
      );
      assert.ok(
        Math.abs(
          Number(currentExternal.mao_obra) - Number(previousExternal?.mao_obra ?? 0) - 123.45,
        ) < 0.001,
        'Fatura mista não entra como mão de obra externa.',
      );
      await recordHourlyRate(c, tenant!, f.user_id, {
        userId: f.user_id,
        hourlyCost: 60,
        effectiveFrom: null,
      });
      const insert = await c.query(
        `INSERT INTO maintenance.execution_participant_work_intervals(tenant_id,participant_id,execution_id,user_id,started_at,ended_at,ended_reason)
 VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 second',clock_timestamp()+interval '3601 seconds','COMPLETED') RETURNING id,hourly_cost_snapshot`,
        [tenant, f.participant_id, f.execution_id, f.user_id],
      );
      assert.equal(Number(insert.rows[0].hourly_cost_snapshot), 60);
      await recordHourlyRate(c, tenant!, f.user_id, {
        userId: f.user_id,
        hourlyCost: 90,
        effectiveFrom: null,
      });
      await c.query(
        'UPDATE maintenance.execution_participant_work_intervals SET hourly_cost_snapshot=90 WHERE id=$1',
        [insert.rows[0].id],
      );
      const saved = await c.query(
        'SELECT hourly_cost_snapshot FROM maintenance.execution_participant_work_intervals WHERE id=$1',
        [insert.rows[0].id],
      );
      assert.equal(
        Number(saved.rows[0].hourly_cost_snapshot),
        60,
        'Reajuste não altera intervalos anteriores.',
      );
      const next = await c.query(
        `INSERT INTO maintenance.execution_participant_work_intervals(tenant_id,participant_id,execution_id,user_id,started_at,ended_at,ended_reason)
 VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 second',clock_timestamp()+interval '3602 seconds','COMPLETED') RETURNING hourly_cost_snapshot`,
        [tenant, f.participant_id, f.execution_id, f.user_id],
      );
      assert.equal(Number(next.rows[0].hourly_cost_snapshot), 90);
      const laborAfter = Number(
        (
          await c.query(
            'SELECT internal_labor_cost FROM maintenance.work_order_labor_costs WHERE work_order_id=$1',
            [f.work_order_id],
          )
        ).rows[0].internal_labor_cost,
      );
      assert.ok(
        Math.abs(laborAfter - laborBefore - 150) < 0.01,
        'Uma hora a 60 e outra a 90 somam 150, sem recalcular intervalos antigos.',
      );
      await c.query('SAVEPOINT invalid_rate');
      await assert.rejects(
        recordHourlyRate(c, tenant!, f.user_id, {
          userId: f.user_id,
          hourlyCost: 1,
          effectiveFrom: '2000-01-01T00:00:00Z',
        }),
      );
      await c.query('ROLLBACK TO SAVEPOINT invalid_rate');
      // Runtime credentials must honor RLS, unlike the database owner.
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [randomUUID()]);
      const isolated = await c.query('SELECT id FROM maintenance.technician_hourly_rates');
      assert.equal(isolated.rowCount, 0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
      await pool.end();
    }
  },
);
