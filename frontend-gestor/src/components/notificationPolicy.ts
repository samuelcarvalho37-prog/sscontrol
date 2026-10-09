import type { GestorNotification } from '../types/gestor'

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export type NotificationNavigation =
  | { kind: 'occurrence'; id: string }
  | { kind: 'technical-demand'; id: string }
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
  notification: Pick<GestorNotification, 'entidade_tipo'>,
  profile: string,
): boolean {
  return !(
    isQualitySafetyProfile(profile) &&
    isOperationalOccurrenceNotification(notification)
  )
}

export function isNotificationVisibleForProfile(
  notification: Pick<GestorNotification, 'entidade_tipo'>,
  profile: string,
): boolean {
  return !(
    isQualitySafetyProfile(profile) &&
    isOperationalOccurrenceNotification(notification)
  )
}

export function filterNotificationsForProfile(
  notifications: readonly GestorNotification[],
  profile: string,
): GestorNotification[] {
  return notifications.filter((notification) =>
    isNotificationVisibleForProfile(notification, profile),
  )
}

export function notificationNavigation(
  notification: Pick<GestorNotification, 'tipo' | 'entidade_tipo' | 'entidade_id'>,
  profile: string,
): NotificationNavigation {
  const entityType = upper(notification.entidade_tipo)
  const id = String(notification.entidade_id ?? '').trim()
  if (!id) return null

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
