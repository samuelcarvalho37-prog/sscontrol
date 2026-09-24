import { useState, type FormEvent } from 'react'
import { API_COMPATIBLE_RELEASE } from '../release'
import {
  getApiUrl,
  isApiUrlManagedByEnvironment,
  saveApiUrl,
} from '../services/api/config'
import { getSystemHealth } from '../services/api/system'

export interface ApiConnectionPanelProps {
  compact?: boolean
  onSaved?: () => void
}

function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function validateApiUrl(value: string): string {
  if (!value) return 'Informe a URL base da API.'

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'Informe uma URL completa e válida.'
  }

  const localHost = ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(localHost && parsed.protocol === 'http:')) {
    return 'Use HTTPS. HTTP é aceito apenas para desenvolvimento local.'
  }

  if (
    parsed.hostname === 'script.google.com' &&
    !/^\/macros\/s\/[^/]+\/exec$/.test(parsed.pathname)
  ) {
    return 'Use a URL do Web App publicada, terminada em /exec, e não o link do editor.'
  }

  return ''
}

export function ApiConnectionPanel({ compact = false, onSaved }: ApiConnectionPanelProps) {
  const managedByEnvironment = isApiUrlManagedByEnvironment()
  const [value, setValue] = useState(getApiUrl)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (managedByEnvironment || testing) return

    const normalized = normalizeApiUrl(value)
    const validationError = validateApiUrl(normalized)
    if (validationError) {
      setError(validationError)
      setSuccess('')
      return
    }

    setTesting(true)
    setError('')
    setSuccess('')
    saveApiUrl(normalized)

    try {
      const health = await getSystemHealth()
      const received = health.release_version || health.version
      if (received !== API_COMPATIBLE_RELEASE) {
        throw new Error(
          `API ${received || 'não identificada'} incompatível com o contrato ${API_COMPATIBLE_RELEASE}.`,
        )
      }

      setValue(normalized)
      setSuccess(`Conexão validada com a API ${received}.`)
      onSaved?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível validar a conexão com a API.',
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className={compact ? 'connection-panel connection-panel--compact' : 'connection-panel'}>
      <div className="connection-panel__heading">
        <div>
          <span className="eyebrow">CONEXÃO SEGURA</span>
          <h2>API do VORQIX</h2>
        </div>
        <span className={getApiUrl() ? 'status-chip status-chip--success' : 'status-chip'}>
          {getApiUrl() ? 'Informada' : 'Pendente'}
        </span>
      </div>

      <p>
        Informe a URL base da API Node.js. O ambiente publicado pode controlar
        este endereço automaticamente.
      </p>

      <form className="connection-form" onSubmit={submit}>
        <label>
          URL base da API
          <input
            type="url"
            value={value}
            disabled={managedByEnvironment || testing}
            placeholder="https://api.suaempresa.com"
            autoComplete="url"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>

        <button className="primary-button" type="submit" disabled={managedByEnvironment || testing}>
          {testing ? 'Validando…' : 'Salvar e testar'}
        </button>
      </form>

      {managedByEnvironment ? (
        <p className="connection-feedback connection-feedback--info">
          URL controlada pela configuração do ambiente de publicação.
        </p>
      ) : null}
      {success ? (
        <p className="connection-feedback connection-feedback--success" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="connection-feedback connection-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
