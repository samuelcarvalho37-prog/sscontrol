export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export interface ApiEnvelope<T> {
  ok: boolean
  action: string
  elapsed_ms?: number
  data?: T
  error?: ApiError
}

export interface HealthData {
  ok: boolean
  app: string
  version: string
  release_version?: string
  api_version?: string
  schema_version?: string
  contract_version?: string
  frontend_version?: string
  spreadsheetId?: string
  serverTime?: string
}

export interface ActionAvailabilityData {
  programada?: boolean
  planejada_para?: string
  alerta_minutos?: number
  tolerancia_atraso_minutos?: number
  estado?: 'SEM_AGENDAMENTO' | 'AGENDADA' | 'EM_ALERTA' | 'DISPONIVEL' | 'ATRASADA'
  pode_iniciar?: boolean
  segundos_para_liberar?: number
  segundos_em_atraso?: number
  mensagem?: string
}

export interface RawOperatorCard {
  id?: string
  acao_id?: string
  title?: string
  subtitle?: string
  description?: string
  priority?: {
    value?: string
    label?: string
    tone?: string
  }
  status?: {
    state?: string
    label?: string
    tone?: string
    icon?: string
  }
  progress?: {
    total?: number
    respondidos?: number
    pendentes?: number
    percentual?: number
  }
  asset?: {
    id?: string
    tag?: string
    name?: string
    label?: string
  }
  component?: {
    id?: string
    tag?: string
    name?: string
    label?: string
  }
  dates?: {
    gerado_em?: string
    planejada_para?: string
    iniciado_em?: string
    finalizado_em?: string
  }
  primary_action?: {
    label?: string
    endpoint?: string
    payload?: Record<string, unknown>
  }
  group?: string
  grupo?: string
  origem?: string
  tipo?: string
  duracao_minutos?: number
  equipe?: string[]
  availability?: ActionAvailabilityData | null
}

export interface OperatorActionsData {
  ok: boolean
  version: string
  contract_version?: string
  operador_id: string
  resumo?: {
    total?: number
    aguardando_inicio?: number
    em_execucao?: number
    aguardando_validacao?: number
    concluidas?: number
    bloqueadas?: number
  }
  total?: number
  cards?: RawOperatorCard[]
  acoes?: RawOperatorCard[]
  visual_cards?: RawOperatorCard[]
}

export interface RawChecklistItem {
  id: string
  ui_key?: string
  execucao_id?: string
  acao_id?: string
  plano_item_id?: string
  ordem: number
  titulo: string
  instrucao?: string
  tipo_resposta?: string
  categoria?: string
  obrigatorio?: boolean
  evidencia_obrigatoria?: boolean
  bloqueia_finalizacao?: boolean
  parametro_nome?: string
  valor_esperado?: string | number
  opcoes?: string[]
  limite_min?: string | number
  limite_max?: string | number
  unidade?: string
  resposta?: string
  valor_numero?: string | number
  observacao?: string
  conforme?: string
  status?: string
  respondido?: boolean
  evidencias_count?: number
  evidencia_min_fotos?: number
  evidencias?: EvidenceRecord[]
  input?: {
    tipo_resposta?: string
    componente?: string
    requer_resposta?: boolean
    requer_valor?: boolean
    requer_opcoes?: boolean
    suporta_evidencia?: boolean
    placeholder?: string
    opcoes?: string[]
    unidade?: string
    limite_min?: string | number
    limite_max?: string | number
  }
}

