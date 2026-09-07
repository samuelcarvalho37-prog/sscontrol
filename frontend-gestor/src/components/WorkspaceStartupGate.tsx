import { useEffect, useMemo, useState } from 'react'
import type { GestorSession } from '../services/api/auth'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type { WorkspaceStartupProgress } from '../services/startup/workspace'
import { AlertIcon, CheckIcon } from './Icons'

interface WorkspaceStartupGateProps {
  session: GestorSession
  onReady: () => void
  onSessionExpired: () => void
  onLogout: () => void
}

const INITIAL_PROGRESS: WorkspaceStartupProgress = {
  percent: 4,
  title: 'Iniciando o ambiente',
  detail: 'Organizando os recursos essenciais para esta sessão.',
  completedGroups: 0,
  totalGroups: 4,
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export function WorkspaceStartupGate({
  session,
  onReady,
  onSessionExpired,
  onLogout,
}: WorkspaceStartupGateProps) {
  const [progress, setProgress] = useState(INITIAL_PROGRESS)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const role = session.user.perfil.trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'GESTOR'
  const stages = useMemo(
    () => role === 'ADMIN'
      ? ['Núcleo do sistema', 'Governança e acessos', 'Configuração e dados', 'Continuidade']
      : ['Núcleo do sistema', 'Filtro técnico', 'Operação e indicadores', 'Recursos técnicos'],
    [role],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function start() {
      setError('')
      setProgress(INITIAL_PROGRESS)
      const startedAt = Date.now()

      try {
        const { prepareWorkspace } = await import('../services/startup/workspace')
        await prepareWorkspace(session, controller.signal, (nextProgress) => {
          if (active) setProgress(nextProgress)
        })
        const remaining = 650 - (Date.now() - startedAt)
        if (remaining > 0) await wait(remaining)
        if (active) onReady()
      } catch (cause) {
        if (!active || controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível preparar todos os recursos essenciais.',
        )
      }
    }

    void start()
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, onReady, onSessionExpired, session])

  const activeStage = Math.min(
    stages.length - 1,
    Math.max(0, Math.ceil((progress.percent / 100) * stages.length) - 1),
  )

  return (
    <main className="workspace-startup-shell" aria-busy={!error}>
      <section className="workspace-startup-card" aria-live="polite">
        <div className="workspace-startup-brand">
          <span className="auth-brand__mark" aria-hidden="true">FC</span>
          <div>
            <span className="eyebrow">FAB CONTROL</span>
            <strong>{role === 'ADMIN' ? 'Preparando Administração' : 'Preparando Gestão'}</strong>
          </div>
        </div>

        <div className="workspace-startup-heading">
          {error ? <AlertIcon /> : <span className="workspace-startup-spinner" aria-hidden="true" />}
          <div>
            <h1>{error ? 'Preparação interrompida' : progress.title}</h1>
            <p>{error || progress.detail}</p>
          </div>
        </div>

        <div className="workspace-startup-progress" aria-label={`${progress.percent}% concluído`}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>

        <div className="workspace-startup-meta">
          <span>{error ? 'Aguardando nova tentativa' : `${progress.percent}% concluído`}</span>
          <span>{session.user.nome}</span>
        </div>

        <ol className="workspace-startup-stages">
          {stages.map((stage, index) => {
            const completed = !error && index < activeStage
            const current = !error && index === activeStage
            return (
              <li
                className={
                  completed
                    ? 'workspace-startup-stage workspace-startup-stage--complete'
                    : current
                      ? 'workspace-startup-stage workspace-startup-stage--current'
                      : 'workspace-startup-stage'
                }
                key={stage}
              >
                <span>{completed ? <CheckIcon /> : index + 1}</span>
                <strong>{stage}</strong>
              </li>
            )
          })}
        </ol>

        {error ? (
          <div className="workspace-startup-actions">
            <button type="button" className="secondary-button" onClick={onLogout}>
              Sair
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <small className="workspace-startup-note">
            O workspace será liberado somente após conferir os módulos essenciais.
          </small>
        )}
      </section>
    </main>
  )
}
