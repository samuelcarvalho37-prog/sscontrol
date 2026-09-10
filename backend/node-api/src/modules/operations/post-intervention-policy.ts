export function requiresPostInterventionRelease(order: Readonly<Record<string, unknown>>): boolean {
  const analysis = order.technical_analysis;
  return (
    order.work_type === 'PREVENTIVE' &&
    Boolean(order.scheduled_for) &&
    order.maintenance_stop_mode === 'MANDATORY_STOP' &&
    typeof analysis === 'object' &&
    analysis !== null &&
    'exige_liberacao_pos_intervencao' in analysis &&
    analysis.exige_liberacao_pos_intervencao === true
  );
}
