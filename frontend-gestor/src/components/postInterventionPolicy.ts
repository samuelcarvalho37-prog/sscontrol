export type PostInterventionPolicy =
  | 'QUALIDADE'
  | 'SEGURANCA'
  | 'QUALIDADE_E_SEGURANCA'

export function selectedPostInterventionPolicy(
  quality: boolean,
  safety: boolean,
): PostInterventionPolicy | null {
  if (quality && safety) return 'QUALIDADE_E_SEGURANCA'
  if (quality) return 'QUALIDADE'
  if (safety) return 'SEGURANCA'
  return null
}

export function postInterventionPolicySelectionError(
  required: boolean,
  policy: PostInterventionPolicy | null,
): string | null {
  return required && !policy
    ? 'Selecione ao menos uma área responsável pela liberação pós-intervenção.'
    : null
}

export function postInterventionPolicyLabel(
  required: boolean,
  policy?: string | null,
): string {
  if (!required) return 'Não exigida'
  const labels: Readonly<Record<string, string>> = {
    QUALIDADE: 'Qualidade',
    SEGURANCA: 'Segurança',
    QUALIDADE_E_SEGURANCA: 'Qualidade + Segurança',
    QUALIDADE_OU_SEGURANCA: 'Qualidade ou Segurança',
  }
  return labels[policy ?? ''] ?? 'Configuração pendente'
}

export function awaitsPostInterventionCompletion(demand: { tipo?: string; status?: string }): boolean {
  const normalize = (value?: string) => (value ?? '').trim().toUpperCase()
  return normalize(demand.tipo) === 'POST_INTERVENTION_RELEASE'
    && !['AGUARDANDO_ASSINATURA', 'AWAITING_SIGNATURE'].includes(normalize(demand.status))
}
