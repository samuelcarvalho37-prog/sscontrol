import { useEffect, useMemo, useState } from 'react'
import { describeOperationalFailure, type OperationalDiagnostic } from '../services/ui/operationalDiagnostic'
import './PcmMobileDashboard.css'

type OrderRow = Record<string, unknown> & { id: string }

type Props = {
  apiUrl: string
  token: string
  onOpenOrders: () => void
}

const closed = new Set(['COMPLETED', 'RESOLVED', 'CLOSED', 'CANCELLED'])
const active = new Set(['RELEASED', 'IN_PROGRESS', 'PAUSED', 'IN_TECHNICAL_REVIEW'])
const review = new Set(['OPEN', 'IN_TREATMENT', 'DRAFT', 'APPROVED'])

function text(value: unknown, fallback = '—'): string {
  return value == null || value === '' ? fallback : String(value)
}

function stateOf(row: OrderRow): string {
  return text(row.situacao ?? row.status, '').toUpperCase()
}

function priorityOf(row: OrderRow): string {
  return text(row.prioridade, '').toUpperCase()
}

function label(value: string): string {
  return ({
    OPEN: 'Aguardando PCM', IN_TREATMENT: 'Em avaliação', DRAFT: 'Em preparação',
    APPROVED: 'Aprovada', RELEASED: 'Liberada', IN_PROGRESS: 'Em execução',
    PAUSED: 'Pausada', IN_TECHNICAL_REVIEW: 'Em validação', COMPLETED: 'Concluída',
    RESOLVED: 'Resolvida', CLOSED: 'Encerrada', CANCELLED: 'Cancelada',
  } as Record<string, string>)[value] ?? text(value, 'Sem situação')
}

export function PcmMobileDashboard({ apiUrl, token, onOpenOrders }: Props) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<OperationalDiagnostic | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
      const response = await fetch(`${base}/v1/shared/orders?pagina=1&situacao=ALL`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      })
      const result = await response.json() as { ok?: boolean; data?: { itens?: OrderRow[] }; error?: { message?: string } }
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? 'Não foi possível carregar os indicadores.')
      setOrders(result.data?.itens ?? [])
    } catch (cause) {
      setError(describeOperationalFailure(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [apiUrl, token])

  const summary = useMemo(() => {
    const running = orders.filter(row => stateOf(row) === 'IN_PROGRESS').length
    const pendingReview = orders.filter(row => review.has(stateOf(row))).length
    const completed = orders.filter(row => closed.has(stateOf(row))).length
    const open = orders.filter(row => active.has(stateOf(row)) || review.has(stateOf(row))).length
    const critical = orders.filter(row => ['CRITICAL', 'HIGH'].includes(priorityOf(row)) && !closed.has(stateOf(row)))
    return { running, pendingReview, completed, open, critical }
  }, [orders])

  return <section className="pcm-mobile-dashboard" aria-label="Dashboard do PCM">
    <header className="pcm-mobile-dashboard__hero">
      <span>PAINEL DO PCM</span>
      <h1>Visão operacional</h1>
      <p>Ordens, prioridades e acompanhamento da planta em um só lugar.</p>
      <button type="button" onClick={onOpenOrders}>Ver todas as OS <span aria-hidden="true">→</span></button>
    </header>

    <div className="pcm-mobile-dashboard__summary" aria-label="Indicadores do período">
      <article><span>ORDENS ATIVAS</span><strong>{summary.open}</strong><small>em acompanhamento</small></article>
      <article><span>EM EXECUÇÃO</span><strong>{summary.running}</strong><small>equipes em campo</small></article>
      <article><span>AGUARDAM PCM</span><strong>{summary.pendingReview}</strong><small>decisões pendentes</small></article>
      <article><span>CONCLUÍDAS</span><strong>{summary.completed}</strong><small>no histórico</small></article>
    </div>

    <section className="pcm-mobile-dashboard__priority" aria-label="Prioridades operacionais">
      <div>
        <span>FOCO DO TURNO</span>
        <h2>{summary.critical.length ? `${summary.critical.length} prioridade${summary.critical.length > 1 ? 's' : ''} alta${summary.critical.length > 1 ? 's' : ''}` : 'Operação estável'}</h2>
        <p>{summary.critical.length ? 'Ordens críticas ou altas que precisam de acompanhamento.' : 'Não há OS críticas ou altas abertas neste momento.'}</p>
      </div>
      <button type="button" onClick={onOpenOrders}>Acompanhar</button>
    </section>

    <section className="pcm-mobile-dashboard__list" aria-label="Ordens que exigem atenção">
      <header><div><span>ACOMPANHAMENTO</span><h2>Prioridades da planta</h2></div><button type="button" onClick={load} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></header>
      {error ? <div className="pcm-mobile-dashboard__error" role="alert"><strong>{error.title}</strong><p>{error.message}</p><button type="button" onClick={load}>Tentar novamente</button></div> : null}
      {!error && !loading && !orders.length ? <p className="pcm-mobile-dashboard__empty">Ainda não há ordens cadastradas nesta planta.</p> : null}
      {!error && (summary.critical.length ? summary.critical : orders.filter(row => !closed.has(stateOf(row))).slice(0, 3)).slice(0, 3).map(row => {
        const state = stateOf(row)
        const priority = priorityOf(row)
        return <button type="button" className="pcm-mobile-dashboard__order" key={row.id} onClick={onOpenOrders}>
          <i className={`is-${priority.toLowerCase() || 'normal'}`} aria-hidden="true" />
          <span><strong>{text(row.titulo, 'Ordem de serviço')}</strong><small>{text(row.os_codigo ?? row.codigo, 'OS sem código')} · {label(state)}</small></span>
          <b>{priority === 'CRITICAL' ? 'Crítica' : priority === 'HIGH' ? 'Alta' : 'Ver'}</b>
        </button>
      })}
    </section>
  </section>
}
