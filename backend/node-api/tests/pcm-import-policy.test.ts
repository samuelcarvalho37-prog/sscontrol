import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Database } from '../src/infrastructure/database/database.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';
import { ImportService } from '../src/modules/governance/import.service.js';

const actor = {
  id: randomUUID(),
  tenantId: randomUUID(),
  capabilities: ['cmms.imports.manage', 'cmms.assets.manage'],
  roles: ['PCM'],
} as unknown as AuthenticatedUser;
const audit = {
  traceId: randomUUID(),
  userAgent: null,
  ipAddress: '127.0.0.1',
  roleSnapshot: 'PCM',
};
test('catálogo PCM respeita capacidade por entidade e não expõe fontes de preços', async () => {
  const service = new ImportService({} as Database);
  assert.deepEqual(
    service.pcmCatalog(actor).modelos.map((model) => model.tipo),
    ['ativos', 'componentes'],
  );
  await assert.rejects(
    service.validatePcm(
      actor,
      { type: 'fontes_valores', fileName: 'teste.csv', sheetName: 'dados', headers: [], rows: [] },
      audit,
    ),
    { code: 'IMPORT_TYPE_FORBIDDEN' },
  );
  assert.equal(
    service.pcmCatalog({ ...actor, capabilities: ['cmms.assets.manage'] }).modelos.length,
    0,
  );
});

test('PCM não importa estrutura exclusiva do TI mesmo com capacidade de estrutura', async () => {
  const service = new ImportService({} as Database);
  const user = {
    ...actor,
    capabilities: [
      ...actor.capabilities,
      'cmms.structure.manage',
      'cmms.materials.manage',
      'admin.technical-structure.manage',
    ],
  };
  assert.deepEqual(
    service
      .pcmCatalog(user)
      .modelos.map((model) => model.tipo)
      .sort(),
    ['ativos', 'componentes', 'materiais', 'areas_tecnicas', 'cargos_tecnicos'].sort(),
  );
  for (const type of ['plantas', 'setores', 'linhas']) {
    await assert.rejects(
      service.validatePcm(
        user,
        { type, fileName: 'teste.csv', sheetName: 'dados', headers: [], rows: [] },
        audit,
      ),
      { code: 'IMPORT_TYPE_FORBIDDEN' },
    );
  }
});

test(
  'importação real de áreas e cargos confirma lote próprio e reverte todos os dados de teste',
  { skip: !process.env.PCM_IMPORT_TEST_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.PCM_IMPORT_TEST_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query(
        "SELECT u.id,u.tenant_id FROM iam.users u JOIN platform.tenants t ON t.id=u.tenant_id WHERE t.slug='manteiga-serra-dourada-demo' AND u.deleted_at IS NULL LIMIT 1",
      );
      assert.ok(identity.rows[0]);
      const user = {
        ...actor,
        id: identity.rows[0].id,
        tenantId: identity.rows[0].tenant_id,
        capabilities: ['cmms.imports.manage', 'admin.technical-structure.manage'],
      };
      await client.query('SET LOCAL ROLE fab_control_api_local');
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [user.tenantId, user.id],
      );
      const db = {
        withTransaction: async (
          _context: unknown,
          operation: (connection: typeof client) => unknown,
        ) => operation(client),
      } as Database;
      const service = new ImportService(db);
      const code = `TEST-${randomUUID().slice(0, 8)}`;
      const area = await service.validatePcm(
        user,
        {
          type: 'areas_tecnicas',
          fileName: 'area.csv',
          sheetName: 'dados',
          headers: ['codigo', 'nome'],
          rows: [{ __linha: 2, codigo: code, nome: 'Área de teste temporário' }],
        },
        audit,
      );
      assert.equal(area.status, 'VALIDADO');
      await assert.rejects(
        service.confirm({ ...user, id: randomUUID() }, area.id, area.validacao_hash!, audit, true),
        { code: 'IMPORT_BATCH_FORBIDDEN' },
      );
      const confirmed = await service.confirm(user, area.id, area.validacao_hash!, audit, true);
      assert.equal(confirmed.status, 'CONCLUIDO');
      const role = await service.validatePcm(
        user,
        {
          type: 'cargos_tecnicos',
          fileName: 'cargo.csv',
          sheetName: 'dados',
          headers: ['area_id', 'codigo', 'nome'],
          rows: [{ __linha: 2, area_id: code, codigo: code, nome: 'Cargo de teste temporário' }],
        },
        audit,
      );
      assert.equal(role.status, 'VALIDADO');
      assert.equal(
        (await service.confirm(user, role.id, role.validacao_hash!, audit, true)).status,
        'CONCLUIDO',
      );
      const roles = await client.query(
        'SELECT name FROM iam.technical_roles WHERE upper(code)=upper($1)',
        [code],
      );
      assert.equal(roles.rows[0].name, 'Cargo de teste temporário');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  },
);