export interface OperatorActionDetailData {
  ok: boolean
  version: string
  contract_version?: string
  perfil?: string
  acao: {
    id: string
    os_id?: string
    ativo_id?: string
    componente_id?: string
    plano_id?: string
    origem?: string
    tipo?: string
    titulo?: string
    descricao?: string
    prioridade?: string
    status: string
    responsavel_id?: string
    gerado_em?: string
    planejada_para?: string
    iniciado_em?: string
    finalizado_em?: string
    modo_parada_manutencao?: MaintenanceStopMode
  }
  os?: {
    id?: string
    codigo?: string
    titulo?: string
    descricao?: string
    prioridade?: string
    status?: string
    aberta_em?: string
    planejada_para?: string
    iniciada_em?: string
    finalizada_em?: string
  }
  ativo?: {
    id?: string
    tag?: string
    nome?: string
    tipo?: string
    criticidade?: string
    status?: string
    saude_pct?: number
    horimetro_atual?: number
    horimetro_modo?: 'MANUAL' | 'TELEMETRIA'
    horimetro_atualizado_em?: string
    horimetro_base_servico?: number | string
    horimetro_base_servico_em?: string
    fabricante?: string
    modelo?: string
    numero_serie?: string
    localizacao_tecnica?: string
  }
  horimetro?: HorimeterSummary | null
  componente?: {
    id?: string
    tag?: string
    nome?: string
    tipo?: string
    criticidade?: string
    status?: string
    vida_util_horas?: number
    horas_acumuladas?: number
    fabricante?: string
    modelo?: string
    numero_serie?: string
    localizacao_tecnica?: string
  }
  plano?: {
    id?: string
    nome?: string
    tipo?: string
    criticidade?: string
    modo_parada_manutencao?: MaintenanceStopMode
    gatilho_tipo?: string
    gatilho_valor?: number
    unidade?: string
    tempo_estimado_min?: number
    requer_bloqueio?: string
    requer_evidencia?: string
    status?: string
    workflow_status?: string
    revisao?: number
  }
  executor?: {
    id?: string
    nome?: string
    email?: string
  } | null
  execucao?: {
    id?: string
    acao_id?: string
    operador_id?: string
    resultado?: string
    observacao?: string
    duracao_segundos?: number
    abriu_em?: string
    iniciou_em?: string
    finalizou_em?: string
    status?: string
    modo_execucao_manutencao?: MaintenanceStartDecision | 'COM_PARADA' | 'SEM_PARADA'
  } | null
  disponibilidade?: ActionAvailabilityData | null
  checklist?: {
    modelo?: boolean
    execucao_id?: string
    total?: number
    respondidos?: number
    pending_count?: number
    evidence_missing_count?: number
    blockers_count?: number
    itens?: RawChecklistItem[]
  }
  ui?: {
    state?: string
    can_start?: boolean
    can_answer?: boolean
    can_save_batch?: boolean
    can_finalize?: boolean
    can_register_evidence?: boolean
    can_validate?: boolean
    message?: string
  }
  operator_screen?: {
    header?: {
      acao_id?: string
      execucao_id?: string
      os_id?: string
      os_codigo?: string
      title?: string
      subtitle?: string
      description?: string
      status?: string
      responsavel_id?: string
    }
    progress?: {
      total?: number
      respondidos?: number
      pendentes?: number
      percentual?: number
      evidencias_pendentes?: number
      bloqueios?: number
      completo?: boolean
      label?: string
    }
    action_bar?: {
      buttons?: Array<{
        id?: string
        label?: string
        endpoint?: string
        enabled?: boolean
        tone?: string
        payload?: Record<string, unknown>
        disabled_reason?: string
      }>
    }
  }
  analise_tecnica?: {
    situacao?: string
    causa_provavel?: string
    resultado_esperado?: string
    riscos?: Array<{ tipo?: string; titulo?: string; descricao?: string }>
    ferramentas?: Array<{ tipo?: string; nome?: string }>
    nrs?: string[]
    etapas?: Array<{ ordem?: number; titulo?: string; descricao?: string }>
  }
}

export type MaintenanceStopMode =
  | 'OBRIGATORIA'
  | 'DECISAO_EXECUTOR'
  | 'SEM_PARADA'

export type MaintenanceStartDecision =
  | 'PARAR_EQUIPAMENTO'
  | 'SEM_PARADA'

export interface MaintenanceStopData {
  id: string
  ativo_id: string
  componente_id?: string
  os_id?: string
  acao_id?: string
  execucao_id?: string
  modo_configurado?: MaintenanceStopMode
  decisao_execucao?: 'COM_PARADA' | 'SEM_PARADA'
  status?: string
  equipamento_ja_parado?: boolean | string
  alterou_status_ativo?: boolean | string
  iniciada_em?: string
  finalizada_em?: string
  duracao_segundos?: number
  usuario_id?: string
}

export interface StartActionData {
  ok?: boolean
  started?: boolean
  already_started?: boolean
  acao_id?: string
  execucao_id?: string
  status?: string
  version?: string
  modo_parada_manutencao?: MaintenanceStopMode
  decisao_parada_manutencao?: MaintenanceStartDecision
  modo_execucao_manutencao?: 'COM_PARADA' | 'SEM_PARADA'
  parada?: OperatorStopData | null
  parada_operacional?: OperatorStopData | null
  parada_manutencao?: MaintenanceStopData | null
  horimetro?: HorimeterSummary | null
  execucao?: NonNullable<OperatorActionDetailData['execucao']>
  checklist?: OperatorActionDetailData['checklist']
}

export interface OperatorActionStateData {
  ok?: boolean
  started: boolean
  acao_id: string
  status?: string
  execucao_id?: string
  execucao?: OperatorActionDetailData['execucao']
  checklist?: OperatorActionDetailData['checklist'] | null
  modo_execucao_manutencao?: 'COM_PARADA' | 'SEM_PARADA' | ''
  parada_operacional?: OperatorStopData | null
  parada_manutencao?: MaintenanceStopData | null
  server_time?: string
}

