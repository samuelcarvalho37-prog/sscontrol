import type { FastifyBaseLogger } from 'fastify';
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

import type { Environment } from '../../config/environment.js';

export interface TransactionContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly readOnly?: boolean;
  readonly isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
}

export interface Database {
  readonly pool: Pool;
  healthcheck(): Promise<{ readonly latencyMs: number }>;
  withTransaction<T>(
    context: TransactionContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T>;
  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

function createPoolConfig(environment: Environment): PoolConfig {
  const ssl =
    environment.database.sslMode === 'verify-full'
      ? {
          rejectUnauthorized: true,
          ...(environment.database.sslCa ? { ca: environment.database.sslCa } : {}),
        }
      : false;

  return {
    application_name: `fab-control-api/${environment.release.api}`,
    connectionString: environment.database.url,
    connectionTimeoutMillis: environment.database.connectionTimeoutMs,
    idleTimeoutMillis: environment.database.idleTimeoutMs,
    max: environment.database.poolMax,
    maxUses: 10_000,
    query_timeout: environment.database.statementTimeoutMs,
    ssl,
    statement_timeout: environment.database.statementTimeoutMs,
  };
}

export function createDatabase(environment: Environment, logger: FastifyBaseLogger): Database {
  const pool = new Pool(createPoolConfig(environment));

  pool.on('error', (error) => {
    logger.error({ err: error }, 'Falha inesperada em uma conexão ociosa do PostgreSQL.');
  });

  return {
    pool,

    async healthcheck() {
      const startedAt = performance.now();
      await pool.query('SELECT 1 AS ready');
      return { latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    },

    async withTransaction<T>(
      context: TransactionContext,
      operation: (client: PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const isolation = context.isolationLevel ?? 'read committed';
        const isolationStatements = {
          'read committed': 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
          'repeatable read': 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
          serializable: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
        } as const;
        await client.query(isolationStatements[isolation]);

        if (context.readOnly === true) {
          await client.query('SET TRANSACTION READ ONLY');
        }

        await client.query(
          `
            SELECT
              set_config('app.tenant_id', $1, true),
              set_config('app.user_id', $2, true)
          `,
          [context.tenantId, context.userId ?? ''],
        );
        await client.query("SELECT set_config('statement_timeout', $1, true)", [
          String(environment.database.statementTimeoutMs),
        ]);

        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          logger.error({ err: rollbackError }, 'Falha ao desfazer transação do PostgreSQL.');
        });
        throw error;
      } finally {
        client.release();
      }
    },

    query<T extends QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<QueryResult<T>> {
      return pool.query<T>(text, [...values]);
    },

    async close() {
      await pool.end();
    },
  };
}
