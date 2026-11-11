import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('acompanhamento separa execução, bloqueios, conclusão e programação vencida', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr:false }, appType: 'custom' })
  try {
    const { trackingState, isTrackingLate, matchesTrackingFilter } = await server.ssrLoadModule('/src/components/pcmTrackingModel.ts')
    const now = Date.parse('2026-11-11T12:00:00Z')
    const order = { status: 'EM_EXECUCAO', planejada_para: '2026-11-10T12:00:00Z' }
    assert.equal(trackingState(order), 'running')
    assert.equal(isTrackingLate(order, now), true)
    assert.equal(matchesTrackingFilter(order, 'late', now), true)
    assert.equal(trackingState({ ...order, status: 'BLOQUEADA' }), 'blocked')
    for (const status of ['CONCLUIDA', 'CANCELADA', 'RASCUNHO']) assert.equal(isTrackingLate({ ...order, status }, now), false)
    assert.equal(isTrackingLate({ ...order, planejada_para: 'inválida' }, now), false)
    assert.equal(matchesTrackingFilter(order, 'completed', now), false)
    assert.equal(trackingState({ ...order, status: 'CONCLUIDA' }), 'completed')
  } finally { await server.close() }
})
