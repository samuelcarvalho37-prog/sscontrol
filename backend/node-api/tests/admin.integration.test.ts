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

function sessionToken(): { readonly raw: string; readonly hash: string } {
  const raw = `fcs_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: createHash('sha256').update(raw, 'utf8').digest('hex') };
}

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
  const session = sessionToken();
  await transaction(pool, async (client) => {
    await client.query(
      `INSERT INTO platform.tenants (id,legal_name,display_name,slug,environment,status)
       VALUES ($1,'Admin Testes','Admin Testes',$2,'DEVELOPMENT','ACTIVE')`,
      [tenantId, `admin-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected)
       VALUES ($1,$2,'ADMIN_TEST','Administrador','Administra o ambiente de testes.','ADMIN',true)`,
      [roleId, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,'USR-ADMIN-MOTOR','Admin Motor','admin.motor@fabcontrol.local',false)`,
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
      [
        tenantId,
        roleId,
        [
          'admin.identity.read',
          'admin.identity.manage',
          'admin.governance.read',
          'admin.governance.manage',
          'admin.configuration.manage',
        ],
      ],
    );
    await client.query(
      `INSERT INTO iam.sessions
         (tenant_id,user_id,token_hash_sha256,environment,scope,ip_address,expires_at)
       VALUES ($1,$2,$3,'DEVELOPMENT','{"purpose":"APPLICATION"}'::jsonb,'127.0.0.1',clock_timestamp()+interval '1 hour')`,
      [tenantId, adminId, session.hash],
    );
  });
  return session.raw;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test(
  'admin: configuração versionada, rollback e catálogo comercial protegido por manutenção',
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

    const initialState = await app.inject({
      method: 'GET',
      url: '/v1/admin/configuration',
      headers: bearer(token),
    });
    assert.equal(initialState.statusCode, 200, initialState.body);
    assert.equal(initialState.json().data.ativa.numero, 0);
    assert.equal(initialState.json().data.ativa.integridade, 'PADRAO_SEGURO');
    assert.equal(initialState.json().data.catalogo.length, 8);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/validate',
      headers: bearer(token),
      payload: { configuracao: { 'parada.tolerancia_retorno_min': -1 } },
    });
    assert.equal(invalid.statusCode, 200, invalid.body);
    assert.equal(invalid.json().data.valido, false);

    const firstConfiguration = Object.fromEntries(
      (
        initialState.json().data.catalogo as { chave: string; padrao: string | number | boolean }[]
      ).map((definition) => [definition.chave, definition.padrao]),
    );
    firstConfiguration['parada.tolerancia_retorno_min'] = 15;
    const firstDraft = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/drafts',
      headers: bearer(token),
      payload: { configuracao: firstConfiguration, base_versao_id: '' },
    });
    assert.equal(firstDraft.statusCode, 200, firstDraft.body);
    assert.equal(firstDraft.json().data.rascunho.validacao.valido, true);

    const firstPublish = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/publish',
      headers: bearer(token),
      payload: { rascunho_id: firstDraft.json().data.rascunho.id },
    });
    assert.equal(firstPublish.statusCode, 200, firstPublish.body);
    assert.equal(firstPublish.json().data.ativa.numero, 1);
    const firstVersionId: string = firstPublish.json().data.ativa.id;

    const secondConfiguration = { ...firstConfiguration, 'parada.tolerancia_retorno_min': 20 };
    const secondDraft = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/drafts',
      headers: bearer(token),
      payload: { configuracao: secondConfiguration, base_versao_id: firstVersionId },
    });
    assert.equal(secondDraft.statusCode, 200, secondDraft.body);
    const secondPublish = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/publish',
      headers: bearer(token),
      payload: { rascunho_id: secondDraft.json().data.rascunho.id },
    });
    assert.equal(secondPublish.statusCode, 200, secondPublish.body);

    const rollback = await app.inject({
      method: 'POST',
      url: '/v1/admin/configuration/rollback',
      headers: bearer(token),
      payload: {
        versao_id: firstVersionId,
        base_versao_id: secondPublish.json().data.ativa.id,
        motivo: 'Restaurar tolerância homologada anteriormente.',
      },
    });
    assert.equal(rollback.statusCode, 200, rollback.body);
    assert.equal(rollback.json().data.ativa.configuracao['parada.tolerancia_retorno_min'], 15);
    assert.equal(rollback.json().data.rollback_from_version_id, firstVersionId);

    const catalog = await app.inject({
      method: 'GET',
      url: '/v1/platform/motor/catalog',
      headers: bearer(token),
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    assert.equal(catalog.json().data.planos.length, 3);
    assert.equal(catalog.json().data.controle.edicao_disponivel, false);

    const lockedDraft = await app.inject({
      method: 'POST',
      url: '/v1/platform/motor/catalog/drafts',
      headers: bearer(token),
      payload: { planos: catalog.json().data.planos, base_versao_id: '' },
    });
    assert.equal(lockedDraft.statusCode, 423, lockedDraft.body);
    assert.equal(lockedDraft.json().error.code, 'MAINTENANCE_WINDOW_REQUIRED');

    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO platform.maintenance_windows
           (tenant_id,status,reason,starts_at,ends_at,opened_by,challenge_hash)
         VALUES ($1,'OPEN','Teste controlado do catálogo',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes',$2,'0000000000000000000000000000000000000000000000000000000000000000')`,
        [tenantId, adminId],
      );
    });
    const catalogDraft = await app.inject({
      method: 'POST',
      url: '/v1/platform/motor/catalog/drafts',
      headers: bearer(token),
      payload: { planos: catalog.json().data.planos, base_versao_id: '' },
    });
    assert.equal(catalogDraft.statusCode, 200, catalogDraft.body);
    const catalogPublish = await app.inject({
      method: 'POST',
      url: '/v1/platform/motor/catalog/publish',
      headers: bearer(token),
      payload: { rascunho_id: catalogDraft.json().data.rascunho.id },
    });
    assert.equal(catalogPublish.statusCode, 200, catalogPublish.body);
    assert.equal(catalogPublish.json().data.ativa.numero, 1);

    const monitoring = await app.inject({
      method: 'GET',
      url: '/v1/admin/monitoring',
      headers: bearer(token),
    });
    assert.equal(monitoring.statusCode, 200, monitoring.body);
    assert.equal(monitoring.json().data.health.ok, true);
    assert.equal(monitoring.json().data.health.spreadsheetId, 'postgresql');
    assert.equal(monitoring.json().data.diagnostico.total_issues, 0);
    assert.ok(Number(monitoring.json().data.tabelas_declaradas) >= 40);
    assert.ok(Number(monitoring.json().data.auditoria.eventos_24h) >= 1);

    const auditTrail = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limite=5',
      headers: bearer(token),
    });
    assert.equal(auditTrail.statusCode, 200, auditTrail.body);
    const event = auditTrail.json().data.eventos[0];
    assert.equal(typeof event.usuario_id, 'string');
    assert.equal(typeof event.acao, 'string');
    assert.equal(typeof event.entidade_id, 'string');
    assert.equal(typeof event.criado_em, 'string');
  },
);
