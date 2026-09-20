import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { callApi } from '../services/api/client'
import { getGestorToken } from '../services/api/config'
import { getGestorActionDetail, getGestorNotifications, isGestorAuthenticationError } from '../services/api/gestor'
import { getAdminIntervention, listAdminInterventions, saveAdminIntervention, sendAdminInterventionForValidation } from '../services/api/interventions'
import { releaseMaintenanceWorkOrder } from '../services/api/maintenanceAssignments'
import type { AdminIntervention } from '../types/interventions'
import { listAdminEntity } from '../services/api/catalog'
import type { AdminEntityRecord } from '../types/catalog'
import type { GestorActionDetail, GestorNotification } from '../types/gestor'
import './PcmDashboard.css'

interface PcmData {
  atualizado_em: string
  atual: {
    ativos_parados: number
    ordens_abertas: number
    ordens_criticas: number
    ordens_atrasadas: number
    preventivas_proximas: number
    backlog_horas_estimadas: number
    ordens_sem_estimativa: number
    tecnicos_em_atividade: number
  }
  confiabilidade: {
    ativos_considerados: number
    falhas: number
    mttr_segundos: number | null
    mtbf_segundos: number | null
    disponibilidade_percentual: number | null
    reincidencias: number
    ativos_reincidentes: number
  }
  confiabilidade_mensal?: {
    mes: string
    mttr_segundos: number | null
  }[]
  falhas_por_ativo: {
    ativo_id: string
    ativo_tag: string
    ativo_nome: string
    setor_nome: string
    falhas: number
  }[]
  falhas_por_setor: {
    setor_id: string
    setor_nome: string
    falhas: number
  }[]
  ativos_parados_lista: {
    id: string
    ativo_tag: string
    ativo_nome: string
    setor_nome: string
  }[]
  preventivas: {
    id: string
    codigo: string
    ativo_tag: string
    programada_para: string
  }[]
  tecnicos: {
    id: string
    nome: string
    execucoes: number
  }[]
  relatorios?: {
    ordens?: {
      abertas?: number
      concluidas_no_periodo?: number
      atrasadas?: number
      por_tipo?: { tipo: string; quantidade: number }[]
      por_prioridade?: { prioridade: string; quantidade: number }[]
    }
    preventivas?: {
      programadas_no_periodo?: number
      concluidas_no_prazo?: number
      concluidas_com_atraso?: number
      pendentes?: number
    }
    tecnicos?: { id: string; nome: string; execucoes: number; segundos_apontados: number }[]
    mttr_mensal?: { mes: string; mttr_segundos: number | null }[]
  }
}

interface MonthlyMttrPoint {
  month: string
  label: string
  mttrSeconds: number | null
}

type MaintenanceStatus = 'NORMAL' | 'ATENCAO' | 'CRITICO'

