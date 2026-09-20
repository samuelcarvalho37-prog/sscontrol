import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { loadEnvironment } from '../src/config/environment.js';
import { authRateLimitConfig } from '../src/modules/auth/auth.routes.js';
import { registerSecurityPlugins } from '../src/plugins/security.js';
import { createTestEnvironment } from './helpers/environment.js';

async function createProbeApp(options: NodeJS.ProcessEnv = {}) {
  const environment = createTestEnvironment(undefined, undefined, undefined, options);
  const app = Fastify({
    trustProxy:
      environment.trustProxyCidrs.length > 0 ? [...environment.trustProxyCidrs] : false,
  });

  await registerSecurityPlugins(app, environment);
  app.get('/ip', async (request) => ({ ip: request.ip, ips: request.ips }));
  app.post('/login', {
    config: {
      rateLimit: {
        ...authRateLimitConfig(environment, 'login'),
      },
    },
    handler: async () => ({ ok: true }),
  });
  app.post('/recovery', {
    config: {
      rateLimit: {
        ...authRateLimitConfig(environment, 'recovery'),
      },
    },
    handler: async () => ({ accepted: true }),
  });

  return app;
}

test('abaixo do limite, requisições normais passam', async (context) => {
  const app = await createProbeApp({ AUTH_RATE_LIMIT_LOGIN_MAX: '2' });
  context.after(() => app.close());

  const first = await app.inject({ method: 'POST', url: '/login', remoteAddress: '198.51.100.10' });
  const second = await app.inject({ method: 'POST', url: '/login', remoteAddress: '198.51.100.10' });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
});

test('login e recuperação retornam 429 e Retry-After ao exceder o limite por IP', async (context) => {
  const app = await createProbeApp({
    AUTH_RATE_LIMIT_LOGIN_MAX: '2',
    AUTH_RATE_LIMIT_RECOVERY_MAX: '2',
  });
  context.after(() => app.close());

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/login', remoteAddress: '198.51.100.11' })).statusCode,
      200,
    );
  }
  const blockedLogin = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress: '198.51.100.11',
  });
  assert.equal(blockedLogin.statusCode, 429);
  assert.ok(Number(blockedLogin.headers['retry-after']) >= 1);
  assert.equal(blockedLogin.headers['x-ratelimit-limit'], '2');
  assert.equal(blockedLogin.headers['x-ratelimit-remaining'], '0');
  assert.ok(Number(blockedLogin.headers['x-ratelimit-reset']) >= 1);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/recovery', remoteAddress: '198.51.100.12' }))
        .statusCode,
      200,
    );
  }
  const blockedRecovery = await app.inject({
    method: 'POST',
    url: '/recovery',
    remoteAddress: '198.51.100.12',
  });
  assert.equal(blockedRecovery.statusCode, 429);
  assert.ok(Number(blockedRecovery.headers['retry-after']) >= 1);
  assert.equal(blockedRecovery.headers['x-ratelimit-limit'], '2');
  assert.equal(blockedRecovery.headers['x-ratelimit-remaining'], '0');
});

test('cabeçalhos de encaminhamento não alteram o IP quando a origem não é proxy confiável', async (context) => {
  const app = await createProbeApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '198.51.100.20',
    headers: {
      forwarded: 'for=203.0.113.90',
      'x-forwarded-for': '203.0.113.90',
      'x-real-ip': '203.0.113.90',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ip, '198.51.100.20');
});

test('proxy explicitamente confiável informa o IP do cliente e proxy local não recebe bypass', async (context) => {
  const app = await createProbeApp({
    TRUST_PROXY_CIDRS: '10.20.0.0/16,127.0.0.1/32',
    AUTH_RATE_LIMIT_LOGIN_MAX: '2',
  });
  context.after(() => app.close());

  const forwarded = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '10.20.1.5',
    headers: { 'x-forwarded-for': '203.0.113.15' },
  });
  assert.equal(forwarded.statusCode, 200);
  assert.equal(forwarded.json().ip, '203.0.113.15');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/login',
          remoteAddress: '127.0.0.1',
          headers: { 'x-forwarded-for': '203.0.113.16' },
        })
      ).statusCode,
      200,
    );
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '203.0.113.16' },
  });
  assert.equal(blocked.statusCode, 429);
});

test('localhost em DEVELOPMENT continua sujeito ao rate limit', async (context) => {
  const app = await createProbeApp({ AUTH_RATE_LIMIT_LOGIN_MAX: '1' });
  context.after(() => app.close());

  assert.equal(
    (await app.inject({ method: 'POST', url: '/login', remoteAddress: '127.0.0.1' })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/login', remoteAddress: '127.0.0.1' })).statusCode,
    429,
  );
});

test('produção recusa trust proxy ausente ou malformado', () => {
  const valid = createTestEnvironment();
  const productionBase: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    HOST: valid.host,
    PORT: String(valid.port),
    DATABASE_URL: valid.database.url,
    DATABASE_SSL_MODE: 'verify-full',
    DEFAULT_TENANT_ID: valid.defaultTenantId,
    APP_ENVIRONMENT: 'PRODUCTION',
    TENANT_BASE_DOMAIN: 'vorqix.example',
    APP_RELEASE_VERSION: valid.release.app,
    API_VERSION: valid.release.api,
    SCHEMA_VERSION: valid.release.schema,
    CONTRACT_VERSION: valid.release.contract,
    FRONTEND_VERSION: valid.release.frontend,
    AUTH_PASSWORD_PEPPER: valid.auth.passwordPepper,
    AUTH_RECOVERY_HMAC_SECRET: valid.auth.recoveryHmacSecret,
    AUTH_MAINTENANCE_HMAC_SECRET: valid.auth.maintenanceHmacSecret,
    CORS_ALLOWED_ORIGINS: 'https://app.vorqix.example',
  };

  assert.throws(() => loadEnvironment(productionBase), /TRUST_PROXY_CIDRS/u);
  assert.throws(
    () => loadEnvironment({ ...productionBase, TRUST_PROXY_CIDRS: 'not-a-network' }),
    /TRUST_PROXY_CIDRS/u,
  );
  assert.throws(
    () => loadEnvironment({ ...productionBase, TRUST_PROXY_CIDRS: '0.0.0.0/0' }),
    /TRUST_PROXY_CIDRS/u,
  );
});
