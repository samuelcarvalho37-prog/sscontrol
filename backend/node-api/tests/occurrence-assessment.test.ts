import assert from 'node:assert/strict';
import test from 'node:test';
import {
  suggestOccurrencePriority,
  type OccurrenceAssessment,
} from '../src/modules/monitoring/occurrence-assessment.js';

test('triagem: risco de segurança prevalece e redundância não reduz riscos de segurança/qualidade', () => {
  const base: OccurrenceAssessment = {
    situacao_atual: 'Funcionando',
    equipamento_parado: false,
    risco_parada: false,
    risco_seguranca: false,
    impacto_producao: false,
    impacto_qualidade: false,
    existe_redundancia: false,
  };
  assert.equal(suggestOccurrencePriority(base), 'LOW');
  assert.equal(suggestOccurrencePriority({ ...base, impacto_producao: true }), 'MEDIUM');
  assert.equal(suggestOccurrencePriority({ ...base, risco_parada: true }), 'HIGH');
  assert.equal(
    suggestOccurrencePriority({ ...base, risco_parada: true, existe_redundancia: true }),
    'MEDIUM',
  );
  assert.equal(
    suggestOccurrencePriority({ ...base, equipamento_parado: true, impacto_producao: true }),
    'CRITICAL',
  );
  assert.equal(
    suggestOccurrencePriority({
      ...base,
      equipamento_parado: true,
      impacto_producao: true,
      existe_redundancia: true,
    }),
    'HIGH',
  );
  assert.equal(
    suggestOccurrencePriority({ ...base, risco_seguranca: true, existe_redundancia: true }),
    'CRITICAL',
  );
  assert.equal(
    suggestOccurrencePriority({ ...base, impacto_qualidade: true, existe_redundancia: true }),
    'HIGH',
  );
});
