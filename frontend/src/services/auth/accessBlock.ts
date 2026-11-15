export const ACCESS_BLOCK_EVENT = 'vorqix:company-access-blocked'
export type AccessBlockCode = 'AUTH_TENANT_DISABLED' | 'AUTH_SUBSCRIPTION_EXPIRED' | 'AUTH_SUBSCRIPTION_DISABLED'
export function isAccessBlockCode(code: unknown): code is AccessBlockCode {
  return ['AUTH_TENANT_DISABLED', 'AUTH_SUBSCRIPTION_EXPIRED', 'AUTH_SUBSCRIPTION_DISABLED'].includes(String(code))
}
export function accessBlockMessage(code: string, administrator = false): string {
  if (!administrator) return 'O acesso da empresa está temporariamente indisponível. Entre em contato com o responsável da sua empresa.'
  const reason = code === 'AUTH_SUBSCRIPTION_EXPIRED' ? 'A validade do plano da empresa terminou.'
    : code === 'AUTH_SUBSCRIPTION_DISABLED' ? 'A assinatura da empresa está desativada.' : 'O acesso da empresa foi desativado.'
  return `${reason} Entre em contato com o suporte da Plataforma para regularizar o acesso.`
}
export function emitAccessBlock(code: unknown): void {
  if (typeof window !== 'undefined' && isAccessBlockCode(code)) window.dispatchEvent(new CustomEvent(ACCESS_BLOCK_EVENT, { detail: code }))
}
export function watchCompanyAccess(check: (signal: AbortSignal) => Promise<unknown>, blocked: (code: AccessBlockCode) => void): () => void {
  const controller = new AbortController()
  let pending = false
  let finished = false
  const report = (code: unknown) => { if (!finished && isAccessBlockCode(code)) { finished = true; blocked(code) } }
  const receive = (event: Event) => report((event as CustomEvent).detail)
  const refresh = async () => {
    if (finished || pending || controller.signal.aborted || document.hidden || !navigator.onLine) return
    pending = true
    try { await check(controller.signal) } catch (error) { if (error && typeof error === 'object' && 'code' in error) report(error.code) }
    finally { pending = false }
  }
  window.addEventListener(ACCESS_BLOCK_EVENT, receive)
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', refresh)
  const timer = window.setInterval(refresh, 15_000)
  void refresh()
  return () => {
    controller.abort(); window.clearInterval(timer)
    window.removeEventListener(ACCESS_BLOCK_EVENT, receive)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}
