import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { type Environment } from '../src/config/environment.js';
import { AppError } from '../src/core/errors/app-error.js';
import { migrateDatabase } from '../src/infrastructure/database/migrator.js';
import { createTestEnvironment } from './helpers/environment.js';

const legacy0033Checksum = '288f7a0d1b56d45836891017c942b2755399e4f7e3a92a9d2a6790de7bd61753';
const fixturePrefix = 'TEST-LEGACY-0034-';
const tenantA = '10000000-0000-4000-8000-000000000034';
const tenantB = '20000000-0000-4000-8000-000000000034';
const reportA = '30000000-0000-4000-8000-000000000034';
const reportB = '40000000-0000-4000-8000-000000000034';

const historicalCrlfChecksums = [
  [
    '0019_pcm_action_assignment.sql',
    'acd2f0794f2c3bc7618543646ba81ff53d85fa74b00d00c3d73171ffcf2b5249',
  ],
  [
    '0020_fix_pcm_action_assignment.sql',
    '21e5fb863fcf4cf4d1d0a2238bfc76f11dc458b5de84bf8bf91a08fd74d5f5af',
  ],
  [
    '0021_pcm_work_order_release.sql',
    'eec4581ce1bb394b45c0f15527938742acfc196e0db5763d2169b65d1356ea0d',
  ],
  [
    '0022_reconcile_completed_normal_work_orders.sql',
    '832ca6f4d0aa2fef39469064fe29f39e184c4ccdba2d0925b7cfba1135141736',
  ],
  [
    '0023_pcm_work_order_create.sql',
    '5bd552bdbc949dc111ac7ff3ecae0b9365ce0a4965d0e0e84fa83e8e2d63d428',
  ],
  [
    '0024_fix_capability_text_and_release_demo.sql',
    'e07e75c4e179a6c6013e83eb8b3416ec95209de3e48faa96defb2afb7b488abf',
  ],
  [
    '0025_execution_pause_tracking.sql',
    '674b5ef0cd1c902a6cf61b8c9c36f80368049f44faadb70c5ee5bf0410f3d4fd',
  ],
  [
    '0026_tenant_hostname_resolution.sql',
    '78fd2dea7899ff4cefd06554d3b91e8a667570dbd30f574ba41a3bebe2d13ba5',
  ],
  [
    '0027_pre_auth_tenant_resolver_role.sql',
    'a8dfb9ab97aebe01bd091afb7ea007cd90d3acb6caa626882d14feb716d1c4f6',
  ],
  [
    '0028_pre_auth_tenant_resolver_runtime_execute.sql',
    '6f0559b4b026a98ee8448e2b43d04160e085bbaafd1d51797c15b4941092eb5a',
  ],
  [
    '0029_material_cost_traceability.sql',
    '32d4b945274ff78da55aa7e7b0611dc2b6575cf9385f0f81479c392377389562',
  ],
  [
    '0030_material_value_sources.sql',
    '99c27354ede7a7a6e5f9ce9bd88d8a30868e122a86c02a3da0a46cbfc48a629a',
  ],
  [
    '0031_post_intervention_release_does_not_block_execution.sql',
    '3ee4f85e3524692bd762dc3d9ed2b9ede3ece1a5d8e6976cc0d6076122f38fd7',
  ],
  [
    '0032_quality_or_safety_shared_requirement.sql',
    'df5ea64b7f611e9dc532879fbf3bd2a21339c137fa2991b06c7d0ccfdcc5c7a3',
  ],
] as const;

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

async function replaceLedgerChecksums(
  client: PoolClient,
  entries: readonly LedgerEntry[],
): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const entry of entries) {
      await client.query(
        `
          UPDATE platform.schema_migrations
          SET checksum_sha256 = $2
          WHERE version = $1
        `,
        [entry.version, entry.checksum_sha256],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
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

async function resetFixture(
  client: PoolClient,
  ledger0033: LedgerEntry,
  ledger0034: LedgerEntry,
): Promise<void> {
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
      await client.query(`DELETE FROM platform.schema_migrations WHERE version = $1`, [
        '0034_reconcile_technical_validation_reports_rls.sql',
      ]);
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
        assert.deepEqual(
          visibleReports.rows.map((report) => report.id),
          [reportA],
        );
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

test(
  'aceita somente o ledger CRLF auditado de 0019 a 0032 com checkout LF canônico',
  { skip: !testEnvironment() },
  async () => {
    const environment = testEnvironment();
    if (!environment) return;

    const administrator = new Pool({
      connectionString: environment.database.migrationUrl,
      max: 1,
    });
    const client = await administrator.connect();
    const originalEntries = await Promise.all(
      historicalCrlfChecksums.map(([version]) => ledgerEntry(client, version)),
    );

    try {
      await replaceLedgerChecksums(
        client,
        historicalCrlfChecksums.map(([version, checksum_sha256]) => ({
          version,
          checksum_sha256,
          execution_ms: 0,
        })),
      );

      const migration = await migrateDatabase(environment);
      assert.deepEqual(migration.applied, []);

      for (const [version, checksum] of historicalCrlfChecksums) {
        assert.equal((await ledgerEntry(client, version)).checksum_sha256, checksum);
      }

      await replaceLedgerChecksums(client, [
        {
          version: historicalCrlfChecksums[0][0],
          checksum_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          execution_ms: 0,
        },
      ]);
      await assert.rejects(
        migrateDatabase(environment),
        (error: unknown) =>
          error instanceof AppError && error.code === 'MIGRATION_CHECKSUM_MISMATCH',
      );
    } finally {
      await replaceLedgerChecksums(client, originalEntries);
      client.release();
      await administrator.end();
    }
  },
);
