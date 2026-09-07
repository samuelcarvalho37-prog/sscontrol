import type { OperatorSession } from '../api/auth'
import {
  clearOperatorToken,
  getOperatorToken,
  saveOperatorToken,
} from '../api/config'

const AUTH_SESSION_KEY = 'fab-control.auth-session'
const AUTH_NOTICE_KEY = 'fab-control.auth-notice'
const STARTUP_COMPLETED_KEY = 'fab-control.startup-completed'

const LEGACY_PREVIEW_KEYS = [
  'fab-control.auth-preview-session',
  'fab-control.auth-preview-started-at',
  'fab-control.auth-preview-expires-at',
]

export type AuthenticationNotice = 'session-expired'

function removeSessionData(): void {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY)
  for (const key of LEGACY_PREVIEW_KEYS) window.sessionStorage.removeItem(key)
}

function isValidSession(value: unknown): value is OperatorSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<OperatorSession>
  return Boolean(
    session.token &&
      session.startedAt &&
      Number.isFinite(session.expiresAt) &&
      session.user?.id &&
      session.user?.matricula &&
      session.user?.nome,
  )
}

export function markExpiredOperatorSession(): void {
  try {
    removeSessionData()
    clearOperatorToken()
    window.sessionStorage.setItem(AUTH_NOTICE_KEY, 'session-expired')
  } catch {
    // O estado em memória ainda será encerrado pelo aplicativo.
  }
}

export function readOperatorSession(): OperatorSession | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    if (!isValidSession(parsed)) {
      removeSessionData()
      clearOperatorToken()
      return null
    }

    if (parsed.expiresAt <= Date.now()) {
      markExpiredOperatorSession()
      return null
    }

    const currentToken = getOperatorToken()
    if (currentToken && currentToken !== parsed.token) {
      removeSessionData()
      clearOperatorToken()
      return null
    }

    saveOperatorToken(parsed.token)
    return parsed
  } catch {
    removeSessionData()
    clearOperatorToken()
    return null
  }
}

export function saveOperatorSession(session: OperatorSession): void {
  try {
    saveOperatorToken(session.token)
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY)
    for (const key of LEGACY_PREVIEW_KEYS) window.sessionStorage.removeItem(key)
  } catch {
    // A sessão continua em memória no componente atual.
  }
}

export function clearOperatorSession(): void {
  try {
    removeSessionData()
    clearOperatorToken()
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY)
    window.sessionStorage.removeItem(STARTUP_COMPLETED_KEY)
  } catch {
    // O recarregamento ainda encerra a sessão mantida apenas em memória.
  }
}

export function hasCompletedStartup(): boolean {
  try {
    return window.sessionStorage.getItem(STARTUP_COMPLETED_KEY) === '1'
  } catch {
    return false
  }
}

export function markStartupCompleted(): void {
  try {
    window.sessionStorage.setItem(STARTUP_COMPLETED_KEY, '1')
  } catch {
    // Sem impacto funcional; o pré-carregamento poderá repetir.
  }
}

export function consumeAuthenticationNotice(): AuthenticationNotice | '' {
  try {
    const notice = window.sessionStorage.getItem(AUTH_NOTICE_KEY) ?? ''
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY)
    return notice === 'session-expired' ? notice : ''
  } catch {
    return ''
  }
}
