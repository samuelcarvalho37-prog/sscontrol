export function estimateChecklistMinutes(items: ReadonlyArray<{ tipo_resposta: string }>, criticality: string): number {
  const weights: Record<string, number> = { INSTRUCAO: 2, CONFIRMACAO: 2, OK_NOK: 4, TEXTO: 5, SELECAO: 3, NUMERO: 4, PARAMETRO: 7, LEITURA_OPERACIONAL: 6, EVIDENCIA: 5 };
  const factor: Record<string, number> = { BAIXA: 1, MEDIA: 1.15, ALTA: 1.3, CRITICA: 1.5 };
  return Math.min(10080, Math.max(5, Math.ceil((5 + items.reduce((sum, item) => sum + (weights[item.tipo_resposta] ?? 4), 0)) * (factor[criticality] ?? 1) / 5) * 5));
}
