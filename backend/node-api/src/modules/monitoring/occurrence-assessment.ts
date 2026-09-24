import type { Severity } from './monitoring.types.js';

export interface OccurrenceAssessment {
  readonly situacao_atual: string;
  readonly equipamento_parado: boolean;
  readonly risco_parada: boolean;
  readonly risco_seguranca: boolean;
  readonly impacto_producao: boolean;
  readonly impacto_qualidade: boolean;
  readonly existe_redundancia: boolean;
}

export function suggestOccurrencePriority(assessment: OccurrenceAssessment): Severity {
  if (
    assessment.risco_seguranca ||
    (assessment.equipamento_parado && assessment.impacto_producao && !assessment.existe_redundancia)
  )
    return 'CRITICAL';
  if (
    assessment.equipamento_parado ||
    assessment.impacto_qualidade ||
    (assessment.risco_parada && !assessment.existe_redundancia)
  )
    return 'HIGH';
  if (assessment.risco_parada || assessment.impacto_producao) return 'MEDIUM';
  return 'LOW';
}
