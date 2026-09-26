import assert from 'node:assert/strict';
import test from 'node:test';

import { type Environment } from '../src/config/environment.js';
import { TenantResolutionService } from '../src/modules/auth/tenant-resolution.service.js';
import { createTestEnvironment } from './helpers/environment.js';

function environment(overrides: Partial<Environment> = {}): Environment {
  const base = createTestEnvironment();
  return {
    ...base,
    release: { ...base.release, environment: 'DEVELOPMENT' },
    tenantResolution: { baseDomain: 'vorqix.com.br', developmentTenantSlug: 'local-company' },
    ...overrides,
  };
}

function resolver(activeSlugs: readonly string[], env = environment()) {
  const database = {
    query: async (_text: string, values: readonly unknown[] = []) => {
      const requestedSlug = values[0];
      const slug = typeof requestedSlug === 'string' ? requestedSlug : '';
      return {
        rows: activeSlugs.includes(slug)
          ? [{ tenant_id: `tenant-${slug}`, tenant_slug: slug }]
          : [],
      };
    },
  } as never;
  return new TenantResolutionService(env, database);
}

test('resolve tenant por subdomínio e não aceita host semelhante', async () => {
  const service = resolver(['tozzi']);
  assert.deepEqual(
    await service.tryResolve({ host: 'TOZZI.vorqix.com.br:443', ipAddress: '198.51.100.10', developmentTenantSlug: undefined }),
    { id: 'tenant-tozzi', slug: 'tozzi' },
  );
  assert.equal(
    await service.tryResolve({ host: 'tozzi.vorqix.com.br.evil.example', ipAddress: '198.51.100.10', developmentTenantSlug: undefined }),
    null,
  );
});

test('fallback local exige DEVELOPMENT, loopback e localhost', async () => {
  const development = resolver(['local-company']);
  assert.deepEqual(
    await development.tryResolve({ host: 'localhost:3333', ipAddress: '127.0.0.1', developmentTenantSlug: 'local-company' }),
    { id: 'tenant-local-company', slug: 'local-company' },
  );
  assert.equal(
    await development.tryResolve({ host: 'localhost', ipAddress: '198.51.100.10', developmentTenantSlug: 'local-company' }),
    null,
  );

  const production = resolver(['local-company'], environment({
    release: { ...createTestEnvironment().release, environment: 'PRODUCTION' },
    tenantResolution: { baseDomain: 'vorqix.com.br', developmentTenantSlug: 'local-company' },
  }));
  assert.equal(
    await production.tryResolve({ host: 'localhost', ipAddress: '127.0.0.1', developmentTenantSlug: 'local-company' }),
    null,
  );
});

test('tenant inativo ou inexistente tem a mesma resolução vazia', async () => {
  const service = resolver([]);
  assert.equal(
    await service.tryResolve({ host: 'inativa.vorqix.com.br', ipAddress: '198.51.100.10', developmentTenantSlug: undefined }),
    null,
  );
  await assert.rejects(
    service.resolve({ host: 'inexistente.vorqix.com.br', ipAddress: '198.51.100.10', developmentTenantSlug: undefined }),
    { code: 'AUTH_TENANT_UNAVAILABLE' },
  );
});