export interface ChecklistBatchItemInput {
  id?: string
  checklist_execucao_id?: string
  ordem: number
  resposta?: string
  valor?: number
  observacao?: string
}

export interface ChecklistBatchSaveData {
  ok: boolean
  version?: string
  acao_id: string
  execucao_id: string
  saved_count: number
  error_count: number
  salvos?: Array<{
    index?: number
    checklist_execucao_id?: string
    tipo_resposta?: string
    conforme?: string
    validacao_msg?: string
  }>
  erros?: Array<{
    index?: number
    ordem?: number
    checklist_execucao_id?: string
    code?: string
    message?: string
  }>
  can_finalize?: boolean
  message?: string
}

export interface EvidenceRecord {
  id?: string
  execucao_id?: string
  acao_id?: string
  checklist_execucao_id?: string
  tipo?: string
  nome_arquivo?: string
  url?: string
  thumbnail_url?: string
  arquivo_id?: string
  mime_type?: string
  tamanho_bytes?: number
  observacao?: string
  criado_em?: string
}

export interface EvidenceInput {
  checklist_execucao_id: string
  tipo: string
  nome_arquivo: string
  url: string
  observacao?: string
}

export interface EvidencePhotoUploadInput {
  checklist_execucao_id: string
  nome_arquivo: string
  mime_type: string
  tamanho_bytes: number
  base64_data: string
  observacao?: string
}

export interface EvidenceSaveData {
  saved: boolean
  uploaded?: boolean
  checklist_execucao_id?: string
  evidencias_count?: number
  minimo_fotos?: number
  arquivo_id?: string
  url?: string
  thumbnail_url?: string
  mime_type?: string
  tamanho_bytes?: number
  evidencia?: EvidenceRecord
  quantidade_configurada?: number
  fotos_registradas?: number
  fotos_restantes?: number
}

export interface FinalizationValidationData {
  ok: boolean
  version?: string
  contract_version?: string
  acao_id: string
  execucao_id: string
  operador_id?: string
  can_finalize: boolean
  finalizacao?: {
    ok?: boolean
    can_finalize?: boolean
    total?: number
    respondidos?: number
    pending_count?: number
    evidence_missing_count?: number
    blockers_count?: number
    pendentes?: unknown[]
    evidencias_pendentes?: unknown[]
    bloqueios?: unknown[]
  }
  message?: string
}

export type OperatorFinalOutcome =
  | 'CONFORME'
  | 'DIFERENCAS_JUSTIFICADAS'
  | 'PARCIAL'
  | 'NAO_EXECUTADO'
  | 'OUTRO'

export interface FinalizeActionInput {
  resultado: 'OK' | 'NOK'
  resultado_operacional: OperatorFinalOutcome
  observacao: string
  duracao_segundos?: number
}

export interface FinalizeActionData {
  finalized: boolean
  already_finalized?: boolean
  acao_id: string
  execucao_id: string
  status_acao: string
  resultado?: 'OK' | 'NOK'
  resultado_operacional?: OperatorFinalOutcome
  requires_manager_validation?: boolean
  pendencias_registradas?: {
    obrigatorias: number
    evidencias: number
    bloqueios: number
  }
  parada?: OperatorStopData | null
  parada_operacional?: OperatorStopData | null
  parada_manutencao?: MaintenanceStopData | null
}



export interface OperatorStopData {
  id: string
  ativo_id: string
  componente_id?: string
  os_id?: string
  acao_id?: string
  execucao_id?: string
  origem?: string
  tipo?: string
  status: string
  iniciada_em: string
  iniciada_por?: string
  manutencao_iniciada_em?: string
  manutencao_finalizada_em?: string
  finalizada_em?: string
  finalizada_por?: string
  tempo_parada_segundos?: number
  tempo_espera_manutencao_segundos?: number
  tempo_execucao_segundos?: number
  tempo_retorno_operacional_segundos?: number
  elapsed_seconds?: number
  motivo_parada?: string
  categoria_retorno?: string
  justificativa_divergencia?: string
  tolerancia_retorno_min?: number
  requires_return_confirmation?: boolean
  server_time?: string
}

export interface OperatorOccurrenceData {
  id: string
  ativo_id: string
  componente_id?: string
  tipo?: string
  titulo: string
  descricao: string
  severidade: string
  status: string
  usuario_id?: string
  perfil?: string
  os_id?: string
  acao_id?: string
  criado_em?: string
  atualizado_em?: string
}

export interface ActiveStopResponseData {
  found: boolean
  ativo_id: string
  parada_ativa: OperatorStopData | null
  server_time?: string
}

export interface StartStopInput {
  ativo_id: string
  componente_id?: string
  tipo?: string
  motivo_parada?: string
}

