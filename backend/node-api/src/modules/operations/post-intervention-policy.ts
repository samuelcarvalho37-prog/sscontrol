export function requiresPostInterventionRelease(order: Readonly<Record<string, unknown>>): boolean {
  const analysis = order.technical_analysis;
  return (
    typeof analysis === 'object' &&
    analysis !== null &&
    'exige_liberacao_pos_intervencao' in analysis &&
    analysis.exige_liberacao_pos_intervencao === true
  );
}
