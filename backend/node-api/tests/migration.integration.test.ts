import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Pool } from 'pg';

import {
  assertLoaderCoverage,
  executeMigration,
} from '../src/infrastructure/migration/migration.service.js';
import { captureSourceSnapshot } from '../src/infrastructure/migration/source-snapshot.js';
import { createMigrationFixture } from './helpers/migration-fixture.js';

const databaseUrl = process.env.TEST_MIGRATION_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = '00000000-0000-4000-8000-000000000006';

test('o contrato possui um tratamento explícito para cada uma das 48 abas', () => {
  assert.doesNotThrow(() => assertLoaderCoverage());
});

test(
  'migra e reconcilia o workbook integral sem duplicar dados em uma nova execução',
  { skip: !integrationEnabled },
  async () => {
    if (!databaseUrl) return;
    const directory = await mkdtemp(join(tmpdir(), 'fab-control-migration-'));
    const source = join(directory, 'legacy-1.4.0.xlsx');
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const countEntities = async (): Promise<Record<string, string>> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const result = await client.query<{
          readonly assets: string;
          readonly workOrders: string;
          readonly signatures: string;
          readonly notifications: string;
        }>(
          `SELECT
             (SELECT count(*) FROM cmms.assets WHERE tenant_id=$1)::text AS assets,
             (SELECT count(*) FROM maintenance.work_orders WHERE tenant_id=$1)::text AS "workOrders",
             (SELECT count(*) FROM workflow.technical_signatures WHERE tenant_id=$1)::text AS signatures,
             (SELECT count(*) FROM workflow.notifications WHERE tenant_id=$1)::text AS notifications`,
          [tenantId],
        );
        await client.query('COMMIT');
        return result.rows[0] as unknown as Record<string, string>;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      await createMigrationFixture(source);
      const snapshot = await captureSourceSnapshot(source);
      assert.equal(snapshot.sheets.length, 48);
      assert.equal(snapshot.unknownSheets.length, 0);

      const first = await executeMigration(pool, {
        source,
        tenantId,
        environment: 'HOMOLOGATION',
        sourceRelease: '1.4.0',
        targetSchemaVersion: 'postgres-0017',
        initiatedBy: 'node-test',
        mode: 'FULL',
      });
      assert.equal(first.status, 'COMPLETED', first.error);
      assert.equal(first.sourceRows, first.migratedRows + first.skippedRows);
      assert.ok(first.reconciliations.every((item) => item.passed));

      const countsBefore = await countEntities();

      const second = await executeMigration(pool, {
        source,
        tenantId,
        environment: 'HOMOLOGATION',
        sourceRelease: '1.4.0',
        targetSchemaVersion: 'postgres-0017',
        initiatedBy: 'node-test-rerun',
        mode: 'FULL',
      });
      assert.equal(second.status, 'COMPLETED', second.error);

      const countsAfter = await countEntities();
      assert.deepEqual(countsAfter, countsBefore);
      assert.deepEqual(countsAfter, {
        assets: '1',
        workOrders: '1',
        signatures: '1',
        notifications: '1',
      });
    } finally {
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
