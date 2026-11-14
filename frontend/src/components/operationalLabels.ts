const labels:Record<string,string>={
  WORK_ORDER:'Ordem de serviço',POST_INTERVENTION_RELEASE:'Liberação após a intervenção',
  OCCURRENCE_REPORTED:'Ocorrência registrada',EXECUTION_TECHNICAL_REPORT:'Relatório técnico de execução',
  PART_SHORTAGE_REPORTED:'Falta de peça registrada',PART_SHORTAGE_RESOLVED:'Pendência de peça resolvida',
  SHARED_REQUEST_CORRECTED:'Solicitação corrigida',WORK_ORDER_RELEASED:'OS liberada',
  EXECUTION_STARTED:'Execução iniciada',EXECUTION_COMPLETED:'Execução concluída',
  QUALITY:'Qualidade',SAFETY:'Segurança',PCM:'PCM',TECNICO:'Técnico',
}
export function operationalLabel(value:unknown):string|undefined{return labels[String(value??'').trim().toUpperCase()]}
