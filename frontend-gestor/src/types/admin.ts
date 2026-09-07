export type AdminUserProfile = 'ADMIN' | 'GESTOR' | 'OPERADOR'
export type AdminUserStatus = 'ATIVO' | 'INATIVO'

export interface AdminUser {
  id: string
  nome: string
  email: string
  matricula: string
  perfil: AdminUserProfile
  status: AdminUserStatus
  primeiro_acesso?: string
  tentativas_login?: number | string
  bloqueado_ate?: string
  ultimo_login_em?: string
  senha_atualizada_em?: string
  recuperacao_referencia?: string
  recuperacao_solicitada_em?: string
  recuperacao_pendente?: boolean
  sessoes_ativas?: number
  criado_em?: string
  atualizado_em?: string
  area_id?: string
  cargo_id?: string
  especialidades_json?: string
  escopo_ids_json?: string
}

export interface AdminUserInput {
  id?: string
  nome: string
  email: string
  matricula: string
  perfil: AdminUserProfile
  status: AdminUserStatus
  senha_temporaria?: string
  area_id?: string
  cargo_id?: string
  especialidades?: string[]
  escopo_ids?: string[]
}

export interface TechnicalArea {
  id: string
  codigo: string
  nome: string
  descricao?: string
  status: AdminUserStatus
  exige_assinatura_padrao?: string
}

export interface TechnicalRole {
  id: string
  area_id: string
  codigo: string
  nome: string
  descricao?: string
  status: AdminUserStatus
  pode_assinar?: string
}

export interface TechnicalAreaInput {
  id?: string
  codigo: string
  nome: string
  descricao?: string
  status: AdminUserStatus
  exige_assinatura_padrao: string
}

export interface TechnicalRoleInput {
  id?: string
  area_id: string
  codigo: string
  nome: string
  descricao?: string
  status: AdminUserStatus
  pode_assinar: string
}

export interface AdminUserListFilters {
  busca?: string
  perfil?: AdminUserProfile | ''
  status?: AdminUserStatus | ''
}

export interface AdminUserSaveResult {
  saved: boolean
  mode: 'insert' | 'update'
  usuario: AdminUser
  sessoes_revogadas: number
}

export interface AdminPasswordResetResult {
  password_reset: boolean
  usuario_id: string
  primeiro_acesso: boolean
  sessoes_revogadas: number
}

export interface AdminSessionRevokeResult {
  revoked: boolean
  usuario_id: string
  sessoes_revogadas: number
}

export interface AdminPermissionCapability {
  id: string
  nome: string
  descricao: string
  permitido: boolean
  padrao: boolean
  acoes: string[]
}

export interface AdminPermissionProfile {
  perfil: AdminUserProfile
  editavel: boolean
  acesso_total?: boolean
  capacidades: AdminPermissionCapability[]
}

export interface AdminPermissionMatrix {
  chave: string
  perfis: AdminPermissionProfile[]
}

export interface AdminPermissionSaveResult {
  saved: boolean
  perfil: AdminUserProfile
  matriz: AdminPermissionProfile
}

export interface AdminCompanyProfile {
  nome: string
  logo_data_url: string
  atualizado_em?: string
}

export interface AdminCompanySaveResult {
  saved: boolean
  empresa: AdminCompanyProfile
}

export type AdminCommercialFeatureCode =
  | 'CADASTROS'
  | 'ORDENS_SERVICO'
  | 'CHECKLISTS'
  | 'GESTAO_TECNICA'
  | 'INDICADORES'
  | 'DOCUMENTOS'
  | 'IMPORTACOES'
  | 'AUDITORIA'
  | 'CONTINUIDADE'
  | 'MOTOR_LIMITADO'

export interface AdminCommercialAccess {
  schema_version: string
  plano: {
    codigo: 'INICIAL' | 'BASICO' | 'COMPLETO' | 'BLOQUEADO'
    nome: string
  }
  status: 'ATIVA' | 'BLOQUEADA'
  valido_ate: string
  recursos: Array<{
    codigo: AdminCommercialFeatureCode
    nome: string
  }>
  manutencao: {
    aberta: boolean
    estado: 'ABERTA' | 'FECHADA' | 'BLOQUEADA'
    motivo: string
    expira_em: string
    janela_id?: string
    operador_nome?: string
    ambiente?: string
  }
  acesso_integral: boolean
  identidade_interna?: {
    nome: string
    ambiente: string
    janela_id: string
  } | null
  usuario_id: string
}

export type PlatformMotorPlanCode = 'INICIAL' | 'BASICO' | 'COMPLETO'

export interface PlatformMotorPlan {
  codigo: PlatformMotorPlanCode
  nome: string
  recursos: AdminCommercialFeatureCode[]
}

export interface PlatformMotorCatalogValidationError {
  plano: PlatformMotorPlanCode | 'DESCONHECIDO'
  codigo: string
  mensagem: string
}

export interface PlatformMotorCatalogValidation {
  valido: boolean
  erros: PlatformMotorCatalogValidationError[]
  planos: PlatformMotorPlan[]
  hash_sha256: string
}

export interface PlatformMotorCatalogDraft {
  integridade?: 'VALIDA'
  id: string
  base_versao_id: string
  planos: PlatformMotorPlan[]
  hash_sha256: string
  validacao: PlatformMotorCatalogValidation
  criado_por?: string
  criado_em?: string
  atualizado_em: string
}

