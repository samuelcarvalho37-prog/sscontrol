export interface GestorAction {
  id: string
  status: string
  titulo?: string
  prioridade?: string
  ativo_id?: string
  ativo_tag?: string
  ativo_nome?: string
  componente_nome?: string
  plano_id?: string
  gerado_em?: string
  iniciado_em?: string
  finalizado_em?: string
  atualizado_em?: string
  locks_ativos?: number
  [key: string]: unknown
}

export interface GestorStop {
  id: string
  status: string
  ativo_id: string
  acao_id?: string
  iniciada_em?: string
  motivo_parada?: string
  elapsed_seconds?: number
  requires_return_confirmation?: boolean
  [key: string]: unknown
}

export interface GestorOccurrence {
  id: string
  status: string
  severidade?: string
  titulo?: string
  descricao?: string
  ativo_id?: string
  parada_id?: string
  criado_em?: string
  [key: string]: unknown
}

export interface GestorKpiBase {
  ativo_id: string
  total_execucoes: number
  execucoes_finalizadas: number
  falhas_registradas: number
  acoes_abertas: number
  mttr_segundos: number
  disponibilidade_base_pct: number
  observacao?: string
}

export interface GestorTechnicalKpis {
  ativo_id: string
  componente_id?: string
  inicio_em: string
  fim_em: string
  ativos_considerados: number
  disponibilidade_pct: number | null
  tempo_observado_segundos: number
  tempo_operacao_segundos: number
  tempo_parada_segundos: number
  falhas_nao_planejadas: number
  mttr_segundos: number | null
  mtbf_segundos: number | null
  lead_time_os_segundos: number | null
  lead_time_demanda_segundos: number | null
  sla_resposta_pct: number | null
  sla_resolucao_pct: number | null
  sla_resposta_amostra: number
  sla_resolucao_amostra: number
  oee_disponivel: boolean
  oee_pct: number | null
  oee_disponibilidade_pct: number | null
  oee_performance_pct: number | null
  oee_qualidade_pct: number | null
  producao_amostra: number
  metodologia?: string
  metas?: {
    disponibilidade_pct: number
    oee_pct: number
  }
}

export interface GestorTechnicalIdentity {
  usuario_id: string
  nome: string
  perfil: string
  area_id: string
  area_nome: string
  cargo_id: string
  cargo_nome: string
  pode_assinar: boolean
  area_codigo?: string
  validador_padrao?: boolean
  especialidades: string[]
  escopo_ids: string[]
}

export interface GestorTechnicalArea {
  id: string
  codigo: string
  nome: string
  status: string
}

export interface GestorTechnicalRole {
  id: string
  area_id: string
  codigo: string
  nome: string
  status: string
  pode_assinar?: string
}

export interface GestorTechnicalContext {
  identidade: GestorTechnicalIdentity
  areas: GestorTechnicalArea[]
  cargos: GestorTechnicalRole[]
  pode_encaminhar: boolean
  pode_assinar: boolean
  pode_validar: boolean
  modo_trabalho: 'VALIDACAO' | 'ACOMPANHAMENTO'
  politicas_assinatura?: Array<{
    codigo: string
    nome: string
    assinaturas: number
  }>
}

export interface GestorTechnicalDemand {
  id: string
  tipo: string
  entidade_tipo: string
  entidade_id: string
  titulo: string
  descricao?: string
  prioridade: string
  status: string
  area_atual_id?: string
  area_atual_nome?: string
  cargo_atual_id?: string
  cargo_atual_nome?: string
  responsavel_atual_id?: string
  responsavel_atual_nome?: string
  exige_assinatura?: string
  politica_assinatura?: string
  assinaturas_necessarias?: number
  assinaturas_realizadas?: number
  assinatura_concluida?: boolean
  areas_validadoras?: Array<{
    id: string
    codigo?: string
    nome?: string
    assinada: boolean
    necessaria?: boolean
  }>
  prazo_primeira_resposta_em?: string
  prazo_resolucao_em?: string
  sla_resposta_atrasado?: boolean
  sla_resolucao_atrasado?: boolean
  criado_em?: string
  atualizado_em?: string
}

export interface GestorTechnicalAnalysisInput {
  id?: string
  ocorrencia_id: string
  ativo_id?: string
  componente_id?: string
  titulo: string
  diagnostico: string
  risco: string
  causa_provavel: string
  recomendacao: string
  recomenda_checklist: boolean
  recomenda_os: boolean
  prioridade: string
  relatorio_tecnico: GestorTechnicalBrief
}

export interface GestorTechnicalStep {
  ordem: number
  titulo: string
  descricao: string
}

