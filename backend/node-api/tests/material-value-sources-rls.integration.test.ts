import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import type { Environment } from '../src/config/environment.js';
import { migrateDatabase } from '../src/infrastructure/database/migrator.js';
import { createTestEnvironment } from './helpers/environment.js';

const fixturePrefix = 'TEST-MATERIAL-RLS-0035-';
const tenantA = '10000000-0000-4000-8000-000000000035';
const tenantB = '20000000-0000-4000-8000-000000000035';
const sourceA = '30000000-0000-4000-8000-000000000035';
const sourceB = '40000000-0000-4000-8000-000000000035';

interface LedgerEntry {
  readonly version: string;
  readonly checksum_sha256: string;
  readonly execution_ms: number;
}

interface SourceSnapshot {
  readonly id: string;
  readonly tenant_id: string;
  readonly category: string;
  readonly reference_used: string;
  readonly source_url: string;
  readonly observation: string | null;
  readonly deleted_at: string | null;
}

interface SecurityState {
  readonly relrowsecurity: boolean;
  readonly relforcerowsecurity: boolean;
  readonly using_expression: string;
  readonly with_check_expression: string;
}

function testEnvironment(): Environment | undefined {
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!runtimeUrl || !migrationUrl) return undefined;

  const runtimeDatabase = new URL(runtimeUrl).pathname.replace(/^\//u, '');
  const migrationDatabase = new URL(migrationUrl).pathname.replace(/^\//u, '');
  assert.equal(runtimeDatabase, migrationDatabase);
  assert.notEqual(runtimeDatabase, 'vorqix_dev');
  assert.match(runtimeDatabase, /test/u);

  return createTestEnvironment(
    runtimeUrl,
    '00000000-0000-4000-8000-000000000001',
    'material-value-sources-rls-test-tenant',
    { MIGRATION_DATABASE_URL: migrationUrl },
  );
}

async function officialChecksum(version: string): Promise<string> {
  const directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../database/postgres/migrations',
  );
  const sql = await readFile(resolve(directory, version), 'utf8');
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

function expression(value: string): string {
  let normalized = value.replace(/\s+/gu, ' ').trim();
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

async function ledgerEntry(client: PoolClient): Promise<LedgerEntry> {
  const result = await client.query<LedgerEntry>(
    `
      SELECT version, checksum_sha256, execution_ms
      FROM platform.schema_migrations
      WHERE version = '0035_material_value_sources_rls.sql'
    `,
  );
  const entry = result.rows[0];
  assert.ok(entry, 'ledger entry ausente: 0035_material_value_sources_rls.sql');
  return entry;
}

async function snapshots(client: PoolClient): Promise<readonly SourceSnapshot[]> {
  const result = await client.query<SourceSnapshot>(
    `
      SELECT
        id::text AS id,
        tenant_id::text AS tenant_id,
        category,
        reference_used,
        source_url,
        observation,
        deleted_at::text AS deleted_at
      FROM cmms.material_value_sources
      WHERE source_url LIKE $1
      ORDER BY source_url
    `,
    [`https://test.invalid/${fixturePrefix}%`],
  );
  return result.rows;
}

async function securityState(client: PoolClient): Promise<SecurityState> {
  const result = await client.query<SecurityState>(
    `
      SELECT
        table_entry.relrowsecurity,
        table_entry.relforcerowsecurity,
        pg_get_expr(policy_entry.polqual, policy_entry.polrelid) AS using_expression,
        pg_get_expr(policy_entry.polwithcheck, policy_entry.polrelid) AS with_check_expression
      FROM pg_class AS table_entry
      INNER JOIN pg_namespace AS schema_entry ON schema_entry.oid = table_entry.relnamespace
      INNER JOIN pg_policy AS policy_entry ON policy_entry.polrelid = table_entry.oid
      WHERE schema_entry.nspname = 'cmms'
        AND table_entry.relname = 'material_value_sources'
        AND policy_entry.polname = 'material_value_sources_tenant_isolation'
    `,
  );
  const state = result.rows[0];
  assert.ok(state, 'policy material_value_sources_tenant_isolation ausente');
  return state;
}

async function restoreFixture(client: PoolClient, ledger: LedgerEntry): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM cmms.material_value_sources WHERE source_url LIKE $1`,
      [`https://test.invalid/${fixturePrefix}%`],
    );
    await client.query(
      `
        INSERT INTO platform.schema_migrations (version, checksum_sha256, execution_ms)
        VALUES ($1, $2, $3)
        ON CONFLICT (version) DO UPDATE
        SET checksum_sha256 = EXCLUDED.checksum_sha256,
            execution_ms = EXCLUDED.execution_ms
      `,
      [ledger.version, ledger.checksum_sha256, ledger.execution_ms],
    );
    await client.query(`ALTER TABLE cmms.material_value_sources ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE cmms.material_value_sources FORCE ROW LEVEL SECURITY`);
    await client.query(
      `DROP POLICY IF EXISTS material_value_sources_tenant_isolation ON cmms.material_value_sources`,
    );
    await client.query(
      `
        CREATE POLICY material_value_sources_tenant_isolation
          ON cmms.material_value_sources
          USING (tenant_id = platform.current_tenant_id())
          WITH CHECK (tenant_id = platform.current_tenant_id())
      `,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

test(
  'reconcilia material_value_sources existente e aplica isolamento tenant pela 0035',
  { skip: !testEnvironment() },
  async () => {
    const environment = testEnvironment();
    if (!environment) return;

    const administrator = new Pool({ connectionString: environment.database.migrationUrl, max: 1 });
    const runtime = new Pool({ connectionString: environment.database.url, max: 1 });
    const client = await administrator.connect();
    const initialLedger = await ledgerEntry(client);

    try {
      assert.equal(
        initialLedger.checksum_sha256,
        await officialChecksum('0035_material_value_sources_rls.sql'),
      );
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query(
        `DELETE FROM cmms.material_value_sources WHERE source_url LIKE $1`,
        [`https://test.invalid/${fixturePrefix}%`],
      );
      await client.query(
        `
          INSERT INTO cmms.material_value_sources (
            id, tenant_id, category, reference_used, source_url, observation
          )
          VALUES
            ($1, $2, 'MATERIAL', 'Fixture A', $3, 'Tenant A'),
            ($4, $5, 'MATERIAL', 'Fixture B', $6, 'Tenant B')
        `,
        [
          sourceA,
          tenantA,
          `https://test.invalid/${fixturePrefix}A`,
          sourceB,
          tenantB,
          `https://test.invalid/${fixturePrefix}B`,
        ],
      );
      await client.query(
        `DELETE FROM platform.schema_migrations WHERE version = '0035_material_value_sources_rls.sql'`,
      );
      await client.query(
        `DROP POLICY IF EXISTS material_value_sources_tenant_isolation ON cmms.material_value_sources`,
      );
      await client.query(`ALTER TABLE cmms.material_value_sources NO FORCE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE cmms.material_value_sources DISABLE ROW LEVEL SECURITY`);
      await client.query('COMMIT');

      const before = await snapshots(client);
      assert.deepEqual(before.map((source) => source.id), [sourceA, sourceB]);

      const migration = await migrateDatabase(environment);
      assert.deepEqual(migration.applied, ['0035_material_value_sources_rls.sql']);
      assert.equal(
        (await ledgerEntry(client)).checksum_sha256,
        await officialChecksum('0035_material_value_sources_rls.sql'),
      );
      assert.deepEqual(await snapshots(client), before);

      const state = await securityState(client);
      assert.equal(state.relrowsecurity, true);
      assert.equal(state.relforcerowsecurity, true);
      assert.equal(expression(state.using_expression), 'tenant_id = platform.current_tenant_id()');
      assert.equal(
        expression(state.with_check_expression),
        'tenant_id = platform.current_tenant_id()',
      );

      const runtimeClient = await runtime.connect();
      try {
        const role = await runtimeClient.query<{ readonly rolbypassrls: boolean }>(
          `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        assert.equal(role.rows[0]?.rolbypassrls, false);

        await runtimeClient.query('BEGIN');
        await runtimeClient.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        const visible = await runtimeClient.query<{ readonly id: string }>(
          `SELECT id::text AS id FROM cmms.material_value_sources WHERE source_url LIKE $1`,
          [`https://test.invalid/${fixturePrefix}%`],
        );
        assert.deepEqual(visible.rows.map((source) => source.id), [sourceA]);
        const deleted = await runtimeClient.query(
          `DELETE FROM cmms.material_value_sources WHERE id = $1`,
          [sourceB],
        );
        assert.equal(deleted.rowCount, 0);
        await runtimeClient.query('COMMIT');

        await runtimeClient.query('BEGIN');
        await runtimeClient.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        await assert.rejects(
          runtimeClient.query(
            `
              INSERT INTO cmms.material_value_sources (
                id, tenant_id, category, reference_used, source_url
              ) VALUES ($1, $2, 'MATERIAL', 'Cross tenant', $3)
            `,
            ['50000000-0000-4000-8000-000000000035', tenantB, `https://test.invalid/${fixturePrefix}C`],
          ),
        );
        await runtimeClient.query('ROLLBACK');

        await runtimeClient.query('BEGIN');
        await runtimeClient.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        await assert.rejects(
          runtimeClient.query(
            `UPDATE cmms.material_value_sources SET tenant_id = $2 WHERE id = $1`,
            [sourceA, tenantB],
          ),
        );
        await runtimeClient.query('ROLLBACK');
      } finally {
        runtimeClient.release();
      }
    } finally {
      await restoreFixture(client, initialLedger);
      client.release();
      await administrator.end();
      await runtime.end();
    }
  },
);
