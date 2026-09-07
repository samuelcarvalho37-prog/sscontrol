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
       VALUES ($1,'Governança Testes','Governança Testes',$2,'DEVELOPMENT','ACTIVE')`,
      [tenantId, `governance-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO iam.roles (id,tenant_id,code,name,description,role_type,protected)
       VALUES ($1,$2,'ADMIN_GOV_TEST','Administrador','Governa documentos.','ADMIN',true)`,
      [roleId, tenantId],
    );
    await client.query(
      `INSERT INTO iam.users (id,tenant_id,employee_number,name,email,first_access_required)
       VALUES ($1,$2,'USR-ADMIN-GOV','Admin Governança','admin.gov@fabcontrol.local',false)`,
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

function metadata(documentId?: string) {
  return {
    ...(documentId ? { documento_id: documentId } : {}),
    codigo: 'DOC-SEG-001',
    titulo: 'Procedimento de bloqueio e etiquetagem',
    tipo: 'PROCEDIMENTO',
    entidade_tipo: 'EMPRESA',
    status: 'VIGENTE',
    validade_em: '2027-12-31',
    responsavel_id: adminId,
    descricao: 'Documento controlado para execução segura.',
    observacao: documentId ? 'Revisão de homologação.' : 'Emissão inicial.',
  };
}

test(
  'governança: documento privado, revisão imutável, metadados e download autenticado',
  { skip: !integrationEnabled, timeout: 45_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const token = await seed(pool);
    const storageRoot = await mkdtemp(join(tmpdir(), 'fab-control-governance-'));
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

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf8');
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/admin/documents',
      headers: bearer(token),
      payload: {
        dados: metadata(),
        arquivo: {
          nome: 'procedimento-loto.pdf',
          mime_type: 'application/pdf',
          base64: `data:application/pdf;base64,${pdf.toString('base64')}`,
        },
      },
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const documentId = String(upload.json().data.documento.id);
    assert.equal(upload.json().data.documento.revisao_atual, 'R1');

    const revision = await app.inject({
      method: 'POST',
      url: '/v1/admin/documents',
      headers: bearer(token),
      payload: {
        dados: metadata(documentId),
        arquivo: {
          nome: 'procedimento-loto-r2.pdf',
          mime_type: 'application/pdf',
          base64: `data:application/pdf;base64,${pdf.toString('base64')}`,
        },
      },
    });
    assert.equal(revision.statusCode, 200, revision.body);
    assert.equal(revision.json().data.documento.revisao_atual, 'R2');

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/admin/documents/${documentId}`,
      headers: bearer(token),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const detailBody = detail.json<{
      data: {
        documento: { arquivo_id: string };
        revisoes: { revisao: string }[];
      };
    }>();
    assert.equal(detailBody.data.revisoes.length, 2);
    assert.deepEqual(
      detailBody.data.revisoes.map((item) => item.revisao),
      ['R2', 'R1'],
    );

    const currentObjectId = detailBody.data.documento.arquivo_id;
    const download = await app.inject({
      method: 'GET',
      url: `/v1/admin/document-files/${currentObjectId}`,
      headers: bearer(token),
    });
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.deepEqual(download.rawPayload, pdf);

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/v1/admin/document-files/${currentObjectId}`,
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const update = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/documents/${documentId}`,
      headers: bearer(token),
      payload: {
        dados: {
          ...metadata(documentId),
          titulo: 'Procedimento LOTO aprovado',
          status: 'EM_REVISAO',
        },
      },
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(update.json().data.documento.titulo, 'Procedimento LOTO aprovado');
    assert.equal(update.json().data.documento.revisao_atual, 'R2');

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/admin/documents',
      headers: bearer(token),
      payload: {
        dados: { ...metadata(), codigo: 'DOC-INVALIDO' },
        arquivo: {
          nome: 'arquivo.pdf',
          mime_type: 'application/pdf',
          base64: `data:application/pdf;base64,${Buffer.from('não é PDF').toString('base64')}`,
        },
      },
    });
    assert.equal(invalid.statusCode, 422, invalid.body);
    assert.equal(invalid.json().error.code, 'FILE_CONTENT_INVALID');

    const auditCount = await transaction(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit.events
         WHERE entity_type='technical_document' AND entity_id=$1`,
        [documentId],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
    assert.equal(auditCount, 3);
  },
);