export interface StartStopResponseData {
  started: boolean
  already_open?: boolean
  parada: OperatorStopData
  notified_profiles?: string[]
}

export interface FinishStopInput {
  parada_id?: string
  ativo_id?: string
  categoria_retorno?: string
  justificativa_divergencia?: string
}

export interface FinishStopResponseData {
  closed: boolean
  already_closed?: boolean
  requires_justification?: boolean
  tolerance_minutes?: number
  delay_seconds?: number
  categories?: string[]
  parada: OperatorStopData
  metricas?: {
    tempo_parada_segundos: number
    tempo_espera_manutencao_segundos: number
    tempo_execucao_segundos: number
    tempo_retorno_operacional_segundos: number
  }
}

export interface RegisterOccurrenceInput {
  ativo_id: string
  componente_id?: string
  alvo_ocorrencia: 'EQUIPAMENTO' | 'COMPONENTE'
  tipo?: string
  titulo: string
  descricao: string
  severidade?: string
}

export interface RegisterOccurrenceResponseData {
  saved: boolean
  occurrence: OperatorOccurrenceData
  alvo_ocorrencia?: 'EQUIPAMENTO' | 'COMPONENTE'
  notified_profiles?: string[]
}

export interface HorimeterSummary {
  ativo_id?: string
  total_horas: number
  modo: 'MANUAL' | 'TELEMETRIA'
  automatico: boolean
  atualizado_em?: string
  contador_servico_horas?: number | null
  contador_servico_base?: number | null
  contador_servico_reiniciado_em?: string
  total_reiniciavel: false
  contador_servico_reiniciavel: true
}

export interface QrAssetData {
  id: string
  linha_id?: string
  tag?: string
  qr_payload?: string
  nome?: string
  tipo?: string
  criticidade?: string
  status?: string
  saude_pct?: number | string
  horimetro_atual?: number | string
  horimetro_modo?: 'MANUAL' | 'TELEMETRIA'
  horimetro_atualizado_em?: string
  horimetro_base_servico?: number | string
  horimetro_base_servico_em?: string
  fabricante?: string
  modelo?: string
  numero_serie?: string
  localizacao_tecnica?: string
}

export interface QrComponentData {
  id: string
  ativo_id?: string
  tag?: string
  nome?: string
  tipo?: string
  criticidade?: string
  status?: string
  horas_acumuladas?: number | string
  fabricante?: string
  modelo?: string
  numero_serie?: string
  localizacao_tecnica?: string
}

export interface QrActionData {
  id: string
  os_id?: string
  ativo_id?: string
  componente_id?: string
  plano_id?: string
  origem?: string
  tipo?: string
  titulo?: string
  descricao?: string
  prioridade?: string
  status?: string
  gerado_em?: string
  componente_nome?: string
  plano?: {
    nome?: string
    tipo?: string
    tempo_estimado_min?: number | string
  }
}

export interface QrHistoryData {
  id: string
  ativo_id?: string
  componente_id?: string
  os_id?: string
  acao_id?: string
  execucao_id?: string
  evento?: string
  descricao?: string
  usuario_id?: string
  perfil?: string
  criado_em?: string
}


export interface QrHistoryPaginationData {
  next_cursor?: string
  has_more?: boolean
  limit?: number
}

export interface QrHistoryPageData extends QrHistoryPaginationData {
  items: QrHistoryData[]
  ativo_id?: string
  componente_id?: string
  scanned_rows?: number
}

export interface QrParameterData {
  id: string
  ativo_id?: string
  componente_id?: string
  parametro?: string
  valor?: number | string
  unidade?: string
  origem?: string
  registrado_por?: string
  registrado_em?: string
  criado_em?: string
}

export interface OperatorQrContextData {
  found: boolean
  tipo_contexto: string
  mensagem_operador?: string
  ativo: QrAssetData | null
  horimetro?: HorimeterSummary | null
  componente: QrComponentData | null
  componentes?: QrComponentData[]
  acoes_pendentes?: QrActionData[]
  proxima_acao?: QrActionData | null
  historico_recente?: QrHistoryData[]
  historico_paginacao?: QrHistoryPaginationData
  parametros_recentes?: QrParameterData[]
  parametros_atuais?: QrParameterData[]
  parada_ativa?: OperatorStopData | null
  ocorrencias_abertas?: OperatorOccurrenceData[]
  saude?: {
    pct?: number
    status?: string
    acoes_abertas?: number
    os_abertas?: number
  } | null
}

export interface RegisterParameterInput {
  ativo_id: string
  componente_id?: string
  parametro: string
  valor: number
  unidade?: string
  origem?: string
}

export interface RegisterParameterData {
  saved: boolean
  parametro: QrParameterData
  recalculo?: unknown
}
