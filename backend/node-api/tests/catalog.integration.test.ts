import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { buildApp } from '../src/app.js';
import { createTestEnvironment } from './helpers/environment.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const tenantId = '00000000-0000-4000-8000-000000000002';

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

async function seedAuthorizedSession(pool: Pool): Promise<{
  readonly token: string;
  readonly userId: string;
  readonly roleId: string;
}> {
  const userId = randomUUID();
  const roleId = randomUUID();
  const token = `fcs_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  await inTenantTransaction(pool, async (client) => {
    await client.query(
      `
        INSERT INTO platform.tenants (
          id, legal_name, display_name, slug, environment, status
        )
        VALUES ($1, 'Catálogo Testes', 'Catálogo Testes', $2, 'DEVELOPMENT', 'ACTIVE')
      `,
      [tenantId, `catalog-tests-${randomUUID()}`],
    );
    await client.query(
      `
        INSERT INTO iam.roles (
          id, tenant_id, code, name, description, role_type, protected
        )
        VALUES ($1, $2, 'CATALOG_ADMIN', 'Administrador do catálogo', 'Teste integral.', 'ADMIN', true)
      `,
      [roleId, tenantId],
    );
    await client.query(
      `
        INSERT INTO iam.users (
          id, tenant_id, employee_number, name, email, first_access_required
        )
        VALUES ($1, $2, 'USR-CATALOG-TEST', 'Admin Catálogo', 'catalog@fabcontrol.local', false)
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
        SELECT $1, $2, capability.id, 'ALLOW'
        FROM iam.capabilities capability
        WHERE capability.code = ANY($3::text[])
      `,
      [
        tenantId,
        roleId,
        [
          'cmms.structure.read',
          'cmms.structure.manage',
          'cmms.assets.read',
          'cmms.assets.manage',
          'cmms.parameters.read',
          'cmms.parameters.manage',
          'cmms.materials.read',
          'cmms.materials.manage',
          'cmms.readings.create',
        ],
      ],
    );
    await client.query(
      `
        INSERT INTO iam.sessions (
          tenant_id, user_id, token_hash_sha256, environment, scope,
          ip_address, expires_at
        )
        VALUES (
          $1, $2, $3, 'DEVELOPMENT', '{"purpose":"APPLICATION"}'::jsonb,
          '127.0.0.1', clock_timestamp() + interval '1 hour'
        )
      `,
      [tenantId, userId, tokenHash],
    );
  });

  return { token, userId, roleId };
}

test(
  'fluxo real do catálogo: estrutura, ativo, componente, material, parâmetro, leitura, alerta e auditoria',
  { skip: !integrationEnabled, timeout: 30_000 },
  async (context) => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const identity = await seedAuthorizedSession(pool);
    const app = await buildApp({
      environment: createTestEnvironment(databaseUrl, tenantId),
      logger: false,
    });
    const authorization = { authorization: `Bearer ${identity.token}` };

    context.after(async () => {
      await app.close();
      await pool.end();
    });

    const plantResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/plants',
      headers: authorization,
      payload: { tag: 'plt-01', nome: 'Planta de Testes' },
    });
    assert.equal(plantResponse.statusCode, 200, plantResponse.body);
    const plantId: string = plantResponse.json().data.id;

    const sectorResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/sectors',
      headers: authorization,
      payload: { planta_id: plantId, tag: 'man', nome: 'Manutenção' },
    });
    assert.equal(sectorResponse.statusCode, 200, sectorResponse.body);
    const sectorId: string = sectorResponse.json().data.id;

    const lineResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/lines',
      headers: authorization,
      payload: { setor_id: sectorId, tag: 'lin-01', nome: 'Linha Principal' },
    });
    assert.equal(lineResponse.statusCode, 200, lineResponse.body);
    const lineId: string = lineResponse.json().data.id;

    const assetResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/assets',
      headers: authorization,
      payload: {
        linha_id: lineId,
        tag: 'eq-mot-001',
        nome: 'Motor Principal',
        tipo: 'ELECTRIC_MOTOR',
        criticidade: 'CRITICAL',
        status_operacional: 'OPERATING',
        status_ciclo_vida: 'ACTIVE',
        saude_percentual: 96,
        horimetro_atual: 1200.5,
        modo_horimetro: 'RUNNING_HOURS',
        fabricante: 'Fab Test',
        modelo: 'M-100',
        numero_serie: 'SERIE-001',
        localizacao_tecnica: 'Linha Principal / Posição 01',
        metadados: { test: true },
      },
    });
    assert.equal(assetResponse.statusCode, 200, assetResponse.body);
    const assetId: string = assetResponse.json().data.id;
    assert.match(assetResponse.json().data.qr_payload, /^fabcontrol:\/\/asset\//u);

    const updatedAssetResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/cmms/assets/${assetId}`,
      headers: authorization,
      payload: {
        fabricante: 'WEG',
        modelo: 'W22',
        numero_serie: 'HML-EQ-MOT-001',
      },
    });
    assert.equal(updatedAssetResponse.statusCode, 200, updatedAssetResponse.body);
    assert.equal(updatedAssetResponse.json().data.fabricante, 'WEG');
    assert.equal(updatedAssetResponse.json().data.modelo, 'W22');
    assert.equal(updatedAssetResponse.json().data.numero_serie, 'HML-EQ-MOT-001');

    const componentResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/components',
      headers: authorization,
      payload: {
        ativo_id: assetId,
        tag: 'cmp-rol-001',
        nome: 'Rolamento Dianteiro',
        tipo: 'BEARING',
        criticidade: 'HIGH',
        status_operacional: 'OPERATING',
        status_ciclo_vida: 'ACTIVE',
        vida_util_horas: 10000,
        vida_util_dias: 1800,
        horas_acumuladas: 1200.5,
        instalado_em: '2026-01-10T10:00:00.000Z',
        fabricante: 'Fab Test',
        modelo: 'BR-200',
        numero_serie: 'BEARING-001',
        localizacao_tecnica: 'Motor / lado acoplado',
        metadados: { lubricated: true },
      },
    });
    assert.equal(componentResponse.statusCode, 200, componentResponse.body);
    const componentId: string = componentResponse.json().data.id;

    const materialResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/materials',
      headers: authorization,
      payload: {
        sku: 'rol-6205-2rs',
        nome: 'Rolamento blindado 6205 2RS',
        unidade: 'un',
        estoque_atual: 2,
        estoque_minimo: 4,
        status: 'ACTIVE',
      },
    });
    assert.equal(materialResponse.statusCode, 200, materialResponse.body);
    const materialId: string = materialResponse.json().data.id;
    assert.equal(materialResponse.json().data.sku, 'ROL-6205-2RS');
    assert.equal(materialResponse.json().data.abaixo_minimo, true);

    const lowStockMaterials = await app.inject({
      method: 'GET',
      url: '/v1/cmms/materials?abaixo_minimo=true&busca=rolamento',
      headers: authorization,
    });
    assert.equal(lowStockMaterials.statusCode, 200, lowStockMaterials.body);
    assert.equal(lowStockMaterials.json().data.itens.length, 1);
    assert.equal(lowStockMaterials.json().data.itens[0].id, materialId);

    const replenishedMaterial = await app.inject({
      method: 'PATCH',
      url: `/v1/cmms/materials/${materialId}`,
      headers: authorization,
      payload: { estoque_atual: 8 },
    });
    assert.equal(replenishedMaterial.statusCode, 200, replenishedMaterial.body);
    assert.equal(replenishedMaterial.json().data.abaixo_minimo, false);

    const parameterResponse = await app.inject({
      method: 'POST',
      url: '/v1/cmms/parameters',
      headers: authorization,
      payload: {
        ativo_id: assetId,
        componente_id: componentId,
        codigo: 'bearing_temperature',
        nome: 'Temperatura do rolamento',
        unidade: '°C',
        tipo_valor: 'DECIMAL',
        tipo_origem: 'MANUAL',
        descricao: 'Temperatura medida no lado acoplado.',
        metadados: { test: true },
      },
    });
    assert.equal(parameterResponse.statusCode, 200, parameterResponse.body);
    const parameterId: string = parameterResponse.json().data.id;

    const policyResponse = await app.inject({
      method: 'POST',
      url: `/v1/cmms/parameters/${parameterId}/policies`,
      headers: authorization,
      payload: {
        alerta_minimo: 40,
        alerta_maximo: 70,
        critico_minimo: 20,
        critico_maximo: 90,
        regra_validacao: { requires_review_when_abnormal: true },
      },
    });
    assert.equal(policyResponse.statusCode, 200, policyResponse.body);
    assert.equal(policyResponse.json().data.versao, 1);

    const normalReading = await app.inject({
      method: 'POST',
      url: `/v1/cmms/parameters/${parameterId}/readings`,
      headers: authorization,
      payload: {
        valor_numerico: 55,
        origem: 'MANUAL',
        chave_idempotencia: 'catalog-test-reading-normal',
        metadados: { test: true },
      },
    });
    assert.equal(normalReading.statusCode, 200, normalReading.body);
    assert.equal(normalReading.json().data.classificacao, 'NORMAL');
    assert.equal(normalReading.json().data.criada, true);

    const criticalReading = await app.inject({
      method: 'POST',
      url: `/v1/cmms/parameters/${parameterId}/readings`,
      headers: authorization,
      payload: {
        valor_numerico: 96,
        origem: 'MANUAL',
        chave_idempotencia: 'catalog-test-reading-critical',
        metadados: { test: true },
      },
    });
    assert.equal(criticalReading.statusCode, 200, criticalReading.body);
    assert.equal(criticalReading.json().data.classificacao, 'CRITICAL_HIGH');

    const repeatedReading = await app.inject({
      method: 'POST',
      url: `/v1/cmms/parameters/${parameterId}/readings`,
      headers: authorization,
      payload: {
        valor_numerico: 96,
        origem: 'MANUAL',
        chave_idempotencia: 'catalog-test-reading-critical',
        metadados: { test: true },
      },
    });
    assert.equal(repeatedReading.statusCode, 200, repeatedReading.body);
    assert.equal(repeatedReading.json().data.criada, false);
    assert.equal(repeatedReading.json().data.id, criticalReading.json().data.id);

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/v1/cmms/assets?busca=motor&limite=10',
      headers: authorization,
    });
    assert.equal(searchResponse.statusCode, 200, searchResponse.body);
    assert.equal(searchResponse.json().data.itens.length, 1);
    assert.equal(searchResponse.json().data.itens[0].id, assetId);
    assert.equal(searchResponse.json().data.itens[0].fabricante, 'WEG');
    assert.equal(searchResponse.json().data.itens[0].modelo, 'W22');
    assert.equal(searchResponse.json().data.itens[0].numero_serie, 'HML-EQ-MOT-001');
    assert.equal(searchResponse.json().data.itens[0].modo_horimetro, 'RUNNING_HOURS');
    assert.deepEqual(searchResponse.json().data.itens[0].metadados, { test: true });

    const resolveResponse = await app.inject({
      method: 'GET',
      url: '/v1/cmms/assets/resolve/EQ-MOT-001',
      headers: authorization,
    });
    assert.equal(resolveResponse.statusCode, 200, resolveResponse.body);
    assert.equal(resolveResponse.json().data.ativo_id, assetId);

    const scopedReading = await app.inject({
      method: 'POST',
      url: `/v1/cmms/assets/${assetId}/readings`,
      headers: authorization,
      payload: {
        componente_id: componentId,
        parametro: 'BEARING_TEMPERATURE',
        valor: 75,
        unidade: '°C',
        origem: 'MANUAL',
        chave_idempotencia: 'catalog-test-reading-qr-scope',
      },
    });
    assert.equal(scopedReading.statusCode, 200, scopedReading.body);
    assert.equal(scopedReading.json().data.salva, true);
    assert.equal(scopedReading.json().data.criada, true);
    assert.equal(scopedReading.json().data.parametro.classificacao, 'WARNING_HIGH');
    assert.equal(scopedReading.json().data.parametro.componente_id, componentId);

    const qrContext = await app.inject({
      method: 'GET',
      url: '/v1/cmms/qr-context/CMP-ROL-001',
      headers: authorization,
    });
    assert.equal(qrContext.statusCode, 200, qrContext.body);
    assert.equal(qrContext.json().data.encontrado, true);
    assert.equal(qrContext.json().data.tipo_contexto, 'COMPONENT');
    assert.equal(qrContext.json().data.ativo.id, assetId);
    assert.equal(qrContext.json().data.componente.id, componentId);
    assert.equal(qrContext.json().data.parametros_atuais.length, 1);
    assert.equal(qrContext.json().data.parametros_atuais[0].ultimo_valor_numerico, '75');
    assert.ok(qrContext.json().data.historico_recente.length >= 1);

    const assetContextById = await app.inject({
      method: 'GET',
      url: `/v1/cmms/qr-context/${assetId}`,
      headers: authorization,
    });
    assert.equal(assetContextById.statusCode, 200, assetContextById.body);
    assert.equal(assetContextById.json().data.encontrado, true);
    assert.equal(assetContextById.json().data.tipo_contexto, 'ASSET');
    assert.equal(assetContextById.json().data.ativo.id, assetId);
    assert.equal(assetContextById.json().data.componente, null);

    const componentContextById = await app.inject({
      method: 'GET',
      url: `/v1/cmms/qr-context/${componentId}`,
      headers: authorization,
    });
    assert.equal(componentContextById.statusCode, 200, componentContextById.body);
    assert.equal(componentContextById.json().data.encontrado, true);
    assert.equal(componentContextById.json().data.tipo_contexto, 'COMPONENT');
    assert.equal(componentContextById.json().data.ativo.id, assetId);
    assert.equal(componentContextById.json().data.componente.id, componentId);

    const technicalHistory = await app.inject({
      method: 'GET',
      url: `/v1/cmms/assets/${assetId}/history?componente_id=${componentId}&limite=2`,
      headers: authorization,
    });
    assert.equal(technicalHistory.statusCode, 200, technicalHistory.body);
    assert.equal(technicalHistory.json().data.itens.length, 2);
    assert.equal(technicalHistory.json().data.ativo_id, assetId);
    assert.equal(technicalHistory.json().data.componente_id, componentId);
    assert.equal(technicalHistory.json().data.possui_mais, true);
    assert.ok(technicalHistory.json().data.proximo_cursor);

    const assetDetail = await app.inject({
      method: 'GET',
      url: `/v1/cmms/assets/${assetId}`,
      headers: authorization,
    });
    assert.equal(assetDetail.statusCode, 200, assetDetail.body);
    assert.equal(assetDetail.json().data.componentes.length, 1);
    assert.equal(assetDetail.json().data.parametros.length, 1);
    assert.equal(assetDetail.json().data.alertas_abertos.length, 1);
    assert.equal(assetDetail.json().data.alertas_abertos[0].severidade, 'MEDIUM');
    assert.ok(assetDetail.json().data.historico.length >= 4);

    const persistence = await inTenantTransaction(pool, async (client) => {
      const readings = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM cmms.parameter_readings
          WHERE parameter_definition_id = $1
        `,
        [parameterId],
      );
      const audits = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM audit.events
          WHERE user_id = $1 AND action LIKE 'CMMS_%'
        `,
        [identity.userId],
      );
      return {
        readings: Number(readings.rows[0]!.count),
        audits: Number(audits.rows[0]!.count),
      };
    });
    assert.equal(persistence.readings, 3);
    assert.ok(persistence.audits >= 9);

    await inTenantTransaction(pool, async (client) => {
      await client.query(
        `
          DELETE FROM iam.role_capabilities role_capability
          USING iam.capabilities capability
          WHERE role_capability.capability_id = capability.id
            AND role_capability.role_id = $1
            AND capability.code = 'cmms.assets.manage'
        `,
        [identity.roleId],
      );
    });
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/cmms/assets',
      headers: authorization,
      payload: {
        linha_id: lineId,
        tag: 'EQ-BLOCKED',
        nome: 'Não deve ser criado',
        tipo: 'TEST',
        criticidade: 'LOW',
        status_operacional: 'OPERATING',
        status_ciclo_vida: 'ACTIVE',
        saude_percentual: null,
        horimetro_atual: null,
        modo_horimetro: null,
        fabricante: null,
        modelo: null,
        numero_serie: null,
        localizacao_tecnica: null,
        metadados: {},
      },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().error.code, 'AUTH_CAPABILITY_REQUIRED');
  },
);
