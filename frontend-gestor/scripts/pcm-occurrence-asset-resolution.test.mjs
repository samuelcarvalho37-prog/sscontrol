import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let vite

async function resolverModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  return vite.ssrLoadModule('/src/components/pcmOccurrenceAssetResolver.ts')
}

async function clientModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  return vite.ssrLoadModule('/src/services/api/client.ts')
}

async function dashboardModule() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  return vite.ssrLoadModule('/src/components/PcmDashboard.tsx')
}

test.after(async () => {
  await vite?.close()
})

function occurrence(overrides = {}) {
  return {
    id: 'occurrence-1',
    status: 'OPEN',
    titulo: 'Título livre que não identifica o equipamento',
    tipo: 'FALHA MECÂNICA',
    ativo_id: 'asset-canonical-id',
    ativo_tag: 'E355',
    ativo_nome: 'Equipamento de teste',
    ...overrides,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('resolve TAG simples pelo ativo_id canônico da ocorrência', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const resolver = createPcmOccurrenceAssetResolver(async () => occurrence())
  const result = await resolver.resolve('occurrence-1')

  assert.equal(result.status, 'success')
  assert.equal(result.context.assetId, 'asset-canonical-id')
  assert.equal(result.context.assetTag, 'E355')
})

test('preserva TAG hifenizada sem interpretar o título', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const resolver = createPcmOccurrenceAssetResolver(async () => occurrence({
    titulo: 'Texto sem separador ou código',
    ativo_tag: 'EQ-ENV-01',
    ativo_nome: 'Envasadora Linha 01',
  }))
  const result = await resolver.resolve('occurrence-1')

  assert.equal(result.status, 'success')
  assert.deepEqual(result.context, {
    occurrenceId: 'occurrence-1',
    assetId: 'asset-canonical-id',
    assetTag: 'EQ-ENV-01',
    assetName: 'Envasadora Linha 01',
    occurrenceType: 'FALHA MECÂNICA',
  })
})

test('não depende da coleção paginada de ativos para resolver ocorrência', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  let detailCalls = 0
  const resolver = createPcmOccurrenceAssetResolver(async (id) => {
    detailCalls += 1
    return occurrence({ id, ativo_id: 'asset-position-408', ativo_tag: 'EQ-ENV-01' })
  })
  const result = await resolver.resolve('occurrence-outside-first-100')

  assert.equal(result.status, 'success')
  assert.equal(result.context.assetId, 'asset-position-408')
  assert.equal(detailCalls, 1)
})

test('usa entidade_id para carregar detalhe e ignora título incompatível', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const requested = []
  const resolver = createPcmOccurrenceAssetResolver(async (id) => {
    requested.push(id)
    return occurrence({ id, titulo: 'Notificação alterada sem TAG', ativo_id: 'asset-from-detail' })
  })
  const result = await resolver.resolve('entity-occurrence-id')

  assert.equal(result.status, 'success')
  assert.deepEqual(requested, ['entity-occurrence-id'])
  assert.equal(result.context.assetId, 'asset-from-detail')
})

test('bloqueia ocorrência sem ativo com mensagem controlada', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const resolver = createPcmOccurrenceAssetResolver(async () => occurrence({ ativo_id: undefined }))
  const result = await resolver.resolve('occurrence-without-asset')

  assert.equal(result.status, 'error')
  assert.match(result.message, /não possui um equipamento válido/i)
})

test('informa falha compreensível ao carregar detalhe', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const resolver = createPcmOccurrenceAssetResolver(async () => {
    throw new Error('HTTP 503')
  })
  const result = await resolver.resolve('occurrence-1')

  assert.equal(result.status, 'error')
  assert.match(result.message, /Não foi possível carregar o equipamento da ocorrência/i)
  assert.match(result.message, /HTTP 503/)
})

test('rejeita notificação sem entidade_id sem consultar a API', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  let calls = 0
  const resolver = createPcmOccurrenceAssetResolver(async () => {
    calls += 1
    return occurrence()
  })
  const result = await resolver.resolve('')

  assert.equal(result.status, 'error')
  assert.match(result.message, /não identifica a ocorrência/i)
  assert.equal(calls, 0)
})

test('resposta obsoleta não sobrescreve ocorrência aberta depois', async () => {
  const { createPcmOccurrenceAssetResolver } = await resolverModule()
  const first = deferred()
  const resolver = createPcmOccurrenceAssetResolver(async (id) => {
    if (id === 'occurrence-A') return first.promise
    return occurrence({ id, ativo_id: 'asset-B', ativo_tag: 'EQ-B-01' })
  })

  const pendingA = resolver.resolve('occurrence-A')
  const resultB = await resolver.resolve('occurrence-B')
  first.resolve(occurrence({ id: 'occurrence-A', ativo_id: 'asset-A', ativo_tag: 'EQ-A-01' }))
  const resultA = await pendingA

  assert.equal(resultB.status, 'success')
  assert.equal(resultB.context.assetId, 'asset-B')
  assert.deepEqual(resultA, { status: 'stale' })
})

test('oferece criação somente quando a ocorrência ainda não possui OS', async () => {
  const { pcmOccurrenceNotificationAction } = await resolverModule()

  assert.deepEqual(
    pcmOccurrenceNotificationAction({ id: 'notification-1', tipo: 'OCORRENCIA_CRITICA', titulo: 'Ocorrência', status: 'NAO_LIDA' }),
    { kind: 'create' },
  )
})

test('oferece acompanhamento quando a ocorrência já possui OS', async () => {
  const { pcmOccurrenceNotificationAction } = await resolverModule()

  assert.deepEqual(
    pcmOccurrenceNotificationAction({
      id: 'notification-1',
      tipo: 'OCORRENCIA_CRITICA',
      titulo: 'Ocorrência',
      status: 'LIDA',
      ordem_servico_id: 'work-order-1',
      ordem_servico_codigo: 'OS-0001',
    }),
    { kind: 'follow', workOrderId: 'work-order-1', label: 'OS-0001' },
  )
})

test('apresenta OS liberada e evento de aprovação em português', async () => {
  const { nodeActionRequest } = await clientModule()
  const request = nodeActionRequest('admin.intervencoes.listar', { token: 'token-de-teste' })
  const mapped = request.transform({ itens: [{ id: 'work-order-1', status: 'RELEASED', acoes: [] }] })
  assert.equal(mapped.intervencoes[0].status, 'LIBERADA')

  const { humanAuditAction, humanStatus } = await dashboardModule()
  assert.equal(humanStatus(mapped.intervencoes[0].status), 'Liberada para execução')
  assert.equal(
    humanAuditAction('WORK_ORDER_APPROVED_WITHOUT_EXCEPTION'),
    'OS aprovada sem necessidade de validação adicional',
  )
})