export interface PlatformMotorCatalogVersion {
  id: string
  numero: number
  origem: 'PUBLICACAO' | 'ROLLBACK'
  hash_sha256: string
  publicado_por: string
  publicado_em: string
  ativa?: boolean
}

export interface PlatformMotorCatalogActiveVersion {
  id: string
  numero: number
  origem: 'PADRAO_EM_CODIGO' | 'PUBLICACAO' | 'ROLLBACK'
  integridade: 'VALIDA' | 'INVALIDA' | 'PADRAO_SEGURO'
  hash_sha256: string
  publicado_em: string
  publicado_por: string
  planos?: PlatformMotorPlan[]
}

export interface PlatformMotorCatalogControl {
  schema_version: string
  edicao_disponivel: boolean
  ativa: PlatformMotorCatalogActiveVersion
  rascunho: PlatformMotorCatalogDraft | {
    integridade: 'INVALIDA'
    motivo: string
  } | null
  historico: {
    integridade: 'VALIDA' | 'INVALIDA' | 'PADRAO_SEGURO'
    total: number
    versoes: PlatformMotorCatalogVersion[]
  }
  limites: {
    versoes_retidas: number
    bytes_por_propriedade: number
  }
}

export interface PlatformMotorCatalog {
  schema_version: string
  gerado_em: string
  ambiente: string
  tenant_id: string
  assinatura: {
    plano: {
      codigo: 'INICIAL' | 'BASICO' | 'COMPLETO' | 'BLOQUEADO'
      nome: string
    }
    status: 'ATIVA' | 'BLOQUEADA'
    origem: string
    integridade: string
    valido_ate: string
    recursos: AdminCommercialFeatureCode[]
  }
  manutencao: AdminCommercialAccess['manutencao']
  recursos: Array<{
    codigo: AdminCommercialFeatureCode
    nome: string
  }>
  planos: PlatformMotorPlan[]
  politicas: {
    padrao: 'NEGAR_ACAO_NAO_CLASSIFICADA'
    regras: Array<{
      prefixo: string
      recurso: AdminCommercialFeatureCode
    }>
    acoes_nucleo: string[]
  }
  protecoes: {
    identidade_assinada: boolean
    janela_assinada: boolean
    codigo_uso_unico: boolean
    sessao_sem_cache: boolean
    revalidacao_por_requisicao: boolean
  }
  controle: PlatformMotorCatalogControl | null
}

export interface PlatformMotorCatalogPublishResult {
  published: boolean
  ativa: PlatformMotorCatalogActiveVersion & {
    planos: PlatformMotorPlan[]
  }
  aviso?: string
  rollback_from_version_id?: string
}

export type ConfigurationValue = string | number | boolean

export interface ConfigurationDefinition {
  chave: string
  grupo: 'OPERACAO' | 'EVIDENCIAS' | 'WORKFLOW' | 'INDICADORES'
  nome: string
  descricao: string
  tipo: 'INTEIRO' | 'NUMERO' | 'BOOLEANO' | 'ENUM'
  padrao: ConfigurationValue
  minimo?: number
  maximo?: number
  unidade?: string
  opcoes?: string[]
}

export interface ConfigurationValidationError {
  chave: string
  codigo: string
  mensagem: string
}

export interface ConfigurationValidation {
  valido: boolean
  erros: ConfigurationValidationError[]
  configuracao: Record<string, ConfigurationValue>
  hash_sha256: string
}

export interface ConfigurationActiveVersion {
  id: string
  numero: number
  hash_sha256: string
  configuracao: Record<string, ConfigurationValue>
  publicado_em: string
  publicado_por: string
  integridade: 'VALIDA' | 'PADRAO_SEGURO' | 'FALLBACK_SEGURO'
}

export interface ConfigurationDraft {
  id: string
  base_versao_id: string
  configuracao: Record<string, ConfigurationValue>
  hash_sha256: string
  validacao: ConfigurationValidation
  atualizado_em: string
}

export interface ConfigurationEngineState {
  catalogo: ConfigurationDefinition[]
  protegidas: string[]
  acesso_comercial: AdminCommercialAccess | null
  ativa: ConfigurationActiveVersion
  rascunho: ConfigurationDraft | null
}

export interface ConfigurationVersion {
  id: string
  numero: number
  status: 'ATIVA' | 'PUBLICADA'
  origem: 'PUBLICACAO' | 'ROLLBACK'
  base_versao_id: string
  hash_sha256: string
  valido: boolean
  criado_por: string
  criado_em: string
}

export interface ConfigurationPublishResult {
  published: boolean
  ativa: ConfigurationActiveVersion
  aviso?: string
  rollback_from_version_id?: string
}

export interface AdminTechnicalAnalysis {
  id: string
  demanda_id?: string
  ocorrencia_id: string
  ativo_id?: string
  componente_id?: string
  autor_id?: string
  area_id?: string
  cargo_id?: string
  titulo: string
  diagnostico?: string
  risco?: string
  causa_provavel?: string
  recomendacao?: string
  recomenda_checklist?: string
  recomenda_os?: string
  prioridade?: string
  status: string
  enviado_admin_em?: string
  criado_em?: string
  atualizado_em?: string
  relatorio_tecnico_json?: string
}

export interface AdminNotificationTarget {
  notificationType: string
  entityType: string
  entityId: string
  nonce: number
}
