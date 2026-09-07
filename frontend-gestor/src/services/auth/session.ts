import type { GestorSession } from '../api/auth'
import {
  clearGestorToken,
  getGestorToken,
  saveGestorToken,
} from '../api/config'

const AUTH_SESSION_KEY = 'fab-control.gestor-auth-session'
const AUTH_NOTICE_KEY = 'fab-control.gestor-auth-notice'
const STARTUP_COMPLETED_KEY = 'fab-control.gestor-startup-completed'
const LOGIN_BOOTSTRAP_COMPLETED_KEY = 'fab-control.gestor-login-bootstrap-completed'
const STARTUP_COMPLETED_VALUE = '2'
const LOGIN_BOOTSTRAP_COMPLETED_VALUE = '2'

const LEGACY_PREVIEW_KEYS = [
  'fab-control.gestor-auth-preview-session',
  'fab-control.gestor-auth-preview-started-at',
  'fab-control.gestor-auth-preview-expires-at',
]

export type AuthenticationNotice = 'session-expired'

function removeSessionData(): void {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY)
  for (const key of LEGACY_PREVIEW_KEYS) window.sessionStorage.removeItem(key)
}

function isValidSession(value: unknown): value is GestorSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<GestorSession>
  return Boolean(
    session.token &&
      session.startedAt &&
      Number.isFinite(session.expiresAt) &&
      session.user?.id &&
      session.user?.matricula &&
      session.user?.nome,
  )
}

export function markExpiredGestorSession(): void {
  try {
    removeSessionData()
    clearGestorToken()
    window.sessionStorage.removeItem(STARTUP_COMPLETED_KEY)
    window.sessionStorage.setItem(AUTH_NOTICE_KEY, 'session-expired')
  } catch {
    // O estado em memória ainda será encerrado pelo aplicativo.
  }
}

export function readGestorSession(): GestorSession | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    if (!isValidSession(parsed)) {
      removeSessionData()
      clearGestorToken()
      return null
    }

    if (parsed.expiresAt <= Date.now()) {
      markExpiredGestorSession()
      return null
    }

    const currentToken = getGestorToken()
    if (currentToken && currentToken !== parsed.token) {
      removeSessionData()
      clearGestorToken()
      return null
    }

    saveGestorToken(parsed.token)
    return parsed
  } catch {
    removeSessionData()
    clearGestorToken()
    return null
  }
}

export function saveGestorSession(session: GestorSession): void {
  try {
    saveGestorToken(session.token)
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY)
    window.sessionStorage.removeItem(STARTUP_COMPLETED_KEY)
    for (const key of LEGACY_PREVIEW_KEYS) window.sessionStorage.removeItem(key)
  } catch {
    // A sessão continua em memória no componente atual.
  }
}

export function clearGestorSession(): void {
  try {
    removeSessionData()
    clearGestorToken()
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY)
    window.sessionStorage.removeItem(STARTUP_COMPLETED_KEY)
  } catch {
    // O recarregamento ainda encerra a sessão mantida apenas em memória.
  }
}

export function hasCompletedStartup(): boolean {
  try {
    return window.sessionStorage.getItem(STARTUP_COMPLETED_KEY) === STARTUP_COMPLETED_VALUE
  } catch {
    return false
  }
}

export function markStartupCompleted(): void {
  try {
    window.sessionStorage.setItem(STARTUP_COMPLETED_KEY, STARTUP_COMPLETED_VALUE)
  } catch {
    // Sem impacto funcional; o pré-carregamento poderá repetir.
  }
}

export function hasCompletedLoginBootstrap(): boolean {
  try {
    return window.sessionStorage.getItem(LOGIN_BOOTSTRAP_COMPLETED_KEY) === LOGIN_BOOTSTRAP_COMPLETED_VALUE
  } catch {
    return false
  }
}

export function markLoginBootstrapCompleted(): void {
  try {
    window.sessionStorage.setItem(LOGIN_BOOTSTRAP_COMPLETED_KEY, LOGIN_BOOTSTRAP_COMPLETED_VALUE)
  } catch {
    // A verificação de entrada poderá repetir sem comprometer a autenticação.
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
