import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let vite

async function modules() {
  vite ??= await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  })
  return {
    navigation: await vite.ssrLoadModule('/src/components/workOrderDetailNavigation.ts'),
    client: await vite.ssrLoadModule('/src/services/api/client.ts'),
  }
}

test.after(async () => {
  await vite?.close()
})

function order(id, code) {
  return { id, raw: { id, codigo: code } }
}

test('seleciona OS A e depois substitui pelo detalhe da OS B usando IDs internos', async () => {
  const { navigation } = await modules()
  const gate = navigation.createWorkOrderDetailRequestGate()
  const loadedIds = []
  let selected = null
  const load = async (id) => {
    loadedIds.push(id)
    return { id, codigo: id === 'internal-a' ? 'OS-00000011' : 'OS-00000010' }
  }

  const requestA = gate.begin('internal-a')
  const detailA = await navigation.loadOperationalWorkOrder(order('internal-a', 'OS-00000011'), load)
  gate.commit(requestA, () => { selected = detailA })
  assert.deepEqual(selected, { id: 'internal-a', codigo: 'OS-00000011' })

  const requestB = gate.begin('internal-b')
  const detailB = await navigation.loadOperationalWorkOrder(order('internal-b', 'OS-00000010'), load)
  gate.commit(requestB, () => { selected = detailB })
  assert.deepEqual(selected, { id: 'internal-b', codigo: 'OS-00000010' })
  assert.deepEqual(loadedIds, ['internal-a', 'internal-b'])
  assert.equal(navigation.workOrderDetailHeadingCode(selected.codigo, 'OS-00000010'), 'OS-00000010')
})

test('resposta assíncrona antiga não sobrescreve a OS selecionada mais recentemente', async () => {
  const { navigation } = await modules()
  const gate = navigation.createWorkOrderDetailRequestGate()
  let selected = null
  let resolveA
  const pendingA = new Promise(resolve => { resolveA = resolve })

  const requestA = gate.begin('internal-a')
  const loadA = navigation.loadOperationalWorkOrder(order('internal-a', 'OS-00000011'), () => pendingA)
  const requestB = gate.begin('internal-b')
  const detailB = await navigation.loadOperationalWorkOrder(order('internal-b', 'OS-00000010'), async id => ({ id, codigo: 'OS-00000010' }))
  gate.commit(requestB, () => { selected = detailB })

  resolveA({ id: 'internal-a', codigo: 'OS-00000011' })
  const detailA = await loadA
  gate.commit(requestA, () => { selected = detailA })

  assert.equal(selected.id, 'internal-b')
  assert.equal(selected.codigo, 'OS-00000010')
})

test('clique direciona somente para leitura do detalhe e não usa o código público como ID', async () => {
  const { navigation, client } = await modules()
  const requested = []
  await navigation.loadOperationalWorkOrder(order('internal-id-11', 'OS-00000011'), async id => {
    requested.push(id)
    return id
  })

  const detailRequest = client.nodeActionRequest('admin.intervencoes.detalhe', {
    token: 'token-de-teste',
    intervencao_id: requested[0],
  })
  assert.deepEqual(requested, ['internal-id-11'])
  assert.equal(detailRequest.method, 'GET')
  assert.equal(detailRequest.path, '/v1/maintenance/work-orders/internal-id-11')
  assert.equal(navigation.workOrderDetailHeadingCode(undefined, 'OS-00000011'), 'OS-00000011')
  assert.throws(
    () => navigation.assertWorkOrderDetailMatchesSelection({ id: 'other-work-order' }, { requestId: 1, workOrderId: 'internal-id-11' }),
    /ordem diferente da selecionada/i,
  )
})

test('posiciona o início do painel e transfere foco ao cabeçalho sem segundo scroll', async () => {
  const { navigation } = await modules()
  const calls = []
  navigation.focusWorkOrderDetail(
    { scrollIntoView: options => calls.push(['scroll', options]) },
    { focus: options => calls.push(['focus', options]) },
  )
  assert.deepEqual(calls, [
    ['scroll', { behavior: 'smooth', block: 'start' }],
    ['focus', { preventScroll: true }],
  ])
})

test('botão acessível está ligado à OS filtrada e abre painel identificado pelo código público', async () => {
  const source = await readFile(new URL('../src/components/PcmDashboard.tsx', import.meta.url), 'utf8')
  assert.match(source, /filteredOperationalOrders\.map\(item =>/)
  assert.match(source, /aria-label=\{`Abrir detalhes da ordem \$\{item\.code\}`\}/)
  assert.match(source, /onClick=\{\(\) => void openOperationalOrder\(item\)\}/)
  assert.match(source, /<button type="button" className="pcm-order-link"/)
  assert.match(source, /loadOperationalWorkOrder\(order, workOrderId => openWorkOrderById\(workOrderId, order\.code\)\)/)
  assert.match(source, /if \(orderStatus && humanStatus\(item\.status\) !== orderStatus\) return false/)
  assert.match(source, /if \(orderPriority && humanPriority\(item\.priority\) !== orderPriority\) return false/)
  assert.match(source, /if \(orderSector && item\.sector !== orderSector\) return false/)
  assert.match(source, /if \(orderResponsible && item\.responsible !== orderResponsible\) return false/)
  assert.match(source, /if \(orderType && humanWorkType\(item\.type\) !== orderType\) return false/)
  assert.match(source, /id="pcm-operational-order-detail"/)
  assert.match(source, /workOrderDetailHeadingCode\(selectedOrder\?\.codigo, selectedWorkOrderCode\)/)
  assert.match(source, /aria-expanded=\{selectedWorkOrderId === item\.raw\.id\}/)
})
