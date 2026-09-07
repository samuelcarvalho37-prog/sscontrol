import { useEffect, useState, type FormEvent } from 'react'
import { ApiConnectionPanel } from '../components/ApiConnectionPanel'
import {
  API_COMPATIBLE_RELEASE,
  APP_RELEASE_VERSION,
  isCompatibleRelease,
} from '../release'
import {
  completeFirstAccess,
  loginGestor,
  requestPasswordRecovery,
  revokeGestorSession,
  type GestorSession,
} from '../services/api/auth'
import { ApiRequestError } from '../services/api/client'
import { getApiUrl } from '../services/api/config'
import { getSystemHealth } from '../services/api/system'
import {
  hasCompletedLoginBootstrap,
  markLoginBootstrapCompleted,
} from '../services/auth/session'
import {
  getPortalPresentation,
  portalAllowsProfile,
} from '../portal'

export interface LoginPageProps {
  onAuthenticated: (session: GestorSession) => void
}

type LoginView = 'startup' | 'login' | 'first-access' | 'recovery' | 'connection-error'
type StartupState = 'checking' | 'online' | 'offline' | 'local'

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function passwordMeetsRules(password: string): boolean {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  )
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const portal = getPortalPresentation()
  const [view, setView] = useState<LoginView>(
    () => hasCompletedLoginBootstrap() ? 'login' : 'startup',
  )
  const [startupLabel, setStartupLabel] = useState('Carregando o sistema…')
  const [startupState, setStartupState] = useState<StartupState>('checking')
  const [connectionErrorMessage, setConnectionErrorMessage] = useState(
    'Verifique a rede e tente novamente. Nenhuma credencial foi alterada.',
  )
  const [registration, setRegistration] = useState('')
  const [password, setPassword] = useState('')
  const [firstAccessRegistration, setFirstAccessRegistration] = useState('')
  const [changeToken, setChangeToken] = useState('')
  const [firstAccessCurrentPassword, setFirstAccessCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [recoveryRegistration, setRecoveryRegistration] = useState('')
  const [recoveryReference, setRecoveryReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showConnection, setShowConnection] = useState(() => !getApiUrl())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (view !== 'startup') return

    let active = true
    const controller = new AbortController()

    async function prepareLogin() {
      setStartupState('checking')
      setStartupLabel('Preparando a interface…')
      await wait(280)
      if (!active) return

      setStartupLabel('Verificando a configuração local…')
      await wait(280)
      if (!active) return

      if (!getApiUrl()) {
        setStartupState('local')
        setStartupLabel('Ambiente local preparado')
        await wait(420)
        if (active) {
          markLoginBootstrapCompleted()
          setView('login')
        }
        return
      }

      setStartupLabel('Conferindo a conexão com a API…')
      const abortTimer = window.setTimeout(() => controller.abort(), 4_500)

      try {
        const health = await getSystemHealth(controller.signal)
        const receivedVersion = health.release_version ?? health.version
        if (!isCompatibleRelease(receivedVersion)) {
          if (!active) return
          setStartupState('offline')
          setStartupLabel('Atualização necessária')
          setConnectionErrorMessage(
            `Versão incompatível: aplicativo ${APP_RELEASE_VERSION}; API ${receivedVersion || 'não identificada'}.`,
          )
          await wait(420)
          if (active) setView('connection-error')
          return
        }
        if (!active) return
        setStartupState('online')
        setStartupLabel('Conexão inicial confirmada')
      } catch {
        if (!active) return
        setStartupState('offline')
        setStartupLabel('Não foi possível confirmar a API')
        setConnectionErrorMessage(
          'Verifique a rede e tente novamente. Nenhuma credencial foi alterada.',
        )
        await wait(420)
        if (active) setView('connection-error')
        return
      } finally {
        window.clearTimeout(abortTimer)
      }

      await wait(420)
      if (active) {
        markLoginBootstrapCompleted()
        setView('login')
      }
    }

    void prepareLogin()
    return () => {
      active = false
      controller.abort()
    }
  }, [view])

  function clearFeedback() {
    setError('')
    setMessage('')
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    const normalizedRegistration = registration.trim()
    if (!normalizedRegistration || !password) {
      setError('Informe a matrícula e a senha para continuar.')
      return
    }

    setSubmitting(true)
    try {
      const result = await loginGestor(normalizedRegistration, password)
      if (!portalAllowsProfile(result.usuario.perfil)) {
        const issuedToken = result.token || result.change_token
        if (issuedToken) {
          try {
            await revokeGestorSession(issuedToken)
          } catch {
            // A sessão não é persistida quando o perfil usa o portal incorreto.
          }
        }
        throw new ApiRequestError(
          `Este endereço é exclusivo para o perfil ${portal.exclusiveProfileLabel}. Use o portal correspondente ao seu acesso.`,
          'PORTAL_PROFILE_MISMATCH',
          {
            expected: portal.profile,
            received: result.usuario.perfil,
          },
        )
      }

      if (result.requires_password_change) {
        if (!result.change_token) {
          throw new ApiRequestError(
            'A API não forneceu a autorização de primeiro acesso.',
            'CHANGE_TOKEN_MISSING',
          )
        }

        setFirstAccessRegistration(result.usuario.matricula || normalizedRegistration)
        setChangeToken(result.change_token)
        setFirstAccessCurrentPassword(password)
        setNewPassword('')
        setConfirmation('')
        setPassword('')
        setView('first-access')
        return
      }

      if (!result.token || !result.expira_ms) {
        throw new ApiRequestError(
          'A API não retornou uma sessão válida.',
          'AUTH_SESSION_INVALID',
        )
      }

      onAuthenticated({
        token: result.token,
        startedAt: new Date().toISOString(),
        expiresAt: result.expira_ms,
        user: result.usuario,
      })
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        if (cause.code === 'PORTAL_PROFILE_MISMATCH') {
          setError(cause.message)
          return
        }

        if (cause.code === 'ROLE_NOT_ALLOWED') {
          setError(cause.message)
          return
        }

        if (cause.code === 'ACCOUNT_LOCKED') {
          setError('Conta temporariamente bloqueada. Aguarde a liberação administrativa.')
          return
        }

        if (cause.code === 'USER_INACTIVE') {
          setError('Conta inativa. Solicite a regularização ao administrador.')
          return
        }

        if (
          [
            'API_TIMEOUT',
            'NETWORK_ERROR',
            'HTTP_ERROR',
            'INVALID_JSON',
            'API_URL_MISSING',
            'VERSION_MISMATCH',
          ].includes(cause.code)
        ) {
          setError(cause.message)
          return
        }
      }

      setError('Matrícula ou senha inválida. Verifique os dados informados.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitFirstAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    if (!passwordMeetsRules(newPassword)) {
      setError(
        'A nova senha deve ter ao menos 12 caracteres, com letra maiúscula, minúscula e número.',
      )
      return
    }

    if (newPassword !== confirmation) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }

    if (!changeToken) {
      setError('A autorização de primeiro acesso expirou. Entre novamente.')
      return
    }

    setSubmitting(true)
    try {
      await completeFirstAccess(changeToken, firstAccessCurrentPassword, newPassword)
      setRegistration(firstAccessRegistration)
      setChangeToken('')
      setFirstAccessCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setView('login')
      setMessage('Nova senha definida. Entre novamente para continuar.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível concluir o primeiro acesso.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()
    setRecoveryReference('')
    const normalizedRegistration = recoveryRegistration.trim()
    if (!normalizedRegistration) {
      setError('Informe sua matrícula para solicitar a recuperação.')
      return
    }

    setSubmitting(true)
    try {
      const result = await requestPasswordRecovery(normalizedRegistration)
      setRecoveryReference(result.request_id)
      setMessage(
        result.message ?? 'Solicitação registrada. Informe a referência ao administrador.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível registrar a recuperação de acesso.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (view === 'startup') {
    return (
      <main className="auth-shell auth-shell--startup">
        <section className="auth-startup" aria-live="polite" aria-busy="true">
          <span className="auth-brand__mark auth-brand__mark--startup" aria-hidden="true">FC</span>
          <div className="auth-startup__spinner" aria-hidden="true" />
          <h1>FAB Control</h1>
          <p>{startupLabel}</p>
          <div className="auth-startup__progress" aria-hidden="true">
            <span />
          </div>
          <small>
            {startupState === 'online'
              ? 'API disponível'
              : startupState === 'offline'
                ? 'Conexão pendente'
                : startupState === 'local'
                  ? 'Configuração local preparada'
                  : 'Inicializando recursos essenciais'}
          </small>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">FC</span>
          <div>
            <span className="eyebrow">{portal.eyebrow}</span>
            <h1 id="auth-title">{portal.title}</h1>
          </div>
        </div>

        <p className="auth-intro">{portal.intro}</p>

        {!getApiUrl() ? (
          <p className="feedback feedback--warning">
            Configure a URL publicada da API antes de entrar.
          </p>
        ) : null}

        {view === 'connection-error' ? (
          <div className="auth-connection-error">
            <strong>Não foi possível preparar o acesso</strong>
            <p>{connectionErrorMessage}</p>
            <div className="auth-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowConnection(true)}
              >
                Configurar conexão
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => setView('startup')}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : null}

        {view === 'login' ? (
          <form className="auth-form" onSubmit={submitLogin}>
            <label>
              Matrícula
              <input
                value={registration}
                onChange={(event) => setRegistration(event.target.value)}
                autoComplete="username"
                disabled={submitting}
              />
            </label>

            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={submitting}
              />
            </label>

            {message ? <p className="feedback feedback--success">{message}</p> : null}
            {error ? <p className="feedback feedback--error">{error}</p> : null}

            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>

            <button
              className="auth-link-button"
              type="button"
              disabled={submitting}
              onClick={() => {
                clearFeedback()
                setRecoveryRegistration(registration)
                setRecoveryReference('')
                setView('recovery')
              }}
            >
              Esqueci minha senha
            </button>
          </form>
        ) : null}

        {view === 'first-access' ? (
          <form className="auth-form" onSubmit={submitFirstAccess}>
            <div className="first-access-summary">
              Primeiro acesso da matrícula <strong>{firstAccessRegistration}</strong>
            </div>

            <label>
              Nova senha
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                disabled={submitting}
              />
            </label>

            <label>
              Confirmar nova senha
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                disabled={submitting}
              />
            </label>

            <p className="password-rule">
              Mínimo de 8 caracteres, com maiúscula, minúscula e número.
            </p>

            {error ? <p className="feedback feedback--error">{error}</p> : null}

            <div className="auth-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setView('login')
                  setChangeToken('')
                  setError('')
                }}
              >
                Voltar
              </button>

              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Salvando…' : 'Definir nova senha'}
              </button>
            </div>
          </form>
        ) : null}

        {view === 'recovery' ? (
          <form className="auth-form" onSubmit={submitRecovery}>
            <div className="first-access-summary">
              Registre a solicitação para que um administrador valide sua identidade e defina uma senha temporária.
            </div>

            <label>
              Matrícula
              <input
                value={recoveryRegistration}
                onChange={(event) => setRecoveryRegistration(event.target.value)}
                autoComplete="username"
                disabled={submitting || Boolean(recoveryReference)}
                autoFocus
              />
            </label>

            {message ? <p className="feedback feedback--success">{message}</p> : null}
            {recoveryReference ? (
              <div className="recovery-reference">
                <span>Referência da solicitação</span>
                <strong>{recoveryReference}</strong>
              </div>
            ) : null}
            {error ? <p className="feedback feedback--error">{error}</p> : null}

            <div className="auth-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setView('login')
                  setError('')
                  setMessage('')
                  setRecoveryReference('')
                }}
              >
                Voltar
              </button>
              {!recoveryReference ? (
                <button className="primary-button" type="submit" disabled={submitting}>
                  {submitting ? 'Registrando…' : 'Solicitar recuperação'}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        <footer className="auth-footer">
          <span>Aplicativo {APP_RELEASE_VERSION} · API compatível {API_COMPATIBLE_RELEASE}</span>
          <button
            type="button"
            onClick={() => setShowConnection((current) => !current)}
          >
            {showConnection ? 'Ocultar configuração' : 'Configurar conexão'}
          </button>
        </footer>

        {showConnection ? (
          <ApiConnectionPanel
            compact
            onSaved={() => {
              setShowConnection(false)
              setMessage('Conexão validada. Informe suas credenciais.')
              if (view === 'connection-error') setView('startup')
            }}
          />
        ) : null}
      </section>
    </main>
  )
}
