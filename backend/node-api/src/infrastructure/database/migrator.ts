import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import type { Environment } from '../../config/environment.js';
import { AppError } from '../../core/errors/app-error.js';

interface AppliedMigration {
  readonly version: string;
  readonly checksum_sha256: string;
}

interface MigrationFile {
  readonly version: string;
  readonly path: string;
  readonly checksum: string;
  readonly sql: string;
}

interface ApprovedLegacyMigrationChecksums {
  readonly canonicalChecksum: string;
  readonly historicalChecksums: readonly string[];
}

/*
 * These are the only audited checksum exceptions. A migration is accepted
 * through this path only when its current contents still produce the exact
 * canonical LF checksum and the stored ledger checksum is listed here.
 *
 * Migrations 0019–0032 were applied historically from CRLF checkouts. Their
 * SQL bytes are otherwise identical to the canonical LF files now enforced by
 * .gitattributes. Migration 0033 retains its previously approved exception
 * and the audited incomplete rollout that omitted its RLS controls.
 */
const approvedLegacyChecksums: Readonly<
  Record<string, ApprovedLegacyMigrationChecksums | undefined>
> = {
  '0019_pcm_action_assignment.sql': {
    canonicalChecksum: '4002c361acb2c3395c63b214fd1cbd5418cf80be6d900ebea4ac59bc13933968',
    historicalChecksums: ['acd2f0794f2c3bc7618543646ba81ff53d85fa74b00d00c3d73171ffcf2b5249'],
  },
  '0020_fix_pcm_action_assignment.sql': {
    canonicalChecksum: '257476d56f6788fa70ca112b3d8e9d46f8c05f56708dc89721a2af8d2796bce5',
    historicalChecksums: ['21e5fb863fcf4cf4d1d0a2238bfc76f11dc458b5de84bf8bf91a08fd74d5f5af'],
  },
  '0021_pcm_work_order_release.sql': {
    canonicalChecksum: '11da1494c5022c4c5da66af83e25ca8c86264fb6a49dfb9883aec76f10810050',
    historicalChecksums: ['eec4581ce1bb394b45c0f15527938742acfc196e0db5763d2169b65d1356ea0d'],
  },
  '0022_reconcile_completed_normal_work_orders.sql': {
    canonicalChecksum: 'b653a5bc696d77eb65ebf0683139fa7e7de0a0f36061795b321073f18f8ddd84',
    historicalChecksums: ['832ca6f4d0aa2fef39469064fe29f39e184c4ccdba2d0925b7cfba1135141736'],
  },
  '0023_pcm_work_order_create.sql': {
    canonicalChecksum: 'a56beaf0bf98be3267a7e2d1a196bf6e04b8ccfaa99808e6ace0d7d4733c9a88',
    historicalChecksums: ['5bd552bdbc949dc111ac7ff3ecae0b9365ce0a4965d0e0e84fa83e8e2d63d428'],
  },
  '0024_fix_capability_text_and_release_demo.sql': {
    canonicalChecksum: 'dfea9c23123100a58ed69622e6013609b5e9782b1d6068bd20d42ce6d7952291',
    historicalChecksums: ['e07e75c4e179a6c6013e83eb8b3416ec95209de3e48faa96defb2afb7b488abf'],
  },
  '0025_execution_pause_tracking.sql': {
    canonicalChecksum: '65817cbf8a2cce68a0bccc578d1d310ab0679e7851196091ac3fe15631307b9e',
    historicalChecksums: ['674b5ef0cd1c902a6cf61b8c9c36f80368049f44faadb70c5ee5bf0410f3d4fd'],
  },
  '0026_tenant_hostname_resolution.sql': {
    canonicalChecksum: '3418a46bbf6d727c2feee7de0647a5a6362f8c9dddb62bd522ca2730a769becd',
    historicalChecksums: ['78fd2dea7899ff4cefd06554d3b91e8a667570dbd30f574ba41a3bebe2d13ba5'],
  },
  '0027_pre_auth_tenant_resolver_role.sql': {
    canonicalChecksum: 'd23542290e8901cdfaa385c4f56e0aa944c10c508e2f95dee5538d0e32a670ea',
    historicalChecksums: ['a8dfb9ab97aebe01bd091afb7ea007cd90d3acb6caa626882d14feb716d1c4f6'],
  },
  '0028_pre_auth_tenant_resolver_runtime_execute.sql': {
    canonicalChecksum: 'a33d4a963461194736f03de4b0d501e8b1ecb0080264f53b810816fb2d6c079b',
    historicalChecksums: ['6f0559b4b026a98ee8448e2b43d04160e085bbaafd1d51797c15b4941092eb5a'],
  },
  '0029_material_cost_traceability.sql': {
    canonicalChecksum: '273fb23b6b587b2dadae328bf4063a9425c72a5e7e3d8f5dcdf246bdc97b5aa7',
    historicalChecksums: ['32d4b945274ff78da55aa7e7b0611dc2b6575cf9385f0f81479c392377389562'],
  },
  '0030_material_value_sources.sql': {
    canonicalChecksum: '261a8d2085e3bd0c3a842f4e534dbef2dc4541262df59fdc4c27220b008f7907',
    historicalChecksums: ['99c27354ede7a7a6e5f9ce9bd88d8a30868e122a86c02a3da0a46cbfc48a629a'],
  },
  '0031_post_intervention_release_does_not_block_execution.sql': {
    canonicalChecksum: '2768761b4a60c0916187766698f62499e14e7792544226db683f82397ecefe73',
    historicalChecksums: ['3ee4f85e3524692bd762dc3d9ed2b9ede3ece1a5d8e6976cc0d6076122f38fd7'],
  },
  '0032_quality_or_safety_shared_requirement.sql': {
    canonicalChecksum: 'ed45ed94c9a942447e0bce73607822ec9fbc3a8376a2955ce2d796df065219da',
    historicalChecksums: ['df5ea64b7f611e9dc532879fbf3bd2a21339c137fa2991b06c7d0ccfdcc5c7a3'],
  },
  '0033_technical_validation_reports.sql': {
    canonicalChecksum: 'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8',
    historicalChecksums: [
      'fbbcce6dfa199285797bba00a1539808020de152360bc4599ab2d53e1a7b3cd8',
      '288f7a0d1b56d45836891017c942b2755399e4f7e3a92a9d2a6790de7bd61753',
    ],
  },
};

