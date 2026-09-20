import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { hashMaintenanceCode } from '../src/modules/auth/maintenance-code.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);

interface TestTenant {
  readonly id: string;
  readonly slug: string;
}

interface TestIdentity {
  readonly tenant: TestTenant;
  readonly userId: string;
  readonly employeeNumber: string;
}

function createTestTenant(prefix: 'empresa-a' | 'empresa-b' | 'auth'): TestTenant {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return { id: randomUUID(), slug: `${prefix}-${suffix}` };
}

function tenantHeaders(tenant: TestTenant) {
  return { host: 'localhost', 'x-vorqix-dev-tenant': tenant.slug };
}

async function inTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedIdentity(
  pool: Pool,
  tenant: TestTenant,
  passwordHash: string,
  options: { readonly email?: string; readonly firstAccessRequired?: boolean } = {},
): Promise<TestIdentity> {
  const userId = randomUUID();
  const roleId = randomUUID();
  const employeeNumber = `USR-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  let capabilityId = '';

  await inTenantTransaction(pool, tenant.id, async (client) => {
    await client.query(
      `
        INSERT INTO platform.tenants (
          id, legal_name, display_name, slug, environment, status
        )
        VALUES ($1, 'Fab Control Testes', 'Fab Control Testes', $2, 'DEVELOPMENT', 'ACTIVE')
      `,
      [tenant.id, tenant.slug],
    );
    const capability = await client.query<{ id: string }>(
      `
        SELECT id
        FROM iam.capabilities
        WHERE code = 'cmms.structure.read'
      `,
    );
    capabilityId = capability.rows[0]?.id ?? '';
    assert.ok(capabilityId);
    await client.query(
      `
        INSERT INTO iam.roles (
          id, tenant_id, code, name, description, role_type, protected
        )
        VALUES ($1, $2, 'ADMIN', 'Administrador', 'Administração integral.', 'ADMIN', true)
      `,
      [roleId, tenant.id],
    );
    await client.query(
      `
        INSERT INTO iam.users (
          id,
          tenant_id,
          employee_number,
          name,
          email,
          first_access_required
        )
        VALUES ($1, $2, $3, 'Admin Teste', $4, $5)
      `,
      [
        userId,
        tenant.id,
        employeeNumber,
        options.email ?? `admin-${tenant.slug}@tests.vorqix.local`,
        options.firstAccessRequired ?? true,
      ],
    );
    await client.query(
      `
        INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
        VALUES ($1, $2, $3)
      `,
      [tenant.id, userId, roleId],
    );
    await client.query(
      `
        INSERT INTO iam.role_capabilities (
          tenant_id, role_id, capability_id, effect
        )
        VALUES ($1, $2, $3, 'ALLOW')
      `,
      [tenant.id, roleId, capabilityId],
    );
    await client.query(
      `
        INSERT INTO iam.credentials (
          tenant_id,
          user_id,
          credential_type,
          algorithm,
          password_hash
        )
        VALUES ($1, $2, 'PASSWORD', 'ARGON2ID', $3)
      `,
      [tenant.id, userId, passwordHash],
    );
  });

  return { tenant, userId, employeeNumber };
}

test(
  'fluxo real: login, primeiro acesso, sessão, recuperação e logout',
  { skip: !integrationEnabled, timeout: 30_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const tenant = createTestTenant('auth');
    const environment = createTestEnvironment(databaseUrl, tenant.id, tenant.slug);
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const initialPassword = 'Initial!Password-2026';
    const changedPassword = 'Changed!Password-2026';
    const passwordHash = await new PasswordService(environment.auth.passwordPepper).hash(
      initialPassword,
    );
    const identity = await seedIdentity(pool, tenant, passwordHash);
    const headers = tenantHeaders(tenant);
    const app = await buildApp({ environment, logger: false });

    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { matricula: identity.employeeNumber, senha: 'Wrong!Password-2026' },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().error.code, 'AUTH_INVALID_CREDENTIALS');

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers,
      payload: { matricula: identity.employeeNumber.toLowerCase(), senha: initialPassword },
    });
    assert.equal(firstLogin.statusCode, 200);
    assert.equal(firstLogin.json().data.first_access_required, true);
    assert.match(firstLogin.json().data.change_token, /^fcf_/u);
    const changeToken: string = firstLogin.json().data.change_token;

    const firstAccessTokenRejected = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...headers, authorization: `Bearer ${changeToken}` },
    });
    assert.equal(firstAccessTokenRejected.statusCode, 401);

    const completed = await app.inject({
      method: 'POST',
      url: '/v1/auth/first-access',
      headers,
      payload: {
        change_token: changeToken,
        senha_atual: initialPassword,
        nova_senha: changedPassword,
      },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().data.authenticated, true);
    assert.match(completed.json().data.access_token, /^fcs_/u);
    assert.equal(completed.json().data.user.perfil, 'ADMIN');
    const accessToken: string = completed.json().data.access_token;

    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...headers, authorization: `Bearer ${accessToken}` },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().data.user.id, identity.userId);
    assert.deepEqual(session.json().data.user.papeis, ['ADMIN']);
    assert.equal(session.json().data.user.capacidades.length, 1);

    const maintenanceCode = 'MAINTENANCE-CODE-2026';
    const maintenanceWindowId = randomUUID();
    await inTenantTransaction(pool, tenant.id, async (client) => {
      await client.query(
        `INSERT INTO platform.maintenance_windows (
           id,tenant_id,status,reason,starts_at,ends_at,opened_by,challenge_hash
         ) VALUES ($1,$2,'OPEN','Validação interna controlada',
                   clock_timestamp() - interval '1 minute',
                   clock_timestamp() + interval '30 minutes',$3,$4)`,
        [
          maintenanceWindowId,
          tenant.id,
          identity.userId,
          hashMaintenanceCode(environment.auth.maintenanceHmacSecret, maintenanceCode),
        ],
      );
    });

    const invalidMaintenance = await app.inject({
      method: 'POST',
      url: '/v1/auth/maintenance/exchange',
      headers,
      payload: { codigo: 'INVALID-CODE-0000' },
    });
    assert.equal(invalidMaintenance.statusCode, 401);
    assert.equal(invalidMaintenance.json().error.code, 'AUTH_MAINTENANCE_INVALID');

    const maintenance = await app.inject({
      method: 'POST',
      url: '/v1/auth/maintenance/exchange',
      headers,
      payload: { codigo: maintenanceCode },
    });
    assert.equal(maintenance.statusCode, 200);
    assert.equal(maintenance.json().data.acesso_integral, true);
    assert.equal(maintenance.json().data.usuario.perfil, 'SISTEMA');
    assert.match(maintenance.json().data.access_token, /^fcm_/u);
    const maintenanceToken: string = maintenance.json().data.access_token;

    const reusedMaintenance = await app.inject({
      method: 'POST',
      url: '/v1/auth/maintenance/exchange',
      headers,
      payload: { codigo: maintenanceCode },
    });
    assert.equal(reusedMaintenance.statusCode, 401);

    const maintenanceSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...headers, authorization: `Bearer ${maintenanceToken}` },
    });
    assert.equal(maintenanceSession.statusCode, 200);
    assert.equal(maintenanceSession.json().data.user.perfil, 'SISTEMA');
    assert.equal(maintenanceSession.json().data.manutencao.janela_id, maintenanceWindowId);

    await inTenantTransaction(pool, tenant.id, async (client) => {
      await client.query(
        `UPDATE platform.maintenance_windows
         SET status='CLOSED',closed_by=$3
         WHERE tenant_id=$1 AND id=$2`,
        [tenant.id, maintenanceWindowId, identity.userId],
      );
    });
    const closedMaintenanceSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...headers, authorization: `Bearer ${maintenanceToken}` },
    });
    assert.equal(closedMaintenanceSession.statusCode, 401);

    const recoveryOne = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery',
      headers,
      payload: { matricula: identity.employeeNumber },
    });
    const recoveryTwo = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery',
      headers,
      payload: { matricula: 'MATRICULA-INEXISTENTE' },
    });
    assert.equal(recoveryOne.statusCode, 200);
    assert.equal(recoveryTwo.statusCode, 200);
    assert.equal(recoveryOne.json().data.message, recoveryTwo.json().data.message);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { ...headers, authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    assert.equal(logout.statusCode, 200);

    const expiredSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...headers, authorization: `Bearer ${accessToken}` },
    });
    assert.equal(expiredSession.statusCode, 401);

    const persisted = await inTenantTransaction(pool, tenant.id, async (client) => {
      const user = await client.query<{
        first_access_required: boolean;
        password_changed_at: Date | null;
      }>(
        `
          SELECT first_access_required, password_changed_at
          FROM iam.users
          WHERE tenant_id = $1 AND id = $2
        `,
        [tenant.id, identity.userId],
      );
      const recovery = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM iam.recovery_requests
          WHERE tenant_id = $1 AND user_id = $2
        `,
        [tenant.id, identity.userId],
      );
      const audit = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM audit.events
          WHERE tenant_id = $1
            AND user_id = $2
            AND action IN (
              'AUTH_LOGIN_SUCCEEDED',
              'AUTH_FIRST_ACCESS_COMPLETED',
              'AUTH_RECOVERY_REQUESTED',
              'AUTH_LOGOUT'
            )
        `,
        [tenant.id, identity.userId],
      );
      return {
        user: user.rows[0]!,
        recoveryCount: Number(recovery.rows[0]!.count),
        auditCount: Number(audit.rows[0]!.count),
      };
    });

    assert.equal(persisted.user.first_access_required, false);
    assert.ok(persisted.user.password_changed_at);
    assert.equal(persisted.recoveryCount, 1);
    assert.equal(persisted.auditCount, 4);
  },
);

test(
  'multitenancy real: identidades e sessões não atravessam empresas',
  { skip: !integrationEnabled, timeout: 30_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const tenantA = createTestTenant('empresa-a');
    const tenantB = createTestTenant('empresa-b');
    const environment = createTestEnvironment(databaseUrl, tenantA.id, tenantA.slug);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const password = 'Shared!Password-2026';
    const passwordHash = await new PasswordService(environment.auth.passwordPepper).hash(password);
    const sharedEmail = `same.person-${randomUUID()}@tests.vorqix.local`;
    const identityA = await seedIdentity(pool, tenantA, passwordHash, {
      email: sharedEmail,
      firstAccessRequired: false,
    });
    const identityB = await seedIdentity(pool, tenantB, passwordHash, {
      email: sharedEmail,
      firstAccessRequired: false,
    });
    const app = await buildApp({ environment, logger: false });
    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const loginA = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: tenantHeaders(tenantA),
      payload: { matricula: identityA.employeeNumber, senha: password },
    });
    const loginB = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: tenantHeaders(tenantB),
      payload: { matricula: identityB.employeeNumber, senha: password },
    });
    assert.equal(loginA.statusCode, 200);
    assert.equal(loginB.statusCode, 200);
    const tokenA: string = loginA.json().data.access_token;
    const tokenB: string = loginB.json().data.access_token;

    const ownSessionA = await app.inject({
      method: 'GET',
      url: `/v1/auth/session?tenant_id=${tenantB.id}`,
      headers: { ...tenantHeaders(tenantA), authorization: `Bearer ${tokenA}` },
    });
    assert.equal(ownSessionA.statusCode, 200);
    assert.equal(ownSessionA.json().data.user.id, identityA.userId);

    const crossTenantA = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...tenantHeaders(tenantB), authorization: `Bearer ${tokenA}` },
    });
    const crossTenantB = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { ...tenantHeaders(tenantA), authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossTenantA.statusCode, 401);
    assert.equal(crossTenantB.statusCode, 401);

    const visibleFromA = await inTenantTransaction(pool, tenantA.id, async (client) =>
      client.query('SELECT id FROM iam.users WHERE tenant_id = $1 AND id = $2', [tenantB.id, identityB.userId]),
    );
    const visibleFromB = await inTenantTransaction(pool, tenantB.id, async (client) =>
      client.query('SELECT id FROM iam.users WHERE tenant_id = $1 AND id = $2', [tenantA.id, identityA.userId]),
    );
    assert.equal(visibleFromA.rowCount, 0);
    assert.equal(visibleFromB.rowCount, 0);

    const missingTenant = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { host: 'localhost', 'x-vorqix-dev-tenant': `inexistente-${randomUUID().slice(0, 8)}` },
      payload: { matricula: identityA.employeeNumber, senha: password },
    });
    assert.equal(missingTenant.statusCode, 401);

    await inTenantTransaction(pool, tenantB.id, async (client) => {
      await client.query("UPDATE platform.tenants SET status = 'SUSPENDED' WHERE id = $1", [tenantB.id]);
    });
    const inactiveTenant = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: tenantHeaders(tenantB),
      payload: { matricula: identityB.employeeNumber, senha: password },
    });
    assert.equal(inactiveTenant.statusCode, 401);
  },
);
