export type PortalMode = 'GESTOR' | 'ADMIN' | 'SHARED'

export function allowsPortal(
  mode: PortalMode,
  profile: string,
  capabilities?: readonly string[],
): boolean {
  if (mode === 'SHARED') return true
  if (capabilities !== undefined) {
    return mode === 'ADMIN'
      ? capabilities.includes('admin.identity.read')
      : capabilities.includes('maintenance.work-orders.read') || capabilities.includes('analytics.technical.read')
  }
  const legacy = profile.trim().toUpperCase()
  return mode === 'ADMIN' ? legacy === 'ADMIN' : ['GESTOR', 'GESTOR_TECNICO'].includes(legacy)
}
