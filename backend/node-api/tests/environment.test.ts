import assert from 'node:assert/strict';
import test from 'node:test';

import { loadEnvironment } from '../src/config/environment.js';
import { createTestEnvironment } from './helpers/environment.js';

test('carrega configuração segura de teste', () => {
  const environment = createTestEnvironment();

  assert.equal(environment.nodeEnv, 'test');
  assert.equal(environment.defaultTenantId, '00000000-0000-4000-8000-000000000001');
  assert.equal(environment.release.schema, 'postgres-0017');
  assert.deepEqual(environment.corsAllowedOrigins, ['http://127.0.0.1:5173']);
});

test('recusa produção sem TLS verify-full', () => {
  const valid = createTestEnvironment();

  assert.throws(
    () =>
      loadEnvironment({
        NODE_ENV: 'production',
        HOST: valid.host,
        PORT: String(valid.port),
        DATABASE_URL: valid.database.url,
        DATABASE_SSL_MODE: 'disable',
        DEFAULT_TENANT_ID: valid.defaultTenantId,
        APP_ENVIRONMENT: 'PRODUCTION',
        APP_RELEASE_VERSION: valid.release.app,
        API_VERSION: valid.release.api,
        SCHEMA_VERSION: valid.release.schema,
        CONTRACT_VERSION: valid.release.contract,
        FRONTEND_VERSION: valid.release.frontend,
        AUTH_PASSWORD_PEPPER: valid.auth.passwordPepper,
        AUTH_RECOVERY_HMAC_SECRET: valid.auth.recoveryHmacSecret,
        AUTH_MAINTENANCE_HMAC_SECRET: valid.auth.maintenanceHmacSecret,
        CORS_ALLOWED_ORIGINS: 'https://app.example.test',
      }),
    /Produção exige DATABASE_SSL_MODE=verify-full/u,
  );
});
