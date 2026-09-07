import { useEffect, useMemo, useState } from 'react'
import type { OperatorAction } from '../types/operator'
import { ActionCard, resolveActionAvailability } from '../components/ActionCard'
import { ArrowIcon } from '../components/Icons'

type QueueView = 'PENDENTES' | 'EM_EXECUCAO'
type ScheduledFilter = 'TODAS' | 'AGENDADA' | 'EM_ALERTA' | 'DISPONIVEL' | 'ATRASADA'
type NonScheduledFilter = 'TODAS' | 'CRITICA' | 'ALTA' | 'DEMAIS'

export interface OperatorHomeProps {
  actions: OperatorAction[]
  loading: boolean
  error: string
  configured: boolean
  onRetry: () => void
  onOpenSettings: () => void
  onOpenAction: (action: OperatorAction) => void
  onOpenQr: () => void
}

function statusMatchesView(action: OperatorAction, view: QueueView): boolean {
  if (view === 'PENDENTES') return action.status === 'PENDENTE'
  return action.status === 'EM_EXECUCAO'
}

function queueDescription(view: QueueView): string {
  if (view === 'PENDENTES') return 'Ações pendentes, agendadas e disponíveis para o operador.'
  return 'Atividades em execução neste turno.'
}

function scheduledMatchesFilter(
  action: OperatorAction,
  filter: ScheduledFilter,
  nowMs: number,
): boolean {
  if (filter === 'TODAS') return true

  const state = resolveActionAvailability(action, nowMs).state
  if (filter === 'DISPONIVEL') {
    return state === 'DISPONIVEL' || state === 'SEM_AGENDAMENTO'
  }
  return state === filter
}

