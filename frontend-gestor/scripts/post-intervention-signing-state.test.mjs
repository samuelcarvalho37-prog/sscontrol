import assert from 'node:assert/strict'
import test from 'node:test'
import { awaitsPostInterventionCompletion } from '../src/components/postInterventionPolicy.ts'

test('liberação final fica somente para acompanhamento antes da conclusão técnica', () => {
  for (const status of ['OPEN', 'ABERTA', 'TRIAGE', 'IN_TECHNICAL_REVIEW', '', undefined, 'CLOSED']) {
    assert.equal(awaitsPostInterventionCompletion({ tipo: 'POST_INTERVENTION_RELEASE', status }), true)
  }
})

test('assinatura final só é apresentada na etapa autorizada pelo fluxo', () => {
  for (const status of ['AGUARDANDO_ASSINATURA', 'AWAITING_SIGNATURE', ' aguardando_assinatura ']) {
    assert.equal(awaitsPostInterventionCompletion({ tipo: 'POST_INTERVENTION_RELEASE', status }), false)
  }
})

test('aprovação de checklist não é tratada como liberação pós-intervenção', () => {
  assert.equal(awaitsPostInterventionCompletion({ tipo: 'CHECKLIST_MODEL', status: 'OPEN' }), false)
})
