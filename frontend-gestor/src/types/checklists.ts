import type { AdminEntityRecord } from './catalog'
import type { ValidationRouteDraft } from './validation'

export type ChecklistResponseType =
  | 'CONFIRMACAO'
  | 'OK_NOK'
  | 'NUMERO'
  | 'PARAMETRO'
  | 'TEXTO'
  | 'SELECAO'
  | 'EVIDENCIA'
  | 'LEITURA_OPERACIONAL'
  | 'INSTRUCAO'

export interface AdminChecklistPlan extends AdminEntityRecord {
  ativo_id: string
  componente_id?: string
  nome: string
  tipo: string
  criticidade: string
  gatilho_tipo: string
  gatilho_valor: number | string
  unidade?: string
  recorrencia_dias?: number | string
  tempo_estimado_min?: number | string
  requer_bloqueio?: string
  requer_evidencia?: string
  max_sessoes?: number | string
  modo_parada_manutencao?: string
  workflow_status?: string
  status?: string
  revisao?: number | string
  ativo_tag?: string
  ativo_nome?: string
  componente_tag?: string
  componente_nome?: string
  itens_count?: number
  operacional?: boolean
}

export interface AdminChecklistItem extends AdminEntityRecord {
  plano_id?: string
  ordem: number
  titulo: string
  instrucao?: string
  tipo_resposta: ChecklistResponseType
  obrigatorio: string
  evidencia_obrigatoria: string
  limite_min?: number | string
  limite_max?: number | string
  unidade?: string
  parametro_nome?: string
  valor_esperado?: string
  opcoes_json?: string
  opcoes_texto?: string
  bloqueia_finalizacao?: string
  categoria?: string
  peso?: number | string
  evidencia_min_fotos?: number | string
  status?: string
}

export interface AdminChecklistDetail {
  plano: AdminChecklistPlan
  ativo: AdminEntityRecord | null
  componente: AdminEntityRecord | null
  itens: AdminChecklistItem[]
  validacoes: AdminEntityRecord[]
  ultimo_parecer: AdminEntityRecord | null
  correcoes_pendentes: boolean
  operacional: boolean
}

export interface AdminChecklistSaveResult {
  saved: boolean
  plano: AdminChecklistPlan
  itens: AdminChecklistItem[]
  workflow_status: string
}

export interface AdminChecklistSendInput extends ValidationRouteDraft {
  plano_id: string
}

export interface AdminChecklistSendResult {
  sent: boolean
  plano_id: string
  workflow_status: string
  demanda_tecnica?: AdminEntityRecord | null
}

export interface AdminChecklistRevisionResult {
  created: boolean
  plano_id: string
  revisao: number
  workflow_status: string
  status: string
  operacional: boolean
  itens_count: number
  plano: AdminChecklistPlan
  itens: AdminChecklistItem[]
}
