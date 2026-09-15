export type StopMode = 'NO_STOP' | 'STOPPED' | 'EXECUTOR_DECISION'

export interface OperatorAction {
  id: string
  titulo: string
  descricao: string
  prioridade: string
  status: string
  ativo_id: string
  ativo_tag: string
  ativo_nome: string
  linha_id?: string
  linha_tag?: string
  linha_nome?: string
  setor_id?: string
  setor_tag?: string
  setor_nome?: string
  componente_id: string | null
  componente_tag: string | null
  componente_nome: string | null
  tipo: string
  origem: string
  modo_parada: StopMode | null
  liberada_em: string
  programada_para: string | null
  ordem_id: string
  ordem_codigo: string
  duracao_estimada_minutos: number | null
  checklist_nome: string
  execucao_id: string | null
  execucao_status: string | null
  total_itens: number
}

export interface ExecutionItem {
  id: string
  sequencia: number
  titulo: string
  instrucao: string | null
  tipo_resposta: string
  categoria: string | null
  obrigatorio: boolean
  evidencia_obrigatoria: boolean
  minimo_evidencias: number
  bloqueia_conclusao: boolean
  status?: string
  resposta_texto?: string | null
  resposta_numero?: number | null
  resposta_booleano?: boolean | null
  resposta_opcao?: string | null
  observacao?: string | null
  conforme?: boolean | null
  mensagem_validacao?: string | null
  quantidade_evidencias?: number
  evidencias?: Array<{
    id: string
    tipo: string
    nome_arquivo: string | null
    url: string | null
    observacao: string | null
  }>
  minimo?: number | null
  maximo?: number | null
  unidade?: string | null
  opcoes?: string[] | null
  [key: string]: unknown
}

export interface Execution {
  id: string
  status: string
  operador_id: string
  operador_nome: string
  assumida_em: string | null
  iniciada_em: string | null
  concluida_em: string | null
  duracao_segundos: number | null
  pausada_em?: string | null
  segundos_pausados?: number
  resultado: string | null
  observacao: string | null
  modo_parada: StopMode | null
  itens: ExecutionItem[]
}

export interface ExecutionCompletionBlocker {
  item_id: string
  titulo: string
  sequencia: number
  tipo: 'RESPOSTA_OBRIGATORIA' | 'EVIDENCIA_OBRIGATORIA' | 'MEDICAO_OBRIGATORIA' | 'ITEM_NAO_CONFORME_BLOQUEANTE'
  mensagem: string
}

export interface ExecutionValidation {
  execucao_id: string
  pode_concluir: boolean
  total: number
  respondidos: number
  respostas_pendentes: number
  evidencias_pendentes: number
  nao_conformes_bloqueantes: number
  pendencias: ExecutionCompletionBlocker[]
}

export interface OperatorActionDetail extends OperatorAction {
  analise_tecnica: Record<string, unknown> | null
  gerada_em: string
  iniciada_em: string | null
  finalizada_em: string | null
  ordem_status: string
  ordem_criada_em: string
  checklist_itens: ExecutionItem[]
}

export interface TechnicalCompletionInput {
  relatorio_tecnico?: {
    diagnostico_tecnico: string
    acao_realizada: string
    pecas_materiais: string
    medicoes: string
  }
  resultado: string
  observacao: string | null
  modo_parada: StopMode
}
