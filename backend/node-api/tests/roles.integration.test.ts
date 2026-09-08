import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { createTestEnvironment } from './helpers/environment.js';

const roleUserSchema = z.object({
  perfil: z.string(),
  primaryRoleCode: z.string().nullable(),
  roleCodes: z.array(z.string()),
  roleType: z.string().nullable(),
  capacidades: z.array(z.string()),
});
const profilesSchema = z.array(
  z.object({
    perfil: z.string(),
    capacidades: z.array(z.object({ id: z.string(), permitido: z.boolean() })),
  }),
);

test(
  'roles: login real, CUSTOM futuro, precedência, DENY e administração por tenant',
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 120_000,
  },
  async (t) => {
    const tenantId = randomUUID();
    const environment = createTestEnvironment(process.env.TEST_DATABASE_URL, tenantId);
    const pool = new Pool({ connectionString: environment.database.url });
    const password = 'Role-Test!Password2026';
    const hash = await new PasswordService(environment.auth.passwordPepper).hash(password);
    const ids = new Map<string, string>();
    const users = new Map<string, string>();
    const codes = [
      'ADMIN',
      'PCM',
      'PRODUCAO',
      'TECNICO',
      'QUALIDADE',
      'SEGURANCA',
      'GESTOR_TECNICO',
      'OPERADOR',
      'ENGENHARIA_FUTURA',
    ];
    async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (cause) {
        await client.query('ROLLBACK');
        throw cause;
      } finally {
        client.release();
      }
    }
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
      VALUES ($1,'Roles Test','Roles Test',$2,'DEVELOPMENT','ACTIVE')`,
        [tenantId, `roles-${tenantId}`],
      );
      for (const code of codes) {
        const roleId = randomUUID();
        const userId = randomUUID();
        ids.set(code, roleId);
        users.set(code, userId);
        const roleType =
          code === 'ADMIN'
            ? 'ADMIN'
            : code === 'GESTOR_TECNICO'
              ? 'MANAGER'
              : code === 'OPERADOR'
                ? 'OPERATOR'
                : 'CUSTOM';
        await client.query(
          `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type)
        VALUES ($1,$2,$3,$3,'Role test',$4)`,
          [roleId, tenantId, code, roleType],
        );
        await client.query(
          `INSERT INTO iam.users (id,tenant_id,employee_number,name,first_access_required)
        VALUES ($1,$2,$3,$3,false)`,
          [userId, tenantId, code],
        );
        await client.query(
          `INSERT INTO iam.credentials (tenant_id,user_id,credential_type,algorithm,password_hash)
        VALUES ($1,$2,'PASSWORD','ARGON2ID',$3)`,
          [tenantId, userId, hash],
        );
        await client.query(
          'INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)',
          [tenantId, userId, roleId],
        );
        await client.query(
          `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id)
        SELECT $1,$2,id FROM iam.capabilities WHERE code='cmms.structure.read'
          OR ($3='ADMIN' AND code IN ('admin.identity.read','admin.identity.manage'))`,
          [tenantId, roleId, code],
        );
      }
    });
    const app = await buildApp({ environment, logger: false });
    t.after(async () => {
      await app.close();
      await pool.end();
    });
    let adminToken = '';
    let technicianToken = '';
    for (const code of codes) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { matricula: code, senha: password },
      });
      assert.equal(response.statusCode, 200, response.body);
      const data = response.json().data;
      const user = roleUserSchema.parse(data.user ?? data.usuario);
      assert.equal(user.perfil, code);
      assert.equal(user.primaryRoleCode, code);
      assert.deepEqual(user.roleCodes, [code]);
      assert.ok(user.capacidades.includes('cmms.structure.read'));
      if (code === 'ADMIN') adminToken = data.access_token;
      if (code === 'TECNICO') technicianToken = data.access_token;
      const session = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { authorization: `Bearer ${data.access_token}` },
      });
      assert.equal(session.statusCode, 200, session.body);
      assert.equal(session.json().data.user.primaryRoleCode, code);
      const denied = await app.inject({
        method: 'GET',
        url: '/v1/admin/users',
        headers: { authorization: `Bearer ${data.access_token}` },
      });
      assert.equal(denied.statusCode, code === 'ADMIN' ? 200 : 403, denied.body);
    }
    const headers = { authorization: `Bearer ${adminToken}` };
    const matrix = await app.inject({ method: 'GET', url: '/v1/admin/permissions', headers });
    assert.equal(matrix.statusCode, 200, matrix.body);
    const profiles = profilesSchema.parse(matrix.json().data.perfis);
    assert.equal(profiles.length, codes.length);
    assert.ok(profiles.some((item) => item.perfil === 'ENGENHARIA_FUTURA'));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers,
      payload: {
        nome: 'Novo técnico',
        matricula: 'NOVO-TECNICO',
        perfil: 'TECNICO',
        status: 'ATIVO',
        senha_temporaria: password,
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const createdId: string = create.json().data.usuario.id;
    const change = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${createdId}`,
      headers,
      payload: {
        nome: 'Novo técnico',
        matricula: 'NOVO-TECNICO',
        perfil: 'ENGENHARIA_FUTURA',
        status: 'ATIVO',
      },
    });
    assert.equal(change.statusCode, 200, change.body);
    assert.equal(change.json().data.usuario.perfil, 'ENGENHARIA_FUTURA');
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers,
      payload: {
        nome: 'Invalid role',
        matricula: 'INVALID-ROLE',
        perfil: 'OUTRO_TENANT',
        status: 'ATIVO',
        senha_temporaria: password,
      },
    });
    assert.equal(unknown.statusCode, 422, unknown.body);
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)',
        [tenantId, users.get('TECNICO'), ids.get('ADMIN')],
      );
      await client.query(
        `INSERT INTO iam.user_capabilities (tenant_id,user_id,capability_id,effect)
      SELECT $1,$2,id,'DENY' FROM iam.capabilities WHERE code='admin.identity.manage'`,
        [tenantId, users.get('TECNICO')],
      );
    });
    const multi = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${technicianToken}` },
    });
    assert.equal(multi.statusCode, 200, multi.body);
    assert.equal(multi.json().data.user.primaryRoleCode, 'ADMIN');
    assert.deepEqual(multi.json().data.user.roleCodes, ['ADMIN', 'TECNICO']);
    assert.ok(
      !roleUserSchema.parse(multi.json().data.user).capacidades.includes('admin.identity.manage'),
    );
    const listing = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?perfil=TECNICO',
      headers,
    });
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal(
      z
        .array(z.object({ id: z.string() }))
        .parse(listing.json().data.usuarios)
        .filter((item) => item.id === users.get('TECNICO')).length,
      1,
    );
    const permissions = await app.inject({
      method: 'PATCH',
      url: '/v1/admin/permissions/QUALIDADE',
      headers,
      payload: { permissoes: { 'cmms.structure.read': false } },
    });
    assert.equal(permissions.statusCode, 200, permissions.body);
    const after = await app.inject({ method: 'GET', url: '/v1/admin/permissions', headers });
    const safety = profilesSchema
      .parse(after.json().data.perfis)
      .find((item) => item.perfil === 'SEGURANCA');
    assert.ok(safety);
    assert.equal(
      safety.capacidades.find((item) => item.id === 'cmms.structure.read')?.permitido,
      true,
    );
  },
);
