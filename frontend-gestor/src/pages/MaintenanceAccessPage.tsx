import { useState, type FormEvent } from 'react'
import { API_COMPATIBLE_RELEASE, APP_RELEASE_VERSION } from '../release'
import {
  exchangeMaintenanceAccess,
  type GestorSession,
} from '../services/api/auth'
import { ApiRequestError } from '../services/api/client'
import { getApiUrl } from '../services/api/config'

interface MaintenanceAccessPageProps {
  onAuthenticated: (session: GestorSession) => void
  onReturn: () => void
}

export function MaintenanceAccessPage({
  onAuthenticated,
  onReturn,
}: MaintenanceAccessPageProps) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const normalized = code.trim()
    if (normalized.length < 16) {
      setError('Informe o código temporário completo.')
      return
    }

    setSubmitting(true)
    try {
      const result = await exchangeMaintenanceAccess(normalized)
      if (!result.token || !result.expira_ms) {
        throw new ApiRequestError(
          'A API não retornou uma sessão interna válida.',
          'AUTH_SESSION_INVALID',
        )
      }
      onAuthenticated({
        token: result.token,
        startedAt: new Date().toISOString(),
        expiresAt: result.expira_ms,
        user: result.usuario,
      })
      setCode('')
    } catch (cause) {
      if (
        cause instanceof ApiRequestError &&
        ['API_TIMEOUT', 'NETWORK_ERROR', 'HTTP_ERROR', 'INVALID_JSON', 'API_URL_MISSING', 'VERSION_MISMATCH'].includes(cause.code)
      ) {
        setError(cause.message)
      } else {
        setError('A janela não está disponível ou o código já foi utilizado.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell maintenance-access-shell">
      <section className="auth-panel maintenance-access-panel" aria-labelledby="maintenance-access-title">
        <div className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">FC</span>
          <div>
            <span className="eyebrow">ACESSO INTERNO PROTEGIDO</span>
            <h1 id="maintenance-access-title">Janela de manutenção</h1>
          </div>
        </div>

        <p className="auth-intro">
          Use somente o código temporário emitido para esta empresa, ambiente e janela.
        </p>

        <div className="maintenance-access-guard">
          <strong>Sessão isolada</strong>
          <span>O código funciona uma única vez e a sessão termina quando a janela expira ou é revogada.</span>
        </div>

        {!getApiUrl() ? (
          <p className="feedback feedback--warning">
            Configure a URL publicada da API antes de continuar.
          </p>
        ) : null}

        <form className="auth-form" onSubmit={submit}>
          <label>
            Código temporário
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={160}
              disabled={submitting}
              autoFocus
            />
          </label>

          {error ? <p className="feedback feedback--error">{error}</p> : null}

          <button className="primary-button" type="submit" disabled={submitting || !getApiUrl()}>
            {submitting ? 'Validando…' : 'Abrir sessão interna'}
          </button>

          <button className="auth-link-button" type="button" disabled={submitting} onClick={onReturn}>
            Voltar ao acesso operacional
          </button>
        </form>

        <footer className="auth-footer">
          <span>Aplicativo {APP_RELEASE_VERSION}</span>
          <span>API compatível {API_COMPATIBLE_RELEASE}</span>
        </footer>
      </section>
    </main>
  )
}
