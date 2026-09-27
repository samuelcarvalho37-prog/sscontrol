import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { type Environment } from '../src/config/environment.js';
import { migrateDatabase } from '../src/infrastructure/database/migrator.js';
import { createTestEnvironment } from './helpers/environment.js';

const legacy0033Checksum =
  'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8';
const fixturePrefix = 'TEST-LEGACY-0034-';
const tenantA = '10000000-0000-4000-8000-000000000034';
const tenantB = '20000000-0000-4000-8000-000000000034';
const reportA = '30000000-0000-4000-8000-000000000034';
const reportB = '40000000-0000-4000-8000-000000000034';

interface LedgerEntry {
  readonly version: string;
  readonly checksum_sha256: string;
  readonly execution_ms: number;
}

interface ReportSnapshot {
  readonly id: string;
  readonly tenant_id: string;
  readonly technical_signature_id: string;
  readonly work_order_id: string;
  readonly report_type: string;
  readonly report_code: string;
  readonly technical_opinion: string;
  readonly attestation_text: string;
  readonly digital_signature_storage_key: string | null;
  readonly approved_at: string;
  readonly content_hash_sha256: string;
  readonly created_at: string;
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
    'legacy-checksum-test-tenant',
    {
    MIGRATION_DATABASE_URL: migrationUrl,
    },
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

async function ledgerEntry(client: PoolClient, version: string): Promise<LedgerEntry> {
  const result = await client.query<LedgerEntry>(
    `
      SELECT version, checksum_sha256, execution_ms
      FROM platform.schema_migrations
      WHERE version = $1
    `,
    [version],
  );
  const entry = result.rows[0];
  assert.ok(entry, `ledger entry ausente: ${version}`);
  return entry;
}

async function reportSnapshots(client: PoolClient): Promise<readonly ReportSnapshot[]> {
  const result = await client.query<ReportSnapshot>(
    `
      SELECT
        id::text AS id,
        tenant_id::text AS tenant_id,
        technical_signature_id::text AS technical_signature_id,
        work_order_id::text AS work_order_id,
        report_type,
        report_code,
        technical_opinion,
        attestation_text,
        digital_signature_storage_key,
        approved_at::text AS approved_at,
        content_hash_sha256,
        created_at::text AS created_at
      FROM workflow.technical_validation_reports
      WHERE report_code LIKE $1
      ORDER BY report_code
    `,
    [`${fixturePrefix}%`],
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
      WHERE schema_entry.nspname = 'workflow'
        AND table_entry.relname = 'technical_validation_reports'
        AND policy_entry.polname = 'technical_validation_reports_tenant_isolation'
    `,
  );
  const state = result.rows[0];
  assert.ok(state, 'policy technical_validation_reports_tenant_isolation ausente');
  return state;
}

async function resetFixture(client: PoolClient, ledger0033: LedgerEntry, ledger0034: LedgerEntry): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM workflow.technical_validation_reports WHERE report_code LIKE $1`,
      [`${fixturePrefix}%`],
    );
    await client.query(
      `
        INSERT INTO platform.schema_migrations (version, checksum_sha256, execution_ms)
        VALUES ($1, $2, $3)
        ON CONFLICT (version) DO UPDATE
        SET checksum_sha256 = EXCLUDED.checksum_sha256,
            execution_ms = EXCLUDED.execution_ms
      `,
      [ledger0033.version, ledger0033.checksum_sha256, ledger0033.execution_ms],
    );
    await client.query(
      `
        INSERT INTO platform.schema_migrations (version, checksum_sha256, execution_ms)
        VALUES ($1, $2, $3)
        ON CONFLICT (version) DO UPDATE
        SET checksum_sha256 = EXCLUDED.checksum_sha256,
            execution_ms = EXCLUDED.execution_ms
      `,
      [ledger0034.version, ledger0034.checksum_sha256, ledger0034.execution_ms],
    );
    await client.query(
      `ALTER TABLE workflow.technical_validation_reports ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE workflow.technical_validation_reports FORCE ROW LEVEL SECURITY`,
    );
    await client.query(
      `DROP POLICY IF EXISTS technical_validation_reports_tenant_isolation ON workflow.technical_validation_reports`,
    );
    await client.query(
      `
        CREATE POLICY technical_validation_reports_tenant_isolation
          ON workflow.technical_validation_reports
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
  'reconcilia o ledger legado da 0033 aplicando a 0034 sem alterar relatórios existentes',
  { skip: !testEnvironment() },
  async () => {
    const environment = testEnvironment();
    if (!environment) return;

    const administrator = new Pool({
      connectionString: environment.database.migrationUrl,
      max: 1,
    });
    const runtime = new Pool({ connectionString: environment.database.url, max: 1 });
    const client = await administrator.connect();
    const initial0033 = await ledgerEntry(client, '0033_technical_validation_reports.sql');
    const initial0034 = await ledgerEntry(
      client,
      '0034_reconcile_technical_validation_reports_rls.sql',
    );

    try {
      assert.equal(
        initial0033.checksum_sha256,
        await officialChecksum('0033_technical_validation_reports.sql'),
      );
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query(
        `DELETE FROM workflow.technical_validation_reports WHERE report_code LIKE $1`,
        [`${fixturePrefix}%`],
      );
      await client.query(
        `
          INSERT INTO workflow.technical_validation_reports (
            id, tenant_id, technical_signature_id, work_order_id, report_type,
            report_code, technical_opinion, attestation_text, content_hash_sha256
          )
          VALUES
            ($1, $2, $3, $4, 'QUALITY', $5, 'Parecer A', 'Atestado A', repeat('a', 64)),
            ($6, $7, $8, $9, 'SAFETY', $10, 'Parecer B', 'Atestado B', repeat('b', 64))
        `,
        [
          reportA,
          tenantA,
          '50000000-0000-4000-8000-000000000034',
          '60000000-0000-4000-8000-000000000034',
          `${fixturePrefix}A`,
          reportB,
          tenantB,
          '70000000-0000-4000-8000-000000000034',
          '80000000-0000-4000-8000-000000000034',
          `${fixturePrefix}B`,
        ],
      );
      await client.query(
        `UPDATE platform.schema_migrations SET checksum_sha256 = $1 WHERE version = $2`,
        [legacy0033Checksum, '0033_technical_validation_reports.sql'],
      );
      await client.query(
        `DELETE FROM platform.schema_migrations WHERE version = $1`,
        ['0034_reconcile_technical_validation_reports_rls.sql'],
      );
      await client.query(
        `DROP POLICY IF EXISTS technical_validation_reports_tenant_isolation ON workflow.technical_validation_reports`,
      );
      await client.query(
        `ALTER TABLE workflow.technical_validation_reports NO FORCE ROW LEVEL SECURITY`,
      );
      await client.query(
        `ALTER TABLE workflow.technical_validation_reports DISABLE ROW LEVEL SECURITY`,
      );
      await client.query('COMMIT');

      const reportsBefore = await reportSnapshots(client);
      assert.deepEqual(
        reportsBefore.map((report) => report.id),
        [reportA, reportB],
      );
      assert.equal(
        (await ledgerEntry(client, '0033_technical_validation_reports.sql')).checksum_sha256,
        legacy0033Checksum,
      );

      const migration = await migrateDatabase(environment);
      assert.deepEqual(migration.applied, ['0034_reconcile_technical_validation_reports_rls.sql']);

      const applied0033 = await ledgerEntry(client, '0033_technical_validation_reports.sql');
      const applied0034 = await ledgerEntry(
        client,
        '0034_reconcile_technical_validation_reports_rls.sql',
      );
      assert.equal(applied0033.checksum_sha256, legacy0033Checksum);
      assert.equal(
        applied0034.checksum_sha256,
        await officialChecksum('0034_reconcile_technical_validation_reports_rls.sql'),
      );
      assert.deepEqual(await reportSnapshots(client), reportsBefore);

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
        const visibleReports = await runtimeClient.query<{ readonly id: string }>(
          `
            SELECT id::text AS id
            FROM workflow.technical_validation_reports
            WHERE report_code LIKE $1
            ORDER BY report_code
          `,
          [`${fixturePrefix}%`],
        );
        assert.deepEqual(visibleReports.rows.map((report) => report.id), [reportA]);
        await runtimeClient.query('COMMIT');
      } catch (error) {
        await runtimeClient.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        runtimeClient.release();
      }
    } finally {
      await resetFixture(client, initial0033, initial0034);
      client.release();
      await administrator.end();
      await runtime.end();
    }
  },
);
