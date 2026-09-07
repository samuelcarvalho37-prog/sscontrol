export interface AdminImportModelField {
  chave: string
  rotulo: string
  obrigatorio: boolean
  exemplo: string | number | boolean
}

export interface AdminImportModel {
  tipo: string
  entidade: string
  grupo: string
  nome: string
  descricao: string
  max_linhas: number
  campos: AdminImportModelField[]
}

export interface AdminImportCatalog {
  max_linhas: number
  modelos: AdminImportModel[]
}

export interface AdminImportError {
  codigo: string
  mensagem: string
}

export interface AdminImportRecord {
  id: string
  linha_numero: number
  entidade: string
  entidade_id: string
  operacao: 'CRIAR' | 'ATUALIZAR' | string
  status: 'VALIDADO' | 'INVALIDO' | 'APLICADO' | 'REVERTIDO' | string
  normalizado: Record<string, unknown>
  erros: AdminImportError[]
}

export interface AdminImportBatch {
  id: string
  tipo: string
  entidade: string
  arquivo_nome: string
  aba_nome: string
  status: 'VALIDADO' | 'COM_ERROS' | 'CONCLUIDO' | 'REVERTIDO' | 'FALHOU' | string
  total_linhas: number
  linhas_validas: number
  linhas_invalidas: number
  validacao_hash: string
  cabecalhos: string[]
  cabecalhos_ignorados: string[]
  resultado: {
    criados?: number
    atualizados?: number
    revertidos?: number
    motivo?: string
    erro?: AdminImportError
  }
  criado_por: string
  criado_em: string
  confirmado_por: string
  confirmado_em: string
  rollback_por: string
  rollback_em: string
  registros: AdminImportRecord[]
}

export type AdminImportRow = Record<string, string | number | boolean | null> & {
  __linha: number
}

export interface ParsedAdminWorkbook {
  fileName: string
  sheetNames: string[]
  selectedSheet: string
  headers: string[]
  rows: AdminImportRow[]
}
