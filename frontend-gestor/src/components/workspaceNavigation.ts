import type { GestorSection } from './AppNavigation'

export function technicalContextLandingSection(
  current: GestorSection,
  canValidate: boolean,
  isTechnician: boolean,
  canReadAnalytics: boolean,
): GestorSection {
  if (current !== 'home' || canValidate || isTechnician) return current
  return canReadAnalytics ? 'validations' : 'more'
}
