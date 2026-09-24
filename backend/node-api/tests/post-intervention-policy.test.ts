import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresPostInterventionRelease } from '../src/modules/operations/post-intervention-policy.js';
test('liberação por exceção exige preventiva, programação, parada obrigatória e opção explícita', () => {
  const order = {
    work_type: 'PREVENTIVE',
    scheduled_for: '2026-09-10T12:00:00Z',
    maintenance_stop_mode: 'MANDATORY_STOP',
    technical_analysis: { exige_liberacao_pos_intervencao: true },
  };
  assert.equal(requiresPostInterventionRelease(order), true);
  for (const change of [
    { work_type: 'CORRECTIVE' },
    { work_type: 'INSPECTION' },
    { scheduled_for: null },
    { maintenance_stop_mode: 'NO_STOP' },
    { technical_analysis: {} },
    { technical_analysis: { exige_liberacao_pos_intervencao: 'true' } },
  ]) {
    assert.equal(requiresPostInterventionRelease({ ...order, ...change }), false);
  }
});
