const labels:Record<string,string>={
  WORK_ORDER:'Ordem de serviço',POST_INTERVENTION_RELEASE:'Liberação após a intervenção',
  OCCURRENCE_REPORTED:'Ocorrência registrada',EXECUTION_TECHNICAL_REPORT:'Relatório técnico de execução',
  PART_SHORTAGE_REPORTED:'Falta de peça registrada',PART_SHORTAGE_RESOLVED:'Pendência de peça resolvida',
  SHARED_REQUEST_CORRECTED:'Solicitação corrigida',WORK_ORDER_RELEASED:'OS liberada',
  EXECUTION_STARTED:'Execução iniciada',EXECUTION_COMPLETED:'Execução concluída',
  QUALITY:'Qualidade',SAFETY:'Segurança',PCM:'PCM',TECNICO:'Técnico',
  LOW:'Baixa',MEDIUM:'Média',HIGH:'Alta',CRITICAL:'Crítica',EXECUTE_CHECKLIST:'Execução de checklist',
  WORK_ORDER_EXTERNAL_WORK_ENABLED:'Participação externa incluída',
  WORK_ORDER_EXTERNAL_SERVICE_RECORDED:'Serviço externo registrado',
  TECHNICIAN_HOURLY_RATE_RECORDED:'Custo por hora registrado',
  EXTERNAL_LABOR_BUDGET_UPDATED:'Orçamento de mão de obra externa atualizado',
}
export function operationalLabel(value:unknown):string|undefined{return labels[String(value??'').trim().toUpperCase()]}