export function isApprovedLegacyMigrationChecksum(
  version: string,
  recordedChecksum: string,
  canonicalChecksum: string,
): boolean {
  const approved = approvedLegacyChecksums[version];
  return (
    approved?.canonicalChecksum === canonicalChecksum &&
    approved.historicalChecksums.includes(recordedChecksum)
  );
}

function defaultMigrationsDirectory(): string {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDirectory, '../../../../../database/postgres/migrations');
}

function migrationBody(sql: string, version: string): string {
  const withoutOpeningTransaction = sql.replace(/^\uFEFF?\s*BEGIN\s*;\s*/iu, '');
  const withoutClosingTransaction = withoutOpeningTransaction.replace(/\s*COMMIT\s*;\s*$/iu, '');

  if (
    withoutOpeningTransaction === sql ||
    withoutClosingTransaction === withoutOpeningTransaction
  ) {
    throw new AppError({
      code: 'MIGRATION_TRANSACTION_CONTRACT_INVALID',
      message: `A migração ${version} deve iniciar com BEGIN; e terminar com COMMIT;.`,
      statusCode: 500,
      expose: true,
    });
  }

  return withoutClosingTransaction;
}

async function loadMigrationFiles(directory: string): Promise<readonly MigrationFile[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  if (entries.length === 0) {
    throw new AppError({
      code: 'MIGRATIONS_NOT_FOUND',
      message: `Nenhuma migração foi encontrada em ${directory}.`,
      statusCode: 500,
      expose: true,
    });
  }

  return Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      const sql = await readFile(path, 'utf8');
      return {
        version: entry.name,
        path,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql,
      };
    }),
  );
}

