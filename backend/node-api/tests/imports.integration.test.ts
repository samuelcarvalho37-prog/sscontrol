import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = randomUUID();
const adminId = randomUUID();
const roleId = randomUUID();

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)`,
      [tenantId, adminId],
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  } finally {
    client.release();
  }
}

async function seed(pool: Pool): Promise<string> {
  const raw = `fcs_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
  await transaction(pool, async (client) => {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
       VALUES ($1,'Importação Testes','Importação Testes',$2,'DEVELOPMENT','ACTIVE')`,
      [tenantId, `imports-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected)
       VALUES ($1,$2,'ADMIN_IMPORT_TEST','Administrador','Governa importações.','ADMIN',true)`,
      [roleId, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,'USR-ADMIN-IMPORT','Admin Importação','admin.import@fabcontrol.local',false)`,
      [adminId, tenantId],
    );
    await client.query(`INSERT INTO iam.user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)`, [
      tenantId,
      adminId,
      roleId,
    ]);
    await client.query(
      `INSERT INTO iam.role_capabilities (tenant_id,role_id,capability_id,effect)
       SELECT $1,$2,id,'ALLOW' FROM iam.capabilities
       WHERE code=ANY($3::text[])`,
      [tenantId, roleId, ['admin.governance.read', 'admin.governance.manage']],
    );
    await client.query(
      `INSERT INTO iam.sessions
         (tenant_id,user_id,token_hash_sha256,environment,scope,ip_address,expires_at)
       VALUES ($1,$2,$3,'DEVELOPMENT','{"purpose":"APPLICATION"}'::jsonb,'127.0.0.1',clock_timestamp()+interval '1 hour')`,
      [tenantId, adminId, hash],
    );
  });
  return raw;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function validationPayload(tag: string, name: string) {
  return {
    tipo: 'plantas',
    arquivo_nome: 'plantas.xlsx',
    aba_nome: 'Plantas',
    cabecalhos: ['TAG', 'Nome', 'Status'],
    linhas: [{ __linha: 2, TAG: tag, Nome: name, Status: 'ATIVO' }],
  };
}

test(
  'importação governada: valida, confirma, bloqueia concorrência e reverte sem perda',
  { skip: !integrationEnabled, timeout: 45_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const token = await seed(pool);
    const app = await buildApp({
      environment: createTestEnvironment(databaseUrl, tenantId),
      logger: false,
    });
    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const catalog = await app.inject({
      method: 'GET',
      url: '/v1/admin/imports/models',
      headers: bearer(token),
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    assert.equal(catalog.json().data.modelos.length, 6);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports/validate',
      headers: bearer(token),
      payload: {
        ...validationPayload('PLT-INVALIDA', 'Planta Inválida'),
        linhas: [{ __linha: 2, TAG: 'PLT-INVALIDA', Nome: '' }],
      },
    });
    assert.equal(invalid.statusCode, 200, invalid.body);
    assert.equal(invalid.json().data.status, 'COM_ERROS');
    assert.equal(invalid.json().data.linhas_invalidas, 1);

    const validation = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports/validate',
      headers: bearer(token),
      payload: validationPayload('PLT-IMPORT', 'Planta Importada'),
    });
    assert.equal(validation.statusCode, 200, validation.body);
    const batch = validation.json().data;
    assert.equal(batch.status, 'VALIDADO');

    const confirmation = await app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${String(batch.id)}/confirm`,
      headers: bearer(token),
      payload: { validacao_hash: batch.validacao_hash },
    });
    assert.equal(confirmation.statusCode, 200, confirmation.body);
    assert.equal(confirmation.json().data.status, 'CONCLUIDO');
    assert.equal(confirmation.json().data.resultado.criados, 1);

    const importedId = await transaction(pool, async (client) => {
      const result = await client.query<{ id: string; name: string }>(
        `SELECT id,name FROM cmms.plants WHERE tag='PLT-IMPORT'`,
      );
      const row = result.rows[0];
      assert.ok(row);
      assert.equal(row.name, 'Planta Importada');
      return row.id;
    });

    const rollback = await app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${String(batch.id)}/rollback`,
      headers: bearer(token),
      payload: { motivo: 'Lote criado exclusivamente para homologação.' },
    });
    assert.equal(rollback.statusCode, 200, rollback.body);
    assert.equal(rollback.json().data.status, 'REVERTIDO');

    const removed = await transaction(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM cmms.plants WHERE id=$1`,
        [importedId],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
    assert.equal(removed, 0);

    const auditCount = await transaction(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit.events
         WHERE entity_type='import_batch' AND entity_id=$1`,
        [batch.id],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
    assert.equal(auditCount, 3);
  },
);
