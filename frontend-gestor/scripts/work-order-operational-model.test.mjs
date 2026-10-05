import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let vite

async function mapper() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  return (await vite.ssrLoadModule('/src/services/api/client.ts')).nodeActionRequest
}

test.after(async () => {
  await vite?.close()
})

test('preserva tipo, modo e categoria ao criar OS de melhoria', async () => {
  const nodeActionRequest = await mapper()
  const request = nodeActionRequest('admin.intervencoes.salvar', {
    token: 'token-de-teste',
    dados: {
      ativo_id: 'asset-1',
      tipo: 'MELHORIA',
      origem: 'IMPROVEMENT_REQUEST',
      entidade_origem_id: 'request-1',
      titulo: 'Adequar proteção',
      descricao: 'Adequação proposta pela equipe técnica.',
      prioridade: 'MEDIA',
      modo_execucao: 'MIXED',
      categoria_melhoria: 'ADEQUACY',
      exige_liberacao_pos_intervencao: false,
    },
  })

  assert.equal(request.method, 'POST')
  assert.equal(request.path, '/v1/maintenance/work-orders')
  assert.equal(request.body.tipo_trabalho, 'IMPROVEMENT')
  assert.equal(request.body.modo_execucao, 'MIXED')
  assert.equal(request.body.categoria_melhoria, 'ADEQUACY')
  assert.equal(request.body.entidade_origem_id, 'request-1')
})

test('mapeia solicitações, serviços externos e complementação de custo', async () => {
  const nodeActionRequest = await mapper()

  const improvement = nodeActionRequest('improvement-requests.create', {
    token: 'token-de-teste',
    ativo_id: 'asset-1',
    categoria: 'MODIFICATION',
    sugestao: 'Modificar suporte',
    motivo: 'Reduzir vibração',
  })
  assert.deepEqual(improvement.body, {
    ativo_id: 'asset-1',
    categoria: 'MODIFICATION',
    sugestao: 'Modificar suporte',
    motivo: 'Reduzir vibração',
    objeto_evidencia_id: null,
  })

  const service = nodeActionRequest('work-orders.external-services.create', {
    token: 'token-de-teste',
    ordem_id: 'work-order-1',
    prestador: 'Prestador local',
    descricao: 'Alinhamento especializado',
    valor: null,
    data_servico: null,
    observacao: null,
  })
  assert.equal(service.method, 'POST')
  assert.equal(service.path, '/v1/maintenance/work-orders/work-order-1/external-services')
  assert.equal(service.body.valor, null)

  const materialCost = nodeActionRequest('material-usage.cost.update', {
    token: 'token-de-teste',
    material_usage_id: 'usage-1',
    valor_unitario: 50,
  })
  assert.equal(materialCost.method, 'PATCH')
  assert.equal(materialCost.path, '/v1/maintenance/material-usage/usage-1/cost')
  assert.deepEqual(materialCost.body, { valor_unitario: 50 })
})

test('mantém código operacional e código legado na leitura da OS', async () => {
  const nodeActionRequest = await mapper()
  const request = nodeActionRequest('admin.intervencoes.detalhe', {
    token: 'token-de-teste',
    intervencao_id: 'work-order-1',
  })
  const mapped = request.transform({
    id: 'work-order-1',
    codigo: 'OS-00000001',
    codigo_legado: 'OS-LEGACY-001',
    tipo_trabalho: 'PREDICTIVE',
    modo_execucao: 'EXTERNAL',
    status: 'RELEASED',
    acoes: [],
  })

  assert.equal(mapped.codigo, 'OS-00000001')
  assert.equal(mapped.codigo_legado, 'OS-LEGACY-001')
  assert.equal(mapped.tipo, 'PREDITIVA')
  assert.equal(mapped.modo_execucao, 'EXTERNAL')
})