export interface GestorTechnicalBrief {
  situacao: string
  causa_provavel: string
  resultado_esperado: string
  riscos: Array<{
    tipo: string
    titulo: string
    descricao: string
  }>
  seguranca: string[]
  nrs: string[]
  ferramentas: Array<{
    tipo: string
    nome: string
  }>
  etapas: GestorTechnicalStep[]
  evidencias_requeridas: string[]
  criterio_aceite: string
}

export interface GestorNotification {
  id: string
  usuario_id?: string
  perfil?: string
  area_id?: string
  tipo: string
  titulo: string
  mensagem?: string
  entidade_tipo?: string
  entidade_id?: string
  prioridade?: string
  status: string
  lida_em?: string
  criado_em?: string
}

export interface GestorExecution {
  id?: string
  acao_id?: string
  usuario_id?: string
  operador_id?: string
  status?: string
  iniciou_em?: string
  finalizou_em?: string
  resultado_operacional?: string
  resultado_tecnico?: string
  [key: string]: unknown
}

export interface GestorChecklistItem {
  id?: string
  acao_id?: string
  execucao_id?: string
  item_id?: string
  descricao?: string
  pergunta?: string
  titulo?: string
  resposta?: string
  valor?: string | number | boolean
  resultado?: string
  observacao?: string
  comentario?: string
  status?: string
  respondido?: boolean
  obrigatorio?: boolean
  bloqueante?: boolean
  usuario_id?: string
  respondido_por?: string
  [key: string]: unknown
}

export interface GestorEvidence {
  id?: string
  acao_id?: string
  execucao_id?: string
  checklist_execucao_id?: string
  tipo?: string
  nome_arquivo?: string
  url?: string
  observacao?: string
  usuario_id?: string
  criado_em?: string
  [key: string]: unknown
}

export interface GestorHistoryItem {
  id?: string
  evento?: string
  descricao?: string
  usuario_id?: string
  perfil?: string
  criado_em?: string
  [key: string]: unknown
}

export interface GestorActionDetail {
  acao: GestorAction
  os?: Record<string, unknown> | null
  ativo?: Record<string, unknown> | null
  componente?: Record<string, unknown> | null
  execucoes: GestorExecution[]
  checklist: GestorChecklistItem[]
  evidencias: GestorEvidence[]
  materiais: Record<string, unknown>[]
  locks: Record<string, unknown>[]
  historico: GestorHistoryItem[]
}

export interface GestorActionAudit {
  acao?: Record<string, unknown> | null
  execucao?: Record<string, unknown> | null
  checklist?: unknown
  evidencias?: unknown
  finalizacao?: {
    can_finalize?: boolean
    [key: string]: unknown
  } | null
  auditoria?: {
    integridade_ok?: boolean
    [key: string]: unknown
  } | null
  gestor_screen?: Record<string, unknown> | null
  [key: string]: unknown
}

export type GestorDecision = 'APROVAR' | 'REPROVAR'

export interface GestorDecisionResult {
  validated: boolean
  already_validated?: boolean
  acao_id: string
  decisao: GestorDecision
  status: string
}

export interface GestorOverview {
  actions: GestorAction[]
  completedActions: GestorAction[]
  validationQueue: GestorAction[]
  stops: GestorStop[]
  openStops: GestorStop[]
  occurrences: GestorOccurrence[]
  occurrenceHistory: GestorOccurrence[]
  kpis: GestorTechnicalKpis
  counts: {
    pending: number
    executing: number
    awaitingValidation: number
    blocked: number
    openStops: number
    awaitingOccurrences: number
  }
}

export type GestorWorkView = 'demands' | 'actions' | 'models' | 'operations'

export interface GestorChecklistModel {
  id: string
  nome?: string
  tipo?: string
  criticidade?: string
  ativo_id?: string
  ativo_tag?: string
  ativo_nome?: string
  componente_id?: string
  componente_tag?: string
  componente_nome?: string
  workflow_status?: string
  status?: string
  revisao?: number
  tempo_estimado_min?: number
  requer_bloqueio?: string
  requer_evidencia?: string
  itens_count?: number
  atualizado_em?: string
  enviado_validacao_em?: string
  [key: string]: unknown
}

export interface GestorChecklistModelItem {
  id: string
  plano_id?: string
  ordem?: number
  titulo?: string
  instrucao?: string
  tipo_resposta?: string
  obrigatorio?: string
  evidencia_obrigatoria?: string
  bloqueia_finalizacao?: string
  categoria?: string
  unidade?: string
  limite_min?: number | string
  limite_max?: number | string
  status?: string
  [key: string]: unknown
}

export interface GestorChecklistModelValidation {
  id?: string
  plano_id?: string
  revisao?: number
  decisao?: string
  justificativa?: string
  usuario_id?: string
  perfil?: string
  criado_em?: string
  [key: string]: unknown
}