async function readAppliedMigrations(client: PoolClient): Promise<readonly AppliedMigration[]> {
  const tableResult = await client.query<{ readonly table_name: string | null }>(
    "SELECT to_regclass('platform.schema_migrations')::text AS table_name",
  );

  if (!tableResult.rows[0]?.table_name) return [];

  const result = await client.query<AppliedMigration>(
    `
      SELECT version, checksum_sha256
      FROM platform.schema_migrations
      ORDER BY version
    `,
  );
  return result.rows;
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  const startedAt = performance.now();

  try {
    await client.query('BEGIN');
    await client.query(migrationBody(migration.sql, migration.version));
    await client.query(
      `
        INSERT INTO platform.schema_migrations (
          version,
          checksum_sha256,
          execution_ms
        )
        VALUES ($1, $2, $3)
      `,
      [
        migration.version,
        migration.checksum,
        Math.max(0, Math.round(performance.now() - startedAt)),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new AppError({
      code: 'MIGRATION_FAILED',
      message: `Falha ao aplicar ${migration.version}.`,
      statusCode: 500,
      details: { stage: 'apply-migration', migration: migration.version },
      expose: true,
      cause: error,
    });
  }
}

export interface MigrationResult {
  readonly directory: string;
  readonly applied: readonly string[];
  readonly current: readonly string[];
}

export async function migrateDatabase(environment: Environment): Promise<MigrationResult> {
  const directory = environment.migrationsDirectory ?? defaultMigrationsDirectory();
  const migrationFiles = await loadMigrationFiles(directory);
  const pool = new Pool({
    application_name: 'fab-control-migrator',
    connectionString: environment.database.migrationUrl ?? environment.database.url,
    connectionTimeoutMillis: environment.database.connectionTimeoutMs,
    max: 1,
    ssl:
      environment.database.sslMode === 'verify-full'
        ? {
            rejectUnauthorized: true,
            ...(environment.database.sslCa ? { ca: environment.database.sslCa } : {}),
          }
        : false,
  });
  let client: PoolClient | undefined;
  let stage = 'connect';
  let migrationVersion: string | undefined;

  try {
    client = await pool.connect();
    stage = 'acquire-advisory-lock';
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('fab-control-schema-migrations', 0))",
    );

    stage = 'read-applied-migrations';
    const appliedMigrations = await readAppliedMigrations(client);
    const appliedByVersion = new Map(
      appliedMigrations.map((migration) => [migration.version, migration.checksum_sha256]),
    );
    const newlyApplied: string[] = [];

    for (const migration of migrationFiles) {
      migrationVersion = migration.version;
      const recordedChecksum = appliedByVersion.get(migration.version);

      if (recordedChecksum && recordedChecksum !== migration.checksum) {
        if (
          isApprovedLegacyMigrationChecksum(migration.version, recordedChecksum, migration.checksum)
        ) {
          process.emitWarning(
            `Checksum legado aprovado reconhecido para ${migration.version}; o ledger será preservado e as migrations posteriores continuarão forward-only.`,
            {
              code: 'MIGRATION_LEGACY_CHECKSUM_ACCEPTED',
              detail: `version=${migration.version}`,
            },
          );
          continue;
        }

        throw new AppError({
          code: 'MIGRATION_CHECKSUM_MISMATCH',
          message: `A migração aplicada ${migration.version} foi alterada.`,
          statusCode: 500,
          details: {
            expected: recordedChecksum,
            received: migration.checksum,
          },
          expose: true,
        });
      }

      if (recordedChecksum) continue;

      stage = 'apply-migration';
      await applyMigration(client, migration);
      newlyApplied.push(migration.version);
    }

    return {
      directory,
      applied: newlyApplied,
      current: migrationFiles.map((migration) => migration.version),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError({
      code: 'MIGRATION_RUNTIME_FAILED',
      message: 'Falha ao executar as migrations do banco.',
      statusCode: 500,
      expose: true,
      details: {
        stage,
        migration: migrationVersion,
        connection: environment.database.migrationUrl ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL',
      },
      cause: error,
    });
  } finally {
    if (client) {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended('fab-control-schema-migrations', 0))")
        .catch(() => undefined);
      client.release();
    }
    await pool.end();
  }
}
