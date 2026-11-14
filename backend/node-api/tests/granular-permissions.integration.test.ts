import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuthRepository, type SessionRecord } from '../src/modules/auth/auth.repository.js';
import { AdminRepository } from '../src/modules/admin/admin.repository.js';
import { routeCapability } from '../src/modules/auth/capability-catalog.js';

test(
  'permissões granulares preservam negativas, permitem trocar o padrão e respeitam o teto comercial com RLS',
  { skip: !process.env.PERMISSIONS_TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PERMISSIONS_TEST_DATABASE_URL });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const tenant = (
        await c.query('SELECT id FROM platform.tenants WHERE slug=$1 AND deleted_at IS NULL', [
          process.env.PERMISSIONS_TEST_TENANT ?? 'tozzi-alimentos',
        ])
      ).rows[0];
      assert.ok(tenant);
      const userId = randomUUID(),
        roleId = randomUUID(),
        code = `GRANULAR_${randomUUID().slice(0, 8)}`;
      await c.query(
        "INSERT INTO iam.users(id,tenant_id,employee_number,name) VALUES($1,$2,$3,'Verificação transacional de permissões')",
        [userId, tenant.id, code],
      );
      await c.query(
        "INSERT INTO iam.roles(id,tenant_id,code,name,description,role_type) VALUES($1,$2,$3,'Verificação','Transação revertida','CUSTOM')",
        [roleId, tenant.id, code],
      );
      await c.query('INSERT INTO iam.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)', [
        tenant.id,
        userId,
        roleId,
      ]);
      const create = routeCapability('POST', '/v1/cmms/parameters', ''),
        edit = routeCapability('PATCH', '/v1/cmms/parameters/:parameterId', '');
      await c.query(
        "INSERT INTO iam.role_capabilities(tenant_id,role_id,capability_id,effect) SELECT $1,$2,id,'DENY' FROM iam.capabilities WHERE code='cmms.parameters.manage'",
        [tenant.id, roleId],
      );
      await c.query(
        "INSERT INTO iam.role_capabilities(tenant_id,role_id,capability_id,effect) SELECT $1,$2,id,'ALLOW' FROM iam.capabilities WHERE code=$3",
        [tenant.id, roleId, create],
      );
      await c.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [tenant.id, userId],
      );
      await c.query('SET LOCAL ROLE fab_control_api_local');
      const session = {
        tenantId: tenant.id,
        userId,
        sessionId: randomUUID(),
        employeeNumber: code,
        name: 'Verificação',
        email: null,
      } as SessionRecord;
      const repository = new AuthRepository();
      let user = await repository.resolveUser(c, session);
      assert.ok(
        user.capabilities.includes(create),
        'ALLOW específico supera padrão DENY do mesmo perfil',
      );
      assert.ok(!user.capabilities.includes(edit), 'editar continua negado');
      await new AdminRepository().savePermissions(c, code, { [create]: false }, userId);
      user = await repository.resolveUser(c, session);
      assert.ok(!user.capabilities.includes(create));
      await new AdminRepository().savePermissions(c, code, { [create]: true }, userId);
      user = await repository.resolveUser(c, session);
      assert.ok(user.capabilities.includes(create));
      await c.query('RESET ROLE');
      await c.query(
        "INSERT INTO iam.user_capabilities(tenant_id,user_id,capability_id,effect) SELECT $1,$2,id,'DENY' FROM iam.capabilities WHERE code=$3",
        [tenant.id, userId, create],
      );
      await c.query('SET LOCAL ROLE fab_control_api_local');
      user = await repository.resolveUser(c, session);
      assert.ok(!user.capabilities.includes(create), 'negação individual prevalece');
      await c.query('RESET ROLE');
      await c.query('DELETE FROM iam.user_capabilities WHERE user_id=$1', [userId]);
      await c.query(
        'UPDATE platform.commercial_plans SET limits=jsonb_set(limits,\'{permissions}\',\'{"personalizavel":false,"permissoes":[]}\'::jsonb) WHERE id=(SELECT commercial_plan_id FROM platform.tenant_subscriptions WHERE tenant_id=$1 ORDER BY starts_at DESC,created_at DESC,id DESC LIMIT 1)',
        [tenant.id],
      );
      await c.query('SET LOCAL ROLE fab_control_api_local');
      user = await repository.resolveUser(c, session);
      assert.ok(!user.capabilities.includes(create), 'plano restringe concessão do perfil');
    } finally {
      await c.query('ROLLBACK');
      c.release();
      await pool.end();
    }
  },
);

test(
  'plano e limites de permissões são salvos atomicamente e códigos desconhecidos são recusados',
  { skip: !process.env.PERMISSIONS_TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PERMISSIONS_TEST_DATABASE_URL });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const actor = (
        await c.query("SELECT id FROM platform.platform_operators WHERE status='ACTIVE' LIMIT 1")
      ).rows[0];
      assert.ok(actor);
      const planCode = `PERM_${randomUUID().slice(0, 8).toUpperCase()}`;
      const sql = `WITH saved AS MATERIALIZED (SELECT platform.save_console_plan($1,NULL,$2,'Plano transacional','Teste revertido','DRAFT',0,ARRAY[]::text[],'teste') AS plan_id) SELECT plan_id,platform.save_console_permission_policy($1,plan_id,false,$3,'teste') FROM saved`;
      await c.query('SET LOCAL ROLE fab_control_api_local');
      const saved = (await c.query(sql, [actor.id, planCode, []])).rows[0];
      assert.ok(saved?.plan_id);
      const policy = (
        await c.query('SELECT platform.read_console_permission_policy($1) AS value', [
          saved.plan_id,
        ])
      ).rows[0].value;
      assert.deepEqual(policy, { personalizavel: false, permissoes: [] });
      await c.query('SAVEPOINT invalid_plan');
      await assert.rejects(
        c.query(sql, [actor.id, planCode + '_ERR', ['permissao.inexistente']]),
        (error: unknown) =>
          Boolean(error && typeof error === 'object' && 'code' in error && error.code === '22023'),
      );
      await c.query('ROLLBACK TO SAVEPOINT invalid_plan');
      await c.query('RESET ROLE');
      const partial = (
        await c.query(
          'SELECT count(*)::int AS total FROM platform.commercial_plans WHERE code=$1',
          [planCode + '_ERR'],
        )
      ).rows[0];
      assert.equal(partial.total, 0, 'plano não pode persistir quando a política falha');
    } finally {
      await c.query('ROLLBACK');
      c.release();
      await pool.end();
    }
  },
);
