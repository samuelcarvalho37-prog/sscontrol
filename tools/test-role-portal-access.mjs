import assert from 'node:assert/strict'
import test from 'node:test'
import { allowsPortal } from '../frontend-gestor/src/services/auth/portalAccess.ts'

test('portal compartilhado aceita códigos reais e futuros', () => {
  for (const role of ['ADMIN', 'PCM', 'PRODUCAO', 'TECNICO', 'QUALIDADE', 'SEGURANCA', 'OPERADOR', 'GESTOR_TECNICO', 'FUTURO']) {
    assert.equal(allowsPortal('SHARED', role, []), true)
  }
})
test('portais especializados usam capacidades, sem confiar no nome', () => {
  assert.equal(allowsPortal('ADMIN', 'CUSTOM_RH', ['admin.identity.read']), true)
  assert.equal(allowsPortal('ADMIN', 'ADMIN', []), false)
  assert.equal(allowsPortal('GESTOR', 'FUTURO', ['maintenance.work-orders.read']), true)
  assert.equal(allowsPortal('GESTOR', 'PCM', ['analytics.technical.read']), true)
  assert.equal(allowsPortal('GESTOR', 'TECNICO', []), false)
})
test('contrato legado continua aceito quando não envia capabilities', () => {
  assert.equal(allowsPortal('GESTOR', 'GESTOR_TECNICO'), true)
  assert.equal(allowsPortal('GESTOR', 'GESTOR'), true)
  assert.equal(allowsPortal('ADMIN', 'ADMIN'), true)
})
