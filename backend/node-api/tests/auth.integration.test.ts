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
const tenantId = '00000000-0000-4000-8000-000000000003';

async function inTenantTransaction<T>(
  pool: Pool,
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

async function seedIdentity(pool: Pool, passwordHash: string) {
  const userId = randomUUID();
  const roleId = randomUUID();
  let capabilityId = '';

  await inTenantTransaction(pool, async (client) => {
    await client.query(
      `
        INSERT INTO platform.tenants (
          id, legal_name, display_name, slug, environment, status
        )
        VALUES ($1, 'Fab Control Testes', 'Fab Control Testes', $2, 'DEVELOPMENT', 'ACTIVE')
      `,
      [tenantId, `fab-control-tests-${randomUUID()}`],
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
      [roleId, tenantId],
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
        VALUES ($1, $2, 'USR-ADMIN-TEST', 'Admin Teste', 'admin.test@fabcontrol.local', true)
      `,
      [userId, tenantId],
    );
    await client.query(
      `
        INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
        VALUES ($1, $2, $3)
      `,
      [tenantId, userId, roleId],
    );
    await client.query(
      `
        INSERT INTO iam.role_capabilities (
          tenant_id, role_id, capability_id, effect
        )
        VALUES ($1, $2, $3, 'ALLOW')
      `,
      [tenantId, roleId, capabilityId],
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
      [tenantId, userId, passwordHash],
    );
  });

  return { userId };
}

test(
  'fluxo real: login, primeiro acesso, sessão, recuperação e logout',
  { skip: !integrationEnabled, timeout: 30_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const environment = createTestEnvironment(databaseUrl, tenantId);
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const initialPassword = 'Initial!Password-2026';
    const changedPassword = 'Changed!Password-2026';
    const passwordHash = await new PasswordService(environment.auth.passwordPepper).hash(
      initialPassword,
    );
    const identity = await seedIdentity(pool, passwordHash);
    const app = await buildApp({ environment, logger: false });

    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { matricula: 'USR-ADMIN-TEST', senha: 'Wrong!Password-2026' },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().error.code, 'AUTH_INVALID_CREDENTIALS');

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { matricula: 'usr-admin-test', senha: initialPassword },
    });
    assert.equal(firstLogin.statusCode, 200);
    assert.equal(firstLogin.json().data.first_access_required, true);
    assert.match(firstLogin.json().data.change_token, /^fcf_/u);
    const changeToken: string = firstLogin.json().data.change_token;

    const firstAccessTokenRejected = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${changeToken}` },
    });
    assert.equal(firstAccessTokenRejected.statusCode, 401);

    const completed = await app.inject({
      method: 'POST',
      url: '/v1/auth/first-access',
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
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().data.user.id, identity.userId);
    assert.deepEqual(session.json().data.user.papeis, ['ADMIN']);
    assert.equal(session.json().data.user.capacidades.length, 1);

    const maintenanceCode = 'MAINTENANCE-CODE-2026';
    const maintenanceWindowId = randomUUID();
    await inTenantTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO platform.maintenance_windows (
           id,tenant_id,status,reason,starts_at,ends_at,opened_by,challenge_hash
         ) VALUES ($1,$2,'OPEN','Validação interna controlada',
                   clock_timestamp() - interval '1 minute',
                   clock_timestamp() + interval '30 minutes',$3,$4)`,
        [
          maintenanceWindowId,
          tenantId,
          identity.userId,
          hashMaintenanceCode(environment.auth.maintenanceHmacSecret, maintenanceCode),
        ],
      );
    });

    const invalidMaintenance = await app.inject({
      method: 'POST',
      url: '/v1/auth/maintenance/exchange',
      payload: { codigo: 'INVALID-CODE-0000' },
    });
    assert.equal(invalidMaintenance.statusCode, 401);
    assert.equal(invalidMaintenance.json().error.code, 'AUTH_MAINTENANCE_INVALID');

    const maintenance = await app.inject({
      method: 'POST',
      url: '/v1/auth/maintenance/exchange',
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
      payload: { codigo: maintenanceCode },
    });
    assert.equal(reusedMaintenance.statusCode, 401);

    const maintenanceSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${maintenanceToken}` },
    });
    assert.equal(maintenanceSession.statusCode, 200);
    assert.equal(maintenanceSession.json().data.user.perfil, 'SISTEMA');
    assert.equal(maintenanceSession.json().data.manutencao.janela_id, maintenanceWindowId);

    await inTenantTransaction(pool, async (client) => {
      await client.query(
        `UPDATE platform.maintenance_windows
         SET status='CLOSED',closed_by=$3
         WHERE tenant_id=$1 AND id=$2`,
        [tenantId, maintenanceWindowId, identity.userId],
      );
    });
    const closedMaintenanceSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${maintenanceToken}` },
    });
    assert.equal(closedMaintenanceSession.statusCode, 401);

    const recoveryOne = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery',
      payload: { matricula: 'USR-ADMIN-TEST' },
    });
    const recoveryTwo = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery',
      payload: { matricula: 'MATRICULA-INEXISTENTE' },
    });
    assert.equal(recoveryOne.statusCode, 200);
    assert.equal(recoveryTwo.statusCode, 200);
    assert.equal(recoveryOne.json().data.message, recoveryTwo.json().data.message);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    assert.equal(logout.statusCode, 200);

    const expiredSession = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(expiredSession.statusCode, 401);

    const persisted = await inTenantTransaction(pool, async (client) => {
      const user = await client.query<{
        first_access_required: boolean;
        password_changed_at: Date | null;
      }>(
        `
          SELECT first_access_required, password_changed_at
          FROM iam.users
          WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, identity.userId],
      );
      const recovery = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM iam.recovery_requests
          WHERE tenant_id = $1 AND user_id = $2
        `,
        [tenantId, identity.userId],
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
        [tenantId, identity.userId],
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
