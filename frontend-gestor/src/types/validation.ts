export type ValidationSignaturePolicy =
  | 'QUALIDADE_OU_SEGURANCA'
  | 'QUALIDADE'
  | 'SEGURANCA'
  | 'QUALIDADE_E_SEGURANCA'
  | 'PERSONALIZADA'

export interface ValidationRouteDraft {
  politica_assinatura: ValidationSignaturePolicy
  comentario: string
  exige_segregacao: string
  responsavel_atual_id?: string
  usuarios_validadores?: string[]
}
