import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { requiredIntentCapabilities } from '../src/modules/auth/capability-intents.js';
import { INTENT_CAPABILITIES } from '../src/modules/auth/capability-intent-catalog.js';
const id = '11111111-1111-4111-8111-111111111111';
const route = '/v1/cmms/assets/:assetId';
const base = 'access.patch.cmms.assets.assetId';
const materialRoute = '/v1/cmms/materials/:materialId';
const materialBase = 'access.patch.cmms.materials.materialId';
function client(current?: Record<string, unknown>): Pick<PoolClient, 'query'> {
  return { query: async () => ({ rows: current ? [{ current }] : [] }) } as unknown as Pick<
    PoolClient,
    'query'
  >;
}
test('edição comum ignora e remove campos de situação inalterados', async () => {
  const body = { nome: 'Novo', status_operacional: 'OPERATING' };
  assert.deepEqual(
    await requiredIntentCapabilities(
      client({ name: 'Anterior', operational_status: 'OPERATING' }),
      'PATCH',
      route,
      body,
      { assetId: id },
    ),
    [base],
  );
  assert.deepEqual(body, { nome: 'Novo' });
});
test('situação isolada não concede edição comum; alteração mista exige as duas', async () => {
  const current = { name: 'Anterior', operational_status: 'OPERATING' };
  assert.deepEqual(
    await requiredIntentCapabilities(
      client(current),
      'PATCH',
      route,
      { status_operacional: 'STOPPED' },
      { assetId: id },
    ),
    [`${base}.status`],
  );
  assert.deepEqual(
    new Set(
      await requiredIntentCapabilities(
        client(current),
        'PATCH',
        route,
        { nome: 'Novo', status_operacional: 'STOPPED' },
        { assetId: id },
      ),
    ),
    new Set([base, `${base}.status`]),
  );
});
test('arquivar e restaurar exigem sua ação específica', async () => {
  for (const [before, after] of [
    ['ACTIVE', 'ARCHIVED'],
    ['ARCHIVED', 'ACTIVE'],
  ]) {
    assert.deepEqual(
      await requiredIntentCapabilities(
        client({ lifecycle_status: before, operational_status: 'OPERATING' }),
        'PATCH',
        route,
        { status_ciclo_vida: after, status_operacional: 'UNAVAILABLE' },
        { assetId: id },
      ),
      [`${base}.archive`],
    );
  }
});
test('saldo e custo são independentes; campos inalterados não podem sobrescrever dados concorrentes', async () => {
  const body = {
    nome: 'Peça',
    valor_unitario: 10,
    estoque_atual: 4,
    estoque_minimo: 1,
    status: 'ACTIVE',
  };
  const current = {
    name: 'Peça',
    unit_cost: '10.00',
    current_stock: '3.000',
    minimum_stock: '1.000',
    status: 'ACTIVE',
  };
  assert.deepEqual(
    await requiredIntentCapabilities(client(current), 'PATCH', materialRoute, body, {
      materialId: id,
    }),
    [`${materialBase}.stock`],
  );
  assert.deepEqual(body, { estoque_atual: 4 });
  assert.deepEqual(
    await requiredIntentCapabilities(
      client(current),
      'PATCH',
      materialRoute,
      { valor_unitario: 11 },
      { materialId: id },
    ),
    [`${materialBase}.cost`],
  );
});
test('no-op explícito mantém ação e corpo; formulário inalterado exige edição', async () => {
  const body = { status_operacional: 'OPERATING' };
  assert.deepEqual(
    await requiredIntentCapabilities(
      client({ operational_status: 'OPERATING' }),
      'PATCH',
      route,
      body,
      { assetId: id },
    ),
    [`${base}.status`],
  );
  assert.deepEqual(body, { status_operacional: 'OPERATING' });
  assert.deepEqual(
    await requiredIntentCapabilities(
      client({ name: 'Mesmo', operational_status: 'OPERATING' }),
      'PATCH',
      route,
      { nome: 'Mesmo', status_operacional: 'OPERATING' },
      { assetId: id },
    ),
    [base],
  );
});
test('recurso ausente e campos ambíguos exigem edição', async () => {
  assert.deepEqual(
    await requiredIntentCapabilities(
      client(),
      'PATCH',
      route,
      { status_operacional: 'STOPPED' },
      { assetId: id },
    ),
    [base],
  );
  assert.deepEqual(
    await requiredIntentCapabilities(client({}), 'PATCH', route, { outro: true }, { assetId: id }),
    [base],
  );
});
test('catálogo de intenções preserva recursos e IDs únicos', () => {
  assert.equal(INTENT_CAPABILITIES.length, 16);
  assert.equal(new Set(INTENT_CAPABILITIES.map((item) => item.id)).size, 16);
  assert.ok(INTENT_CAPABILITIES.every((item) => item.rota === null && item.legado && item.feature));
});
