import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { LocalObjectStorage } from '../src/infrastructure/storage/object-storage.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = randomUUID();
const adminId = randomUUID();
const roleId = randomUUID();
const plantId = randomUUID();

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
       VALUES ($1,'Backup Testes','Backup Testes',$2,'DEVELOPMENT','ACTIVE')`,
      [tenantId, `backup-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected)
       VALUES ($1,$2,'ADMIN_BACKUP_TEST','Administrador','Governa backups.','ADMIN',true)`,
      [roleId, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,'USR-ADMIN-BACKUP','Admin Backup','admin.backup@fabcontrol.local',false)`,
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
    await client.query(
      `INSERT INTO cmms.plants (id,tenant_id,tag,name,status)
       VALUES ($1,$2,'PLT-BACKUP','Nome no backup','ACTIVE')`,
      [plantId, tenantId],
    );
  });
  return raw;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test(
  'continuidade: backup privado verificado, desafio assinado e restauração com cópia de segurança',
  { skip: !integrationEnabled, timeout: 60_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const token = await seed(pool);
    const storageRoot = await mkdtemp(join(tmpdir(), 'fab-control-backup-'));
    const app = await buildApp({
      environment: createTestEnvironment(databaseUrl, tenantId),
      objectStorage: new LocalObjectStorage(storageRoot, 6_291_456),
      logger: false,
    });
    context.after(async () => {
      await app.close();
      await pool.end();
      await rm(storageRoot, { recursive: true, force: true });
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/backups',
      headers: bearer(token),
      payload: { motivo: 'Ponto anterior à homologação.', confirmacao: 'CRIAR BACKUP' },
    });
    assert.equal(created.statusCode, 200, created.body);
    const backup = created.json().data.backup;
    assert.ok(Number(backup.tamanho_bytes) > 0);

    await transaction(pool, (client) =>
      client
        .query(`UPDATE cmms.plants SET name='Nome alterado' WHERE id=$1`, [plantId])
        .then(() => undefined),
    );

    const preparation = await app.inject({
      method: 'POST',
      url: `/v1/admin/backups/${String(backup.id)}/prepare`,
      headers: bearer(token),
      payload: {},
    });
    assert.equal(preparation.statusCode, 200, preparation.body);
    const prepared = preparation.json().data;

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/admin/backups/${String(backup.id)}/restore`,
      headers: bearer(token),
      payload: {
        token: prepared.token,
        confirmacao: prepared.desafio,
        confirmacao_final: prepared.confirmacao_final,
        motivo: 'Retornar ao ponto validado de homologação.',
        criar_backup_seguranca: true,
      },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().data.restored, true);
    assert.notEqual(restored.json().data.backup_seguranca.id, backup.id);

    const plantName = await transaction(pool, async (client) => {
      const result = await client.query<{ name: string }>(
        `SELECT name FROM cmms.plants WHERE id=$1`,
        [plantId],
      );
      return result.rows[0]?.name;
    });
    assert.equal(plantName, 'Nome no backup');

    const download = await app.inject({
      method: 'GET',
      url: `/v1/admin/backups/${String(backup.id)}/file`,
      headers: bearer(token),
    });
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.headers['content-type'], 'application/gzip');
    assert.equal(download.rawPayload[0], 0x1f);
    assert.equal(download.rawPayload[1], 0x8b);
  },
);
