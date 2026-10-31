import type { GestorNotification } from '../types/gestor'

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export type NotificationNavigation =
  | { kind: 'occurrence'; id: string }
  | { kind: 'technical-demand'; id: string }
  | { kind: 'part-shortage'; id: string }
  | { kind: 'technician-action'; actionId?: string; workOrderId?: string }
  | null

export function isQualitySafetyProfile(profile: string): boolean {
  return ['QUALIDADE', 'SEGURANCA'].includes(upper(profile))
}

export function isOperationalOccurrenceNotification(
  notification: Pick<GestorNotification, 'entidade_tipo'>,
): boolean {
  return ['OPERATIONAL_OCCURRENCE', 'OCORRENCIAS_OPERACIONAIS'].includes(
    upper(notification.entidade_tipo),
  ) || upper(notification.entidade_tipo) === 'PARADAS_EQUIPAMENTO'
}

export function isNotificationActionableForProfile(
  notification: Pick<GestorNotification, 'tipo' | 'entidade_tipo' | 'entidade_id' | 'ordem_servico_id' | 'acao_ordem_servico_id'>,
  profile: string,
): boolean {
  if (
    isQualitySafetyProfile(profile) &&
    isOperationalOccurrenceNotification(notification)
  ) return false

  if (upper(profile) === 'TECNICO') {
    const entity = upper(notification.entidade_tipo)
    const hasAction = Boolean(notification.acao_ordem_servico_id)
    if (isOperationalOccurrenceNotification(notification)) return false
    if (entity === 'ANALISES_TECNICAS' || entity === 'TECHNICAL_ANALYSIS') return hasAction
    return hasAction || entity === 'OS_ACOES'
  }

  return true
}

export function isNotificationVisibleForProfile(
  notification: Pick<GestorNotification, 'tipo' | 'entidade_tipo' | 'entidade_id' | 'ordem_servico_id' | 'acao_ordem_servico_id'>,
  profile: string,
): boolean {
  return isNotificationActionableForProfile(notification, profile)
}

export function filterNotificationsForProfile(
  notifications: readonly GestorNotification[],
  profile: string,
): GestorNotification[] {
  const visible = notifications.filter((notification) =>
    isNotificationVisibleForProfile(notification, profile),
  )

  if (!['PCM', 'GESTOR'].includes(upper(profile))) return visible

  // Once a technical analysis exists, keep its actionable notification and
  // suppress the earlier occurrence card so the same case is not presented
  // as two separate work items.
  const analyzedOccurrences = new Set(
    visible
      .filter((notification) => ['ANALISES_TECNICAS', 'TECHNICAL_ANALYSIS'].includes(upper(notification.entidade_tipo)))
      .map((notification) => String(notification.ocorrencia_origem_id ?? '').trim())
      .filter(Boolean),
  )
  return visible.filter((notification) =>
    !isOperationalOccurrenceNotification(notification) ||
    !analyzedOccurrences.has(String(notification.entidade_id ?? '').trim()),
  )
}

export function notificationNavigation(
  notification: Pick<GestorNotification, 'tipo' | 'entidade_tipo' | 'entidade_id' | 'ordem_servico_id' | 'acao_ordem_servico_id'>,
  profile: string,
): NotificationNavigation {
  const entityType = upper(notification.entidade_tipo)
  const id = String(notification.entidade_id ?? '').trim()
  const normalizedProfile = upper(profile)
  const isTechnician = normalizedProfile === 'TECNICO'

  if (isTechnician) {
    const actionId = String(notification.acao_ordem_servico_id ?? '').trim()
    const workOrderId = String(notification.ordem_servico_id ?? '').trim()

    if (entityType === 'OS_ACOES') {
      return id ? { kind: 'technician-action', actionId: id } : null
    }
    if (actionId || workOrderId) {
      return { kind: 'technician-action', ...(actionId ? { actionId } : {}), ...(workOrderId ? { workOrderId } : {}) }
    }
    if (['WORK_ORDER', 'ORDEM_SERVICO', 'MAINTENANCE_WORK_ORDER', 'ORDENS_SERVICO'].includes(entityType)) {
      return id ? { kind: 'technician-action', workOrderId: id } : null
    }
    return null
  }

  if (!id) return null

  if (entityType === 'WORK_ORDER_PART_SHORTAGE' && ['PCM', 'GESTOR'].includes(upper(profile))) {
    return { kind: 'part-shortage', id }
  }

  if (isOperationalOccurrenceNotification(notification)) {
    return isNotificationActionableForProfile(notification, profile)
      ? { kind: 'occurrence', id }
      : null
  }
  if (entityType === 'DEMANDAS_TECNICAS') {
    return { kind: 'technical-demand', id }
  }
  return null
}

export function notificationActionLabel(
  notification: Pick<GestorNotification, 'tipo' | 'entidade_tipo'>,
  profile: string,
): string {
  if (!isNotificationActionableForProfile(notification, profile)) {
    return 'Histórico · sem ação'
  }
  if (upper(notification.tipo) === 'POST_INTERVENTION_VALIDATION_REQUESTED') {
    return 'Analisar validação'
  }
  if (upper(notification.entidade_tipo) === 'DEMANDAS_TECNICAS') {
    return 'Analisar validação'
  }
  if (isOperationalOccurrenceNotification(notification)) return 'Analisar ocorrência'
  return 'Ver contexto'
}

export function validationDemandFromSearch(search: string): string {
  return new URLSearchParams(search).get('validationDemand')?.trim() ?? ''
}