export interface GestorChecklistModelDetail {
  plano: GestorChecklistModel
  ativo?: Record<string, unknown> | null
  componente?: Record<string, unknown> | null
  itens: GestorChecklistModelItem[]
  validacoes: GestorChecklistModelValidation[]
  ultimo_parecer?: GestorChecklistModelValidation | null
  correcoes_pendentes?: boolean
  operacional?: boolean
}

export type GestorChecklistModelDecision = 'APROVAR' | 'DEVOLVER'

export interface GestorChecklistModelDecisionResult {
  validated: boolean
  plano_id: string
  decisao: GestorChecklistModelDecision
  workflow_status: string
  status: string
}

export interface GestorAsset {
  id: string
  tag?: string
  nome?: string
  tipo?: string
  criticidade?: string
  status?: string
  saude_pct?: number
  horimetro_atual?: number
  fabricante?: string
  modelo?: string
  numero_serie?: string
  localizacao_tecnica?: string
  linha_id?: string
  [key: string]: unknown
}

export interface GestorComponent {
  id: string
  ativo_id: string
  tag?: string
  nome?: string
  tipo?: string
  criticidade?: string
  status?: string
  vida_util_horas?: number
  vida_util_dias?: number
  horas_acumuladas?: number
  fabricante?: string
  modelo?: string
  localizacao_tecnica?: string
  [key: string]: unknown
}

export interface GestorAssetCatalog {
  assets: GestorAsset[]
  components: GestorComponent[]
}

export interface GestorAssetParameter {
  id: string
  ativo_id?: string
  componente_id?: string
  parametro?: string
  valor?: number | string
  unidade?: string
  origem?: string
  registrado_por?: string
  registrado_por_nome?: string
  registrado_em?: string
  criado_em?: string
  status_limite?: GestorParameterStatus
}

export type GestorParameterStatus =
  | 'NORMAL'
  | 'ACIMA_LIMITE'
  | 'ABAIXO_LIMITE'
  | 'SEM_LEITURA'
  | 'SEM_LIMITE'

export interface GestorAssetParameterSummary {
  chave: string
  parametro: string
  unidade?: string
  limite_min?: number | null
  limite_max?: number | null
  valor_esperado?: string
  plano_id?: string
  plano_nome?: string
  componente_id?: string
  componente_nome?: string
  componente_tag?: string
  configurado: boolean
  status: GestorParameterStatus
  leitura_atual: GestorAssetParameter | null
  leituras_recentes: GestorAssetParameter[]
}

export interface GestorAssetParameterRule {
  id: string
  plano_id?: string
  plano_nome?: string
  componente_id?: string
  parametro_nome?: string
  unidade?: string
  limite_min?: number | string
  limite_max?: number | string
  valor_esperado?: string
}

export interface GestorAssetHistory {
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
  usuario_nome?: string
  os_codigo?: string
  os_titulo?: string
  acao_titulo?: string
  execucao?: {
    id: string
    status?: string
    resultado?: string
    observacao?: string
    duracao_segundos?: number
    iniciou_em?: string
    finalizou_em?: string
    operador_id?: string
    operador_nome?: string
    checklist_total?: number
    checklist_respondidos?: number
    checklist_nao_conformes?: number
    checklist_itens?: Array<{
      id: string
      ordem?: number
      titulo?: string
      resposta?: string
      valor_numero?: number | string
      unidade?: string
      conforme?: string
      observacao?: string
    }>
  } | null
}

export interface GestorAssetJourney {
  found: boolean
  tipo_contexto: string
  ativo: GestorAsset | null
  componente: GestorComponent | null
  componentes: GestorComponent[]
  acoes_pendentes: GestorAction[]
  historico_recente: GestorAssetHistory[]
  parametros_recentes: GestorAssetParameter[]
  parametros_atuais: GestorAssetParameter[]
  regras_parametros: GestorAssetParameterRule[]
  parametros_analisados: GestorAssetParameterSummary[]
  historico_manutencao: GestorAssetHistory[]
  parada_ativa: GestorStop | null
  ocorrencias_abertas: GestorOccurrence[]
  saude: {
    pct?: number
    status?: string
    acoes_abertas?: number
    os_abertas?: number
  } | null
  consulta_registrada_em?: string
  consultado_por?: {
    usuario_id?: string
    nome?: string
    area_nome?: string
    cargo_nome?: string
  }
}

export type GestorParameterRequestType =
  | 'INSPECAO'
  | 'CHECKLIST'
  | 'AJUSTE_LIMITE'

export interface GestorParameterActionRequest {
  parametro_id: string
  tipo_solicitacao: GestorParameterRequestType
  prioridade: string
  observacao: string
  causa_provavel?: string
  risco?: string
  limite_min_proposto?: number
  limite_max_proposto?: number
}
