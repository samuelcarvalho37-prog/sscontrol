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
  perfil: string
  acao: string
  entidade: string
  entidade_id: string
  antes_json?: string
  depois_json?: string
  user_agent?: string
  criado_em: string
}

export interface AdminAuditListData {
  total: number
  eventos: AdminAuditEvent[]
}

export interface AdminMonitoringState {
  health: {
    ok: boolean
    app: string
    version: string
    spreadsheetId: string
    serverTime: string
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
}

export interface AdminBackup {
  id: string
  nome: string
  tamanho_bytes: number
  criado_em: string
  atualizado_em?: string
  url: string
  pasta_id?: string
}

export interface AdminBackupListData {
  total: number
  backups: AdminBackup[]
  pasta_id: string
  restauracao_disponivel: boolean
  escopo_restauracao: 'OPERACIONAL_SEGURO'
  abas_protegidas: string[]
}

export interface AdminBackupCreateData {
  created: boolean
  backup: AdminBackup
  restauracao_disponivel: boolean
}

export interface AdminBackupRestorePreparation {
  prepared: boolean
  token: string
  desafio: string
  confirmacao_final: string
  backup: Pick<AdminBackup, 'id' | 'nome' | 'criado_em'>
  escopo: 'OPERACIONAL_SEGURO'
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
  escopo: 'OPERACIONAL_SEGURO'
  abas_restauradas: string[]
  abas_protegidas: string[]
  backup_seguranca: AdminBackup
  motivo: string
  restaurado_em: string
}