function number(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function duration(seconds: number | null) {
  if (seconds === null) return 'Sem amostra'
  return seconds >= 3600 ? `${number(seconds / 3600)} h` : `${number(seconds / 60)} min`
}

function statusFrom(data: PcmData): MaintenanceStatus {
  const current = data.atual

  if (current.ordens_criticas > 0 || current.ativos_parados >= 2 || current.ordens_atrasadas >= 3) {
    return 'CRITICO'
  }

  if (
    current.ativos_parados > 0 ||
    current.ordens_atrasadas > 0 ||
    current.preventivas_proximas >= 5 ||
    current.ordens_sem_estimativa > 0
  ) {
    return 'ATENCAO'
  }

  return 'NORMAL'
}

function Metric({
  label,
  value,
  note,
  tone = 'default',
  onClick,
}: {
  label: string
  value: string | number
  note: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
  onClick?: () => void
}) {
  const content = <><span className="pcm-metric__label">{label}</span><strong>{value}</strong><small>{note}</small>{onClick ? <span className="pcm-metric__action">Ver lista →</span> : null}</>
  if (onClick) return <button type="button" className={`pcm-metric pcm-metric--${tone} pcm-metric--interactive`} onClick={onClick}>{content}</button>
  return (
    <article className={`pcm-metric pcm-metric--${tone}`}>
      {content}
    </article>
  )
}

interface InsightItem { id: string; title: string; detail: string; status?: string }

function InsightDialog({ insight, onClose }: { insight: { title: string; description: string; items: InsightItem[] } | null; onClose: () => void }) {
  if (!insight) return null
  return <div className="pcm-insight-dialog__backdrop" role="presentation" onMouseDown={onClose}>
    <section className="pcm-insight-dialog" role="dialog" aria-modal="true" aria-labelledby="pcm-insight-title" onMouseDown={event => event.stopPropagation()}>
      <header><div><span className="pcm-section-kicker">VISÃO DO DIA</span><h2 id="pcm-insight-title">{insight.title}</h2><p>{insight.description}</p></div><button type="button" aria-label="Fechar lista" onClick={onClose}>×</button></header>
      {insight.items.length ? <ul>{insight.items.map(item => <li key={item.id}><div><strong>{item.title}</strong><span>{item.detail}</span></div>{item.status ? <small>{item.status}</small> : null}</li>)}</ul> : <p className="pcm-empty">Nenhum registro disponível neste momento.</p>}
    </section>
  </div>
}

function EmptyState({ children }: { children: string }) {
  return <p className="pcm-empty">{children}</p>
}

function HorizontalBarChart({
  items,
  emptyMessage,
  valueLabel,
}: {
  items: ReadonlyArray<{ id: string; label: string; detail?: string; value: number }>
  emptyMessage: string
  valueLabel: string
}) {
  const maxValue = Math.max(...items.map(item => item.value), 1)
  if (items.length === 0) return <EmptyState>{emptyMessage}</EmptyState>

  return <div className="pcm-bar-chart" role="img" aria-label={`${valueLabel}: ${items.map(item => `${item.label}, ${item.value}`).join('; ')}`}>
    {items.map(item => <div className="pcm-bar-chart__row" key={item.id}>
      <div className="pcm-bar-chart__label"><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</div>
      <div className="pcm-bar-chart__track"><span style={{ width: `${Math.max(8, (item.value / maxValue) * 100)}%` }} /></div>
      <strong className="pcm-bar-chart__value">{item.value}</strong>
    </div>)}
  </div>
}

function ReliabilityBarChart({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: ReadonlyArray<{ label: string; value: number | null; displayValue: string; detail: string }>
}) {
  const availableItems = items.filter((item): item is { label: string; value: number; displayValue: string; detail: string } => item.value !== null)
  const maximum = Math.max(...availableItems.map((item) => item.value), 1)

  return (
    <article className="pcm-indicator-chart">
      <div className="pcm-indicator-chart__heading">
        <div>
          <span>INDICADOR DE TEMPO</span>
          <h3>{title}</h3>
        </div>
        <small>{description}</small>
      </div>

      {availableItems.length === 0 ? <EmptyState>Sem falhas concluídas no período para calcular os tempos.</EmptyState> : (
        <div className="pcm-indicator-bars" role="img" aria-label={`${title}: ${availableItems.map((item) => `${item.label} ${item.displayValue}`).join('; ')}`}>
          {availableItems.map((item) => (
            <div className="pcm-indicator-bars__row" key={item.label}>
              <div><strong>{item.label}</strong><small>{item.detail}</small></div>
              <div className="pcm-indicator-bars__track"><span style={{ width: `${Math.max(6, (item.value / maximum) * 100)}%` }} /></div>
              <b>{item.displayValue}</b>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function PercentageChart({
  title,
  description,
  percentage,
  detail,
}: {
  title: string
  description: string
  percentage: number | null
  detail: string
}) {
  const safePercentage = percentage === null ? null : Math.min(100, Math.max(0, percentage))

  return (
    <article className="pcm-indicator-chart pcm-indicator-chart--percentage">
      <div className="pcm-indicator-chart__heading">
        <div><span>INDICADOR OPERACIONAL</span><h3>{title}</h3></div>
        <small>{description}</small>
      </div>
      {safePercentage === null ? <EmptyState>Sem ativos suficientes para calcular a disponibilidade.</EmptyState> : (
        <div className="pcm-percentage-chart" role="img" aria-label={`${title}: ${number(safePercentage)}%`}>
          <div className="pcm-percentage-chart__ring" style={{ '--pcm-percentage': `${safePercentage}%` } as CSSProperties}>
            <strong>{number(safePercentage)}%</strong>
            <span>disponível</span>
          </div>
          <p>{detail}</p>
        </div>
      )}
    </article>
  )
}

function BacklogChart({ hours, openOrders, withoutEstimate }: { hours: number; openOrders: number; withoutEstimate: number }) {
  const estimatedOrders = Math.max(0, openOrders - withoutEstimate)
  const estimatedWidth = openOrders > 0 ? (estimatedOrders / openOrders) * 100 : 0
  const unestimatedWidth = openOrders > 0 ? (withoutEstimate / openOrders) * 100 : 0

  return (
    <article className="pcm-indicator-chart">
      <div className="pcm-indicator-chart__heading">
        <div><span>CARGA DE TRABALHO</span><h3>Backlog estimado</h3></div>
        <strong className="pcm-indicator-chart__main-value">{number(hours)} h</strong>
      </div>
      <div className="pcm-backlog-chart" role="img" aria-label={`Backlog estimado de ${number(hours)} horas: ${estimatedOrders} ordens estimadas e ${withoutEstimate} sem estimativa`}>
        <div className="pcm-backlog-chart__track">
          {estimatedWidth > 0 ? <span className="pcm-backlog-chart__estimated" style={{ width: `${estimatedWidth}%` }} /> : null}
          {unestimatedWidth > 0 ? <span className="pcm-backlog-chart__unestimated" style={{ width: `${unestimatedWidth}%` }} /> : null}
          {openOrders === 0 ? <span className="pcm-backlog-chart__empty" /> : null}
        </div>
        <div className="pcm-backlog-chart__legend">
          <span><i className="pcm-backlog-chart__estimated" />{estimatedOrders} estimada{estimatedOrders === 1 ? '' : 's'}</span>
          <span><i className="pcm-backlog-chart__unestimated" />{withoutEstimate} sem estimativa</span>
        </div>
      </div>
    </article>
  )
}


interface OperationalOrder {
  id: string
  code: string
  equipment: string
  sector: string
  type: string
  priority: string
  responsible: string
  status: string
  deadline: string
  openedAt: string
  raw: AdminIntervention
}

function formatDateTime(value: string) {
  if (!value) return 'Não informado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function elapsed(value: string) {
  if (!value) return 'Não informado'
  const start = new Date(value).getTime()
  if (!Number.isFinite(start)) return 'Não informado'
  const diff = Math.max(0, Date.now() - start)
  const hours = diff / 3600000
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))} min`
  if (hours < 24) return `${number(hours)} h`
  return `${number(hours / 24)} d`
}

function isClosedWorkOrder(status: string) {
  return ['CONCLUIDA', 'COMPLETED', 'CLOSED', 'CANCELLED', 'CANCELADA'].includes(normalize(status))
}

function scheduleWindow(plannedAt: string, status: string): { label: string; tone: 'early' | 'on-time' | 'late' | 'scheduled' } | null {
  if (!plannedAt) return null
  const planned = new Date(plannedAt).getTime()
  if (!Number.isFinite(planned)) return null
  const state = normalize(status)
  if (isClosedWorkOrder(state)) return null
  if (planned > Date.now()) return { label: 'Pode antecipar', tone: 'scheduled' }
  if (Date.now() <= planned + 86400000) return { label: 'No prazo', tone: 'on-time' }
  return { label: 'Atrasada', tone: 'late' }
}

function normalize(value: string) {
  return value.trim().toLocaleUpperCase('pt-BR')
}

function humanStatus(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    DRAFT: 'Rascunho',
    RASCUNHO: 'Rascunho',
    OPEN: 'Aberta',
    ABERTA: 'Aberta',
    READY: 'Pronta para execução',
    IN_PROGRESS: 'Em execução',
    EM_EXECUCAO: 'Em execução',
    AWAITING_VALIDATION: 'Aguardando validação',
    AGUARDANDO_VALIDACAO: 'Aguardando validação',
    COMPLETED: 'Concluída',
    CONCLUIDA: 'Concluída',
    CANCELLED: 'Cancelada',
    CANCELADA: 'Cancelada',
    CHANGES_REQUESTED: 'Devolvida para correção',
    DEVOLVIDO_CORRECAO: 'Devolvida para correção',
  }
  if (labels[source]) return labels[source]
  const readable = value.trim().replaceAll('_', ' ').toLocaleLowerCase('pt-BR')
  return readable ? readable.charAt(0).toLocaleUpperCase('pt-BR') + readable.slice(1) : 'Não informado'
}

function humanPriority(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    CRITICAL: 'Crítica',
    CRITICA: 'Crítica',
    HIGH: 'Alta',
    ALTA: 'Alta',
    MEDIUM: 'Média',
    MEDIA: 'Média',
    LOW: 'Baixa',
    BAIXA: 'Baixa',
  }
  return labels[source] ?? humanStatus(value)
}

function humanWorkType(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    CORRECTIVE: 'Corretiva',
    CORRETIVA: 'Corretiva',
    PREVENTIVE: 'Preventiva',
    PREVENTIVA: 'Preventiva',
  }
  return labels[source] ?? humanStatus(value)
}

function maintenanceStatusLabel(value: MaintenanceStatus) {
  return value === 'ATENCAO' ? 'ATENÇÃO' : value === 'CRITICO' ? 'CRÍTICO' : 'NORMAL'
}

function MonthlyMttrChart({ items, loading }: { items: MonthlyMttrPoint[]; loading: boolean }) {
  const maximum = Math.max(1, ...items.map(item => item.mttrSeconds ?? 0))
  const hasSample = items.some(item => item.mttrSeconds !== null)

  return (
    <article className="pcm-indicator-chart pcm-indicator-chart--monthly">
      <div className="pcm-indicator-chart__heading">
        <div>
          <span>INDICADOR DE TEMPO</span>
          <h3>MTTR mensal</h3>
        </div>
        <small>Tempo médio para reparar falhas concluídas.</small>
      </div>
      {loading ? <p className="pcm-indicator-chart__empty">Carregando comparação mensal…</p> : !hasSample ? (
        <p className="pcm-indicator-chart__empty">Ainda não há dados mensais de MTTR.</p>
      ) : (
        <div className="pcm-monthly-chart" role="img" aria-label="Comparação mensal do MTTR">
          {items.map(item => {
            const height = item.mttrSeconds === null ? 0 : Math.max(8, (item.mttrSeconds / maximum) * 100)
            return (
              <div className="pcm-monthly-chart__column" key={item.month}>
                <span className="pcm-monthly-chart__value">{item.mttrSeconds === null ? '—' : duration(item.mttrSeconds)}</span>
                <div className="pcm-monthly-chart__track">
                  <span className="pcm-monthly-chart__bar" style={{ height: `${height}%` }} />
                </div>
                <span className="pcm-monthly-chart__label">{item.label}</span>
              </div>
            )
          })}
        </div>
      )}
      <p className="pcm-indicator-chart__note">Para calcular o MTTR, registre o início e o término da falha.</p>
    </article>
  )
}

function PcmReports({ report, onExport, onPrint }: { report: NonNullable<PcmData['relatorios']>; onExport: () => void; onPrint: () => void }) {
  const orders = report.ordens ?? {}
  const preventive = report.preventivas ?? {}
  const technicians = report.tecnicos ?? []
  const byType = (orders.por_tipo ?? []).map(item => ({ id: item.tipo, label: humanWorkType(item.tipo), value: Number(item.quantidade ?? 0) }))
  const byPriority = (orders.por_prioridade ?? []).map(item => ({ id: item.prioridade, label: humanPriority(item.prioridade), value: Number(item.quantidade ?? 0) }))

  return <section className="pcm-reports" aria-label="Relatórios do PCM">
    <header className="pcm-panel__heading pcm-reports__heading">
      <div><span className="pcm-section-kicker">RELATÓRIOS</span><h2>Resultado do período</h2><p>Consolidação de OS, preventivas e horas apontadas pela equipe.</p></div>
      <div className="pcm-reports__actions"><button type="button" className="pcm-orders__export" onClick={onExport}>Exportar CSV</button><button type="button" className="pcm-reports__print" onClick={onPrint}>Imprimir / PDF</button></div>
    </header>
    <div className="pcm-reports__summary">
      <Metric label="OS abertas" value={orders.abertas ?? 0} note="Pendentes de encerramento" />
      <Metric label="OS concluídas" value={orders.concluidas_no_periodo ?? 0} note="Concluídas no período selecionado" tone="success" />
      <Metric label="Preventivas no prazo" value={preventive.concluidas_no_prazo ?? 0} note="Concluídas até a data programada" tone="success" />
      <Metric label="Preventivas com atraso" value={preventive.concluidas_com_atraso ?? 0} note="Concluídas após a programação" tone={(preventive.concluidas_com_atraso ?? 0) > 0 ? 'warning' : 'success'} />
    </div>
    <div className="pcm-reports__charts">
      <article className="pcm-indicator-chart"><div className="pcm-indicator-chart__heading"><div><span>ORDENS DE SERVIÇO</span><h3>Por tipo</h3></div><small>Registros movimentados no período</small></div><HorizontalBarChart items={byType} emptyMessage="Ainda não há ordens no período selecionado." valueLabel="Ordens por tipo" /></article>
      <article className="pcm-indicator-chart"><div className="pcm-indicator-chart__heading"><div><span>FILA OPERACIONAL</span><h3>Por prioridade</h3></div><small>Apenas ordens ainda abertas</small></div><HorizontalBarChart items={byPriority} emptyMessage="Não há ordens abertas para classificar." valueLabel="Ordens abertas por prioridade" /></article>
    </div>
    <article className="pcm-reports__team"><div><span className="pcm-section-kicker">EQUIPE TÉCNICA</span><h3>Horas apontadas</h3></div>
      {technicians.length === 0 ? <EmptyState>Não há execuções concluídas no período selecionado.</EmptyState> : <div className="pcm-reports__table-wrap"><table><thead><tr><th>Técnico</th><th>OS concluídas</th><th>Horas apontadas</th></tr></thead><tbody>{technicians.map(item => <tr key={item.id}><td>{item.nome}</td><td>{item.execucoes}</td><td>{duration(item.segundos_apontados)}</td></tr>)}</tbody></table></div>}
    </article>
  </section>
}

function toOperationalOrder(action: AdminIntervention): OperationalOrder {
  const code =
    action.codigo ||
    action.id.slice(0, 8).toLocaleUpperCase('pt-BR')

  const equipment =
    [action.ativo_tag, action.ativo_nome].filter(Boolean).join(' · ') ||
    'Não informado'

  return {
    id: action.id,
    code,
    equipment,
    sector: action.setor_nome || 'Não informado',
    type: action.tipo || 'Não informado',
    priority: action.prioridade || 'NORMAL',
    responsible: action.responsavel_nome || 'Não atribuído',
    status: action.status || 'Não informado',
    deadline: action.planejada_para || '',
    openedAt: action.criado_em || action.atualizado_em || '',
    raw: action,
  }
}

function SelectFilter({
  label,
  value,
  values,
  onChange,
}: {
  label: string
  value: string
  values: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="pcm-order-filter">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">Todos</option>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}

function recordText(value: string | number | boolean | null | undefined) {
  return String(value ?? '').trim()
}

interface ExecutablePlan {
  id: string
  versionId: string
  code: string
  name: string
  asset: string
  workType: string
  recurrenceDays: number | null
}

export function PcmDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [days, setDays] = useState('30')
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<PcmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [orders, setOrders] = useState<AdminIntervention[]>([])
  const [orderLoading, setOrderLoading] = useState(true)
  const [orderError, setOrderError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminIntervention | null>(null)
  const [selectedActionDetail, setSelectedActionDetail] = useState<GestorActionDetail | null>(null)
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false)
  const [selectedOrderError, setSelectedOrderError] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [assignmentSuccess, setAssignmentSuccess] = useState('')
  const detailRequestRef = useRef(0)
  const [orderStatus, setOrderStatus] = useState('')
  const [orderPriority, setOrderPriority] = useState('')
  const [orderSector, setOrderSector] = useState('')
  const [orderResponsible, setOrderResponsible] = useState('')
  const [orderType, setOrderType] = useState('')
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [createOrderMode, setCreateOrderMode] = useState<'WORK_ORDER' | 'PREVENTIVE'>('WORK_ORDER')
  const [createOrderBusy, setCreateOrderBusy] = useState(false)
  const [createOrderError, setCreateOrderError] = useState('')
  const [createOrderSuccess, setCreateOrderSuccess] = useState('')
  const [createPlansLoading, setCreatePlansLoading] = useState(false)
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')
  const [insight, setInsight] = useState<{ title: string; description: string; items: InsightItem[] } | null>(null)
  const [batchSchedulingBusy, setBatchSchedulingBusy] = useState(false)
  const [batchSchedulingNotice, setBatchSchedulingNotice] = useState('')
  const [batchPreparationBusy, setBatchPreparationBusy] = useState(false)
  const [createPlans, setCreatePlans] = useState<AdminEntityRecord[]>([])
  const [assetCatalog, setAssetCatalog] = useState<AdminEntityRecord[]>([])
  const [createPlanVersionId, setCreatePlanVersionId] = useState('')
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createPriority, setCreatePriority] = useState('MEDIUM')
  const [createScheduledFor, setCreateScheduledFor] = useState('')
  const [createOriginEntityId, setCreateOriginEntityId] = useState('')
  const [createOriginAssetTag, setCreateOriginAssetTag] = useState('')
  const [createRequiresPostIntervention, setCreateRequiresPostIntervention] = useState(false)
  const [todayNotifications, setTodayNotifications] = useState<GestorNotification[]>([])
  const [notificationsError, setNotificationsError] = useState('')

  const pendingTodayNotifications = useMemo(() => {
    const completedOrigins = new Set(
      orders
        .filter(order => ['COMPLETED', 'CONCLUIDA', 'CONCLUÍDA'].includes(normalize(order.status)))
        .map(order => order.entidade_origem_id)
        .filter((originId): originId is string => Boolean(originId)),
    )
    return todayNotifications.filter(notification => !completedOrigins.has(notification.entidade_id ?? ''))
  }, [orders, todayNotifications])

  const reload = useCallback(() => setRefresh(value => value + 1), [])

  const showOperationalQueue = useCallback(() => {
    setOrderStatus('')
    setOrderPriority('')
    setOrderSector('')
    setOrderResponsible('')
    setOrderType('')
    window.requestAnimationFrame(() => {
      document.getElementById('pcm-operational-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const showCriticalOrders = useCallback(() => {
    setOrderStatus('')
    setOrderPriority('Crítica')
    setOrderSector('')
    setOrderResponsible('')
    setOrderType('')
    window.requestAnimationFrame(() => {
      document.getElementById('pcm-operational-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  function exportOperationalQueue() {
    const protectCsv = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
      return `"${safe.replaceAll('"', '""')}"`
    }
    const headings = ['OS', 'Equipamento', 'Setor', 'Tipo', 'Prioridade', 'Responsável', 'Status', 'Programação', 'Tempo em aberto']
    const rows = filteredOperationalOrders.map(order => [
      order.code,
      order.equipment,
      order.sector,
      humanWorkType(order.type),
      humanPriority(order.priority),
      order.responsible,
      humanStatus(order.status),
      formatDateTime(order.deadline),
      elapsed(order.openedAt),
    ])
    const csv = [headings, ...rows].map(row => row.map(value => protectCsv(String(value))).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vorqix-fila-os-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function exportPcmReport() {
    const report = data?.relatorios
    if (!report) return
    const protectCsv = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
      return `"${safe.replaceAll('"', '""')}"`
    }
    const lines: string[][] = [
      ['Relatório PCM', `Período: últimos ${days} dias`], [],
      ['Resumo de OS', 'Quantidade'], ['Abertas', String(report.ordens?.abertas ?? 0)], ['Concluídas no período', String(report.ordens?.concluidas_no_periodo ?? 0)], ['Atrasadas', String(report.ordens?.atrasadas ?? 0)], [],
      ['Preventivas', 'Quantidade'], ['Programadas no período', String(report.preventivas?.programadas_no_periodo ?? 0)], ['Concluídas no prazo', String(report.preventivas?.concluidas_no_prazo ?? 0)], ['Concluídas com atraso', String(report.preventivas?.concluidas_com_atraso ?? 0)], ['Pendentes', String(report.preventivas?.pendentes ?? 0)], [],
      ['Técnico', 'OS concluídas', 'Horas apontadas'], ...(report.tecnicos ?? []).map(item => [item.nome, String(item.execucoes), duration(item.segundos_apontados)]),
    ]
    const csv = lines.map(row => row.map(value => protectCsv(value)).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vorqix-relatorio-pcm-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function printPcmReport() {
    window.print()
  }

  useEffect(() => {
    const controller = new AbortController()
    const end = new Date()

    setLoading(true)
    setError('')

    void callApi<PcmData>(
      'cmms.pcm_dashboard',
      {
        token: getGestorToken(),
        inicio_em: new Date(end.getTime() - Number(days) * 86400000).toISOString(),
        fim_em: end.toISOString(),
      },
      controller.signal,
    )
      .then(response => {
        if (!response.data) throw new Error('A API não retornou os indicadores do PCM.')
        if (!controller.signal.aborted) setData(response.data)
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) onSessionExpired()
        else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os indicadores.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [days, refresh, onSessionExpired])

  useEffect(() => {
    const controller = new AbortController()
    setNotificationsError('')
    void getGestorNotifications(controller.signal)
      .then(notifications => {
        const today = new Date().toDateString()
        setTodayNotifications(notifications.filter(notification => {
          const createdAt = notification.criado_em ? new Date(notification.criado_em) : null
          return createdAt && !Number.isNaN(createdAt.getTime()) && createdAt.toDateString() === today
        }))
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setNotificationsError('Não foi possível carregar as notificações de hoje.')
      })
    return () => controller.abort()
  }, [refresh, onSessionExpired])

  useEffect(() => {
    const controller = new AbortController()

    void listAdminEntity('ativos', controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setAssetCatalog(result.rows)
      })
      // A lista complementar não pode impedir a abertura do dashboard caso a
      // permissão de catálogo ainda não esteja habilitada para o perfil PCM.
      .catch(() => {
        if (!controller.signal.aborted) setAssetCatalog([])
      })

    return () => controller.abort()
  }, [refresh])


  useEffect(() => {
    const controller = new AbortController()
    setOrderLoading(true)
    setOrderError('')

    void listAdminInterventions(controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setOrders(result)
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) onSessionExpired()
        else setOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar as ordens.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrderLoading(false)
      })

    return () => controller.abort()
  }, [refresh, onSessionExpired])

  useEffect(() => {
    const controller = new AbortController()
    setPlansLoading(true)
    setPlansError('')

    void listAdminEntity('planos', controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setCreatePlans(result.rows)
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) onSessionExpired()
        else setPlansError(cause instanceof Error ? cause.message : 'Não foi possível carregar os planos preventivos.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlansLoading(false)
      })

    return () => controller.abort()
  }, [refresh, onSessionExpired])

  const operationalOrders = useMemo(
    () => orders.map(toOperationalOrder),
    [orders],
  )

  const activeCriticalOrders = useMemo(
    () => operationalOrders.filter(order =>
      !['CONCLUIDA', 'CONCLUÍDA', 'COMPLETED', 'CANCELLED', 'CANCELADA'].includes(normalize(order.status))
      && ['CRITICAL', 'CRITICA', 'CRÍTICA'].includes(normalize(order.priority)),
    ).length,
    [operationalOrders],
  )

  const orderFilterOptions = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return {
      status: unique(operationalOrders.map(item => humanStatus(item.status))),
      priority: unique(operationalOrders.map(item => humanPriority(item.priority))),
      sector: unique(operationalOrders.map(item => item.sector)),
      responsible: unique(operationalOrders.map(item => item.responsible)),
      type: unique(operationalOrders.map(item => humanWorkType(item.type))),
    }
  }, [operationalOrders])

  const filteredOperationalOrders = useMemo(
    () => operationalOrders.filter(item => {
      if (orderStatus && humanStatus(item.status) !== orderStatus) return false
      if (orderPriority && humanPriority(item.priority) !== orderPriority) return false
      if (orderSector && item.sector !== orderSector) return false
      if (orderResponsible && item.responsible !== orderResponsible) return false
      if (orderType && humanWorkType(item.type) !== orderType) return false
      return true
    }),
    [operationalOrders, orderStatus, orderPriority, orderSector, orderResponsible, orderType],
  )

  function openInsight(title: string, description: string, items: InsightItem[]) {
    setInsight({ title, description, items })
  }

  function orderInsightItems(items: OperationalOrder[]): InsightItem[] {
    return items.map(order => ({
      id: order.id,
      title: `${order.code} · ${order.equipment}`,
      detail: `${order.sector} · ${humanWorkType(order.type)} · responsável: ${order.responsible}`,
      status: humanStatus(order.status),
    }))
  }

  const dailyInsights = useMemo(() => {
    const now = Date.now()
    const isOpen = (order: OperationalOrder) => !['CONCLUIDA', 'COMPLETED', 'CANCELLED', 'CANCELADA'].includes(normalize(order.status))
    const openOrders = operationalOrders.filter(isOpen)
    const overdueOrders = openOrders.filter(order => Boolean(order.deadline) && new Date(order.deadline).getTime() < now)
    const stoppedAssets = data?.ativos_parados_lista ?? []
    const stoppedFromAssets = stoppedAssets.map(asset => ({
      id: asset.id,
      title: `${asset.ativo_tag || 'Sem TAG'} · ${asset.ativo_nome || 'Ativo sem nome'}`,
      detail: asset.setor_nome || 'Setor não informado',
      status: 'Parado',
    }))
    const stoppedFromCatalog = assetCatalog
      .filter(asset => ['STOPPED', 'PARADO', 'STOP'].includes(normalize(String(asset.status ?? asset.status_operacional ?? ''))))
      .map(asset => ({
        id: String(asset.id),
        title: `${String(asset.tag ?? asset.codigo ?? 'Sem TAG')} · ${String(asset.nome ?? asset.name ?? 'Ativo sem nome')}`,
        detail: String(asset.setor_nome ?? asset.setor ?? 'Setor não informado'),
        status: 'Parado',
      }))
    const stoppedFallback = openOrders
      .filter(order => ['CORRECTIVE', 'CORRETIVA'].includes(normalize(order.type)))
      .slice(0, data?.atual.ativos_parados ?? 0)
      .map(order => ({
        id: `order-${order.id}`,
        title: `${order.equipment || 'Ativo não informado'} · ${order.code}`,
        detail: `${order.sector || 'Setor não informado'} · OS corretiva aberta para acompanhamento`,
        status: 'Em acompanhamento',
      }))
    const preventiveFromApi = (data?.preventivas ?? []).map(order => ({
      id: order.id,
      title: `${order.codigo} · ${order.ativo_tag}`,
      detail: `Programada para ${formatDateTime(order.programada_para)}`,
      status: 'Preventiva',
    }))
    const preventiveFallback = openOrders
      .filter(order => ['PREVENTIVE', 'PREVENTIVA'].includes(normalize(order.type)))
      .filter(order => {
        const scheduledAt = order.deadline ? new Date(order.deadline).getTime() : Number.NaN
        return Number.isFinite(scheduledAt) && scheduledAt >= now && scheduledAt <= now + 7 * 86400000
      })
      .map(order => ({
        id: `order-${order.id}`,
        title: `${order.code} · ${order.equipment || 'Ativo não informado'}`,
        detail: `Programada para ${formatDateTime(order.deadline)}`,
        status: 'Preventiva',
      }))
    return {
      stopped: stoppedFromAssets.length ? stoppedFromAssets : stoppedFromCatalog.length ? stoppedFromCatalog : stoppedFallback,
      open: orderInsightItems(openOrders),
      critical: orderInsightItems(openOrders.filter(order => ['CRITICAL', 'CRITICA'].includes(normalize(order.priority)))),
      overdue: orderInsightItems(overdueOrders),
      preventive: preventiveFromApi.length ? preventiveFromApi : preventiveFallback,
      technicians: (data?.tecnicos ?? []).map(technician => ({ id: technician.id, title: technician.nome, detail: `${technician.execucoes} execução(ões) em andamento`, status: 'Em atividade' })),
    }
  }, [assetCatalog, data?.atual.ativos_parados, data?.ativos_parados_lista, data?.preventivas, data?.tecnicos, operationalOrders])

  const current = data?.atual
  const reliability = data?.confiabilidade
  const maintenanceStatus = useMemo(() => (data ? statusFrom(data) : null), [data])
  const monthlyMttr = useMemo<MonthlyMttrPoint[]>(() => (data?.relatorios?.mttr_mensal ?? data?.confiabilidade_mensal ?? []).map(item => {
    const [year, month] = item.mes.split('-').map(Number)
    const date = new Date(year, Math.max(0, month - 1), 1)
    return {
      month: item.mes,
      label: Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : item.mes,
      mttrSeconds: item.mttr_segundos,
    }
  }), [data?.confiabilidade_mensal, data?.relatorios?.mttr_mensal])

  const alerts = useMemo(() => {
    if (!data) return []

    const items: { level: 'danger' | 'warning' | 'info'; title: string; detail: string }[] = []

    if (activeCriticalOrders > 0) {
      items.push({
        level: 'danger',
        title: 'Ordens críticas abertas',
        detail: `${activeCriticalOrders} ${activeCriticalOrders === 1 ? 'ordem exige' : 'ordens exigem'} priorização imediata.`,
      })
    }

    if (data.atual.ativos_parados > 0) {
      items.push({
        level: 'danger',
        title: 'Equipamentos parados',
        detail: `${data.atual.ativos_parados} ${data.atual.ativos_parados === 1 ? 'ativo está' : 'ativos estão'} com parada aberta.`,
      })
    }

    if (data.atual.ordens_atrasadas > 0) {
      items.push({
        level: 'warning',
        title: 'Ordens atrasadas',
        detail: `${data.atual.ordens_atrasadas} ${data.atual.ordens_atrasadas === 1 ? 'ordem ultrapassou' : 'ordens ultrapassaram'} a programação.`,
      })
    }

    if (data.atual.ordens_sem_estimativa > 0) {
      items.push({
        level: 'warning',
        title: 'Backlog sem estimativa',
        detail: `${data.atual.ordens_sem_estimativa} ${data.atual.ordens_sem_estimativa === 1 ? 'ordem aberta ainda não possui' : 'ordens abertas ainda não possuem'} estimativa.`,
      })
    }

    if (data.confiabilidade.ativos_reincidentes > 0) {
      items.push({
        level: 'warning',
        title: 'Reincidência de falhas',
        detail: `${data.confiabilidade.ativos_reincidentes} ${data.confiabilidade.ativos_reincidentes === 1 ? 'equipamento apresentou' : 'equipamentos apresentaram'} nova falha no período.`,
      })
    }

    if (items.length === 0) {
      items.push({
        level: 'info',
        title: 'Nenhum alerta prioritário',
        detail: 'Os indicadores disponíveis não apontam condição crítica neste momento.',
      })
    }

    return items.slice(0, 5)
  }, [activeCriticalOrders, data])

  async function openOperationalOrder(order: OperationalOrder) {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setSelectedOrderLoading(true)
    setSelectedOrderError('')
    setSelectedOrder(null)
    setReleaseError('')
    setPrepareError('')
    try {
      const detail = await getAdminIntervention(order.raw.id)
      let actionDetail: GestorActionDetail | null = null
      if (detail.acao_id) {
        try { actionDetail = await getGestorActionDetail(detail.acao_id) } catch { /* A OS continua acessível mesmo sem histórico de execução. */ }
      }
      if (detailRequestRef.current === requestId) {
        setSelectedOrder(detail)
        setSelectedActionDetail(actionDetail)
      }
    } catch (cause) {
      if (detailRequestRef.current !== requestId) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setSelectedOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar a ordem de serviço.')
    } finally {
      if (detailRequestRef.current === requestId) setSelectedOrderLoading(false)
    }
  }

  function closeOperationalOrder() {
    detailRequestRef.current += 1
    setSelectedOrder(null)
    setSelectedActionDetail(null)
    setSelectedOrderError('')
    setSelectedOrderLoading(false)
    setReleaseError('')
    setPrepareError('')
  }
  const selectedOrderReadyForRelease = selectedOrder?.status === 'AGUARDANDO_LIBERACAO'
  const selectedOrderReadyForPreparation = selectedOrder !== null && ['RASCUNHO', 'DRAFT', 'DEVOLVIDO_CORRECAO', 'CHANGES_REQUESTED'].includes(normalize(selectedOrder.status))

  const scheduledPreventiveBatch = useMemo(
    () => orders.filter(order => normalize(order.origem) === 'PCM_PREVENTIVE_SCHEDULE' && order.titulo.startsWith('Preventiva programada ')),
    [orders],
  )

  const publishedPlans = useMemo(
    () => createPlans
      .filter(plan => {
        const versionStatus = normalize(recordText(plan.versao_status))
        const lifecycle = normalize(recordText(plan.status))
        return versionStatus === 'PUBLISHED'
          && ['ACTIVE', 'ATIVO'].includes(lifecycle)
          && Boolean(recordText(plan.versao_id))
          && Number(plan.plano_itens_count ?? 0) > 0
      })
      .map(plan => ({
        id: plan.id,
        versionId: recordText(plan.versao_id),
        code: recordText(plan.codigo) || plan.id.slice(0, 8).toLocaleUpperCase('pt-BR'),
        name: recordText(plan.nome) || 'Plano sem nome',
        asset: [recordText(plan.ativo_tag), recordText(plan.ativo_nome)].filter(Boolean).join(' · ') || 'Equipamento não informado',
        workType: recordText(plan.tipo) || 'PREVENTIVE',
        recurrenceDays: Number.isFinite(Number(plan.recorrencia_dias)) ? Number(plan.recorrencia_dias) : null,
      })),
    [createPlans],
  )

  const executablePlans = useMemo(
    () => publishedPlans.filter(plan => createOrderMode !== 'PREVENTIVE' || ['PREVENTIVE', 'PREVENTIVA'].includes(normalize(plan.workType))),
    [publishedPlans, createOrderMode],
  )

  const preventivePlans = useMemo(
    () => publishedPlans.filter(plan => ['PREVENTIVE', 'PREVENTIVA'].includes(normalize(plan.workType))),
    [publishedPlans],
  )

  const plansAwaitingOem = useMemo(
    () => createPlans.filter(plan => normalize(recordText(plan.versao_status)) === 'DRAFT').length,
    [createPlans],
  )

  const selectedCreatePlan = executablePlans.find(plan => plan.versionId === createPlanVersionId) ?? null

  function resetCreateOrderForm() {
    setCreatePlanVersionId('')
    setCreateTitle('')
    setCreateDescription('')
    setCreatePriority('MEDIUM')
    setCreateRequiresPostIntervention(false)
    setCreateScheduledFor('')
    setCreateOriginEntityId('')
    setCreateOriginAssetTag('')
    setCreateOrderError('')
  }

  async function openCreateOrder(mode: 'WORK_ORDER' | 'PREVENTIVE' = 'WORK_ORDER', notification?: GestorNotification) {
    resetCreateOrderForm()
    setCreateOrderMode(mode)
    setCreateOrderOpen(true)
    setCreateOrderError('')
    setCreateOrderSuccess('')
    if (notification) {
      const assetTag = notification.titulo.match(/—\s*([A-Za-z]+\d+)\b/u)?.[1] ?? ''
      const matchingPlan = assetTag
        ? executablePlans.find(plan => plan.asset.startsWith(`${assetTag} ·`))
        : null
      setCreateTitle(notification.titulo)
      setCreateDescription(notification.mensagem || `OS originada da notificação: ${notification.titulo}.`)
      setCreatePriority(normalize(notification.prioridade || 'MEDIUM'))
      setCreateOriginEntityId(notification.entidade_id || '')
      setCreateOriginAssetTag(assetTag)
      if (matchingPlan) setCreatePlanVersionId(matchingPlan.versionId)
      else setCreateOrderError(assetTag ? `Não há plano publicado com checklist para o ativo ${assetTag}.` : 'Não foi possível identificar o ativo da ocorrência.')
    }
    if (createPlans.length > 0) return
    setCreatePlansLoading(true)
    try {
      const result = await listAdminEntity('planos')
      setCreatePlans(result.rows)
    } catch (cause) {
      setCreateOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar os planos executáveis.')
    } finally {
      setCreatePlansLoading(false)
    }
  }

  function selectCreatePlan(versionId: string) {
    setCreatePlanVersionId(versionId)
    const plan = executablePlans.find(candidate => candidate.versionId === versionId)
    if (!plan || createOrderMode !== 'PREVENTIVE') return
    setCreateTitle(current => current || `Preventiva programada · ${plan.name}`)
    setCreateDescription(current => current || `Execução preventiva programada conforme o plano ${plan.code}.`)
  }

  async function createWorkOrder() {
    if (!selectedCreatePlan || createTitle.trim().length < 3 || createDescription.trim().length < 3) {
      setCreateOrderError('Selecione um plano e informe título e descrição com pelo menos 3 caracteres.')
      return
    }
    if (createOrderMode === 'PREVENTIVE' && !createScheduledFor) {
      setCreateOrderError('Informe a data e hora da preventiva programada.')
      return
    }
    setCreateOrderBusy(true)
    setCreateOrderError('')
    try {
      const releaseForMaintenance = Boolean(createOriginEntityId)
      const created = await saveAdminIntervention({
        origem: createOrderMode === 'PREVENTIVE' ? 'PCM_PREVENTIVE_SCHEDULE' : 'PCM',
        entidade_origem_id: createOriginEntityId || undefined,
        plano_versao_id: selectedCreatePlan.versionId,
        tipo: selectedCreatePlan.workType,
        titulo: createTitle.trim(),
        descricao: createDescription.trim(),
        prioridade: createPriority,
        modo_parada_manutencao: 'NO_STOP',
        planejada_para: createScheduledFor || undefined,
        exige_liberacao_pos_intervencao: createRequiresPostIntervention,
      })
      if (releaseForMaintenance) {
        await sendAdminInterventionForValidation({
          intervencao_id: created.id,
          politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
          comentario: 'OS criada pelo PCM a partir de uma ocorrência operacional.',
          exige_segregacao: 'NAO',
        })
        if (!createRequiresPostIntervention) await releaseMaintenanceWorkOrder(created.id)
      }
      setCreateOrderOpen(false)
      resetCreateOrderForm()
      setCreateOrderSuccess(releaseForMaintenance && !createRequiresPostIntervention
        ? `OS ${created.codigo} criada e liberada para a equipe de Manutenção. O primeiro técnico a iniciá-la será registrado como executor.`
        : releaseForMaintenance
          ? `OS ${created.codigo} criada com a confirmação pós-execução configurada. Ela seguirá a validação adicional antes da liberação.`
        : createOrderMode === 'PREVENTIVE'
        ? `Preventiva ${created.codigo} programada como rascunho. Prepare-a e libere-a para a equipe de Manutenção.`
        : `OS ${created.codigo} criada como rascunho. Prepare-a e libere-a para a equipe de Manutenção.`)
      reload()
    } catch (cause) {
      setCreateOrderError(cause instanceof Error ? cause.message : 'Não foi possível criar a ordem de serviço.')
    } finally {
      setCreateOrderBusy(false)
    }
  }

  async function schedulePreventivesForNext30Days() {
    const selectedPlans = preventivePlans.slice(0, 20)
    if (selectedPlans.length < 20) {
      setBatchSchedulingNotice('Não há 20 planos preventivos publicados disponíveis para o agendamento em lote.')
      return
    }

    setBatchSchedulingBusy(true)
    setBatchSchedulingNotice('')
    try {
      for (const [index, plan] of selectedPlans.entries()) {
        const scheduledAt = new Date()
        scheduledAt.setDate(scheduledAt.getDate() + 1 + Math.floor((index * 29) / 19))
        scheduledAt.setHours(9, 0, 0, 0)
        await saveAdminIntervention({
          origem: 'PCM_PREVENTIVE_SCHEDULE',
          plano_versao_id: plan.versionId,
          tipo: plan.workType,
          titulo: `Preventiva programada ${String(index + 1).padStart(2, '0')} de 20 · ${plan.name}`,
          descricao: `OS preventiva criada para o calendário operacional dos próximos 30 dias, conforme o plano ${plan.code}.`,
          prioridade: 'MEDIUM',
          modo_parada_manutencao: 'NO_STOP',
          planejada_para: scheduledAt.toISOString(),
        })
      }
      setBatchSchedulingNotice('20 OS preventivas foram programadas e distribuídas nos próximos 30 dias. Elas permanecem como rascunho até o preparo, a liberação e a atribuição da equipe.')
      reload()
    } catch (cause) {
      setBatchSchedulingNotice(cause instanceof Error ? cause.message : 'Não foi possível concluir o agendamento em lote.')
    } finally {
      setBatchSchedulingBusy(false)
    }
  }

  async function prepareAndAssignScheduledPreventives() {
    if (!scheduledPreventiveBatch.length) {
      setBatchSchedulingNotice('Ainda não há OS preventivas programadas em lote para preparar.')
      return
    }

    setBatchPreparationBusy(true)
    setBatchSchedulingNotice('Preparando as OS e consultando a equipe técnica ativa…')
    try {
      let prepared = 0
      let awaitingValidation = 0
      const failures: string[] = []

      for (const order of scheduledPreventiveBatch) {
        try {
          let detail = await getAdminIntervention(order.id)
          if (['RASCUNHO', 'DRAFT', 'DEVOLVIDO_CORRECAO', 'CHANGES_REQUESTED'].includes(normalize(detail.status))) {
            await sendAdminInterventionForValidation({
              intervencao_id: detail.id,
              politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
              comentario: 'Preparação em lote do calendário preventivo de 30 dias.',
              exige_segregacao: 'NAO',
            })
            prepared += 1
            detail = await getAdminIntervention(detail.id)
          }

          if (normalize(detail.status) === 'AGUARDANDO_LIBERACAO') {
            await releaseMaintenanceWorkOrder(detail.id)
            detail = await getAdminIntervention(detail.id)
          }

          if (normalize(detail.acao_status ?? '') !== 'READY' || !detail.acao_id) {
            awaitingValidation += 1
            continue
          }

        } catch (cause) {
          failures.push(`${order.codigo}: ${cause instanceof Error ? cause.message : 'erro ao preparar'}`)
        }
      }

      const parts = [
        `${prepared} preparada${prepared === 1 ? '' : 's'}`,
        'liberadas para a equipe de Manutenção',
      ]
      if (awaitingValidation) parts.push(`${awaitingValidation} aguardando validação`)
      if (failures.length) parts.push(`${failures.length} com pendência`)
      setBatchSchedulingNotice(`Calendário processado: ${parts.join(' · ')}. O técnico que iniciar a OS será registrado automaticamente como executor.${failures.length ? ` Primeiro erro: ${failures[0]}` : ''}`)
      reload()
    } catch (cause) {
      setBatchSchedulingNotice(cause instanceof Error ? cause.message : 'Não foi possível preparar o calendário preventivo.')
    } finally {
      setBatchPreparationBusy(false)
    }
  }

  async function releaseSelectedWorkOrder() {
    if (!selectedOrder || !selectedOrderReadyForRelease) return
    setReleaseBusy(true); setReleaseError(''); setAssignmentSuccess('')
    try {
      await releaseMaintenanceWorkOrder(selectedOrder.id)
      const detail = await getAdminIntervention(selectedOrder.id)
      setSelectedOrder(detail)
      setAssignmentSuccess('OS liberada com sucesso. Ela já está disponível para a equipe de Manutenção; o executor será registrado ao iniciar.')
      setRefresh(value => value + 1)
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : 'Não foi possível liberar a OS.')
    } finally { setReleaseBusy(false) }
  }

  async function prepareSelectedWorkOrder() {
    if (!selectedOrder || !selectedOrderReadyForPreparation) return
    setPrepareBusy(true)
    setPrepareError('')
    setAssignmentSuccess('')
    try {
      await sendAdminInterventionForValidation({
        intervencao_id: selectedOrder.id,
        politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
        comentario: '',
        exige_segregacao: 'NAO',
      })
      const detail = await getAdminIntervention(selectedOrder.id)
      setSelectedOrder(detail)
      setAssignmentSuccess(
        normalize(detail.acao_status ?? '') === 'READY'
          ? 'OS preparada e liberada. A ação está pronta para receber um técnico.'
          : 'OS enviada para a validação formal configurada.',
      )
      reload()
    } catch (cause) {
      setPrepareError(cause instanceof Error ? cause.message : 'Não foi possível preparar a ordem de serviço.')
    } finally {
      setPrepareBusy(false)
    }
  }


  return (
    <section className="pcm-dashboard" aria-label="Dashboard do PCM" aria-busy={loading}>
      <header className="pcm-heading">
        <div>
          <span className="eyebrow">PLANEJAMENTO E CONTROLE DA MANUTENÇÃO</span>
          <h1>Central PCM</h1>
          <p>Prioridades, equipe, backlog e confiabilidade em uma única visão.</p>
        </div>

        <div className="pcm-controls">
          <label>
            Histórico
            <select value={days} onChange={event => setDays(event.target.value)}>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Últimos 12 meses</option>
            </select>
          </label>
          <button type="button" disabled={loading} onClick={reload}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </header>

      <section className="pcm-today-notifications" aria-labelledby="pcm-today-notifications-title">
        <header>
          <div>
            <span className="pcm-section-kicker">PRIMEIRA PRIORIDADE</span>
            <h2 id="pcm-today-notifications-title">Notificações de hoje</h2>
          </div>
          <span>{pendingTodayNotifications.length}</span>
        </header>
        {notificationsError ? <p className="pcm-today-notifications__error" role="alert">{notificationsError}</p> : null}
        {pendingTodayNotifications.length ? (
          <ul>
            {pendingTodayNotifications.slice(0, 5).map(notification => (
              <li key={notification.id} className={`is-${normalize(notification.prioridade || 'MEDIA').toLowerCase()}`}>
                <button type="button" onClick={() => void openCreateOrder('WORK_ORDER', notification)}>
                  <div>
                    <strong>{notification.titulo}</strong>
                    <span>{notification.mensagem || 'Nova atualização operacional requer atenção do PCM.'}</span>
                    <em>Criar OS e direcionar técnico →</em>
                  </div>
                  <small>{humanPriority(notification.prioridade || 'MEDIA')}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="pcm-empty">Nenhuma notificação recebida hoje.</p>}
      </section>

    {error && (
        <div className="dashboard-error" role="alert">
          {error}
          {data && ' Os dados abaixo são da última atualização bem-sucedida.'}
        </div>
    )}
    {assignmentSuccess ? <div className="pcm-assignment-success" role="status">{assignmentSuccess}</div> : null}
    {createOrderSuccess ? <div className="pcm-assignment-success" role="status">{createOrderSuccess}</div> : null}

      {!data && loading && (
        <div className="pcm-loading" role="status">
          <span className="pcm-loading__dot" />
          Consultando ordens, paradas e execuções…
        </div>
      )}

      {data && current && reliability && maintenanceStatus && (
        <>
          {activeCriticalOrders > 0 ? (
            <button
              className="pcm-critical-action"
              type="button"
              onClick={showCriticalOrders}
              aria-label="Ver ordens de serviço críticas"
            >
              <span className="pcm-critical-action__icon" aria-hidden="true">!</span>
              <span className="pcm-critical-action__content">
                <strong>Ver manutenções críticas</strong>
                <small>{activeCriticalOrders} {activeCriticalOrders === 1 ? 'ordem crítica aguardando' : 'ordens críticas aguardando'} atenção</small>
              </span>
              <span className="pcm-critical-action__arrow" aria-hidden="true">Ver fila →</span>
            </button>
          ) : null}

          <div className="pcm-section-heading">
            <div>
              <span className="pcm-section-kicker">VISÃO DO DIA</span>
              <h2>O que precisa de atenção</h2>
            </div>
          </div>

          <div className="pcm-metrics pcm-metrics--current">
            <Metric
              label="Ativos parados"
              value={current.ativos_parados}
              note="Equipamentos ativos com parada aberta"
              tone={current.ativos_parados > 0 ? 'danger' : 'success'}
              onClick={() => openInsight('Ativos parados', 'Equipamentos que exigem acompanhamento operacional.', dailyInsights.stopped)}
            />
            <Metric
              label="Ordens abertas"
              value={current.ordens_abertas}
              note="Todas as ordens ainda não encerradas"
              onClick={() => openInsight('Ordens abertas', 'Ordens de serviço que permanecem abertas ou em execução.', dailyInsights.open)}
            />
              <Metric
              label="Ordens críticas"
              value={activeCriticalOrders}
              note="Prioridade crítica ainda em aberto"
              tone={activeCriticalOrders > 0 ? 'danger' : 'success'}
              onClick={() => openInsight('Ordens críticas', 'Ordens abertas com prioridade crítica.', dailyInsights.critical)}
            />
            <Metric
              label="Ordens atrasadas"
              value={current.ordens_atrasadas}
              note="Programação vencida"
              tone={current.ordens_atrasadas > 0 ? 'warning' : 'success'}
              onClick={() => openInsight('Ordens atrasadas', 'Ordens abertas com programação vencida.', dailyInsights.overdue)}
            />
            <Metric
              label="Preventivas próximas"
              value={current.preventivas_proximas}
              note="Programadas para os próximos 7 dias"
              onClick={() => openInsight('Preventivas próximas', 'Preventivas abertas programadas para os próximos 7 dias.', dailyInsights.preventive)}
            />
            <Metric
              label="Técnicos em atividade"
              value={current.tecnicos_em_atividade}
              note="Pessoas distintas com execução ativa"
              onClick={() => openInsight('Técnicos em atividade', 'Técnicos com execução em andamento neste momento.', dailyInsights.technicians)}
            />
          </div>

          <div className="pcm-section-heading">
            <div>
              <span className="pcm-section-kicker">INDICADORES</span>
              <h2>Confiabilidade · últimos {days} dias</h2>
            </div>
          </div>

          <div className="pcm-reliability-charts">
            <ReliabilityBarChart
              title="MTTR × MTBF"
              description="Comparação direta dos tempos reais do período"
              items={[
                {
                  label: 'MTTR',
                  value: reliability.mttr_segundos,
                  displayValue: duration(reliability.mttr_segundos),
                  detail: 'Tempo médio para restaurar',
                },
                {
                  label: 'MTBF',
                  value: reliability.mtbf_segundos,
                  displayValue: duration(reliability.mtbf_segundos),
                  detail: 'Tempo médio entre falhas',
                },
              ]}
            />
            <MonthlyMttrChart items={monthlyMttr} loading={loading} />
            <PercentageChart
              title="Disponibilidade"
              description="Percentual de tempo operacional dos ativos"
              percentage={reliability.disponibilidade_percentual}
              detail={`${reliability.ativos_considerados} ativos considerados no cálculo`}
            />
            <BacklogChart
              hours={current.backlog_horas_estimadas}
              openOrders={current.ordens_abertas}
              withoutEstimate={current.ordens_sem_estimativa}
            />
          </div>

          <div className="pcm-metrics pcm-metrics--secondary">
            <Metric
              label="Falhas"
              value={reliability.falhas}
              note="Falhas consideradas no período selecionado"
            />
            <Metric
              label="Reincidências"
              value={reliability.reincidencias}
              note={`Em ${reliability.ativos_reincidentes} ${reliability.ativos_reincidentes === 1 ? 'equipamento' : 'equipamentos'}`}
              tone={reliability.reincidencias > 0 ? 'warning' : 'success'}
            />
          </div>

          {data.relatorios ? <PcmReports report={data.relatorios} onExport={exportPcmReport} onPrint={printPcmReport} /> : null}


          <section className="pcm-panel pcm-orders" id="pcm-operational-queue">
            <div className="pcm-panel__heading pcm-orders__heading">
              <div>
                <span className="pcm-section-kicker">ORDENS DE SERVIÇO</span>
                <h2>Fila operacional</h2>
              </div>
              <div className="pcm-orders__heading-actions">
                <button type="button" className="pcm-orders__export" onClick={exportOperationalQueue} disabled={!filteredOperationalOrders.length}>Exportar CSV</button>
                <span className="pcm-orders__count">
                  {filteredOperationalOrders.length} de {operationalOrders.length}
                </span>
              </div>
            </div>

            <div className="pcm-order-filters" aria-label="Filtros das ordens de serviço">
              <SelectFilter label="Status" value={orderStatus} values={orderFilterOptions.status} onChange={setOrderStatus} />
              <SelectFilter label="Prioridade" value={orderPriority} values={orderFilterOptions.priority} onChange={setOrderPriority} />
              <SelectFilter label="Setor" value={orderSector} values={orderFilterOptions.sector} onChange={setOrderSector} />
              <SelectFilter label="Responsável" value={orderResponsible} values={orderFilterOptions.responsible} onChange={setOrderResponsible} />
              <SelectFilter label="Tipo" value={orderType} values={orderFilterOptions.type} onChange={setOrderType} />
              {(orderStatus || orderPriority || orderSector || orderResponsible || orderType) && (
                <button
                  className="pcm-order-filters__clear"
                  type="button"
                  onClick={() => {
                    setOrderStatus('')
                    setOrderPriority('')
                    setOrderSector('')
                    setOrderResponsible('')
                    setOrderType('')
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {orderError && <div className="dashboard-error" role="alert">{orderError}</div>}

            {orderLoading ? (
              <div className="pcm-loading" role="status">
                <span className="pcm-loading__dot" />
                Carregando ordens de serviço…
              </div>
            ) : operationalOrders.length === 0 ? (
              <EmptyState>Nenhuma ordem aberta encontrada.</EmptyState>
            ) : filteredOperationalOrders.length === 0 ? (
              <EmptyState>Nenhuma ordem corresponde aos filtros selecionados.</EmptyState>
            ) : (
              <div className="pcm-orders__table-wrap">
                <table className="pcm-orders__table">
                  <thead>
                    <tr>
                      <th>OS</th>
                      <th>Equipamento</th>
                      <th>Setor</th>
                      <th>Tipo</th>
                      <th>Prioridade</th>
                      <th>Responsável</th>
                      <th>Status</th>
                      <th>Prazo</th>
                      <th>Tempo em aberto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOperationalOrders.map(item => {
                      const window = scheduleWindow(item.deadline, item.status)
                      return <tr key={item.id}>
                        <td><button type="button" className="pcm-order-link" onClick={() => void openOperationalOrder(item)}>{item.code}</button></td>
                        <td>{item.equipment}</td>
                        <td>{item.sector}</td>
                        <td>{humanWorkType(item.type)}</td>
                        <td>
                          <span className={`pcm-order-badge pcm-order-badge--priority-${normalize(item.priority).replaceAll(' ', '-')} `}>
                            {humanPriority(item.priority)}
                          </span>
                        </td>
                        <td>{item.responsible}</td>
                        <td>
                          <span className="pcm-order-badge">
                            {humanStatus(item.status)}
                          </span>
                        </td>
                        <td>{item.deadline ? <div className="pcm-order-schedule"><span>{formatDateTime(item.deadline)}</span>{window ? <small className={`pcm-schedule-indicator pcm-schedule-indicator--${window.tone}`}>{window.label}</small> : null}</div> : 'Não informado'}</td>
                        <td>{isClosedWorkOrder(item.status) ? 'Encerrada' : elapsed(item.openedAt)}</td>
                      </tr>
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {(selectedOrderLoading || selectedOrderError || selectedOrder) && (
            <section className="pcm-panel pcm-order-detail" aria-busy={selectedOrderLoading} aria-live="polite">
              <div className="pcm-panel__heading pcm-order-detail__heading">
                <div>
                  <span className="pcm-section-kicker">ORDEM DE SERVIÇO</span>
                  <h2>{selectedOrder?.codigo || 'Detalhes da ordem'}</h2>
                </div>
                <button type="button" className="pcm-order-detail__close" onClick={closeOperationalOrder}>
                  Fechar
                </button>
              </div>
              {selectedOrderLoading ? (
                <div className="pcm-order-detail__loading" role="status">
                  <span className="pcm-loading__dot" />
                  Carregando ordem de serviço…
                </div>
              ) : selectedOrderError ? (
                <p className="pcm-order-detail__error" role="alert">{selectedOrderError}</p>
              ) : selectedOrder ? (
                <>
                  <dl className="pcm-order-detail__facts">
                    <div className="pcm-order-detail__fact">
                      <dt>Status</dt>
                      <dd>{humanStatus(selectedOrder.status)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Prioridade</dt>
                      <dd>{humanPriority(selectedOrder.prioridade)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Tipo</dt>
                      <dd>{humanWorkType(selectedOrder.tipo)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact pcm-order-detail__fact--wide">
                      <dt>Equipamento</dt>
                      <dd>{[selectedOrder.ativo_tag, selectedOrder.ativo_nome].filter(Boolean).join(' · ') || 'Não informado'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Setor</dt>
                      <dd>{selectedOrder.setor_nome || 'Não informado'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Responsável</dt>
                      <dd>{selectedOrder.responsavel_nome || 'Não atribuído'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Programada para</dt>
                      <dd>{selectedOrder.planejada_para ? formatDateTime(selectedOrder.planejada_para) : 'Não informado'}</dd>
                    </div>
                  </dl>
                  <div className="pcm-order-detail__content">
                    <section>
                      <h3>Título</h3>
                      <p>{selectedOrder.titulo || 'Não informado'}</p>
                    </section>
                    <section>
                      <h3>Descrição</h3>
                      <p>{selectedOrder.descricao || 'Sem descrição.'}</p>
                    </section>
                  </div>
                  {selectedActionDetail?.materiais?.length ? <section className="pcm-order-assignment"><h3>Materiais e custo da OS</h3><p>Saídas registradas pelo técnico. Os valores são preservados como histórico da execução.</p><ul>{selectedActionDetail.materiais.map((material, index) => { const data = material as Record<string, unknown>; const quantity = Number(data.quantidade ?? 0); const unitCost = Number(data.valor_unitario ?? 0); const total = Number(data.custo_total ?? 0); const name = String(data.nome_facil ?? data.nome ?? 'Material'); return <li key={String(data.id ?? index)}><strong>{String(data.sku ?? 'Sem SKU')} · {name}</strong><span> — {quantity} {String(data.unidade ?? '')} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitCost)} cada · total {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}</span></li> })}</ul></section> : null}
                  {selectedOrderReadyForPreparation ? <section className="pcm-order-assignment">
                    <h3>Preparar para execução</h3>
                    <p>Para uma OS normal, este passo libera a ação para toda a equipe de Manutenção. Se houver confirmação pós-execução configurada, ela será solicitada somente depois da conclusão técnica.</p>
                    <button type="button" onClick={() => void prepareSelectedWorkOrder()} disabled={prepareBusy}>
                      {prepareBusy ? 'Preparando…' : 'Preparar e liberar OS'}
                    </button>
                    {prepareError ? <p className="pcm-order-detail__error" role="alert">{prepareError}</p> : null}
                  </section> : null}
                  {selectedOrderReadyForRelease ? <section className="pcm-order-assignment">
                    <h3>Liberar para execução</h3>
                    <p>Confirme a liberação da OS tecnicamente aprovada. A ação operacional será criada como pronta.</p>
                    <button type="button" onClick={() => void releaseSelectedWorkOrder()} disabled={releaseBusy}>
                      {releaseBusy ? 'Liberando…' : 'Liberar OS'}
                    </button>
                    {releaseError ? <p className="pcm-order-detail__error" role="alert">{releaseError}</p> : null}
                  </section> : null}
                  {selectedOrder.acao_id && normalize(selectedOrder.acao_status ?? '') === 'READY' ? <section className="pcm-order-assignment">
                    <h3>Disponível para execução</h3>
                    <p>A OS está liberada para a equipe de Manutenção. O sistema registra automaticamente o técnico que iniciar a execução.</p>
                  </section> : null}
                </>
              ) : null}
            </section>
          )}

      <section className="pcm-panel pcm-plans-overview" aria-labelledby="pcm-plans-title">
        <div className="pcm-panel__heading">
          <div>
            <span className="pcm-section-kicker">PLANEJAMENTO PREVENTIVO</span>
            <h2 id="pcm-plans-title">Planos cadastrados</h2>
          </div>
          <div className="pcm-plans-overview__actions">
            <button type="button" onClick={() => void openCreateOrder('PREVENTIVE')} disabled={plansLoading || preventivePlans.length === 0}>Programar preventiva</button>
            <button type="button" onClick={() => void schedulePreventivesForNext30Days()} disabled={plansLoading || batchSchedulingBusy || preventivePlans.length < 20}>{batchSchedulingBusy ? 'Programando 20 OS…' : 'Programar 20 · 30 dias'}</button>
            <button type="button" onClick={() => void prepareAndAssignScheduledPreventives()} disabled={batchPreparationBusy || scheduledPreventiveBatch.length === 0}>{batchPreparationBusy ? 'Preparando calendário…' : `Preparar e liberar ${scheduledPreventiveBatch.length || ''}`}</button>
          </div>
        </div>
        {plansLoading ? <p className="pcm-empty">Carregando planos preventivos…</p> : plansError ? <p className="pcm-order-detail__error" role="alert">{plansError}</p> : <>
          <div className="pcm-plans-overview__metrics">
            <div><strong>{publishedPlans.length}</strong><span>publicados e prontos</span></div>
            <div><strong>{plansAwaitingOem}</strong><span>aguardando validação OEM</span></div>
            <div><strong>{publishedPlans.filter(plan => plan.recurrenceDays !== null).length}</strong><span>com periodicidade definida</span></div>
          </div>
          {batchSchedulingNotice ? <p className="pcm-plans-overview__notice" role="status">{batchSchedulingNotice}</p> : null}
          {publishedPlans.length ? <div className="pcm-plans-overview__list">
            {publishedPlans.slice(0, 6).map(plan => <article key={plan.versionId}>
              <strong>{plan.code}</strong>
              <span>{plan.name}</span>
              <small>{plan.asset}{plan.recurrenceDays ? ` · a cada ${plan.recurrenceDays} dias` : ' · agendamento manual'}</small>
            </article>)}
          </div> : <p className="pcm-empty">Nenhum plano preventivo publicado está disponível.</p>}
        </>}
      </section>

      <div className="pcm-grid-main">
            <section className="pcm-panel pcm-alerts">
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ALERTAS</span>
                  <h2>Prioridades operacionais</h2>
                </div>
              </div>
              <div className="pcm-alert-list">
                {alerts.map((alert, index) => (
                  <article className={`pcm-alert pcm-alert--${alert.level}`} key={`${alert.title}-${index}`}>
                    <span className="pcm-alert__marker" aria-hidden="true" />
                    <div>
                      <strong>{alert.title}</strong>
                      <p>{alert.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="pcm-panel pcm-actions">
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ATALHOS</span>
                  <h2>Ações rápidas</h2>
                </div>
              </div>
              <div className="pcm-action-grid">
                <button type="button" onClick={() => void openCreateOrder()}>
                  <span>Criar OS</span>
                  <small>Abra uma nova ordem a partir de um plano publicado</small>
                </button>
                <button type="button" onClick={() => void openCreateOrder('PREVENTIVE')}>
                  <span>Programar preventiva</span>
                  <small>Agende uma preventiva usando um plano ativo</small>
                </button>
                <button type="button" onClick={showOperationalQueue}>
                  <span>Ver fila de OS</span>
                  <small>Consulte e filtre todas as ordens de serviço</small>
                </button>
                <button type="button" onClick={reload} disabled={loading}>
                  <span>Atualizar painel</span>
                  <small>{loading ? 'Atualizando indicadores…' : 'Recarregue indicadores e ordens agora'}</small>
                </button>
              </div>
            </section>
          </div>
          {createOrderOpen ? <div className="pcm-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="pcm-create-order-title">
            <div className="pcm-assignment-modal__card pcm-create-order-modal">
              <h2 id="pcm-create-order-title">{createOrderMode === 'PREVENTIVE' ? 'Programar preventiva' : 'Criar ordem de serviço'}</h2>
              <p>{createOriginEntityId ? 'A demanda já definiu o ativo e o plano de execução. Revise as informações e crie a OS.' : createOrderMode === 'PREVENTIVE' ? 'Escolha um plano preventivo publicado e informe quando a OS deve ser executada.' : 'Selecione um plano publicado. O equipamento e o tipo de manutenção são definidos pelo plano.'}</p>
              {createOriginEntityId ? (
                <div className="pcm-create-order-modal__origin">
                  <span>DEMANDA DE ORIGEM</span>
                  <strong>{createOriginAssetTag || 'Ativo informado na ocorrência'}</strong>
                  <small>{selectedCreatePlan ? `${selectedCreatePlan.code} · ${selectedCreatePlan.name}` : 'Plano executável não localizado.'}</small>
                </div>
              ) : <label>Plano e equipamento
                <select value={createPlanVersionId} onChange={event => selectCreatePlan(event.target.value)} disabled={createOrderBusy || createPlansLoading}>
                  <option value="">{createPlansLoading ? 'Carregando planos…' : createOrderMode === 'PREVENTIVE' ? 'Selecione um plano preventivo' : 'Selecione um plano publicado'}</option>
                  {executablePlans.map(plan => <option key={plan.versionId} value={plan.versionId}>{plan.code} · {plan.name} · {plan.asset}</option>)}
                </select>
              </label>}
              {selectedCreatePlan ? <p className="pcm-create-order-modal__context">Equipamento: <strong>{selectedCreatePlan.asset}</strong> · Tipo: <strong>{humanWorkType(selectedCreatePlan.workType)}</strong>{createOrderMode === 'PREVENTIVE' && selectedCreatePlan.recurrenceDays ? <> · Recorrência: <strong>{selectedCreatePlan.recurrenceDays} dias</strong></> : null}</p> : null}
              {!createPlansLoading && createPlans.length > 0 && executablePlans.length === 0 ? <p className="pcm-order-detail__error">{createOrderMode === 'PREVENTIVE' ? 'Não há plano preventivo ativo e publicado com checklist disponível.' : 'Não há plano ativo e publicado com checklist disponível.'}</p> : null}
              <label>Título<input value={createTitle} onChange={event => setCreateTitle(event.target.value)} maxLength={240} disabled={createOrderBusy} /></label>
              <label>Descrição<textarea value={createDescription} onChange={event => setCreateDescription(event.target.value)} maxLength={8000} rows={4} disabled={createOrderBusy} /></label>
              <label>Prioridade
                <select value={createPriority} onChange={event => setCreatePriority(event.target.value)} disabled={createOrderBusy}>
                  <option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option>
                </select>
              </label>
              <label className="pcm-create-order-modal__post-intervention"><input type="checkbox" checked={createRequiresPostIntervention} onChange={event => setCreateRequiresPostIntervention(event.target.checked)} disabled={createOrderBusy} />
                <span><strong>Exige confirmação pós-execução de Qualidade ou Segurança?</strong><small>Não bloqueia a execução. Após a conclusão técnica, uma dessas áreas confirma que a OS foi executada corretamente antes do encerramento oficial.</small></span>
              </label>
              <label>Programada para{createOrderMode === 'PREVENTIVE' ? '' : ' (opcional)'}<input type="datetime-local" value={createScheduledFor} onChange={event => setCreateScheduledFor(event.target.value)} disabled={createOrderBusy} required={createOrderMode === 'PREVENTIVE'} /></label>
              {createOrderError ? <p className="pcm-order-detail__error" role="alert">{createOrderError}</p> : null}
              <div><button type="button" onClick={() => { setCreateOrderOpen(false); resetCreateOrderForm() }} disabled={createOrderBusy}>Cancelar</button><button type="button" onClick={() => void createWorkOrder()} disabled={createOrderBusy || createPlansLoading || !selectedCreatePlan}>{createOrderBusy ? 'Criando…' : createOrderMode === 'PREVENTIVE' ? 'Programar preventiva' : 'Criar OS'}</button></div>
            </div>
          </div> : null}

          <div className="pcm-tables">
            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">SETOR</span>
                  <h2>Falhas por setor</h2>
                </div>
              </div>
              <HorizontalBarChart
                valueLabel="Falhas por setor"
                emptyMessage="Nenhuma falha registrada no período."
                items={data.falhas_por_setor.map(row => ({ id: row.setor_id, label: row.setor_nome, value: row.falhas }))}
              />
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ATIVOS</span>
                  <h2>Falhas por equipamento</h2>
                </div>
              </div>
              <HorizontalBarChart
                valueLabel="Falhas por equipamento"
                emptyMessage="Nenhuma falha registrada no período."
                items={data.falhas_por_ativo.map(row => ({ id: row.ativo_id, label: `${row.ativo_tag} · ${row.ativo_nome}`, detail: row.setor_nome, value: row.falhas }))}
              />
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">PLANEJAMENTO</span>
                  <h2>Próximas preventivas</h2>
                </div>
              </div>
              {data.preventivas.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Ordem / equipamento</th>
                      <th>Programação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.preventivas.map(row => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.codigo}</strong>
                          <small>{row.ativo_tag}</small>
                        </td>
                        <td>{new Date(row.programada_para).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>Nenhuma preventiva programada para os próximos 7 dias.</EmptyState>
              )}
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">EQUIPE</span>
                  <h2>Técnicos em execução</h2>
                </div>
              </div>
              <HorizontalBarChart
                valueLabel="Execuções por técnico"
                emptyMessage="Nenhum técnico com execução em andamento."
                items={data.tecnicos.map(row => ({ id: row.id, label: row.nome, value: row.execucoes }))}
              />
            </section>
          </div>

          <details className="pcm-method">
            <summary>Como os indicadores são calculados</summary>
            <p>
              Os totais atuais incluem todos os registros abertos dos ativos ativos. O período selecionado
              filtra somente a confiabilidade e as falhas. As listas mostram até 10 registros; os totais não
              são limitados.
            </p>
            <p>
              Falhas são paradas não planejadas ou originadas por alerta técnico que começaram no período.
              Reincidência significa uma nova falha no mesmo equipamento, sem afirmar que a causa é a mesma.
            </p>
            <p>
              A disponibilidade desconta todas as paradas registradas, unindo intervalos sobrepostos. A base
              é o calendário contínuo dos ativos atualmente ativos, sem calendário de turnos. MTTR usa falhas
              concluídas até o fim do período; MTBF divide o tempo disponível acumulado pelo número de falhas.
              Sem falhas, os tempos ficam sem amostra.
            </p>
            <p>
              O backlog soma a duração estimada dos planos de todas as ordens abertas. Não desconta avanço
              parcial e não representa horas-homem.
            </p>
          </details>
        </>
      )}
      <InsightDialog insight={insight} onClose={() => setInsight(null)} />
    </section>
  )
}
