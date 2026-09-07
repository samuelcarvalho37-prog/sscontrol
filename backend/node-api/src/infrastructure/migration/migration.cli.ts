import { Pool } from 'pg';

import { loadEnvironment } from '../../config/environment.js';
import { assertLoaderCoverage, executeMigration } from './migration.service.js';
import type { MigrationMode } from './migration-repository.js';

interface CliArguments {
  readonly source: string;
  readonly mode: MigrationMode;
  readonly reportPath?: string;
  readonly sourceRelease?: string;
  readonly initiatedBy?: string;
}

function argumentValue(argumentsList: readonly string[], name: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const inline = argumentsList.find((argument) => argument.startsWith(equalsPrefix));
  if (inline) return inline.slice(equalsPrefix.length);
  const index = argumentsList.indexOf(`--${name}`);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function parseMode(value: string | undefined): MigrationMode {
  const normalized = (value ?? 'DRY_RUN').trim().toUpperCase();
  if (normalized === 'DRY_RUN' || normalized === 'FULL' || normalized === 'DELTA') {
    return normalized;
  }
  throw new Error('O modo deve ser DRY_RUN, FULL ou DELTA.');
}

function parseArguments(argumentsList: readonly string[]): CliArguments {
  const source = argumentValue(argumentsList, 'source');
  if (!source) {
    throw new Error('Informe a fonte com --source <arquivo.xlsx|diretório-csv>.');
  }
  const reportPath = argumentValue(argumentsList, 'report');
  const sourceRelease = argumentValue(argumentsList, 'source-release');
  const initiatedBy = argumentValue(argumentsList, 'initiated-by');
  return {
    source,
    mode: parseMode(argumentValue(argumentsList, 'mode')),
    ...(reportPath ? { reportPath } : {}),
    ...(sourceRelease ? { sourceRelease } : {}),
    ...(initiatedBy ? { initiatedBy } : {}),
  };
}

const environment = loadEnvironment();
const cli = parseArguments(process.argv.slice(2));
assertLoaderCoverage();

const pool = new Pool({
  application_name: `fab-control-migration/${environment.release.api}`,
  connectionString: environment.database.migrationUrl ?? environment.database.url,
  connectionTimeoutMillis: environment.database.connectionTimeoutMs,
  idleTimeoutMillis: environment.database.idleTimeoutMs,
  max: Math.min(4, environment.database.poolMax),
  query_timeout: environment.database.statementTimeoutMs,
  statement_timeout: environment.database.statementTimeoutMs,
  ssl:
    environment.database.sslMode === 'verify-full'
      ? {
          rejectUnauthorized: true,
          ...(environment.database.sslCa ? { ca: environment.database.sslCa } : {}),
        }
      : false,
});

try {
  const report = await executeMigration(pool, {
    source: cli.source,
    tenantId: environment.defaultTenantId,
    environment: environment.release.environment,
    sourceRelease: cli.sourceRelease ?? environment.release.app,
    targetSchemaVersion: environment.release.schema,
    initiatedBy: cli.initiatedBy ?? 'migration-cli',
    mode: cli.mode,
    timeZone: 'America/Sao_Paulo',
    ...(cli.reportPath ? { reportPath: cli.reportPath } : {}),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === 'FAILED') process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: 'FAILED',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
