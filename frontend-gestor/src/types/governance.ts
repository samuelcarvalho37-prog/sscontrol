export type AdminDocumentType =
  | 'MANUAL'
  | 'DIAGRAMA'
  | 'CERTIFICADO'
  | 'LAUDO'
  | 'PROCEDIMENTO'
  | 'FICHA_TECNICA'
  | 'OUTRO'

export type AdminDocumentStatus = 'RASCUNHO' | 'EM_REVISAO' | 'VIGENTE' | 'OBSOLETO'
export type AdminDocumentEntityType = 'EMPRESA' | 'PLANTA' | 'SETOR' | 'LINHA' | 'ATIVO' | 'COMPONENTE'

export interface AdminDocument {
  id: string
  codigo: string
  titulo: string
  tipo: AdminDocumentType
  entidade_tipo: AdminDocumentEntityType
  entidade_id?: string
  status: AdminDocumentStatus
  status_exibicao: AdminDocumentStatus | 'VENCIDO'
  revisao_atual: string
  validade_em?: string
  responsavel_id?: string
  descricao?: string
  arquivo_id: string
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number | string
  vencido: boolean
  criado_por: string
  criado_em: string
  atualizado_em: string
}

export interface AdminDocumentRevision {
  id: string
  documento_id: string
  revisao: string
  arquivo_id: string
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number | string
  observacao?: string
  criado_por: string
  criado_em: string
}

export interface AdminDocumentMetadataInput {
  id?: string
  documento_id?: string
  codigo?: string
  titulo: string
  tipo: AdminDocumentType
  entidade_tipo: AdminDocumentEntityType
  entidade_id?: string
  status: AdminDocumentStatus
  validade_em?: string
  responsavel_id?: string
  descricao?: string
  revisao?: string
  observacao?: string
}

export interface AdminDocumentFileInput {
  nome: string
  mime_type: string
  base64: string
}

export interface AdminDocumentListData {
  total: number
  documentos: AdminDocument[]
}

export interface AdminDocumentDetailData {
  documento: AdminDocument
  revisoes: AdminDocumentRevision[]
  arquivo_url: string
}

export interface AdminAuditEvent {
  id: string
  usuario_id: string
  responsavel: string
  responsavel_tipo: 'USER' | 'PLATFORM' | string
  perfil: string
  acao: string
  entidade: string
  entidade_id: string
  antes_json?: string
  depois_json?: string
  user_agent?: string
  trace_id?: string
  origem?: string
  ip_address?: string
  campos_ocultos?: string[]
  criado_em: string
}

export interface AdminAuditListData {
  total: number
  deslocamento?: number
  eventos: AdminAuditEvent[]
}

export interface AdminMonitoringState {
  health: {
    ok: boolean
    app: string
    version: string
    spreadsheetId: string
    serverTime: string
    environment?: string
    databaseReady?: boolean
    databaseLatencyMs?: number | null
    [key: string]: unknown
  }
  diagnostico: {
    dry_run: boolean
    total_issues: number
    by_code: Record<string, number>
    issues: Array<Record<string, unknown>>
  }
  cache: Record<string, unknown>
  auditoria: {
    eventos_24h: number
    ultimo_evento: AdminAuditEvent | null
  }
  tabelas_declaradas: number
  verificado_em: string
  telemetria?: {
    windowMinutes: number
    observedAt: string
    source: 'process-memory'
    persistence: 'process-lifetime'
    modules: Array<{
      module: string
      calls: number
      serverErrors: number
      deniedRequests: number
      p95Ms: number
      averageMs: number
      state: 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WARNING' | 'CRITICAL'
      capabilities: Array<{
        capability: string
        calls: number
        p95Ms: number
        averageMs: number
        serverErrors: number
        deniedRequests: number
        errorRatio: number
        state: 'INSUFFICIENT_DATA' | 'HEALTHY' | 'WARNING' | 'CRITICAL'
        observedAt: string | null
      }>
    }>
  }
}

export type AdminBackupScopeId = 'OPERACIONAL' | 'IMPORTACOES' | 'ACESSOS' | 'CONFIGURACOES'

export interface AdminBackupScope {
  id: AdminBackupScopeId
  nome: string
  descricao: string
}

export interface AdminBackup {
  id: string
  nome: string
  tamanho_bytes: number
  criado_em: string
  atualizado_em?: string
  url: string
  pasta_id?: string
  escopos?: AdminBackupScopeId[]
}

export interface AdminBackupListData {
  total: number
  backups: AdminBackup[]
  pasta_id: string
  restauracao_disponivel: boolean
  escopo_restauracao: 'OPERACIONAL_SEGURO' | 'SELECIONAVEL'
  abas_protegidas: string[]
  escopos_disponiveis: AdminBackupScope[]
  pontos_por_mes: Record<string, number>
}

export interface AdminBackupCreateData {
  created: boolean
  backup: AdminBackup
  restauracao_disponivel: boolean
  escopos: AdminBackupScopeId[]
}

export interface AdminBackupRestorePreparation {
  prepared: boolean
  token: string
  desafio: string
  confirmacao_final: string
  backup: Pick<AdminBackup, 'id' | 'nome' | 'criado_em'>
  escopo: 'OPERACIONAL_SEGURO' | 'SELECIONAVEL'
  escopos_disponiveis: AdminBackupScope[]
  escopos_restaurados: AdminBackupScopeId[]
  abas_restauradas: string[]
  abas_protegidas: string[]
  abas_ausentes: string[]
  total_celulas: number
  expira_em: string
}

export interface AdminBackupRestoreResult {
  restored: boolean
  backup_id: string
  backup_nome: string
  escopo: 'OPERACIONAL_SEGURO' | 'SELECIONAVEL'
  escopos_restaurados: AdminBackupScopeId[]
  abas_restauradas: string[]
  abas_protegidas: string[]
  backup_seguranca: AdminBackup
  motivo: string
  restaurado_em: string
}
