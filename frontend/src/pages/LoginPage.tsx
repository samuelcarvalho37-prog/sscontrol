import { useEffect, useState, type FormEvent } from 'react'
import { APP_RELEASE_VERSION, isCompatibleRelease } from '../release'
import { ApiRequestError } from '../services/api/client'
import { getApiUrl } from '../services/api/config'
import {
  completeFirstAccess,
  loginOperator,
  requestPasswordRecovery,
  type OperatorSession,
} from '../services/api/auth'
import { getSystemHealth } from '../services/api/operator'
import {
  consumeAuthenticationNotice,
  hasCompletedStartup,
  markStartupCompleted,
} from '../services/auth/session'

export interface LoginPageProps {
  onAuthenticated: (session: OperatorSession) => void
}

type LoginView =
  | 'startup'
  | 'login'
  | 'recovery'
  | 'recovery-confirmation'
  | 'first-access'
  | 'locked'
  | 'connection-error'

type StartupState = 'checking' | 'online' | 'offline' | 'local'

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function passwordMeetsPreviewRules(password: string): boolean {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  )
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
      <path d="M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5.2 9 5.2a15.9 15.9 0 0 1-2.4 2.8" />
      <path d="M6.6 6.6A16.5 16.5 0 0 0 3 9.2S6.5 14.4 12 14.4c1 0 2-.2 2.8-.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  )
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [view, setView] = useState<LoginView>(
    () => hasCompletedStartup() ? 'login' : 'startup',
  )
  const [startupLabel, setStartupLabel] = useState('Carregando o sistema…')
  const [startupState, setStartupState] = useState<StartupState>('checking')
  const [registration, setRegistration] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryRegistration, setRecoveryRegistration] = useState('')
  const [recoveryRequestId, setRecoveryRequestId] = useState('')
  const [firstAccessRegistration, setFirstAccessRegistration] = useState('')
  const [firstAccessToken, setFirstAccessToken] = useState('')
  const [firstAccessCurrentPassword, setFirstAccessCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showNewPasswordConfirmation, setShowNewPasswordConfirmation] = useState(false)
  const [error, setError] = useState('')
  const [connectionErrorMessage, setConnectionErrorMessage] = useState(
    'Verifique a rede do dispositivo e tente novamente. Nenhuma credencial foi alterada.',
  )
  const [message, setMessage] = useState(() => {
    return consumeAuthenticationNotice() === 'session-expired'
      ? 'Sua sessão expirou. Entre novamente para continuar.'
      : ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function prepareSystem() {
      if (hasCompletedStartup()) {
        setView('login')
        return
      }

      setStartupLabel('Preparando a interface…')
      await wait(360)
      if (!active) return

      setStartupLabel('Verificando a configuração local…')
      await wait(360)
      if (!active) return

      const apiConfigured = Boolean(getApiUrl())
      if (!apiConfigured) {
        setStartupState('local')
        setStartupLabel('Ambiente local preparado')
        await wait(520)
        if (active) {
          markStartupCompleted()
          setView('login')
        }
        return
      }

      setStartupLabel('Conferindo a conexão com a API…')
      const abortTimer = window.setTimeout(() => controller.abort(), 1_600)

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
          await wait(520)
          if (active) setView('connection-error')
          return
        }
        if (!active) return
        setStartupState('online')
        setStartupLabel('Sincronização inicial concluída')
      } catch {
        if (!active) return
        setStartupState('offline')
        setStartupLabel('Modo de acesso preparado')
        setConnectionErrorMessage(
          'Verifique a rede do dispositivo e tente novamente. Nenhuma credencial foi alterada.',
        )
      } finally {
        window.clearTimeout(abortTimer)
      }

      await wait(520)
      if (active) {
        markStartupCompleted()
        setView('login')
      }
    }

    void prepareSystem()

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  function clearFeedback() {
    setError('')
    setMessage('')
  }

  function showConnectionError(cause?: unknown) {
    const messageText =
      cause instanceof ApiRequestError && cause.code === 'VERSION_MISMATCH'
        ? cause.message
        : 'Verifique a rede do dispositivo e tente novamente. Nenhuma credencial foi alterada.'
    setConnectionErrorMessage(messageText)
    setView('connection-error')
  }

  function returnToLogin(messageText = '') {
    setView('login')
    setPassword('')
    setFirstAccessToken('')
    setFirstAccessCurrentPassword('')
    setNewPassword('')
    setNewPasswordConfirmation('')
    setError('')
    setMessage(messageText)
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
      const result = await loginOperator(normalizedRegistration, password)

      if (result.requires_password_change) {
        if (!result.change_token) {
          throw new ApiRequestError(
            'A API não forneceu a autorização de primeiro acesso.',
            'CHANGE_TOKEN_MISSING',
          )
        }

        setFirstAccessRegistration(result.usuario.matricula || normalizedRegistration)
        setFirstAccessToken(result.change_token)
        setFirstAccessCurrentPassword(password)
        setNewPassword('')
        setNewPasswordConfirmation('')
        setPassword('')
        setView('first-access')
        return
      }

      if (!result.token || !result.expira_ms) {
        throw new ApiRequestError(
          'A API não retornou uma sessão operacional válida.',
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
        if (cause.code === 'ACCOUNT_LOCKED') {
          setView('locked')
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
          showConnectionError(cause)
          return
        }
      }

      setError('Matrícula ou senha inválida. Verifique os dados informados.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    const normalizedRegistration = recoveryRegistration.trim()
    if (!normalizedRegistration) {
      setError('Informe sua matrícula para solicitar a recuperação.')
      return
    }

    setSubmitting(true)
    try {
      const result = await requestPasswordRecovery(normalizedRegistration)
      setRecoveryRegistration(normalizedRegistration)
      setRecoveryRequestId(result.request_id)
      setView('recovery-confirmation')
    } catch (cause) {
      if (
        cause instanceof ApiRequestError &&
        [
          'API_TIMEOUT',
          'NETWORK_ERROR',
          'HTTP_ERROR',
          'INVALID_JSON',
          'API_URL_MISSING',
          'VERSION_MISMATCH',
        ].includes(cause.code)
      ) {
        showConnectionError(cause)
        return
      }
      setError('Não foi possível registrar a solicitação. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitFirstAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    if (!passwordMeetsPreviewRules(newPassword)) {
      setError(
        'A nova senha deve ter ao menos 12 caracteres, com letra maiúscula, minúscula e número.',
      )
      return
    }

    if (newPassword !== newPasswordConfirmation) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }

    if (!firstAccessToken) {
      setError('A autorização de primeiro acesso expirou. Entre novamente.')
      return
    }

    setSubmitting(true)
    try {
      await completeFirstAccess(firstAccessToken, firstAccessCurrentPassword, newPassword)
      setRegistration(firstAccessRegistration)
      returnToLogin('Nova senha definida. Entre novamente para continuar.')
    } catch (cause) {
      if (
        cause instanceof ApiRequestError &&
        ['CHANGE_TOKEN_INVALID', 'CHANGE_TOKEN_INACTIVE', 'CHANGE_TOKEN_EXPIRED'].includes(
          cause.code,
        )
      ) {
        setError('A autorização de primeiro acesso expirou. Entre novamente.')
        return
      }

      if (
        cause instanceof ApiRequestError &&
        [
          'API_TIMEOUT',
          'NETWORK_ERROR',
          'HTTP_ERROR',
          'INVALID_JSON',
          'API_URL_MISSING',
          'VERSION_MISMATCH',
        ].includes(cause.code)
      ) {
        showConnectionError(cause)
        return
      }

      setError(cause instanceof Error ? cause.message : 'Não foi possível definir a nova senha.')
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
                ? 'A conexão será retomada após o acesso'
                : startupState === 'local'
                  ? 'Configuração técnica será concluída na integração'
                  : 'Inicializando recursos essenciais'}
          </small>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">FC</span>
          <div>
            <span className="auth-brand__eyebrow">Operação industrial</span>
            <h1 id="auth-title">FAB Control</h1>
          </div>
        </header>

        {view === 'login' && (
          <>
            <div className="auth-intro">
              <span className="auth-intro__kicker">Acesso do operador</span>
              <h2>Inicie sua sessão</h2>
              <p>Acesse as rotinas, checklists e registros do seu turno.</p>
            </div>

            <form className="auth-form" onSubmit={submitLogin} noValidate>
              <label className="auth-field">
                <span>Matrícula</span>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  value={registration}
                  onChange={(event) => setRegistration(event.target.value)}
                  placeholder="Digite sua matrícula"
                  disabled={submitting}
                />
              </label>

              <label className="auth-field">
                <span>Senha</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  disabled={submitting}
                />
              </label>

              {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
              {message && <p className="auth-feedback auth-feedback--warning" role="status">{message}</p>}

              <button className="auth-primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Validando acesso…' : 'Entrar'}
              </button>

              <button
                className="auth-link-button"
                type="button"
                onClick={() => {
                  setView('recovery')
                  clearFeedback()
                }}
                disabled={submitting}
              >
                Esqueci minha senha
              </button>
            </form>
          </>
        )}

        {view === 'recovery' && (
          <>
            <div className="auth-intro">
              <span className="auth-intro__kicker">Suporte de acesso</span>
              <h2>Recuperar acesso</h2>
              <p>Informe sua matrícula para solicitar uma nova senha ao administrador.</p>
            </div>

            <form className="auth-form" onSubmit={submitRecovery} noValidate>
              <label className="auth-field">
                <span>Matrícula</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={recoveryRegistration}
                  onChange={(event) => setRecoveryRegistration(event.target.value)}
                  placeholder="Digite sua matrícula"
                />
              </label>

              {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}
              {message && <p className="auth-feedback auth-feedback--success" role="status">{message}</p>}

              <button className="auth-primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Registrando solicitação…' : 'Solicitar nova senha'}
              </button>

              <button
                className="auth-link-button"
                type="button"
                onClick={() => returnToLogin()}
              >
                Voltar para o login
              </button>
            </form>
          </>
        )}

        {view === 'recovery-confirmation' && (
          <section className="auth-state" aria-live="polite">
            <span className="auth-state__icon auth-state__icon--success" aria-hidden="true">✓</span>
            <span className="auth-intro__kicker">Recuperação de acesso</span>
            <h2>Solicitação preparada</h2>
            <p>
              A solicitação foi registrada na API. O administrador fará a validação e a redefinição do acesso.
            </p>

            <div className="auth-recovery-summary">
              <div>
                <span>Matrícula</span>
                <strong>{recoveryRegistration}</strong>
              </div>
              <div>
                <span>Referência local</span>
                <strong>{recoveryRequestId}</strong>
              </div>
              <div>
                <span>Status atual</span>
                <strong>Registrada</strong>
              </div>
            </div>

            <div className="auth-state__note auth-state__note--neutral">
              Por segurança, a confirmação não informa se a matrícula existe na base.
            </div>

            <button
              className="auth-primary-button"
              type="button"
              onClick={() => returnToLogin('Solicitação registrada. Aguarde a validação do administrador.')}
            >
              Voltar para o login
            </button>
          </section>
        )}

        {view === 'first-access' && (
          <>
            <div className="auth-intro">
              <span className="auth-intro__kicker">Primeiro acesso</span>
              <h2>Crie sua nova senha</h2>
              <p>A senha temporária deve ser substituída antes de acessar o aplicativo.</p>
            </div>

            <form className="auth-form" onSubmit={submitFirstAccess} noValidate>
              <div className="auth-account-reference">
                <span>Matrícula</span>
                <strong>{firstAccessRegistration}</strong>
              </div>

              <label className="auth-field">
                <span>Nova senha</span>
                <div className="auth-password-input">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Crie uma senha segura"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowNewPassword((visible) => !visible)}
                    aria-label={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                    title={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                    disabled={submitting}
                  >
                    <PasswordVisibilityIcon visible={showNewPassword} />
                  </button>
                </div>
              </label>

              <label className="auth-field">
                <span>Confirmar nova senha</span>
                <div className="auth-password-input">
                  <input
                    type={showNewPasswordConfirmation ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPasswordConfirmation}
                    onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                    placeholder="Repita a nova senha"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowNewPasswordConfirmation((visible) => !visible)}
                    aria-label={
                      showNewPasswordConfirmation
                        ? 'Ocultar confirmação da senha'
                        : 'Mostrar confirmação da senha'
                    }
                    title={
                      showNewPasswordConfirmation
                        ? 'Ocultar confirmação da senha'
                        : 'Mostrar confirmação da senha'
                    }
                    disabled={submitting}
                  >
                    <PasswordVisibilityIcon visible={showNewPasswordConfirmation} />
                  </button>
                </div>
              </label>

              <div className="auth-password-rules">
                <strong>Requisitos mínimos</strong>
                <span>8 caracteres · letra maiúscula · letra minúscula · número</span>
              </div>

              {error && <p className="auth-feedback auth-feedback--error" role="alert">{error}</p>}

              <button className="auth-primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Definindo senha…' : 'Definir nova senha'}
              </button>

              <button
                className="auth-link-button"
                type="button"
                onClick={() => returnToLogin()}
                disabled={submitting}
              >
                Cancelar
              </button>
            </form>
          </>
        )}

        {view === 'locked' && (
          <section className="auth-state" aria-live="polite">
            <span className="auth-state__icon auth-state__icon--error" aria-hidden="true">!</span>
            <span className="auth-intro__kicker">Acesso bloqueado</span>
            <h2>Conta temporariamente bloqueada</h2>
            <p>
              O acesso foi bloqueado após tentativas inválidas. Solicite a liberação ao administrador.
            </p>
            <div className="auth-state__note">
              A recuperação automática não desbloqueia uma conta protegida.
            </div>
            <button className="auth-primary-button" type="button" onClick={() => returnToLogin()}>
              Voltar para o login
            </button>
          </section>
        )}

        {view === 'connection-error' && (
          <section className="auth-state" aria-live="polite">
            <span className="auth-state__icon" aria-hidden="true">↻</span>
            <span className="auth-intro__kicker">Falha de conexão</span>
            <h2>Não foi possível validar o acesso</h2>
            <p>{connectionErrorMessage}</p>
            <div className="auth-state__actions">
              <button className="auth-primary-button" type="button" onClick={() => window.location.reload()}>
                Tentar novamente
              </button>
              <button
                className="auth-link-button"
                type="button"
                onClick={() => {
                  setView('recovery')
                  clearFeedback()
                }}
              >
                Solicitar suporte de acesso
              </button>
            </div>
          </section>
        )}

        <footer className="auth-footer">
          Acesso exclusivo para profissionais cadastrados.
        </footer>
      </section>
    </main>
  )
}
