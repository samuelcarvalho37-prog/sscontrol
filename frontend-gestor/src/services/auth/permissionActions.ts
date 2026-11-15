import { readGestorSession } from './session'

export function actionCapabilityId(method: string, path: string): string {
  return 'access.' + method.toLowerCase() + '.' + path.split('?')[0].split('/').slice(2).map(segment => segment.replace(/^:/, '').replaceAll('-', '_')).join('.')
}

export function hasCapability(id: string, legacy?: string | readonly string[]): boolean {
  const capabilities = readGestorSession()?.user.capacidades ?? []
  if (capabilities.includes('permissions.catalog.v2')) return capabilities.includes(id)
  const fallback = typeof legacy === 'string' ? [legacy] : legacy ?? []
  return fallback.some(capability => capabilities.includes(capability))
}

export function hasAction(method: string, path: string, legacy?: string | readonly string[]): boolean {
  return hasCapability(actionCapabilityId(method, path), legacy)
}
