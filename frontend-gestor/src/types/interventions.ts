import type { AdminEntityRecord } from './catalog'
import type { ValidationRouteDraft } from './validation'

export interface AdminTechnicalDemandSummary extends AdminEntityRecord {
  status?: string
  area_atual_id?: string
  area_atual_nome?: string
  cargo_atual_id?: string
  cargo_atual_nome?: string
  exige_assinatura?: string
  politica_assinatura?: string
  assinaturas_necessarias?: number | string
  assinaturas_realizadas?: number | string
}

export interface AdminIntervention {
  exige_liberacao_pos_intervencao?: boolean
  id: string
  codigo: string
  codigo_legado?: string
  numero_operacional?: number
  ativo_id?: string
  ativo_tag?: string
  componente_id?: string
  plano_id?: string
  plano_versao_id?: string
  origem: string
  entidade_origem_id?: string
  tipo: string
  modo_execucao?: 'INTERNAL' | 'EXTERNAL' | 'MIXED'
  categoria_melhoria?: 'MODIFICATION' | 'MANUFACTURE' | 'INSTALLATION' | 'ADEQUACY' | 'OTHER' | null
  titulo: string
  descricao: string
  prioridade: string
  status: string
  planejada_para?: string
  modo_parada_manutencao?: string
  ativo_nome?: string
  linha_id?: string
  linha_tag?: string
  linha_nome?: string
  setor_id?: string
  setor_tag?: string
  setor_nome?: string
  responsavel_id?: string
  responsavel_nome?: string
  componente_tag?: string
  componente_nome?: string
  plano_nome?: string
  plano_revisao?: number | string
  plano_itens_count?: number | string
  acao_id?: string
  acao_status?: string
  demanda?: AdminTechnicalDemandSummary | null
  auditoria?: {
    acao: string
    entidade: string
    entidade_id: string
    usuario: string | null
    perfil: string | null
    ocorreu_em: string
  }[]
  criado_em?: string
  atualizado_em?: string
  custos?: {
    materiais: number | string
    servicos_externos: number | string
    total_realizado: number | string
    materiais_sem_preco: number
    servicos_sem_preco: number
    dados_financeiros_pendentes: boolean
  }
  servicos_externos?: Array<{
    id: string
    prestador: string
    descricao: string
    valor: number | string | null
    data_servico: string | null
    observacao: string | null
  }>
}

export interface AdminInterventionInput {
  origem?: string
  entidade_origem_id?: string
  exige_liberacao_pos_intervencao?: boolean
  id?: string
  ativo_id?: string
  ativo_tag?: string
  componente_id?: string
  plano_id?: string
  plano_versao_id?: string
  tipo: string
  modo_execucao?: 'INTERNAL' | 'EXTERNAL' | 'MIXED'
  categoria_melhoria?: 'MODIFICATION' | 'MANUFACTURE' | 'INSTALLATION' | 'ADEQUACY' | 'OTHER' | null
  titulo: string
  descricao: string
  prioridade: string
  planejada_para?: string
  modo_parada_manutencao: string
}

export interface AdminInterventionRoute extends ValidationRouteDraft {
  intervencao_id: string
}
