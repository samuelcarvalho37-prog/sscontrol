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
    connectionString: environment.database.url,
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
  const client = await pool.connect();

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('fab-control-schema-migrations', 0))",
    );

    const appliedMigrations = await readAppliedMigrations(client);
    const appliedByVersion = new Map(
      appliedMigrations.map((migration) => [migration.version, migration.checksum_sha256]),
    );
    const newlyApplied: string[] = [];

    for (const migration of migrationFiles) {
      const recordedChecksum = appliedByVersion.get(migration.version);

      if (recordedChecksum && recordedChecksum !== migration.checksum) {
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

      await applyMigration(client, migration);
      newlyApplied.push(migration.version);
    }

    return {
      directory,
      applied: newlyApplied,
      current: migrationFiles.map((migration) => migration.version),
    };
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended('fab-control-schema-migrations', 0))")
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}
