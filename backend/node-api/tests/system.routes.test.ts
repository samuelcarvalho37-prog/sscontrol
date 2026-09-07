import assert from 'node:assert/strict';
import test from 'node:test';

import type { Database } from '../src/infrastructure/database/database.js';
import { buildApp } from '../src/app.js';
import { createTestEnvironment } from './helpers/environment.js';

function fakeDatabase(): Database {
  return {
    pool: null as never,
    async healthcheck() {
      return { latencyMs: 1 };
    },
    async withTransaction() {
      throw new Error('Transação não esperada neste teste.');
    },
    async query() {
      throw new Error('Consulta não esperada neste teste.');
    },
    close() {
      return Promise.resolve();
    },
  };
}

test('health e bootstrap publicam contrato sem segredos', async (context) => {
  const app = await buildApp({
    environment: createTestEnvironment(),
    database: fakeDatabase(),
    logger: false,
  });
  context.after(async () => app.close());

  const live = await app.inject({ method: 'GET', url: '/health/live' });
  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  const bootstrap = await app.inject({ method: 'GET', url: '/v1/bootstrap' });

  assert.equal(live.statusCode, 200);
  assert.equal(ready.statusCode, 200);
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(live.json().data.version, '2.0.0');
  assert.equal(ready.json().data.database.ready, true);
  assert.equal(bootstrap.json().data.authentication.strategy, 'OPAQUE_BEARER_SESSION');
  assert.doesNotMatch(bootstrap.body, /pepper|hmac|password/i);
});

test('erro 404 preserva envelope e trace id', async (context) => {
  const app = await buildApp({
    environment: createTestEnvironment(),
    database: fakeDatabase(),
    logger: false,
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/rota-inexistente',
    headers: { 'x-request-id': 'trace-test-404' },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, 'ROUTE_NOT_FOUND');
  assert.equal(response.json().trace_id, 'trace-test-404');
});