export function OperatorHome({
  actions,
  loading,
  error,
  configured,
  onRetry,
  onOpenSettings,
  onOpenAction,
}: OperatorHomeProps) {
  const [activeView, setActiveView] = useState<QueueView>('PENDENTES')
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledFilter>('TODAS')
  const [nonScheduledFilter, setNonScheduledFilter] = useState<NonScheduledFilter>('TODAS')
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (activeView !== 'PENDENTES') {
      setScheduledFilter('TODAS')
      setNonScheduledFilter('TODAS')
    }
  }, [activeView])

  const pending = useMemo(
    () => actions.filter((action) => action.status === 'PENDENTE'),
    [actions],
  )
  const running = useMemo(
    () => actions.filter((action) => action.status === 'EM_EXECUCAO'),
    [actions],
  )
  const visibleActions = useMemo(
    () => actions.filter((action) => statusMatchesView(action, activeView)),
    [actions, activeView],
  )
  const nonScheduledAll = useMemo(
    () => visibleActions.filter((action) => action.group === 'NAO_PROGRAMADA'),
    [visibleActions],
  )
  const scheduledAll = useMemo(
    () => visibleActions.filter((action) => action.group === 'PROGRAMADA'),
    [visibleActions],
  )

  const scheduledStats = useMemo(() => {
    const stats = { scheduled: 0, alert: 0, available: 0, overdue: 0 }
    scheduledAll.forEach((action) => {
      const state = resolveActionAvailability(action, nowMs).state
      if (state === 'AGENDADA') stats.scheduled += 1
      else if (state === 'EM_ALERTA') stats.alert += 1
      else if (state === 'ATRASADA') stats.overdue += 1
      else stats.available += 1
    })
    return stats
  }, [scheduledAll, nowMs])

  const scheduled = useMemo(
    () => scheduledAll.filter((action) => scheduledMatchesFilter(action, scheduledFilter, nowMs)),
    [scheduledAll, scheduledFilter, nowMs],
  )

  const nonScheduledStats = useMemo(() => ({
    critical: nonScheduledAll.filter((action) => action.priority === 'CRITICA').length,
    high: nonScheduledAll.filter((action) => action.priority === 'ALTA').length,
    others: nonScheduledAll.filter((action) => !['CRITICA', 'ALTA'].includes(action.priority)).length,
  }), [nonScheduledAll])

  const nonScheduled = useMemo(() => {
    if (nonScheduledFilter === 'TODAS') return nonScheduledAll
    if (nonScheduledFilter === 'DEMAIS') {
      return nonScheduledAll.filter((action) => !['CRITICA', 'ALTA'].includes(action.priority))
    }
    return nonScheduledAll.filter((action) => action.priority === nonScheduledFilter)
  }, [nonScheduledAll, nonScheduledFilter])

  const currentEmergency =
    activeView === 'PENDENTES'
      ? pending.find(
          (action) =>
            action.group === 'NAO_PROGRAMADA' &&
            action.priority === 'CRITICA',
        ) ?? pending.find((action) => action.group === 'NAO_PROGRAMADA')
      : undefined

  if (!configured) {
    return (
      <section className="screen">
        <article className="state-panel">
          <span className="state-panel__kicker">Integração necessária</span>
          <h1>Configure a API e o token do operador</h1>
          <p>
            Informe o endpoint da API Node.js e autentique uma sessão válida do
            perfil Operador.
          </p>
          <button type="button" onClick={onOpenSettings}>Abrir configurações</button>
        </article>
      </section>
    )
  }

  if (loading && actions.length === 0) {
    return (
      <section className="screen">
        <div className="loading-panel" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <strong>Carregando ações do operador</strong>
          <p>Consultando o FAB Control.</p>
        </div>
      </section>
    )
  }

  if (error && actions.length === 0) {
    return (
      <section className="screen">
        <article className="state-panel state-panel--error">
          <span className="state-panel__kicker">Falha na sincronização</span>
          <h1>Não foi possível carregar a fila</h1>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>Tentar novamente</button>
        </article>
      </section>
    )
  }

  return (
    <section className="screen operator-home">
      {error && (
        <div className="inline-warning">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Atualizar</button>
        </div>
      )}

      {currentEmergency && (
        <button
          type="button"
          className="live-alert"
          onClick={() => onOpenAction(currentEmergency)}
        >
          <div>
            <span>Ação emergencial agora</span>
            <strong>{currentEmergency.title}</strong>
            <small>
              {currentEmergency.assetTag} · {currentEmergency.componentName}
            </small>
          </div>
          <span className="live-alert__cta">
            Abrir <ArrowIcon />
          </span>
        </button>
      )}

      <header className="screen-heading screen-heading--with-action">
        <div>
          <span>Fila de operação</span>
          <h1>Manutenções do turno</h1>
          <p>{queueDescription(activeView)}</p>
        </div>
        <span className={`operator-auto-sync${loading ? ' is-syncing' : ''}`} role="status">
          <i aria-hidden="true" />
          {loading ? 'Sincronizando' : 'Fila ao vivo'}
        </span>
      </header>

      <div className="summary-grid summary-grid--active-queue" aria-label="Filtrar ações por situação">
        <button
          type="button"
          className={activeView === 'PENDENTES' ? 'summary-card summary-card--active' : 'summary-card'}
          aria-pressed={activeView === 'PENDENTES'}
          onClick={() => setActiveView('PENDENTES')}
        >
          <strong>{pending.length}</strong>
          <span>Pendentes</span>
        </button>
        <button
          type="button"
          className={activeView === 'EM_EXECUCAO' ? 'summary-card summary-card--active' : 'summary-card'}
          aria-pressed={activeView === 'EM_EXECUCAO'}
          onClick={() => setActiveView('EM_EXECUCAO')}
        >
          <strong>{running.length}</strong>
          <span>Em execução</span>
        </button>
      </div>

      <section className="content-section maintenance-type-section">
        <div className="section-heading section-heading--stacked">
          <div>
            <h2>Não programadas</h2>
            <p>Ocorrências, emergências e intervenções não previstas.</p>
          </div>
          <span>{nonScheduled.length}</span>
        </div>

        {activeView === 'PENDENTES' && nonScheduledAll.length > 0 && (
          <div
            className="queue-metrics queue-metrics--filters"
            aria-label="Filtrar manutenções não programadas por prioridade"
          >
            <button
              type="button"
              className={nonScheduledFilter === 'TODAS' ? 'queue-metric queue-metric--active' : 'queue-metric'}
              aria-pressed={nonScheduledFilter === 'TODAS'}
              onClick={() => setNonScheduledFilter('TODAS')}
            >
              <strong>{nonScheduledAll.length}</strong> todas
            </button>
            <button
              type="button"
              className={nonScheduledFilter === 'CRITICA' ? 'queue-metric queue-metric--critical queue-metric--active' : 'queue-metric queue-metric--critical'}
              aria-pressed={nonScheduledFilter === 'CRITICA'}
              onClick={() => setNonScheduledFilter('CRITICA')}
            >
              <strong>{nonScheduledStats.critical}</strong> críticas
            </button>
            <button
              type="button"
              className={nonScheduledFilter === 'ALTA' ? 'queue-metric queue-metric--high queue-metric--active' : 'queue-metric queue-metric--high'}
              aria-pressed={nonScheduledFilter === 'ALTA'}
              onClick={() => setNonScheduledFilter('ALTA')}
            >
              <strong>{nonScheduledStats.high}</strong> altas
            </button>
            <button
              type="button"
              className={nonScheduledFilter === 'DEMAIS' ? 'queue-metric queue-metric--active' : 'queue-metric'}
              aria-pressed={nonScheduledFilter === 'DEMAIS'}
              onClick={() => setNonScheduledFilter('DEMAIS')}
            >
              <strong>{nonScheduledStats.others}</strong> demais
            </button>
          </div>
        )}

        {nonScheduled.length > 0 ? (
          <div className={activeView === 'PENDENTES' ? 'emergency-list' : 'scheduled-grid'}>
            {nonScheduled.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                compact={activeView === 'PENDENTES'}
                nowMs={nowMs}
                onOpen={onOpenAction}
              />
            ))}
          </div>
        ) : (
          <article className="queue-empty-card">
            <strong>
              {nonScheduledAll.length > 0
                ? 'Nenhuma manutenção neste filtro'
                : 'Nenhuma manutenção não programada'}
            </strong>
            <p>
              {nonScheduledAll.length > 0
                ? 'Não há ações não programadas na prioridade selecionada.'
                : 'Não há ações deste tipo na situação selecionada.'}
            </p>
            {nonScheduledAll.length > 0 && nonScheduledFilter !== 'TODAS' && (
              <button
                type="button"
                className="queue-filter-clear"
                onClick={() => setNonScheduledFilter('TODAS')}
              >
                Mostrar todas
              </button>
            )}
          </article>
        )}
      </section>

      <section className="content-section maintenance-type-section">
        <div className="section-heading section-heading--stacked">
          <div>
            <h2>Programadas</h2>
            <p>Preventivas, inspeções e atividades dentro da janela planejada.</p>
          </div>
          <span>{scheduled.length}</span>
        </div>

        {activeView === 'PENDENTES' && scheduledAll.length > 0 && (
          <div className="queue-metrics queue-metrics--filters" aria-label="Filtrar manutenções programadas por situação">
            <button
              type="button"
              className={scheduledFilter === 'TODAS' ? 'queue-metric queue-metric--active' : 'queue-metric'}
              aria-pressed={scheduledFilter === 'TODAS'}
              onClick={() => setScheduledFilter('TODAS')}
            >
              <strong>{scheduledAll.length}</strong> todas
            </button>
            <button
              type="button"
              className={scheduledFilter === 'AGENDADA' ? 'queue-metric queue-metric--active' : 'queue-metric'}
              aria-pressed={scheduledFilter === 'AGENDADA'}
              onClick={() => setScheduledFilter('AGENDADA')}
            >
              <strong>{scheduledStats.scheduled}</strong> agendadas
            </button>
            <button
              type="button"
              className={scheduledFilter === 'EM_ALERTA' ? 'queue-metric queue-metric--alert queue-metric--active' : 'queue-metric queue-metric--alert'}
              aria-pressed={scheduledFilter === 'EM_ALERTA'}
              onClick={() => setScheduledFilter('EM_ALERTA')}
            >
              <strong>{scheduledStats.alert}</strong> em alerta
            </button>
            <button
              type="button"
              className={scheduledFilter === 'DISPONIVEL' ? 'queue-metric queue-metric--available queue-metric--active' : 'queue-metric queue-metric--available'}
              aria-pressed={scheduledFilter === 'DISPONIVEL'}
              onClick={() => setScheduledFilter('DISPONIVEL')}
            >
              <strong>{scheduledStats.available}</strong> disponíveis
            </button>
            <button
              type="button"
              className={scheduledFilter === 'ATRASADA' ? 'queue-metric queue-metric--critical queue-metric--active' : 'queue-metric queue-metric--critical'}
              aria-pressed={scheduledFilter === 'ATRASADA'}
              onClick={() => setScheduledFilter('ATRASADA')}
            >
              <strong>{scheduledStats.overdue}</strong> atrasadas
            </button>
          </div>
        )}

        {scheduled.length > 0 ? (
          <div className="scheduled-grid">
            {scheduled.map((action) => (
              <ActionCard key={action.id} action={action} nowMs={nowMs} onOpen={onOpenAction} />
            ))}
          </div>
        ) : (
          <article className="queue-empty-card">
            <strong>
              {scheduledAll.length > 0
                ? 'Nenhuma manutenção neste filtro'
                : 'Nenhuma manutenção programada'}
            </strong>
            <p>
              {scheduledAll.length > 0
                ? 'Não há ações programadas na situação selecionada.'
                : 'Não há ações deste tipo na situação selecionada.'}
            </p>
            {scheduledAll.length > 0 && scheduledFilter !== 'TODAS' && (
              <button
                type="button"
                className="queue-filter-clear"
                onClick={() => setScheduledFilter('TODAS')}
              >
                Mostrar todas
              </button>
            )}
          </article>
        )}
      </section>

    </section>
  )
}
