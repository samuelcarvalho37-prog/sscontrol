import type { AdminEntityRecord } from './catalog'
import type { ValidationRouteDraft } from './validation'

export interface AdminTechnicalDemandSummary extends AdminEntityRecord {
  status?: string
  area_atual_id?: string
  area_atual_nome?: string
  cargo_atual_id?: string
  cargo_atual_nome?: string
  exige_assinatura?: string
  assinaturas_necessarias?: number | string
  assinaturas_realizadas?: number | string
}

export interface AdminIntervention {
  id: string
  codigo: string
  ativo_id: string
  componente_id?: string
  plano_id: string
  plano_versao_id?: string
  origem: string
  tipo: string
  titulo: string
  descricao: string
  prioridade: string
  status: string
  planejada_para?: string
  modo_parada_manutencao?: string
  ativo_tag?: string
  ativo_nome?: string
  componente_tag?: string
  componente_nome?: string
  plano_nome?: string
  plano_revisao?: number | string
  plano_itens_count?: number | string
  acao_id?: string
  acao_status?: string
  demanda?: AdminTechnicalDemandSummary | null
  criado_em?: string
  atualizado_em?: string
}

export interface AdminInterventionInput {
  id?: string
  ativo_id: string
  componente_id?: string
  plano_id: string
  plano_versao_id?: string
  tipo: string
  titulo: string
  descricao: string
  prioridade: string
  planejada_para?: string
  modo_parada_manutencao: string
}

export interface AdminInterventionRoute extends ValidationRouteDraft {
  intervencao_id: string
}
