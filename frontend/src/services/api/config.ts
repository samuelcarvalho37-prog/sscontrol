const API_URL_KEY = 'fab-control.api-url'
const OPERATOR_TOKEN_SESSION_KEY = 'fab-control.operator-token'
const LEGACY_OPERATOR_TOKEN_PERSISTENT_KEY = 'fab-control.operator-token-persistent'

export type ApiTransport = 'auto' | 'node' | 'apps-script'

let inMemoryOperatorToken = ''

function environmentOperatorToken(): string {
  return (import.meta.env.VITE_OPERATOR_TOKEN as string | undefined)?.trim() ?? ''
}

function readLocalStorage(key: string): string {
  try {
    return window.localStorage.getItem(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Configuração em memória/ambiente continua disponível quando o storage é bloqueado.
  }
}

function readSessionStorage(key: string): string {
  try {
    return window.sessionStorage.getItem(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

function writeSessionStorage(key: string, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(key, value)
    else window.sessionStorage.removeItem(key)
  } catch {
    // A sessão pode continuar em memória no componente atual.
  }
}

function clearLegacyPersistentToken(): void {
  writeLocalStorage(LEGACY_OPERATOR_TOKEN_PERSISTENT_KEY, '')
}

export function getApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  return readLocalStorage(API_URL_KEY)
}

export function getLegacyApiUrl(): string {
  return (import.meta.env.VITE_APPS_SCRIPT_API_URL as string | undefined)?.trim() ?? ''
}

export function getApiTransport(): ApiTransport {
  const value = (import.meta.env.VITE_API_TRANSPORT as string | undefined)?.trim().toLowerCase()
  return value === 'node' || value === 'apps-script' ? value : 'auto'
}

export function saveApiUrl(value: string): void {
  writeLocalStorage(API_URL_KEY, value.trim())
}

export function getOperatorToken(): string {
  clearLegacyPersistentToken()
  return (
    readSessionStorage(OPERATOR_TOKEN_SESSION_KEY) ||
    inMemoryOperatorToken ||
    environmentOperatorToken()
  )
}

export function saveOperatorToken(value: string): void {
  clearLegacyPersistentToken()
  inMemoryOperatorToken = value.trim()
  writeSessionStorage(OPERATOR_TOKEN_SESSION_KEY, inMemoryOperatorToken)
}

export function clearOperatorToken(): void {
  saveOperatorToken('')
}

export function hasApiConfiguration(): boolean {
  return Boolean(getApiUrl() && getOperatorToken())
}
