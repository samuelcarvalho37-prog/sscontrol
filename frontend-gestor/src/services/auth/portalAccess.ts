export type PortalMode = 'GESTOR' | 'ADMIN' | 'SHARED'

export function allowsPortal(
  mode: PortalMode,
  profile: string,
  capabilities?: readonly string[],
): boolean {
  if (mode === 'SHARED') return true
  const legacy = profile.trim().toUpperCase()

  // Técnicos usam o portal Gestor para acessar a Central do Técnico.
  if (
    mode === 'GESTOR' &&
    legacy === 'TECNICO' &&
    capabilities?.includes('maintenance.executions.perform')
  ) {
    return true
  }

  if (capabilities !== undefined) {
    return mode === 'ADMIN'
      ? capabilities.includes('admin.identity.read')
      : capabilities.includes('maintenance.work-orders.read') ||
        capabilities.includes('maintenance.work-orders.review') ||
        capabilities.includes('analytics.technical.read')
  }
  return mode === 'ADMIN' ? legacy === 'ADMIN' : ['GESTOR', 'GESTOR_TECNICO', 'TECNICO'].includes(legacy)
}
