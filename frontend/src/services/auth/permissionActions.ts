export function actionKey(method: string, path: string): string {
  return `access.${method.toLowerCase()}.${path.split('/').slice(2).map(segment => segment.replace(/^:/, '').replaceAll('-', '_')).join('.')}`
}
export function permitsAction(capabilities: readonly string[] | undefined, method: string, path: string, legacy?: string): boolean {
  if (!capabilities) return false
  return capabilities.includes('permissions.catalog.v2')
    ? capabilities.includes(actionKey(method, path))
    : Boolean(legacy && capabilities.includes(legacy))
}
