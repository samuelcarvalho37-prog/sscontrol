import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CalendarCheck2, ChartNoAxesCombined, CirclePause, ClipboardList, ClockAlert, Download, FileQuestionMark, Printer, Repeat2, Siren, TimerReset, TriangleAlert, UsersRound, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { callApi } from '../services/api/client'
import { getGestorToken } from '../services/api/config'
import { getGestorActionDetail, getGestorNotifications, isGestorAuthenticationError } from '../services/api/gestor'
import { createExternalService, getAdminIntervention, listAdminInterventions, listImprovementRequests, saveAdminIntervention, sendAdminInterventionForValidation, updateMaterialUsageCost } from '../services/api/interventions'
import type { ImprovementRequestSummary } from '../services/api/interventions'
import { releaseMaintenanceWorkOrder } from '../services/api/maintenanceAssignments'
import { PcmPartShortagesPanel } from './PcmPartShortagesPanel'
import { PcmDashboardCanvas } from './PcmDashboardCanvas'
import type { PcmCanvasCategory, PcmCanvasMode, PcmCanvasPalette, PcmCanvasSegmentFilter, PcmCanvasSegments, PcmCanvasWidget } from './PcmDashboardCanvas'
import type { AdminIntervention } from '../types/interventions'
import { listAdminEntity } from '../services/api/catalog'
import type { AdminEntityRecord } from '../types/catalog'
import type { GestorActionDetail, GestorNotification } from '../types/gestor'
import { createPcmOccurrenceAssetResolver, pcmOccurrenceNotificationAction } from './pcmOccurrenceAssetResolver'
import { createPcmDemoSnapshot } from './pcmDashboardDemo'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { assertWorkOrderDetailMatchesSelection, createWorkOrderDetailRequestGate, focusWorkOrderDetail, loadOperationalWorkOrder, workOrderDetailHeadingCode } from './workOrderDetailNavigation'
import {
  postInterventionPolicyLabel,
  postInterventionPolicySelectionError,
  selectedPostInterventionPolicy,
} from './postInterventionPolicy'
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
    motivo_parada?: string
    parada_iniciada_em?: string | null
    parada_status?: string | null
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
    custos_materiais?: {
      total?: number | string
      itens_consumidos?: number
      ordens_com_consumo?: number
      por_ativo?: { ativo_tag: string; ativo_nome: string; custo_total: number | string; itens_consumidos: number }[]
    }
    estoque_baixo?: {
      quantidade?: number
      itens?: { sku: string; nome: string; unidade: string; estoque_atual: number | string; estoque_minimo: number | string; valor_unitario: number | string }[]
    }
    tecnicos?: { id: string; nome: string; execucoes: number; segundos_apontados: number }[]
    execucoes_detalhadas?: {
      id: string
      tecnico_nome: string
      ordem_codigo: string
      titulo: string
      ativo_tag: string
      iniciada_em: string
      concluida_em: string
      duracao_segundos: number
      segundos_pausados: number
      custo_materiais_total: number | string
      itens_materiais: number
    }[]
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

function formatCurrency(value: number | string | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0))
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
  icon,
  onClick,
}: {
  label: string
  value: string | number
  note: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
  icon?: LucideIcon
  onClick?: () => void
}) {
  const Icon = icon
  const content = <><span className="pcm-metric__topline">{Icon ? <span className="pcm-metric__icon" aria-hidden="true"><Icon size={15} strokeWidth={1.8} /></span> : null}{label ? <span className="pcm-metric__label pcm-context-help" title={note}>{label}</span> : null}</span><strong>{value}</strong>{onClick ? <span className="pcm-metric__action" aria-hidden="true">›</span> : null}</>
  if (onClick) return <button type="button" className={`pcm-metric pcm-metric--${tone} pcm-metric--interactive`} onClick={onClick}>{content}</button>
  return (
    <article className={`pcm-metric pcm-metric--${tone}`}>
      {content}
    </article>
  )
}

function pcmNumberWidget({ id, title, categoryId, value, note, icon, tone = 'default', onClick, segmentValue }: {
  id: string
  title: string
  categoryId: string
  value: string | number
  note: string
  icon?: LucideIcon
  tone?: 'default' | 'warning' | 'danger' | 'success'
  onClick?: () => void
  segmentValue?: (segments: PcmCanvasSegments) => string | number
}): PcmCanvasWidget {
  return {
    id,
    title,
    categoryId,
    note,
    modes: [{ id: 'number', label: 'Número' }],
    defaultMode: 'number',
    render: (_mode, _palette, segments) => <Metric label="" value={segmentValue?.(segments ?? {}) ?? value} note={note} icon={icon} tone={tone} onClick={onClick} />,
  }
}

const pcmCanvasCategories: PcmCanvasCategory[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'operational', label: 'Carga operacional' },
  { id: 'reliability', label: 'Confiabilidade' },
  { id: 'time', label: 'Indicadores de tempo' },
  { id: 'comparison', label: 'Comparação' },
  { id: 'orders', label: 'Ordens e fila' },
  { id: 'planning', label: 'Planejamento' },
  { id: 'team', label: 'Equipe técnica' },
  { id: 'assets', label: 'Ativos e setores' },
  { id: 'stock', label: 'Estoque e custos' },
  { id: 'results', label: 'Resultados do período' },
]

interface InsightItem { id: string; title: string; detail: string; status?: string }

function InsightWorkspace({ insight, onClose, onSelect }: { insight: { title: string; description: string; items: InsightItem[] } | null; onClose: () => void; onSelect: (item: InsightItem) => void }) {
  if (!insight) return null
  return <section className="pcm-focus-workspace" aria-labelledby="pcm-insight-title" aria-live="polite">
      <header><button type="button" className="pcm-focus-workspace__back" onClick={onClose}>← Painel</button><div><span className="pcm-section-kicker">CONSULTA OPERACIONAL</span><h2 id="pcm-insight-title">{insight.title}</h2><p>{insight.description}</p></div><span className="pcm-focus-workspace__count">{insight.items.length} registro(s)</span></header>
      {insight.items.length ? <ul>{insight.items.map(item => <li key={item.id}><button type="button" onClick={() => onSelect(item)}><div><strong>{item.title}</strong><span>{item.detail}</span></div>{item.status ? <small>{item.status}</small> : null}</button></li>)}</ul> : <p className="pcm-empty">Nenhum registro disponível neste momento.</p>}
    </section>
}

function EmptyState({ children }: { children: string }) {
  return <p className="pcm-empty">{children}</p>
}

function HorizontalBarChart({
  items,
  emptyMessage,
  valueLabel,
  palette,
}: {
  items: ReadonlyArray<{ id: string; label: string; detail?: string; value: number }>
  emptyMessage: string
  valueLabel: string
  palette?: PcmCanvasPalette
}) {
  const maxValue = Math.max(...items.map(item => item.value), 1)
  if (items.length === 0) return <EmptyState>{emptyMessage}</EmptyState>

  return <div className="pcm-bar-chart" role="img" aria-label={`${valueLabel}: ${items.map(item => `${item.label}, ${item.value}`).join('; ')}`}>
    {items.map(item => <div className="pcm-bar-chart__row" key={item.id}>
      <div className="pcm-bar-chart__label"><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</div>
      <div className="pcm-bar-chart__track"><span style={{ width: `${Math.max(8, (item.value / maxValue) * 100)}%`, background: palette?.[0] ?? '#176fc1' }} /></div>
      <strong className="pcm-bar-chart__value">{item.value}</strong>
    </div>)}
  </div>
}

function PcmPieChart({ items, emptyMessage, valueLabel, palette }: {
  items: ReadonlyArray<{ id: string; label: string; value: number }>
  emptyMessage: string
  valueLabel: string
  palette?: PcmCanvasPalette
}) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const positiveItems = items.filter(item => item.value > 0)
  const colors = palette ?? ['#176fc1', '#63a2df', '#a9cbea', '#0b4b84', '#82b7dc', '#416d98']
  const visibleItems = positiveItems.filter(item => !hiddenIds.includes(item.id))
  const total = visibleItems.reduce((sum, item) => sum + item.value, 0)
  let offset = -90
  const slices = visibleItems.map(item => {
    const index = positiveItems.findIndex(candidate => candidate.id === item.id)
    const start = offset
    offset += item.value / Math.max(total, 1) * 360
    return { ...item, color: colors[index % colors.length], start, end: offset, percentage: item.value / Math.max(total, 1) * 100 }
  })
  const polar = (radius: number, angle: number) => {
    const radians = angle * Math.PI / 180
    return { x: 50 + radius * Math.cos(radians), y: 50 + radius * Math.sin(radians) }
  }
  const donutPath = (start: number, end: number) => {
    const outerStart = polar(46, start)
    const outerEnd = polar(46, end)
    const innerEnd = polar(27, end)
    const innerStart = polar(27, start)
    const largeArc = end - start > 180 ? 1 : 0
    return `M ${outerStart.x} ${outerStart.y} A 46 46 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A 27 27 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`
  }
  const hovered = slices.find(item => item.id === hoveredId)
  const toggle = (id: string) => setHiddenIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  return <div className="pcm-pie-chart" role="group" aria-label={valueLabel}>
    <div className="pcm-pie-chart__visual">
      <svg className="pcm-pie-chart__svg" viewBox="0 0 100 100" role="img" aria-label={`${valueLabel}: ${positiveItems.map(item => `${item.label}, ${item.value}`).join('; ')}`}>
        {total === 0 ? <circle cx="50" cy="50" r="36" fill="none" stroke="#e5ebf0" strokeWidth="18" /> : slices.map(item => <g key={item.id} tabIndex={0} role="button" aria-label={`${item.label}: ${item.value}, ${number(item.percentage)} por cento. Clique para ocultar ou mostrar.`} onMouseEnter={() => setHoveredId(item.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(item.id)} onBlur={() => setHoveredId(null)} onClick={event => { event.stopPropagation(); toggle(item.id) }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(item.id) } }}><title>{item.label}: {item.value} ({number(item.percentage)}%)</title>{Math.abs(item.end - item.start) >= 359.99 ? <circle cx="50" cy="50" r="36" fill="none" stroke={item.color} strokeWidth="18" /> : <path d={donutPath(item.start, item.end)} fill={item.color} />}</g>)}
      </svg>
      <span className="pcm-pie-chart__center"><strong>{hovered ? hovered.value : total}</strong><small>{hovered ? hovered.label : total ? 'Total' : 'Sem dados'}</small></span>
    </div>
    <ul>{positiveItems.map((item, index) => {
      const active = slices.find(slice => slice.id === item.id)
      const percentage = total > 0 && active ? active.percentage : 0
      return <li key={item.id} className={`${active ? '' : 'is-hidden'}${hoveredId === item.id ? ' is-hovered' : ''}`}>
        <button type="button" aria-pressed={Boolean(active)} title={`${active ? 'Ocultar' : 'Mostrar'} ${item.label}`} onClick={event => { event.stopPropagation(); toggle(item.id) }} onKeyDown={event => event.stopPropagation()} onMouseEnter={() => setHoveredId(item.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(item.id)} onBlur={() => setHoveredId(null)}><i style={{ background: colors[index % colors.length] }} aria-hidden="true" /><span>{item.label}</span><strong>{item.value}<small>{number(percentage)}%</small></strong></button>
      </li>
    })}</ul>
    {positiveItems.length === 0 ? <p className="pcm-pie-chart__empty">{emptyMessage}</p> : null}
  </div>
}

function ReliabilityComparison({
  title,
  description,
  items,
  mode = 'comparison',
  palette,
}: {
  title: string
  description: string
  items: ReadonlyArray<{ label: string; value: number | null; displayValue: string; detail: string }>
  mode?: 'comparison' | 'number'
  palette?: PcmCanvasPalette
}) {
  const availableItems = items.filter((item): item is { label: string; value: number; displayValue: string; detail: string } => item.value !== null)
  const maximum = Math.max(1, ...availableItems.map(item => item.value))
  return (
    <div className="pcm-time-comparison-widget">
      <div className="pcm-indicator-chart__heading">
        <div>
          <span>INDICADORES DE TEMPO</span>
          <h3>{title}</h3>
        </div>
        <small>{description}</small>
      </div>

      {availableItems.length === 0 ? <EmptyState>Sem falhas concluídas no período para calcular os tempos.</EmptyState> : (
        <div className={`pcm-time-comparison${mode === 'comparison' ? ' pcm-time-comparison--bars' : ''}`} role="group" aria-label={`${title}: ${availableItems.map((item) => `${item.label} ${item.displayValue}`).join('; ')}`}>
          {availableItems.map((item) => (
            <div className="pcm-time-comparison__item" key={item.label}>
              <div className="pcm-time-comparison__data"><span>{item.label}</span><strong>{item.displayValue}</strong><small>{item.detail}</small></div>
              {mode === 'comparison' ? <div className="pcm-time-comparison__track" aria-hidden="true"><i style={{ width: `${Math.max(4, (item.value / maximum) * 100)}%`, background: palette?.[item.label === 'MTBF' ? 1 : 0] ?? palette?.[0] ?? '#176fc1' }} /></div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
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

export function humanStatus(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    DRAFT: 'Rascunho',
    RASCUNHO: 'Rascunho',
    OPEN: 'Aberta',
    ABERTA: 'Aberta',
    RELEASED: 'Liberada para execução',
    LIBERADA: 'Liberada para execução',
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

export function humanAuditAction(value: string) {
  const labels: Record<string, string> = {
    WORK_ORDER_CREATED: 'OS criada',
    WORK_ORDER_SUBMITTED: 'OS enviada para aprovação',
    WORK_ORDER_RELEASED: 'OS liberada para execução',
    WORK_ORDER_APPROVED_WITHOUT_EXCEPTION: 'OS aprovada sem necessidade de validação adicional',
    OPERATOR_ACTION_STARTED: 'Execução iniciada',
    EXECUTION_RESPONSES_SAVED: 'Checklist registrado',
    OPERATOR_ACTION_COMPLETED: 'Execução concluída',
    TECHNICAL_SIGNATURE_RECORDED: 'Validação pós-intervenção assinada',
    WORK_ORDER_CHANGES_REQUESTED: 'Correção solicitada',
  }
  return labels[normalize(value)] ?? humanStatus(value)
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
    PREDICTIVE: 'Preditiva',
    PREDITIVA: 'Preditiva',
    IMPROVEMENT: 'Melhoria',
    MELHORIA: 'Melhoria',
  }
  return labels[source] ?? humanStatus(value)
}

function humanExecutionMode(value: string | undefined) {
  return ({ INTERNAL: 'Interna', EXTERNAL: 'Externa', MIXED: 'Mista' } as Record<string, string>)[normalize(value ?? '')] ?? 'Interna'
}

function maintenanceStatusLabel(value: MaintenanceStatus) {
  return value === 'ATENCAO' ? 'ATENÇÃO' : value === 'CRITICO' ? 'CRÍTICO' : 'NORMAL'
}

function MonthlyMttrChart({ items, loading, mode = 'bar', palette }: { items: MonthlyMttrPoint[]; loading: boolean; mode?: 'line' | 'bar' | 'progress'; palette?: PcmCanvasPalette }) {
  const chartColor = palette?.[0] ?? '#176fc1'
  const chartTint = palette?.[0] ?? '#176fc1'
  const maximum = Math.max(1, ...items.map(item => item.mttrSeconds ?? 0))
  const hasSample = items.some(item => item.mttrSeconds !== null)
  const points = items.flatMap((item, index) => item.mttrSeconds === null ? [] : [{
    ...item,
    x: items.length < 2 ? 300 : 28 + index * (544 / (items.length - 1)),
    y: 152 - (item.mttrSeconds / maximum) * 126,
  }])
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')

  return (
    <div className="pcm-indicator-chart pcm-indicator-chart--monthly">
      <div className="pcm-indicator-chart__heading">
        <div>
          <span>INDICADOR DE TEMPO</span>
          <h3>MTTR mensal</h3>
        </div>
        <small title="Tempo médio para reparar falhas concluídas.">Tendência de reparo</small>
      </div>
      {loading ? <p className="pcm-indicator-chart__empty">Carregando comparação mensal…</p> : !hasSample ? (
        <p className="pcm-indicator-chart__empty">Ainda não há dados mensais de MTTR.</p>
      ) : (
        mode === 'line' ? <div className="pcm-monthly-line-chart" role="img" aria-label={`Tendência mensal do MTTR: ${points.map(point => `${point.label} ${duration(point.mttrSeconds)}`).join('; ')}`}>
          <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="pcm-mttr-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={chartTint} stopOpacity=".5" /><stop offset="100%" stopColor={chartTint} stopOpacity="0" /></linearGradient></defs>
            {[26, 68, 110, 152].map(y => <line key={y} x1="20" x2="580" y1={y} y2={y} stroke="#e7edf2" strokeWidth="1" />)}
            {points.length > 1 ? <path d={`${linePath} L ${points[points.length - 1]?.x ?? 572} 152 L ${points[0]?.x ?? 28} 152 Z`} fill="url(#pcm-mttr-area)" /> : null}
            {points.length > 0 ? <path d={linePath} fill="none" stroke={chartColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
            {points.map(point => <g key={point.month} className="pcm-monthly-line-chart__point"><circle cx={point.x} cy={point.y} r="5" fill="#fff" stroke={chartColor} strokeWidth="3" vectorEffect="non-scaling-stroke" /><title>{point.label}: {duration(point.mttrSeconds)}</title><text x={point.x} y="173" textAnchor="middle" fill="#60798e" fontSize="11">{point.label}</text></g>)}
          </svg>
        </div> : mode === 'progress' ? <div className="pcm-monthly-progress" role="img" aria-label={`Progresso mensal relativo do MTTR: ${items.map(item => `${item.label} ${item.mttrSeconds === null ? 'sem amostra' : duration(item.mttrSeconds)}`).join('; ')}`}>
          {items.map(item => <div className="pcm-monthly-progress__item" key={item.month} title={`${item.label}: ${item.mttrSeconds === null ? 'Sem amostra' : duration(item.mttrSeconds)}`}>
            <span className="pcm-monthly-progress__month">{item.label}</span>
            <div className="pcm-monthly-progress__track"><span style={{ width: `${item.mttrSeconds === null ? 0 : Math.max(4, (item.mttrSeconds / maximum) * 100)}%`, background: chartColor }} /></div>
            <strong>{item.mttrSeconds === null ? '—' : duration(item.mttrSeconds)}</strong>
          </div>)}
        </div> : <div className="pcm-monthly-chart" role="img" aria-label="Comparação mensal do MTTR">
          {items.map(item => {
            const height = item.mttrSeconds === null ? 0 : Math.max(8, (item.mttrSeconds / maximum) * 100)
            return (
              <div className="pcm-monthly-chart__column" key={item.month} title={`${item.label}: ${item.mttrSeconds === null ? 'Sem amostra' : duration(item.mttrSeconds)}`}>
                <span className="pcm-monthly-chart__value">{item.mttrSeconds === null ? '—' : duration(item.mttrSeconds)}</span>
                <div className="pcm-monthly-chart__track">
                  <span className="pcm-monthly-chart__bar" style={{ height: `${height}%`, background: chartColor }} />
                </div>
                <span className="pcm-monthly-chart__label">{item.label}</span>
              </div>
            )
          })}
        </div>
      )}
      <p className="pcm-indicator-chart__note">Para calcular o MTTR, registre o início e o término da falha.</p>
    </div>
  )
}

function PcmReports({ report, onExport, onPrint }: { report: NonNullable<PcmData['relatorios']>; onExport: () => void; onPrint: () => void }) {
  const technicians = report.tecnicos ?? []
  const executions = report.execucoes_detalhadas ?? []
  const materialCosts = report.custos_materiais ?? {}
  const lowStock = report.estoque_baixo ?? {}

  return <section className="pcm-reports" aria-label="Relatórios do PCM">
    <header className="pcm-panel__heading pcm-reports__heading">
      <div><span className="pcm-section-kicker">RELATÓRIOS</span><h2>Resultado do período</h2><p>Consolidação de OS, preventivas e horas apontadas pela equipe.</p></div>
      <div className="pcm-reports__actions"><button type="button" className="pcm-orders__export" onClick={onExport}>Exportar CSV</button><button type="button" className="pcm-reports__print" onClick={onPrint}>Imprimir / PDF</button></div>
    </header>
    <article className="pcm-reports__team"><div><span className="pcm-section-kicker">EQUIPE TÉCNICA</span><h3>Horas apontadas</h3></div>
      {technicians.length === 0 ? <EmptyState>Não há execuções concluídas no período selecionado.</EmptyState> : <div className="pcm-reports__table-wrap"><table><thead><tr><th>Técnico</th><th>OS concluídas</th><th>Horas apontadas</th></tr></thead><tbody>{technicians.map(item => <tr key={item.id}><td>{item.nome}</td><td>{item.execucoes}</td><td>{duration(item.segundos_apontados)}</td></tr>)}</tbody></table></div>}
    </article>
    <article className="pcm-reports__team"><div><span className="pcm-section-kicker">ESTOQUE</span><h3>Reposição necessária</h3></div>
      {(lowStock.itens ?? []).length === 0 ? <EmptyState>Não há SKU no estoque mínimo para repor.</EmptyState> : <div className="pcm-reports__table-wrap"><table><thead><tr><th>SKU</th><th>Material</th><th>Saldo</th><th>Mínimo</th></tr></thead><tbody>{lowStock.itens?.map(item => <tr key={item.sku}><td><strong>{item.sku}</strong></td><td>{item.nome}</td><td>{item.estoque_atual} {item.unidade}</td><td><strong>{item.estoque_minimo} {item.unidade}</strong></td></tr>)}</tbody></table></div>}
    </article>
    <article className="pcm-reports__team"><div><span className="pcm-section-kicker">CUSTOS DE MATERIAIS</span><h3>Maior consumo por ativo</h3></div>
      {(materialCosts.por_ativo ?? []).length === 0 ? <EmptyState>Não houve consumo de material no período selecionado.</EmptyState> : <div className="pcm-reports__table-wrap"><table><thead><tr><th>Ativo</th><th>SKUs consumidos</th><th>Custo total</th></tr></thead><tbody>{materialCosts.por_ativo?.map(item => <tr key={item.ativo_tag}><td><strong>{item.ativo_tag}</strong><br /><small>{item.ativo_nome}</small></td><td>{item.itens_consumidos}</td><td><strong>{formatCurrency(item.custo_total)}</strong></td></tr>)}</tbody></table></div>}
    </article>
    <article className="pcm-reports__team"><div><span className="pcm-section-kicker">EXECUÇÕES CONCLUÍDAS</span><h3>Horários e tempo líquido</h3></div>
      {executions.length === 0 ? <EmptyState>Não há horários de execução concluída no período selecionado.</EmptyState> : <div className="pcm-reports__table-wrap"><table><thead><tr><th>OS</th><th>Técnico</th><th>Início</th><th>Conclusão</th><th>Tempo líquido</th><th>Pausas</th><th>Materiais / custo</th></tr></thead><tbody>{executions.map(item => <tr key={item.id}><td><strong>{item.ordem_codigo}</strong><br /><small>{item.ativo_tag} · {item.titulo}</small></td><td>{item.tecnico_nome}</td><td>{formatDateTime(item.iniciada_em)}</td><td>{formatDateTime(item.concluida_em)}</td><td>{duration(item.duracao_segundos)}</td><td>{duration(item.segundos_pausados)}</td><td>{item.itens_materiais > 0 ? <><strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(item.custo_materiais_total))}</strong><br /><small>{item.itens_materiais} SKU(s)</small></> : <small>Sem consumo</small>}</td></tr>)}</tbody></table></div>}
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
  assetId: string
  code: string
  name: string
  asset: string
  workType: string
  recurrenceDays: number | null
}

export function PcmDashboard({ onSessionExpired, partShortageFocusId = '' }: { onSessionExpired: () => void; partShortageFocusId?: string }) {
  const [days, setDays] = useState('30')
  const [demoMode, setDemoMode] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<PcmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [orders, setOrders] = useState<AdminIntervention[]>([])
  const [orderLoading, setOrderLoading] = useState(true)
  const [orderError, setOrderError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminIntervention | null>(null)
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('')
  const [selectedWorkOrderCode, setSelectedWorkOrderCode] = useState('')
  const [selectedActionDetail, setSelectedActionDetail] = useState<GestorActionDetail | null>(null)
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false)
  const [selectedOrderError, setSelectedOrderError] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [assignmentSuccess, setAssignmentSuccess] = useState('')
  const detailRequestGateRef = useRef<ReturnType<typeof createWorkOrderDetailRequestGate> | null>(null)
  detailRequestGateRef.current ??= createWorkOrderDetailRequestGate()
  const workOrderDetailPanelRef = useRef<HTMLElement | null>(null)
  const workOrderDetailHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const createOrderPanelRef = useRef<HTMLElement | null>(null)
  const [orderStatus, setOrderStatus] = useState('')
  const [orderPriority, setOrderPriority] = useState('')
  const [orderSector, setOrderSector] = useState('')
  const [orderResponsible, setOrderResponsible] = useState('')
  const [orderType, setOrderType] = useState('')
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const createOccurrenceAssetResolverRef = useRef<ReturnType<typeof createPcmOccurrenceAssetResolver> | null>(null)
  createOccurrenceAssetResolverRef.current ??= createPcmOccurrenceAssetResolver()
  const [createOrderMode, setCreateOrderMode] = useState<'WORK_ORDER' | 'PREVENTIVE' | 'IMPROVEMENT'>('WORK_ORDER')
  const [createOrderBusy, setCreateOrderBusy] = useState(false)
  const [createOriginLoading, setCreateOriginLoading] = useState(false)
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
  const [createOriginAssetId, setCreateOriginAssetId] = useState('')
  const [createOriginAssetTag, setCreateOriginAssetTag] = useState('')
  const [createOriginAssetName, setCreateOriginAssetName] = useState('')
  const [createOriginType, setCreateOriginType] = useState('')
  const [createRequiresPostIntervention, setCreateRequiresPostIntervention] = useState(false)
  const [createQualityValidation, setCreateQualityValidation] = useState(false)
  const [createSafetyValidation, setCreateSafetyValidation] = useState(false)
  const [createExecutionMode, setCreateExecutionMode] = useState<'INTERNAL' | 'EXTERNAL' | 'MIXED'>('INTERNAL')
  const [createImprovementCategory, setCreateImprovementCategory] = useState<'MODIFICATION' | 'MANUFACTURE' | 'INSTALLATION' | 'ADEQUACY' | 'OTHER'>('MODIFICATION')
  const [externalProvider, setExternalProvider] = useState('')
  const [externalDescription, setExternalDescription] = useState('')
  const [externalAmount, setExternalAmount] = useState('')
  const [externalDate, setExternalDate] = useState('')
  const [externalNotice, setExternalNotice] = useState('')
  const [externalBusy, setExternalBusy] = useState(false)
  const [improvementRequests, setImprovementRequests] = useState<ImprovementRequestSummary[]>([])
  const [improvementRequestId, setImprovementRequestId] = useState('')
  const [materialCostDrafts, setMaterialCostDrafts] = useState<Record<string, string>>({})
  const [todayNotifications, setTodayNotifications] = useState<GestorNotification[]>([])
  const [notificationsError, setNotificationsError] = useState('')
  const demoSnapshot = useMemo(() => createPcmDemoSnapshot(), [])
  const displayData: PcmData | null = demoMode ? demoSnapshot.data : data
  const displayOrders = demoMode ? demoSnapshot.orders : orders
  const displayPlans = demoMode ? demoSnapshot.plans : createPlans

  useEffect(() => {
    if (!createOrderOpen) return
    const frame = window.requestAnimationFrame(() => {
      createOrderPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      createOrderPanelRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [createOrderOpen])

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
  const refreshAutomatically = useCallback(() => {
    if (!demoMode && !loading && !createOrderOpen) reload()
  }, [createOrderOpen, demoMode, loading, reload])
  useAutoRefresh(refreshAutomatically, { enabled: !demoMode && !createOrderOpen, intervalMs: 5 * 60_000 })

  function showOperationalQueue() {
    setOrderStatus('')
    setOrderPriority('')
    setOrderSector('')
    setOrderResponsible('')
    setOrderType('')
    setInsight({ title: 'Ordens de serviço', description: 'Fila de trabalho para acompanhamento e priorização.', items: orderInsightItems(operationalOrders) })
  }

  function showCriticalOrders() {
    setOrderStatus('')
    setOrderPriority('Crítica')
    setOrderSector('')
    setOrderResponsible('')
    setOrderType('')
    setInsight({ title: 'Ordens críticas', description: 'Ordens abertas com prioridade crítica.', items: dailyInsights.critical })
  }

  function showPreventivePlans() {
    setInsight({ title: 'Preventivas próximas', description: 'Ordens preventivas programadas para os próximos 7 dias.', items: dailyInsights.preventive })
  }

  function showStoppedAssets() {
    setInsight({ title: 'Ativos parados', description: 'Equipamentos com parada aberta que precisam de acompanhamento.', items: dailyInsights.stopped })
  }

  function showOverdueOrders() {
    setInsight({ title: 'Ordens atrasadas', description: 'Ordens abertas cuja programação já venceu.', items: dailyInsights.overdue })
  }

  function showNotificationDetails(notification: GestorNotification) {
    const action = pcmOccurrenceNotificationAction(notification)
    const linkedOrder = action.kind === 'follow'
      ? operationalOrders.find(order => order.id === action.workOrderId)
      : undefined
    setInsight({
      title: notification.titulo,
      description: linkedOrder
        ? `${linkedOrder.code} · ${linkedOrder.equipment} · ${linkedOrder.sector}. Selecione o registro para abrir a ordem.`
        : `${notification.mensagem || 'Aviso operacional recebido.'} Selecione o registro para continuar.`,
      items: [{
        id: `notification:${notification.id}`,
        title: linkedOrder ? `${linkedOrder.code} · ${linkedOrder.equipment}` : notification.titulo,
        detail: linkedOrder
          ? `${linkedOrder.sector} · ${humanWorkType(linkedOrder.type)} · ${humanStatus(linkedOrder.status)}`
          : action.kind === 'follow' ? 'Ordem vinculada; abrir detalhes' : 'Solicitação recebida; iniciar abertura de ordem',
        status: linkedOrder ? humanPriority(linkedOrder.priority) : 'Aviso',
      }],
    })
  }

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
    const report = displayData?.relatorios
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
      [], ['Estoque baixo', 'SKU', 'Material', 'Saldo', 'Mínimo', 'Unidade', 'Valor unitário'], ...(report.estoque_baixo?.itens ?? []).map(item => ['Reposição necessária', item.sku, item.nome, String(item.estoque_atual), String(item.estoque_minimo), item.unidade, formatCurrency(item.valor_unitario)]),
      [], ['Custo por ativo', 'Nome do ativo', 'Itens consumidos', 'Custo total'], ...(report.custos_materiais?.por_ativo ?? []).map(item => [item.ativo_tag, item.ativo_nome, String(item.itens_consumidos), formatCurrency(item.custo_total)]),
      [], ['Execução', 'Ordem', 'Ativo', 'Técnico', 'Início', 'Conclusão', 'Duração', 'Pausas', 'Custo de materiais'], ...(report.execucoes_detalhadas ?? []).map(item => [item.titulo, item.ordem_codigo, item.ativo_tag, item.tecnico_nome, formatDateTime(item.iniciada_em), formatDateTime(item.concluida_em), duration(item.duracao_segundos), duration(item.segundos_pausados), formatCurrency(item.custo_materiais_total)]),
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
    const reportData = displayData?.relatorios
    if (!reportData) return
    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) {
      window.alert('Permita a abertura da janela de impressão para gerar o relatório.')
      return
    }
    const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
    const rows = (items: unknown[][], headers: string[]) => `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${items.length ? items.map(item => `<tr>${headers.map((_, index) => `<td>${escapeHtml(item[index])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Sem registros no período.</td></tr>`}</tbody></table>`
    const executions = reportData.execucoes_detalhadas ?? []
    const technicians = reportData.tecnicos ?? []
    const lowStockItems = reportData.estoque_baixo?.itens ?? []
    const costsByAsset = reportData.custos_materiais?.por_ativo ?? []
    const title = 'Relatório de manutenção · PCM'
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
      *{box-sizing:border-box}body{margin:0;padding:32px;color:#17324a;font:13px/1.45 Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:2px solid #173f5f}h1{margin:0;font-size:22px}h2{margin:24px 0 9px;font-size:15px}p{margin:4px 0;color:#586f82}.meta{text-align:right}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0}.metric{padding:11px;border:1px solid #d6e0e8;border-radius:6px}.metric span{display:block;color:#5b7082;font-size:11px}.metric strong{display:block;margin-top:3px;font-size:18px}table{width:100%;border-collapse:collapse;margin:8px 0 20px}th,td{padding:7px 8px;border:1px solid #dbe3e9;text-align:left;vertical-align:top}th{background:#f0f4f7;color:#294a65;font-size:11px}td{overflow-wrap:anywhere}footer{margin-top:25px;padding-top:10px;border-top:1px solid #dbe3e9;color:#607688;font-size:10px}@media print{body{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid;break-after:auto}@page{size:auto;margin:14mm}}
    </style></head><body><header><div><h1>${title}</h1><p>Consolidação de ordens, preventivas, equipe e materiais.</p></div><div class="meta"><strong>Período: últimos ${escapeHtml(days)} dias</strong><p>Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p></div></header>
      <section class="summary"><div class="metric"><span>Ordens abertas</span><strong>${escapeHtml(reportData.ordens?.abertas ?? 0)}</strong></div><div class="metric"><span>Concluídas no período</span><strong>${escapeHtml(reportData.ordens?.concluidas_no_periodo ?? 0)}</strong></div><div class="metric"><span>Ordens atrasadas</span><strong>${escapeHtml(reportData.ordens?.atrasadas ?? 0)}</strong></div><div class="metric"><span>Backlog estimado</span><strong>${escapeHtml(`${number(displayData?.atual.backlog_horas_estimadas ?? 0)} h`)}</strong></div></section>
      <h2>Preventivas</h2>${rows([['Programadas no período', reportData.preventivas?.programadas_no_periodo ?? 0], ['Concluídas no prazo', reportData.preventivas?.concluidas_no_prazo ?? 0], ['Concluídas com atraso', reportData.preventivas?.concluidas_com_atraso ?? 0], ['Pendentes', reportData.preventivas?.pendentes ?? 0]], ['Indicador', 'Quantidade'])}
      <h2>Equipe técnica</h2>${rows(technicians.map(item => [item.nome, item.execucoes, duration(item.segundos_apontados)]), ['Técnico', 'OS concluídas', 'Horas apontadas'])}
      <h2>Materiais com estoque baixo</h2>${rows(lowStockItems.map(item => [item.sku, item.nome, `${item.estoque_atual} ${item.unidade}`, `${item.estoque_minimo} ${item.unidade}`]), ['SKU', 'Material', 'Saldo', 'Mínimo'])}
      <h2>Custo de materiais por ativo</h2>${rows(costsByAsset.map(item => [item.ativo_tag, item.ativo_nome, item.itens_consumidos, formatCurrency(Number(item.custo_total))]), ['Ativo', 'Nome', 'Itens consumidos', 'Custo total'])}
      <h2>Execuções concluídas</h2>${rows(executions.map(item => [item.ordem_codigo, item.titulo, item.ativo_tag, item.tecnico_nome, formatDateTime(item.iniciada_em), formatDateTime(item.concluida_em), duration(item.duracao_segundos), formatCurrency(Number(item.custo_materiais_total))]), ['OS', 'Execução', 'Ativo', 'Técnico', 'Início', 'Conclusão', 'Duração', 'Custo'])}
      <footer>VORQIX · Relatório gerado a partir dos dados do PCM.</footer></body></html>`
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true })
    window.setTimeout(() => { printWindow.focus(); printWindow.print() }, 350)
  }

  function printPcmCanvas(board: HTMLElement, activeFilters: string[]) {
    const printWindow = window.open('', '_blank', 'width=1200,height=900')
    if (!printWindow) {
      window.alert('Permita a abertura da janela de impressão para imprimir a lousa.')
      return
    }

    const printDocument = printWindow.document
    printDocument.open()
    printDocument.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lousa atual · PCM</title></head><body><main class="pcm-canvas-print"><header class="pcm-canvas-print__heading"><div><h1>Lousa atual do PCM</h1><p>Indicadores e gráficos visíveis no painel.</p></div><div class="pcm-canvas-print__meta"></div></header><section class="pcm-canvas-print__filters" aria-label="Filtros aplicados"></section><div class="pcm-canvas-print__board"></div></main></body></html>')
    printDocument.close()

    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach(styleNode => {
      printDocument.head.appendChild(printDocument.importNode(styleNode, true))
    })

    const meta = printDocument.querySelector<HTMLElement>('.pcm-canvas-print__meta')
    if (meta) meta.textContent = `Período: ${days} dias · Gerado em ${new Date().toLocaleString('pt-BR')}`
    const filters = printDocument.querySelector<HTMLElement>('.pcm-canvas-print__filters')
    if (filters) {
      filters.textContent = activeFilters.length ? `Filtros aplicados: ${activeFilters.join(' · ')}` : 'Filtros: nenhum'
    }

    const boardCopy = printDocument.importNode(board, true) as HTMLElement
    boardCopy.removeAttribute('id')
    boardCopy.classList.remove('is-selecting')
    boardCopy.querySelectorAll('.pcm-canvas__group-controls, .pcm-canvas__resize-handle, .pcm-canvas__select-handle, .pcm-canvas__palette-control, .pcm-canvas__widget-tools, .pcm-canvas__context-menu').forEach(element => element.remove())
    boardCopy.querySelectorAll('.is-dragging, .is-drop-target, .is-selected, .has-palette-open, .is-drop-left, .is-drop-right, .is-drop-top, .is-drop-bottom').forEach(element => element.classList.remove('is-dragging', 'is-drop-target', 'is-selected', 'has-palette-open', 'is-drop-left', 'is-drop-right', 'is-drop-top', 'is-drop-bottom'))
    boardCopy.querySelectorAll<HTMLElement>('[draggable]').forEach(element => element.removeAttribute('draggable'))
    printDocument.querySelector('.pcm-canvas-print__board')?.appendChild(boardCopy)

    const printStyles = printDocument.createElement('style')
    printStyles.textContent = `body{margin:0;padding:22px;background:#fff;color:#17324a;font:12px/1.4 Arial,sans-serif}.pcm-canvas-print__heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #173f5f}.pcm-canvas-print__heading h1{margin:0;font-size:20px}.pcm-canvas-print__heading p{margin:3px 0 0;color:#607688}.pcm-canvas-print__meta{color:#607688;text-align:right}.pcm-canvas-print__filters{margin:0 0 12px;color:#526b7d;font-size:10px}.pcm-canvas-print__board .pcm-canvas__board{grid-auto-rows:auto!important;grid-auto-flow:row!important;align-items:stretch!important;gap:8px!important}.pcm-canvas-print__board .pcm-canvas__group{grid-row:auto!important;height:auto!important;min-height:0!important;align-self:start!important;break-inside:avoid;padding:6px!important}.pcm-canvas-print__board .pcm-canvas__group-heading{cursor:default!important}.pcm-canvas-print__board .pcm-canvas__widgets{grid-auto-rows:auto!important;grid-auto-flow:row!important;align-items:stretch!important;gap:6px!important}.pcm-canvas-print__board .pcm-canvas__widget{grid-row:auto!important;height:auto!important;min-height:105px!important;max-height:none!important;overflow:visible!important;align-self:stretch!important;break-inside:avoid;box-shadow:none!important}.pcm-canvas-print__board .pcm-canvas__widget-body{overflow:visible!important}.pcm-canvas-print__board .pcm-canvas__widget:has(.pcm-canvas-list,.pcm-bar-chart,.pcm-pie-chart,.pcm-monthly-line-chart,.pcm-monthly-chart,.pcm-monthly-progress,.pcm-time-comparison-widget){min-height:190px!important}.pcm-canvas-print__board .pcm-canvas__group--board{padding:0!important;border:0!important}@page{size:landscape;margin:12mm}@media print{body{padding:0}.pcm-canvas-print__board{width:100%}}`
    printDocument.head.appendChild(printStyles)

    printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true })
    const stylesheets = [...printDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    void Promise.all(stylesheets.map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
      link.addEventListener('load', () => resolve(), { once: true })
      link.addEventListener('error', () => resolve(), { once: true })
      window.setTimeout(resolve, 1200)
    }))).then(() => printDocument.fonts?.ready).then(() => {
      printWindow.focus()
      printWindow.print()
    })
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
    void listImprovementRequests(controller.signal)
      .then(rows => { if (!controller.signal.aborted) setImprovementRequests(rows) })
      .catch(cause => {
        if (!controller.signal.aborted && isGestorAuthenticationError(cause)) onSessionExpired()
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
    () => displayOrders.map(toOperationalOrder),
    [displayOrders],
  )

  const priorityQueueOrders = useMemo(() => {
    const priorityScore: Record<string, number> = {
      CRITICAL: 4,
      CRITICA: 4,
      CRÍTICA: 4,
      HIGH: 3,
      ALTA: 3,
      MEDIUM: 2,
      MEDIA: 2,
      LOW: 1,
      BAIXA: 1,
    }

    return operationalOrders
      .filter(order => !isClosedWorkOrder(order.status))
      .sort((left, right) => {
        const leftWindow = scheduleWindow(left.deadline, left.status)
        const rightWindow = scheduleWindow(right.deadline, right.status)
        const leftScore = (leftWindow?.tone === 'late' ? 10 : 0) + (priorityScore[normalize(left.priority)] ?? 0)
        const rightScore = (rightWindow?.tone === 'late' ? 10 : 0) + (priorityScore[normalize(right.priority)] ?? 0)

        if (leftScore !== rightScore) return rightScore - leftScore

        const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
        const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY
        return leftDeadline - rightDeadline
      })
      .slice(0, 4)
  }, [operationalOrders])

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

  const pcmCanvasSegmentFilters: PcmCanvasSegmentFilter[] = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [
      { id: 'sector', label: 'Setor', options: unique(operationalOrders.map(item => item.sector)) },
      { id: 'equipment', label: 'Ativo', options: unique(operationalOrders.map(item => item.equipment)) },
      { id: 'type', label: 'Tipo', options: unique(operationalOrders.map(item => humanWorkType(item.type))) },
      { id: 'priority', label: 'Prioridade', options: unique(operationalOrders.map(item => humanPriority(item.priority))) },
      { id: 'status', label: 'Status', options: unique(operationalOrders.map(item => humanStatus(item.status))) },
      { id: 'responsible', label: 'Responsável', options: unique(operationalOrders.map(item => item.responsible)) },
    ].filter(filter => filter.options.length > 0)
  }, [operationalOrders])

  const ordersForSegments = (segments: PcmCanvasSegments = {}) => operationalOrders.filter(item =>
    (!segments.sector || item.sector === segments.sector)
    && (!segments.equipment || item.equipment === segments.equipment)
    && (!segments.type || humanWorkType(item.type) === segments.type)
    && (!segments.priority || humanPriority(item.priority) === segments.priority)
    && (!segments.status || humanStatus(item.status) === segments.status)
    && (!segments.responsible || item.responsible === segments.responsible),
  )

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
    const stoppedAssets = displayData?.ativos_parados_lista ?? []
    const stoppedFromAssets = stoppedAssets.map(asset => ({
      id: asset.id,
      title: `${asset.ativo_tag || 'Sem TAG'} · ${asset.ativo_nome || 'Ativo sem nome'}`,
      detail: [asset.setor_nome || 'Setor não informado', asset.motivo_parada || 'Motivo não informado', asset.parada_iniciada_em ? `Desde ${formatDateTime(asset.parada_iniciada_em)}` : null].filter(Boolean).join(' · '),
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
      .slice(0, displayData?.atual.ativos_parados ?? 0)
      .map(order => ({
        id: `order-${order.id}`,
        title: `${order.equipment || 'Ativo não informado'} · ${order.code}`,
        detail: `${order.sector || 'Setor não informado'} · OS corretiva aberta para acompanhamento`,
        status: 'Em acompanhamento',
      }))
    const preventiveFromApi = (displayData?.preventivas ?? []).map(order => ({
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
      technicians: (displayData?.tecnicos ?? []).map(technician => ({ id: technician.id, title: technician.nome, detail: `${technician.execucoes} execução(ões) em andamento`, status: 'Em atividade' })),
    }
  }, [assetCatalog, displayData, operationalOrders])

  const current = displayData?.atual
  const reliability = displayData?.confiabilidade
  const maintenanceStatus = useMemo(() => (displayData ? statusFrom(displayData) : null), [displayData])
  const monthlyMttr = useMemo<MonthlyMttrPoint[]>(() => (displayData?.relatorios?.mttr_mensal ?? displayData?.confiabilidade_mensal ?? []).map(item => {
    const [year, month] = item.mes.split('-').map(Number)
    const date = new Date(year, Math.max(0, month - 1), 1)
    return {
      month: item.mes,
      label: Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : item.mes,
      mttrSeconds: item.mttr_segundos,
    }
  }), [displayData])

  const alerts = useMemo(() => {
    if (!displayData) return []

    const items: { level: 'danger' | 'warning' | 'info'; title: string; detail: string }[] = []

    if (activeCriticalOrders > 0) {
      items.push({
        level: 'danger',
        title: 'Ordens críticas abertas',
        detail: `${activeCriticalOrders} ${activeCriticalOrders === 1 ? 'ordem exige' : 'ordens exigem'} priorização imediata.`,
      })
    }

    if (displayData.atual.ativos_parados > 0) {
      items.push({
        level: 'danger',
        title: 'Equipamentos parados',
        detail: `${displayData.atual.ativos_parados} ${displayData.atual.ativos_parados === 1 ? 'ativo está' : 'ativos estão'} com parada aberta.`,
      })
    }

    if (displayData.atual.ordens_atrasadas > 0) {
      items.push({
        level: 'warning',
        title: 'Ordens atrasadas',
        detail: `${displayData.atual.ordens_atrasadas} ${displayData.atual.ordens_atrasadas === 1 ? 'ordem ultrapassou' : 'ordens ultrapassaram'} a programação.`,
      })
    }

    if (displayData.atual.ordens_sem_estimativa > 0) {
      items.push({
        level: 'warning',
        title: 'Backlog sem estimativa',
        detail: `${displayData.atual.ordens_sem_estimativa} ${displayData.atual.ordens_sem_estimativa === 1 ? 'ordem aberta ainda não possui' : 'ordens abertas ainda não possuem'} estimativa.`,
      })
    }

    if (displayData.confiabilidade.ativos_reincidentes > 0) {
      items.push({
        level: 'warning',
        title: 'Reincidência de falhas',
        detail: `${displayData.confiabilidade.ativos_reincidentes} ${displayData.confiabilidade.ativos_reincidentes === 1 ? 'equipamento apresentou' : 'equipamentos apresentaram'} nova falha no período.`,
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
  }, [activeCriticalOrders, displayData])

  const operationalMetrics = {
    backlog: { label: 'Backlog estimado', value: `${number(current?.backlog_horas_estimadas ?? 0)} h`, note: 'Soma das horas estimadas nas ordens abertas.', icon: TimerReset as LucideIcon },
    'open-orders': { label: 'Ordens abertas', value: current?.ordens_abertas ?? 0, note: 'Ordens ainda em acompanhamento.', icon: ClipboardList as LucideIcon },
    'active-technicians': { label: 'Técnicos ativos', value: current?.tecnicos_em_atividade ?? 0, note: 'Técnicos com execução em andamento.', icon: UsersRound as LucideIcon },
    unestimated: { label: 'Sem estimativa', value: current?.ordens_sem_estimativa ?? 0, note: 'Ordens abertas sem duração planejada.', icon: FileQuestionMark as LucideIcon },
  }
  const reliabilityMetrics = {
    availability: { label: 'Disponibilidade', value: reliability?.disponibilidade_percentual === null || reliability?.disponibilidade_percentual === undefined ? '—' : `${number(reliability.disponibilidade_percentual)}%`, note: `${reliability?.ativos_considerados ?? 0} ativos considerados no cálculo.`, icon: ChartNoAxesCombined as LucideIcon },
    failures: { label: 'Falhas no período', value: reliability?.falhas ?? 0, note: `Registros nos últimos ${days} dias.`, icon: TriangleAlert as LucideIcon },
    recurrence: { label: 'Reincidências', value: reliability?.reincidencias ?? 0, note: `${reliability?.ativos_reincidentes ?? 0} ativos com nova falha no período.`, icon: Repeat2 as LucideIcon },
  }
  const attentionMetrics = {
    stopped: { label: 'Ativos parados', value: current?.ativos_parados ?? 0, note: 'Equipamentos ativos com parada aberta.', tone: (current?.ativos_parados ?? 0) > 0 ? 'danger' as const : 'default' as const, icon: CirclePause as LucideIcon, onClick: showStoppedAssets },
    critical: { label: 'Ordens críticas', value: activeCriticalOrders, note: 'Ordens abertas com prioridade crítica.', tone: activeCriticalOrders > 0 ? 'danger' as const : 'default' as const, icon: Siren as LucideIcon, onClick: showCriticalOrders },
    overdue: { label: 'Ordens atrasadas', value: current?.ordens_atrasadas ?? 0, note: 'Ordens com programação vencida.', tone: (current?.ordens_atrasadas ?? 0) > 0 ? 'warning' as const : 'default' as const, icon: ClockAlert as LucideIcon, onClick: showOverdueOrders },
  }
  const report = displayData?.relatorios
  const sectorFailures = (displayData?.falhas_por_setor ?? []).map(item => ({ id: item.setor_id, label: item.setor_nome, value: item.falhas }))
  const assetFailures = (displayData?.falhas_por_ativo ?? []).map(item => ({ id: item.ativo_id, label: `${item.ativo_tag} · ${item.ativo_nome}`, detail: item.setor_nome, value: item.falhas }))
  const pcmCanvasWidgets: PcmCanvasWidget[] = [
    ...Object.entries(attentionMetrics).map(([id, metric]) => pcmNumberWidget({
      id: `attention-${id}`, title: metric.label, categoryId: 'overview', value: metric.value, note: metric.note,
      icon: metric.icon, tone: metric.tone, onClick: metric.onClick,
      segmentValue: segments => {
        const subset = ordersForSegments(segments).filter(order => !isClosedWorkOrder(order.status))
        if (id === 'critical') return subset.filter(order => ['CRITICAL', 'CRITICA', 'CRÍTICA'].includes(normalize(order.priority))).length
        if (id === 'overdue') return subset.filter(order => Boolean(order.deadline) && new Date(order.deadline).getTime() < Date.now()).length
        return metric.value
      },
    })),
    ...Object.entries(operationalMetrics).map(([id, metric]) => pcmNumberWidget({
      id: `operational-${id}`, title: metric.label, categoryId: 'operational', value: metric.value, note: metric.note, icon: metric.icon,
      segmentValue: segments => {
        const subset = ordersForSegments(segments).filter(order => !isClosedWorkOrder(order.status))
        if (id === 'open-orders') return subset.length
        if (id === 'active-technicians') return new Set(subset.map(order => order.responsible).filter(name => name !== 'Não atribuído')).size
        return metric.value
      },
    })),
    ...Object.entries(reliabilityMetrics).map(([id, metric]) => pcmNumberWidget({
      id: `reliability-${id}`, title: metric.label, categoryId: 'reliability', value: metric.value, note: metric.note, icon: metric.icon,
    })),
    {
      id: 'mttr-mtbf-comparison', title: 'MTTR e MTBF', categoryId: 'comparison', note: 'Reparo médio e intervalo médio entre falhas.',
      modes: [{ id: 'comparison', label: 'Comparação visual' }, { id: 'number', label: 'Valores' }], defaultMode: 'comparison',
      onActivate: () => openInsight('MTTR e MTBF', 'Indicadores de reparo e intervalo entre falhas no período selecionado.', [
        { id: 'report-mttr', title: `MTTR · ${duration(reliability?.mttr_segundos ?? null)}`, detail: 'Tempo médio para restaurar um ativo após uma falha.' },
        { id: 'report-mtbf', title: `MTBF · ${duration(reliability?.mtbf_segundos ?? null)}`, detail: 'Tempo médio de operação entre falhas.' },
      ]),
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette) => <ReliabilityComparison title="MTTR × MTBF" description="Tempo de reparo e intervalo entre falhas" mode={mode === 'number' ? 'number' : 'comparison'} palette={palette} items={[
        { label: 'MTTR', value: reliability?.mttr_segundos ?? null, displayValue: duration(reliability?.mttr_segundos ?? null), detail: 'Tempo médio para restaurar' },
        { label: 'MTBF', value: reliability?.mtbf_segundos ?? null, displayValue: duration(reliability?.mtbf_segundos ?? null), detail: 'Tempo médio entre falhas' },
      ]} />,
    },
    {
      id: 'monthly-mttr', title: 'MTTR mensal', categoryId: 'time', note: 'Tendência de tempo médio para reparar falhas.',
      modes: [{ id: 'line', label: 'Linha' }, { id: 'bar', label: 'Colunas' }, { id: 'progress', label: 'Progresso' }], defaultMode: 'line',
      onActivate: () => openInsight('MTTR mensal', 'Média mensal do tempo para reparo.', monthlyMttr.map(item => ({ id: `report-month:${item.month}`, title: item.label, detail: item.mttrSeconds === null ? 'Sem amostra' : duration(item.mttrSeconds) }))),
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette) => <MonthlyMttrChart items={monthlyMttr} loading={loading} mode={mode === 'bar' || mode === 'progress' ? mode : 'line'} palette={palette} />,
    },
    {
      id: 'sector-failures', title: 'Falhas por setor', categoryId: 'assets', note: 'Setores com registros de falha no período.',
      modes: [{ id: 'bar', label: 'Barras' }, { id: 'pie', label: 'Pizza' }, { id: 'list', label: 'Lista' }], defaultMode: 'bar',
      onActivate: () => openInsight('Falhas por setor', 'Setores com falhas registradas no período.', sectorFailures.map(item => ({ id: `report-sector:${item.id}`, title: item.label, detail: `${item.value} falha(s)` }))),
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
        const items = sectorFailures.filter(item => !segments?.sector || item.label === segments.sector)
        return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Sem falhas por setor no período." valueLabel="Falhas por setor" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Sem falhas por setor no período." valueLabel="Falhas por setor" palette={palette} />
      },
    },
    {
      id: 'asset-failures', title: 'Falhas por ativo', categoryId: 'assets', note: 'Ativos com registros de falha no período.',
      modes: [{ id: 'bar', label: 'Barras' }, { id: 'pie', label: 'Pizza' }, { id: 'list', label: 'Lista' }], defaultMode: 'bar',
      onActivate: () => openInsight('Falhas por ativo', 'Ativos com falhas registradas no período.', assetFailures.map(item => ({ id: `report-asset:${item.id}`, title: item.label, detail: `${item.value} falha(s) · ${item.detail ?? 'Setor não informado'}` }))),
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
        const items = assetFailures.filter(item => (!segments?.sector || item.detail === segments.sector) && (!segments?.equipment || item.label === segments.equipment))
        return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Sem falhas por ativo no período." valueLabel="Falhas por ativo" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Sem falhas por ativo no período." valueLabel="Falhas por ativo" palette={palette} />
      },
    },
    {
      id: 'preventives-next', title: 'Preventivas próximas', categoryId: 'planning', note: 'Programação dos próximos sete dias.',
      modes: [{ id: 'number', label: 'Número' }, { id: 'list', label: 'Lista' }], defaultMode: 'number',
      onActivate: showPreventivePlans,
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette) => mode === 'number' ? <Metric label="" value={current?.preventivas_proximas ?? 0} note="Programadas para os próximos sete dias." icon={CalendarCheck2} onClick={showPreventivePlans} /> : <ol className="pcm-canvas-list">{dailyInsights.preventive.slice(0, 6).map(item => <li key={item.id}><span>{item.title}<small>{item.detail}</small></span><strong>{item.status ?? 'Programada'}</strong></li>)}</ol>,
    },
    ...(displayData?.tecnicos?.length ? [{
      id: 'team-executions', title: 'Técnicos em atividade', categoryId: 'team', note: 'Execuções de manutenção em andamento.',
      modes: [{ id: 'bar' as const, label: 'Barras' }, { id: 'pie' as const, label: 'Pizza' }, { id: 'list' as const, label: 'Lista' }], defaultMode: 'bar' as const,
      onActivate: () => openInsight('Técnicos em atividade', 'Execuções atualmente em andamento por técnico.', (displayData.tecnicos ?? []).map(item => ({ id: `report-team:${item.id}`, title: item.nome, detail: `${item.execucoes} execução(ões)` }))),
      render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
        const technicians = (displayData.tecnicos ?? []).filter(item => !segments?.responsible || item.nome === segments.responsible).map(item => ({ id: item.id, label: item.nome, value: item.execucoes }))
        return mode === 'list' ? <ol className="pcm-canvas-list">{technicians.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={technicians} emptyMessage="Sem técnicos em atividade." valueLabel="Execuções por técnico" palette={palette} /> : <HorizontalBarChart items={technicians} emptyMessage="Sem técnicos em atividade." valueLabel="Execuções por técnico" palette={palette} />
      },
    }] : []),
    ...(report ? [
      pcmNumberWidget({ id: 'result-orders-open', title: 'OS abertas', categoryId: 'results', value: report.ordens?.abertas ?? 0, note: 'Pendentes de encerramento.', icon: ClipboardList, onClick: () => openInsight('OS abertas', 'Ordens pendentes de encerramento.', orderInsightItems(operationalOrders.filter(order => !['CONCLUIDA', 'COMPLETED', 'CANCELLED', 'CANCELADA'].includes(normalize(order.status))))), segmentValue: segments => ordersForSegments(segments).filter(order => !isClosedWorkOrder(order.status)).length }),
      pcmNumberWidget({ id: 'result-orders-closed', title: 'OS concluídas', categoryId: 'results', value: report.ordens?.concluidas_no_periodo ?? 0, note: 'Concluídas no período.', icon: Activity, tone: 'success', onClick: () => openInsight('Execuções concluídas', 'Registros encerrados no período selecionado.', (report.execucoes_detalhadas ?? []).map(item => ({ id: `report-execution:${item.id}`, title: `${item.ordem_codigo} · ${item.titulo}`, detail: `${item.ativo_tag} · ${item.tecnico_nome} · ${duration(item.duracao_segundos)}`, status: formatDateTime(item.concluida_em) }))) }),
      pcmNumberWidget({ id: 'result-preventives-on-time', title: 'Preventivas no prazo', categoryId: 'planning', value: report.preventivas?.concluidas_no_prazo ?? 0, note: 'Concluídas até a data programada.', icon: CalendarCheck2, tone: 'success', onClick: () => openInsight('Preventivas no prazo', 'Total concluído dentro da data programada no período.', [{ id: 'report-preventive-ontime', title: `${report.preventivas?.concluidas_no_prazo ?? 0} preventiva(s)`, detail: `Período selecionado: ${days} dias.` }]) }),
      pcmNumberWidget({ id: 'result-preventives-late', title: 'Preventivas com atraso', categoryId: 'planning', value: report.preventivas?.concluidas_com_atraso ?? 0, note: 'Concluídas após a programação.', icon: ClockAlert, tone: (report.preventivas?.concluidas_com_atraso ?? 0) > 0 ? 'warning' : 'success', onClick: () => openInsight('Preventivas com atraso', 'Total concluído após a data programada no período.', [{ id: 'report-preventive-late', title: `${report.preventivas?.concluidas_com_atraso ?? 0} preventiva(s)`, detail: `Período selecionado: ${days} dias.` }]) }),
      pcmNumberWidget({ id: 'result-material-cost', title: 'Custo de materiais', categoryId: 'stock', value: formatCurrency(report.custos_materiais?.total), note: `${report.custos_materiais?.itens_consumidos ?? 0} itens em ${report.custos_materiais?.ordens_com_consumo ?? 0} OS.`, icon: Wrench, onClick: () => openInsight('Custo de materiais por ativo', 'Consumo registrado no período selecionado.', (report.custos_materiais?.por_ativo ?? []).map((item, index) => ({ id: `report-cost:${index}`, title: `${item.ativo_tag} · ${item.ativo_nome}`, detail: `${item.itens_consumidos} item(ns) · ${formatCurrency(item.custo_total)}` }))) }),
      pcmNumberWidget({ id: 'result-low-stock', title: 'Estoque baixo', categoryId: 'stock', value: report.estoque_baixo?.quantidade ?? 0, note: 'Itens no mínimo ou abaixo dele.', icon: TriangleAlert, tone: (report.estoque_baixo?.quantidade ?? 0) > 0 ? 'warning' : 'success', onClick: () => openInsight('Itens com estoque baixo', 'Materiais no mínimo ou abaixo dele.', (report.estoque_baixo?.itens ?? []).map(item => ({ id: `report-stock:${item.sku}`, title: `${item.sku} · ${item.nome}`, detail: `Saldo ${item.estoque_atual} ${item.unidade} · mínimo ${item.estoque_minimo} ${item.unidade} · ${formatCurrency(item.valor_unitario)}` }))) }),
      {
        id: 'result-team-hours', title: 'Horas da equipe', categoryId: 'team', note: 'Execuções concluídas e horas apontadas no período.',
        modes: [{ id: 'bar' as const, label: 'Barras' }, { id: 'pie' as const, label: 'Pizza' }, { id: 'list' as const, label: 'Lista' }], defaultMode: 'bar' as const,
        onActivate: () => openInsight('Horas da equipe', 'Horas apontadas por técnico em execuções concluídas.', (report.tecnicos ?? []).map(item => ({ id: `report-team-hours:${item.id}`, title: item.nome, detail: `${item.execucoes} OS concluída(s) · ${duration(item.segundos_apontados)}` }))),
        render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
          const items = (report.tecnicos ?? []).filter(item => !segments?.responsible || item.nome === segments.responsible).map(item => ({ id: item.id, label: item.nome, value: Math.round(item.segundos_apontados / 3600 * 10) / 10, detail: `${item.execucoes} OS concluída(s) · ${duration(item.segundos_apontados)}` }))
          return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}<small>{item.detail}</small></span><strong>{number(item.value)} h</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Sem horas apontadas no período." valueLabel="Horas apontadas por técnico" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Sem horas apontadas no período." valueLabel="Horas apontadas por técnico" palette={palette} />
        },
      },
      {
        id: 'result-stock-items', title: 'Materiais para reposição', categoryId: 'stock', note: 'Saldo atual comparado ao mínimo cadastrado.',
        modes: [{ id: 'list' as const, label: 'Lista' }], defaultMode: 'list' as const,
        render: () => (report.estoque_baixo?.itens ?? []).length ? <ol className="pcm-canvas-list">{report.estoque_baixo?.itens?.map(item => <li key={item.sku}><span>{item.sku} · {item.nome}<small>Saldo {item.estoque_atual} {item.unidade} · mínimo {item.estoque_minimo} {item.unidade}</small></span><strong>{formatCurrency(item.valor_unitario)}</strong></li>)}</ol> : <EmptyState>Sem itens para reposição.</EmptyState>,
      },
      {
        id: 'result-material-cost-assets', title: 'Materiais por ativo', categoryId: 'stock', note: 'Custo e quantidade de itens consumidos por ativo.',
        modes: [{ id: 'bar' as const, label: 'Barras' }, { id: 'pie' as const, label: 'Pizza' }, { id: 'list' as const, label: 'Lista' }], defaultMode: 'bar' as const,
        onActivate: () => openInsight('Materiais por ativo', 'Custo e itens consumidos por ativo no período.', (report.custos_materiais?.por_ativo ?? []).map((item, index) => ({ id: `report-cost-detail:${index}`, title: `${item.ativo_tag} · ${item.ativo_nome}`, detail: `${item.itens_consumidos} item(ns) · ${formatCurrency(item.custo_total)}` }))),
        render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
          const items = (report.custos_materiais?.por_ativo ?? []).filter(item => !segments?.equipment || `${item.ativo_tag} · ${item.ativo_nome}` === segments.equipment).map((item, index) => ({ id: `${item.ativo_tag}-${index}`, label: `${item.ativo_tag} · ${item.ativo_nome}`, value: Number(item.custo_total), detail: `${item.itens_consumidos} item(ns)` }))
          return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}<small>{item.detail}</small></span><strong>{formatCurrency(item.value)}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Sem consumo de materiais no período." valueLabel="Custo por ativo" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Sem consumo de materiais no período." valueLabel="Custo por ativo" palette={palette} />
        },
      },
      {
        id: 'result-executions', title: 'Execuções concluídas', categoryId: 'results', note: 'Técnico, ativo, duração, pausas e custo de materiais.',
        modes: [{ id: 'list' as const, label: 'Lista' }], defaultMode: 'list' as const,
        render: (_mode: PcmCanvasMode, _palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
          const items = (report.execucoes_detalhadas ?? []).filter(item => (!segments?.equipment || item.ativo_tag === segments.equipment || segments.equipment.startsWith(`${item.ativo_tag} ·`)) && (!segments?.responsible || item.tecnico_nome === segments.responsible))
          return items.length ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.ordem_codigo} · {item.titulo}<small>{item.ativo_tag} · {item.tecnico_nome} · {formatDateTime(item.concluida_em)}</small></span><strong>{duration(item.duracao_segundos)}</strong></li>)}</ol> : <EmptyState>Sem execuções concluídas para os filtros selecionados.</EmptyState>
        },
      },
      {
        id: 'result-export-csv', title: 'Exportar fechamento', categoryId: 'results', note: 'Baixar consolidação do período em CSV.', action: true,
        modes: [{ id: 'number' as const, label: 'Ação' }], defaultMode: 'number' as const,
        render: () => <button type="button" className="pcm-canvas__action" aria-label="Exportar CSV" title="Exportar CSV" onClick={exportPcmReport}><Download size={15} aria-hidden="true" /><span>Exportar CSV</span></button>,
      },
      {
        id: 'result-print-pdf', title: 'Imprimir relatório', categoryId: 'results', note: 'Abrir a impressão do relatório para salvar como PDF.', action: true,
        modes: [{ id: 'number' as const, label: 'Ação' }], defaultMode: 'number' as const,
        render: () => <button type="button" className="pcm-canvas__action" aria-label="Imprimir ou salvar PDF" title="Imprimir ou salvar PDF" onClick={printPcmReport}><Printer size={15} aria-hidden="true" /><span>Imprimir / PDF</span></button>,
      },
      {
        id: 'report-orders-type', title: 'Ordens por tipo', categoryId: 'orders', note: 'Ordens movimentadas no período.',
        modes: [{ id: 'bar' as const, label: 'Barras' }, { id: 'pie' as const, label: 'Pizza' }, { id: 'list' as const, label: 'Lista' }], defaultMode: 'bar' as const,
        onActivate: () => openInsight('Ordens por tipo', 'Distribuição das ordens movimentadas no período.', (report.ordens?.por_tipo ?? []).map(item => ({ id: `report-type:${item.tipo}`, title: humanWorkType(item.tipo), detail: `${item.quantidade} ordem(ns)` }))),
        render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
          const subset = ordersForSegments(segments)
          const items = [...new Set(subset.map(item => humanWorkType(item.type)))].map(label => ({ id: label, label, value: subset.filter(item => humanWorkType(item.type) === label).length }))
          return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Ainda não há ordens no período." valueLabel="Ordens por tipo" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Ainda não há ordens no período." valueLabel="Ordens por tipo" palette={palette} />
        },
      },
      {
        id: 'report-orders-priority', title: 'Fila por prioridade', categoryId: 'orders', note: 'Ordens ainda abertas.',
        modes: [{ id: 'bar' as const, label: 'Barras' }, { id: 'pie' as const, label: 'Pizza' }, { id: 'list' as const, label: 'Lista' }], defaultMode: 'bar' as const,
        onActivate: () => openInsight('Fila por prioridade', 'Distribuição das ordens abertas por prioridade.', (report.ordens?.por_prioridade ?? []).map(item => ({ id: `report-priority:${item.prioridade}`, title: humanPriority(item.prioridade), detail: `${item.quantidade} ordem(ns)` }))),
        render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => {
          const subset = ordersForSegments(segments).filter(item => !isClosedWorkOrder(item.status))
          const items = [...new Set(subset.map(item => humanPriority(item.priority)))].map(label => ({ id: label, label, value: subset.filter(item => humanPriority(item.priority) === label).length }))
          return mode === 'list' ? <ol className="pcm-canvas-list">{items.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.value}</strong></li>)}</ol> : mode === 'pie' ? <PcmPieChart items={items} emptyMessage="Não há ordens abertas para classificar." valueLabel="Ordens por prioridade" palette={palette} /> : <HorizontalBarChart items={items} emptyMessage="Não há ordens abertas para classificar." valueLabel="Ordens por prioridade" palette={palette} />
        },
      },
    ] : []),
  ]

  function openFocusItem(item: InsightItem) {
    if (item.id.startsWith('notification:')) {
      const notification = todayNotifications.find(candidate => candidate.id === item.id.slice('notification:'.length))
      if (!notification) return
      const action = pcmOccurrenceNotificationAction(notification)
      if (action.kind === 'follow') void openWorkOrderById(action.workOrderId)
      else void openCreateOrder('WORK_ORDER', notification)
      return
    }
    const order = operationalOrders.find(candidate => candidate.id === item.id || `order-${candidate.id}` === item.id)
    if (order) {
      if (demoMode) {
        setInsight({ title: item.title, description: 'Registro fictício da demonstração; nenhuma operação será gravada.', items: [item] })
      } else {
        void openOperationalOrder(order)
      }
      return
    }
    setInsight({ title: item.title, description: item.detail, items: [item] })
  }

  async function openWorkOrderById(workOrderId: string, publicCode?: string) {
    const requestGate = detailRequestGateRef.current
    if (!requestGate) return
    const request = requestGate.begin(workOrderId)
    setSelectedWorkOrderId(workOrderId)
    setSelectedWorkOrderCode(publicCode ?? '')
    setSelectedOrderLoading(true)
    setSelectedOrderError('')
    setSelectedOrder(null)
    setReleaseError('')
    setPrepareError('')
    try {
      const detail = await getAdminIntervention(request.workOrderId)
      assertWorkOrderDetailMatchesSelection(detail, request)
      let actionDetail: GestorActionDetail | null = null
      if (detail.acao_id) {
        try { actionDetail = await getGestorActionDetail(detail.acao_id) } catch { /* A OS continua acessível mesmo sem histórico de execução. */ }
      }
      requestGate.commit(request, () => {
        setSelectedOrder(detail)
        setSelectedWorkOrderCode(detail.codigo || publicCode || '')
        setSelectedActionDetail(actionDetail)
      })
    } catch (cause) {
      if (!requestGate.isCurrent(request)) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setSelectedOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar a ordem de serviço.')
    } finally {
      if (requestGate.isCurrent(request)) setSelectedOrderLoading(false)
    }
  }

  async function openOperationalOrder(order: OperationalOrder) {
    await loadOperationalWorkOrder(order, workOrderId => openWorkOrderById(workOrderId, order.code))
  }

  function closeOperationalOrder() {
    detailRequestGateRef.current?.invalidate()
    setSelectedOrder(null)
    setSelectedWorkOrderId('')
    setSelectedWorkOrderCode('')
    setSelectedActionDetail(null)
    setSelectedOrderError('')
    setSelectedOrderLoading(false)
    setReleaseError('')
    setPrepareError('')
  }

  useEffect(() => {
    if (!selectedOrder || selectedOrderLoading || selectedOrder.id !== selectedWorkOrderId) return
    const panel = workOrderDetailPanelRef.current
    const heading = workOrderDetailHeadingRef.current
    if (panel && heading) focusWorkOrderDetail(panel, heading)
  }, [selectedOrder, selectedOrderLoading, selectedWorkOrderId])
  const selectedOrderReadyForRelease = selectedOrder?.status === 'AGUARDANDO_LIBERACAO'
  const selectedOrderReadyForPreparation = selectedOrder !== null && ['RASCUNHO', 'DRAFT', 'DEVOLVIDO_CORRECAO', 'CHANGES_REQUESTED'].includes(normalize(selectedOrder.status))

  const scheduledPreventiveBatch = useMemo(
    () => orders.filter(order => normalize(order.origem) === 'PCM_PREVENTIVE_SCHEDULE' && order.titulo.startsWith('Preventiva programada ')),
    [orders],
  )

  const publishedPlans = useMemo(
    () => displayPlans
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
        assetId: recordText(plan.ativo_id),
        code: recordText(plan.codigo) || plan.id.slice(0, 8).toLocaleUpperCase('pt-BR'),
        name: recordText(plan.nome) || 'Plano sem nome',
        asset: [recordText(plan.ativo_tag), recordText(plan.ativo_nome)].filter(Boolean).join(' · ') || 'Equipamento não informado',
        workType: recordText(plan.tipo) || 'PREVENTIVE',
        recurrenceDays: Number.isFinite(Number(plan.recorrencia_dias)) ? Number(plan.recorrencia_dias) : null,
      })),
    [displayPlans],
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
    () => displayPlans.filter(plan => normalize(recordText(plan.versao_status)) === 'DRAFT').length,
    [displayPlans],
  )

  const selectedCreatePlan = executablePlans.find(plan => plan.versionId === createPlanVersionId) ?? null

  function resetCreateOrderForm() {
    setCreatePlanVersionId('')
    setCreateTitle('')
    setCreateDescription('')
    setCreatePriority('MEDIUM')
    setCreateRequiresPostIntervention(false)
    setCreateQualityValidation(false)
    setCreateSafetyValidation(false)
    setCreateExecutionMode('INTERNAL')
    setCreateImprovementCategory('MODIFICATION')
    setCreateScheduledFor('')
    setCreateOriginEntityId('')
    setImprovementRequestId('')
    setCreateOriginAssetId('')
    setCreateOriginAssetTag('')
    setCreateOriginAssetName('')
    setCreateOriginType('')
    setCreateOriginLoading(false)
    setCreateOrderError('')
  }

  function openImprovementRequest(request: ImprovementRequestSummary) {
    void openCreateOrder('IMPROVEMENT').then(() => {
      setImprovementRequestId(request.id)
      setCreateOriginAssetId(request.ativo_id)
      setCreateOriginAssetTag(request.ativo_tag)
      setCreateOriginAssetName(request.ativo_nome)
      setCreateImprovementCategory(request.categoria)
      setCreateTitle(request.sugestao)
      setCreateDescription(request.motivo)
    })
  }

  function closeCreateOrder() {
    createOccurrenceAssetResolverRef.current?.cancel()
    setCreateOrderOpen(false)
    resetCreateOrderForm()
  }

  async function openCreateOrder(mode: 'WORK_ORDER' | 'PREVENTIVE' | 'IMPROVEMENT' = 'WORK_ORDER', notification?: GestorNotification) {
    createOccurrenceAssetResolverRef.current?.cancel()
    resetCreateOrderForm()
    setCreateOrderMode(mode)
    setCreateOrderOpen(true)
    setCreateOrderError('')
    setCreateOrderSuccess('')
    if (notification) {
      setCreateTitle(notification.titulo)
      setCreateDescription(notification.mensagem || `OS originada da notificação: ${notification.titulo}.`)
      setCreatePriority(normalize(notification.prioridade || 'MEDIUM'))
      setCreateOriginEntityId(notification.entidade_id || '')
      setCreateOriginLoading(true)
      const resolution = await createOccurrenceAssetResolverRef.current!.resolve(notification.entidade_id ?? '')
      if (resolution.status === 'stale') return
      setCreateOriginLoading(false)
      if (resolution.status === 'error') {
        setCreateOrderError(resolution.message)
      } else {
        const { context } = resolution
        const matchingPlan = executablePlans.find(plan => plan.assetId === context.assetId)
        setCreateOriginAssetId(context.assetId)
        setCreateOriginAssetTag(context.assetTag)
        setCreateOriginAssetName(context.assetName)
        setCreateOriginType(context.occurrenceType)
        if (matchingPlan) setCreatePlanVersionId(matchingPlan.versionId)
      }
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
    const canBootstrapCorrective = createOrderMode === 'WORK_ORDER' && Boolean(createOriginEntityId && createOriginAssetId)
    const canBootstrapImprovement = createOrderMode === 'IMPROVEMENT' && Boolean(createOriginAssetId)
    const postInterventionPolicy = selectedPostInterventionPolicy(
      createQualityValidation,
      createSafetyValidation,
    )
    if ((!selectedCreatePlan && !canBootstrapCorrective && !canBootstrapImprovement) || createTitle.trim().length < 3 || createDescription.trim().length < 3) {
      setCreateOrderError('Informe título e descrição com pelo menos 3 caracteres e confirme o ativo da ocorrência.')
      return
    }
    if (createOrderMode === 'PREVENTIVE' && !createScheduledFor) {
      setCreateOrderError('Informe a data e hora da preventiva programada.')
      return
    }
    const policySelectionError = postInterventionPolicySelectionError(
      createRequiresPostIntervention,
      postInterventionPolicy,
    )
    if (policySelectionError) {
      setCreateOrderError(policySelectionError)
      return
    }
    setCreateOrderBusy(true)
    setCreateOrderError('')
    try {
      const releaseForMaintenance = Boolean(createOriginEntityId)
      const created = await saveAdminIntervention({
        origem: createOrderMode === 'PREVENTIVE'
          ? 'PCM_PREVENTIVE_SCHEDULE'
          : improvementRequestId
            ? 'IMPROVEMENT_REQUEST'
          : createOrderMode === 'IMPROVEMENT'
            ? 'PCM_IMPROVEMENT'
          : createOriginEntityId
            ? 'OCCURRENCE'
            : 'PCM',
        entidade_origem_id: improvementRequestId || createOriginEntityId || undefined,
        ...(selectedCreatePlan ? { plano_versao_id: selectedCreatePlan.versionId } : {}),
        ativo_id: selectedCreatePlan ? undefined : createOriginAssetId || undefined,
        ativo_tag: selectedCreatePlan ? undefined : createOriginAssetTag || undefined,
        tipo: createOrderMode === 'IMPROVEMENT' ? 'MELHORIA' : selectedCreatePlan?.workType ?? 'CORRETIVA',
        modo_execucao: createExecutionMode,
        categoria_melhoria: createOrderMode === 'IMPROVEMENT' ? createImprovementCategory : null,
        titulo: createTitle.trim(),
        descricao: createDescription.trim(),
        prioridade: createPriority,
        modo_parada_manutencao: 'NO_STOP',
        planejada_para: createScheduledFor || undefined,
        exige_liberacao_pos_intervencao: createRequiresPostIntervention,
      })
      if (releaseForMaintenance || createRequiresPostIntervention) {
        await sendAdminInterventionForValidation({
          intervencao_id: created.id,
          politica_assinatura: postInterventionPolicy ?? 'QUALIDADE_OU_SEGURANCA',
          comentario: 'OS criada pelo PCM com a configuração de validação selecionada.',
          exige_segregacao: 'NAO',
        })
      }
      if (releaseForMaintenance) {
        // A validação pós-intervenção permanece pendente para Qualidade ou Segurança,
        // mas nunca deve impedir a equipe de iniciar a execução da OS.
        await releaseMaintenanceWorkOrder(created.id)
      }
      closeCreateOrder()
      setCreateOrderSuccess(releaseForMaintenance
        ? `OS ${created.codigo} criada e liberada para a equipe de Manutenção. O primeiro técnico a iniciá-la será registrado como executor.${createRequiresPostIntervention ? ` ${postInterventionPolicyLabel(true, postInterventionPolicy)} validará a conclusão após a execução.` : ''}`
        : createOrderMode === 'PREVENTIVE'
        ? createRequiresPostIntervention
          ? `Preventiva ${created.codigo} preparada com validação pós-intervenção de ${postInterventionPolicyLabel(true, postInterventionPolicy)}. Libere-a para a equipe de Manutenção quando estiver pronta.`
          : `Preventiva ${created.codigo} programada como rascunho. Prepare-a e libere-a para a equipe de Manutenção.`
        : createOrderMode === 'IMPROVEMENT'
        ? createRequiresPostIntervention
          ? `Melhoria ${created.codigo} preparada com validação pós-intervenção de ${postInterventionPolicyLabel(true, postInterventionPolicy)}. Libere-a para a equipe de Manutenção quando estiver pronta.`
          : `Melhoria ${created.codigo} criada como rascunho. Prepare-a e libere-a para a equipe de Manutenção.`
        : createRequiresPostIntervention
          ? `OS ${created.codigo} preparada com validação pós-intervenção de ${postInterventionPolicyLabel(true, postInterventionPolicy)}. Libere-a para a equipe de Manutenção quando estiver pronta.`
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

  async function registerExternalService() {
    if (!selectedOrder || externalProvider.trim().length < 2 || externalDescription.trim().length < 3) return
    const parsedAmount = externalAmount.trim() === '' ? null : Number(externalAmount)
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setExternalNotice('Informe um valor válido ou deixe-o pendente.')
      return
    }
    setExternalBusy(true); setExternalNotice('')
    try {
      await createExternalService(selectedOrder.id, { provider: externalProvider.trim(), description: externalDescription.trim(), amount: parsedAmount, serviceDate: externalDate || null, notes: null })
      const detail = await getAdminIntervention(selectedOrder.id)
      setSelectedOrder(detail)
      setExternalProvider(''); setExternalDescription(''); setExternalAmount(''); setExternalDate('')
      setExternalNotice('Serviço externo registrado e custos recalculados pelo servidor.')
    } catch (cause) {
      setExternalNotice(cause instanceof Error ? cause.message : 'Não foi possível registrar o serviço externo.')
    } finally { setExternalBusy(false) }
  }

  async function complementMaterialCost(materialUsageId: string) {
    const value = Number(materialCostDrafts[materialUsageId])
    if (!Number.isFinite(value) || value < 0 || !selectedOrder) return
    await updateMaterialUsageCost(materialUsageId, value)
    const detail = await getAdminIntervention(selectedOrder.id)
    setSelectedOrder(detail)
    if (detail.acao_id) setSelectedActionDetail(await getGestorActionDetail(detail.acao_id))
  }


  return (
    <section className={`pcm-dashboard pcm-dashboard--desktop${insight ? ' pcm-dashboard--focus' : ''}`} aria-label="Dashboard do PCM" aria-busy={loading}>
      <header className="pcm-heading">
        <div>
          <h1>Visão de manutenção</h1>
          {displayData?.atualizado_em && !demoMode ? <small className="pcm-heading__updated" title="Os dados são atualizados automaticamente a cada cinco minutos, ao voltar para esta aba ou quando a conexão é restabelecida.">Atualizado {formatDateTime(displayData.atualizado_em)}</small> : null}
        </div>

        <div className="pcm-heading__tools">
          <button type="button" className="pcm-demo-toggle" aria-pressed={demoMode} disabled={createOrderOpen} onClick={() => { setDemoMode(value => !value); setInsight(null) }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h16M7 15l4-4 3 2 5-6"/><circle cx="19" cy="7" r="1.5"/></svg>
            {demoMode ? 'Voltar aos dados reais' : 'Ver demonstração'}
          </button>
          {maintenanceStatus ? <span className={`pcm-dashboard-condition pcm-dashboard-condition--${maintenanceStatus.toLowerCase()}`}>
            <i aria-hidden="true" /> {maintenanceStatusLabel(maintenanceStatus)}
          </span> : null}
          <div className="pcm-controls">
            <label>
              Período
              <select value={days} onChange={event => setDays(event.target.value)}>
                <option value="7">7 dias</option>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">12 meses</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      {demoMode ? <div className="pcm-demo-banner" role="status"><strong>Demonstração fictícia</strong><span>Exemplos locais para avaliar a tela. Nenhum dado será gravado na empresa.</span></div> : null}

      <section className="pcm-notification-rail" aria-labelledby="pcm-today-notifications-title">
        <header>
          <span className="pcm-notification-rail__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
          </span>
          <h2 id="pcm-today-notifications-title">Avisos</h2>
          <span className="pcm-notification-rail__count">{demoMode ? 2 : pendingTodayNotifications.length}</span>
        </header>
        {!demoMode && notificationsError ? <p className="pcm-today-notifications__error" role="alert">{notificationsError}</p> : null}
        {demoMode ? <ul className="pcm-notification-rail__list">
          <li><button type="button" className="pcm-notification-rail__item pcm-notification-rail__item--shortcut is-critical" title="Ver os detalhes do aviso" onClick={() => openInsight('Parada crítica · EQ-PA-01', 'Ativo parado com ordem crítica aberta. Selecione o registro para consultar os detalhes.', [{ id: 'demo-critical-1', title: 'OS-204 · Pasteurizador 01', detail: 'Linha de manteiga · parada desde 08:40', status: 'Crítica' }])}><strong>Parada crítica · EQ-PA-01</strong><span aria-hidden="true">›</span></button></li>
          <li><button type="button" className="pcm-notification-rail__item pcm-notification-rail__item--shortcut is-high" title="Ir para os planos preventivos" onClick={showPreventivePlans}><strong>3 preventivas nesta semana</strong><span aria-hidden="true">›</span></button></li>
        </ul> : pendingTodayNotifications.length ? (
          <ul className="pcm-notification-rail__list">
            {pendingTodayNotifications.slice(0, 3).map(notification => {
              const action = pcmOccurrenceNotificationAction(notification)
              return <li key={notification.id}>
                <button type="button" className={`pcm-notification-rail__item is-${normalize(notification.prioridade || 'MEDIA').toLowerCase()}`} title="Ver detalhes do aviso" onClick={() => showNotificationDetails(notification)}>
                  <strong>{notification.titulo}</strong>
                </button>
              </li>
            })}
          </ul>
        ) : null}
      </section>

    {!demoMode && error && (
        <div className="dashboard-error" role="alert">
          {error}
          {displayData && ' Os dados abaixo são da última atualização bem-sucedida.'}
        </div>
    )}
    {assignmentSuccess ? <div className="pcm-assignment-success" role="status">{assignmentSuccess}</div> : null}
    {createOrderSuccess ? <div className="pcm-assignment-success" role="status">{createOrderSuccess}</div> : null}

      {!displayData && loading && (
        <div className="pcm-loading" role="status">
          <span className="pcm-loading__dot" />
          Consultando ordens, paradas e execuções…
        </div>
      )}

      {displayData && current && reliability && maintenanceStatus && (
        insight ? <InsightWorkspace insight={insight} onClose={() => setInsight(null)} onSelect={openFocusItem} /> : <>
      <PcmDashboardCanvas categories={pcmCanvasCategories} widgets={pcmCanvasWidgets} segmentFilters={pcmCanvasSegmentFilters} onPrintCanvas={printPcmCanvas} helpContent={<details className="pcm-method pcm-method--help">
            <summary>Como usar e interpretar a lousa</summary>
            <p>Adicione indicadores pelo botão “+”, organize-os arrastando os cartões e use a paleta de cada cartão para definir visual, aparência e filtros próprios. Salve o layout para reutilizar sua organização.</p>
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
          </details>} />

          <div className="pcm-workbench">
            <section className="pcm-focus-board" aria-labelledby="pcm-focus-board-title">
              <header className="pcm-workbench__heading">
                <div><h2 id="pcm-focus-board-title" className="pcm-context-help" title="Ordens abertas organizadas por prioridade e vencimento. Selecione uma ordem para ver os detalhes.">Fila prioritária</h2></div>
                <button type="button" className="pcm-workbench__text-action" onClick={showOperationalQueue}>Abrir fila completa</button>
              </header>
              {alerts.some(alert => alert.level !== 'info') ? <ul className="pcm-focus-board__signals" aria-label="Alertas operacionais">
                {alerts.filter(alert => alert.level !== 'info').slice(0, 2).map(alert => <li className={`pcm-focus-board__signal pcm-focus-board__signal--${alert.level}`} key={alert.title}>
                  <span aria-hidden="true" />
                  <div><strong>{alert.title}</strong><small>{alert.detail}</small></div>
                </li>)}
              </ul> : <p className="pcm-focus-board__clear">Sem alertas prioritários no momento.</p>}
              {priorityQueueOrders.length ? <ol className="pcm-priority-orders">
                {priorityQueueOrders.map(item => {
                  const window = scheduleWindow(item.deadline, item.status)
                  return <li key={item.id}>
                    <button type="button" data-priority={normalize(item.priority)} onClick={() => demoMode ? openInsight(item.code, 'Registro fictício da demonstração; nenhuma operação será gravada.', [{ id: item.id, title: item.equipment, detail: `${item.sector} · ${humanWorkType(item.type)} · responsável: ${item.responsible}`, status: humanStatus(item.status) }]) : void openOperationalOrder(item)} aria-label={`Abrir ordem ${item.code}, ${item.equipment}`}>
                      <span className="pcm-priority-orders__marker" aria-hidden="true" />
                      <span className="pcm-priority-orders__body">
                        <strong>{item.code} · {item.equipment}</strong>
                        <small>{item.sector} · {humanWorkType(item.type)} · {humanStatus(item.status)}</small>
                      </span>
                      <span className={`pcm-priority-orders__deadline${window?.tone === 'late' ? ' is-late' : ''}`}>
                        {window?.label ?? (item.deadline ? formatDateTime(item.deadline) : 'Sem programação')}
                      </span>
                      <span className={`pcm-order-badge pcm-order-badge--priority-${normalize(item.priority).replaceAll(' ', '-')}`}>{humanPriority(item.priority)}</span>
                    </button>
                  </li>
                })}
              </ol> : <div className="pcm-focus-board__empty"><strong>Fila em dia</strong><span>Nenhuma ordem aberta precisa de acompanhamento.</span></div>}
            </section>

            <aside className="pcm-pcm-routine" aria-label="Ações e programação do PCM">
              <section className="pcm-routine-actions">
                <header className="pcm-workbench__heading">
                  <div><h2 className="pcm-context-help" title="Acesse o agendamento preventivo, a abertura de ordens e o registro de melhorias.">Próximas ações</h2></div>
                </header>
                <div className="pcm-routine-actions__list">
                  <button type="button" className="pcm-routine-action pcm-routine-action--primary" onClick={() => void openCreateOrder('PREVENTIVE')} disabled={demoMode || plansLoading || preventivePlans.length === 0}>
                    <span className="pcm-routine-action__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M7 3v8m10-8v8M5 11h14v10H5z"/><path d="m9 16 2 2 4-4"/></svg></span>
                    <span><strong>Programar preventiva</strong></span>
                    <span aria-hidden="true">›</span>
                  </button>
                  <button type="button" className="pcm-routine-action" onClick={() => void openCreateOrder()} disabled={demoMode || plansLoading || publishedPlans.length === 0}>
                    <span className="pcm-routine-action__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7m-7 4h7"/></svg></span>
                    <span><strong>Criar ordem de serviço</strong></span>
                    <span aria-hidden="true">›</span>
                  </button>
                  <button type="button" className="pcm-routine-action" onClick={() => void openCreateOrder('IMPROVEMENT')} disabled={demoMode}>
                    <span className="pcm-routine-action__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
                    <span><strong>Registrar melhoria</strong></span>
                    <span aria-hidden="true">›</span>
                  </button>
                </div>
              </section>

              <section className="pcm-upcoming-preventives" aria-labelledby="pcm-upcoming-preventives-title">
                <header>
                  <div><span className="pcm-section-kicker">PRÓXIMOS 7 DIAS</span><h3 id="pcm-upcoming-preventives-title">Preventivas programadas</h3></div>
                  <button type="button" className="pcm-workbench__text-action" onClick={showPreventivePlans}>Ver planos</button>
                </header>
                {displayData.preventivas.length ? <ul>
                  {displayData.preventivas.slice(0, 3).map(item => <li key={item.id}>
                    <button type="button" onClick={() => openInsight('Preventivas próximas', 'Preventivas abertas programadas para os próximos 7 dias.', dailyInsights.preventive)}>
                      <strong>{item.codigo} · {item.ativo_tag}</strong>
                      <small>{formatDateTime(item.programada_para)}</small>
                    </button>
                  </li>)}
                </ul> : <p>Sem preventivas programadas para os próximos 7 dias.</p>}
              </section>
            </aside>
          </div>



          {!demoMode && improvementRequests.some(request => request.status === 'OPEN') ? <section className="pcm-panel pcm-orders" aria-labelledby="pcm-improvement-requests-title">
            <div className="pcm-panel__heading pcm-orders__heading"><div><span className="pcm-section-kicker">MELHORIAS</span><h2 id="pcm-improvement-requests-title">Solicitações da equipe técnica</h2></div></div>
            <div className="pcm-orders__table-wrap"><table className="pcm-orders__table"><thead><tr><th>Equipamento</th><th>Categoria</th><th>Sugestão</th><th>Solicitante</th><th>Ação</th></tr></thead><tbody>
              {improvementRequests.filter(request => request.status === 'OPEN').map(request => <tr key={request.id}><td><strong>{request.ativo_tag}</strong><br /><small>{request.ativo_nome}</small></td><td>{humanStatus(request.categoria)}</td><td><strong>{request.sugestao}</strong><br /><small>{request.motivo}</small></td><td>{request.solicitante_nome}<br /><small>{request.solicitante_matricula}</small></td><td><button type="button" className="pcm-order-link" onClick={() => openImprovementRequest(request)}>Avaliar e converter</button></td></tr>)}
            </tbody></table></div>
          </section> : null}

          <section className="pcm-panel pcm-orders" id="pcm-operational-queue">
            <div className="pcm-panel__heading pcm-orders__heading">
              <div>
                <span className="pcm-section-kicker">ORDENS DE SERVIÇO</span>
                <h2>Fila operacional</h2>
              </div>
              <div className="pcm-orders__heading-actions">
                <button type="button" className="pcm-orders__export" onClick={() => void openCreateOrder('IMPROVEMENT')} disabled={demoMode}>Nova melhoria</button>
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

            {!demoMode && orderError && <div className="dashboard-error" role="alert">{orderError}</div>}

            {!demoMode && orderLoading ? (
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
                        <td><button type="button" className="pcm-order-link" aria-label={`Abrir detalhes da ordem ${item.code}`} aria-controls={selectedWorkOrderId === item.raw.id ? 'pcm-operational-order-detail' : undefined} aria-expanded={selectedWorkOrderId === item.raw.id} onClick={() => demoMode ? openInsight(item.code, 'Registro fictício da demonstração; nenhuma operação será gravada.', [{ id: item.id, title: item.equipment, detail: `${item.sector} · ${humanWorkType(item.type)} · responsável: ${item.responsible}`, status: humanStatus(item.status) }]) : void openOperationalOrder(item)}>{item.code}</button></td>
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
            <section id="pcm-operational-order-detail" ref={workOrderDetailPanelRef} className="pcm-panel pcm-order-detail" aria-busy={selectedOrderLoading} aria-live="polite">
              <div className="pcm-panel__heading pcm-order-detail__heading">
                <div>
                  <span className="pcm-section-kicker">ORDEM DE SERVIÇO</span>
                  <h2 ref={workOrderDetailHeadingRef} tabIndex={-1}>{workOrderDetailHeadingCode(selectedOrder?.codigo, selectedWorkOrderCode)}</h2>
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
                    <div className="pcm-order-detail__fact pcm-order-detail__fact--wide">
                      <dt>Validação pós-intervenção</dt>
                      <dd>{postInterventionPolicyLabel(
                        selectedOrder.exige_liberacao_pos_intervencao === true,
                        selectedOrder.demanda?.politica_assinatura,
                      )}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Prioridade</dt>
                      <dd>{humanPriority(selectedOrder.prioridade)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Tipo</dt>
                      <dd>{humanWorkType(selectedOrder.tipo)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Modo</dt>
                      <dd>{humanExecutionMode(selectedOrder.modo_execucao)}</dd>
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
                  {selectedOrder.auditoria?.length ? <section className="pcm-order-audit" aria-label="Linha do tempo da OS">
                    <div>
                      <span className="pcm-section-kicker">AUDITORIA</span>
                      <h3>Linha do tempo da OS</h3>
                      <p>Eventos registrados automaticamente durante o ciclo da ordem.</p>
                    </div>
                    <ol>
                      {selectedOrder.auditoria.map((event, index) => <li key={`${event.entidade_id}-${event.acao}-${event.ocorreu_em}-${index}`}>
                        <i aria-hidden="true" />
                        <div>
                          <strong>{humanAuditAction(event.acao)}</strong>
                          <span>{event.usuario || 'Sistema'} · {formatDateTime(event.ocorreu_em)}</span>
                        </div>
                      </li>)}
                    </ol>
                  </section> : null}
                  {selectedActionDetail?.materiais?.length ? <section className="pcm-order-assignment"><h3>Materiais e custo da OS</h3><p>Saídas registradas pelo técnico. Valores desconhecidos podem ser complementados sem alterar a conclusão técnica.</p><ul>{selectedActionDetail.materiais.map((material, index) => { const data = material as Record<string, unknown>; const id = String(data.id ?? index); const quantity = Number(data.quantidade ?? 0); const unitCost = data.valor_unitario === null || data.valor_unitario === undefined ? null : Number(data.valor_unitario); const total = data.custo_total === null || data.custo_total === undefined ? null : Number(data.custo_total); const name = String(data.nome_facil ?? data.nome ?? 'Material'); return <li key={id}><strong>{String(data.sku ?? 'Sem SKU')} · {name}</strong><span> — {quantity} {String(data.unidade ?? '')} · {unitCost === null ? 'Preço pendente' : `${formatCurrency(unitCost)} cada · total ${formatCurrency(total ?? 0)}`}</span>{unitCost === null && data.id ? <span><input aria-label={`Valor unitário de ${name}`} type="number" min="0" step="0.0001" value={materialCostDrafts[id] ?? ''} onChange={event => setMaterialCostDrafts(current => ({ ...current, [id]: event.target.value }))} /><button type="button" onClick={() => void complementMaterialCost(id)}>Salvar valor</button></span> : null}</li> })}</ul></section> : null}
                  <section className="pcm-order-assignment"><h3>Custos realizados</h3><p>Materiais: <strong>{formatCurrency(selectedOrder.custos?.materiais ?? 0)}</strong> · Serviços externos: <strong>{formatCurrency(selectedOrder.custos?.servicos_externos ?? 0)}</strong> · Total: <strong>{formatCurrency(selectedOrder.custos?.total_realizado ?? 0)}</strong></p>{selectedOrder.custos?.dados_financeiros_pendentes ? <p>Há valores pendentes de complementação financeira; isso não bloqueia a conclusão técnica.</p> : null}{selectedOrder.servicos_externos?.length ? <ul>{selectedOrder.servicos_externos.map(service => <li key={service.id}><strong>{service.prestador}</strong> — {service.descricao} · {service.valor === null ? 'Valor pendente' : formatCurrency(service.valor)}</li>)}</ul> : <p>Nenhum serviço externo registrado.</p>}{selectedOrder.modo_execucao !== 'INTERNAL' ? <div className="pcm-create-order-modal__form"><label>Prestador<input value={externalProvider} maxLength={240} onChange={event => setExternalProvider(event.target.value)} /></label><label>Descrição<input value={externalDescription} maxLength={2000} onChange={event => setExternalDescription(event.target.value)} /></label><label>Valor (opcional)<input type="number" min="0" step="0.01" value={externalAmount} onChange={event => setExternalAmount(event.target.value)} /></label><label>Data (opcional)<input type="date" value={externalDate} onChange={event => setExternalDate(event.target.value)} /></label><button type="button" disabled={externalBusy || externalProvider.trim().length < 2 || externalDescription.trim().length < 3} onClick={() => void registerExternalService()}>{externalBusy ? 'Registrando…' : 'Registrar serviço externo'}</button>{externalNotice ? <p role="status">{externalNotice}</p> : null}</div> : null}</section>
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
            <button type="button" onClick={() => void openCreateOrder('PREVENTIVE')} disabled={demoMode || plansLoading || preventivePlans.length === 0}>Programar preventiva</button>
            {!demoMode ? <>
              <button type="button" onClick={() => void schedulePreventivesForNext30Days()} disabled={plansLoading || batchSchedulingBusy || preventivePlans.length < 20}>{batchSchedulingBusy ? 'Programando 20 OS…' : 'Programar 20 · 30 dias'}</button>
              <button type="button" onClick={() => void prepareAndAssignScheduledPreventives()} disabled={batchPreparationBusy || scheduledPreventiveBatch.length === 0}>{batchPreparationBusy ? 'Preparando calendário…' : `Preparar e liberar ${scheduledPreventiveBatch.length || ''}`}</button>
            </> : null}
          </div>
        </div>
        {!demoMode && plansLoading ? <p className="pcm-empty">Carregando planos preventivos…</p> : !demoMode && plansError ? <p className="pcm-order-detail__error" role="alert">{plansError}</p> : <>
          <div className="pcm-plans-overview__metrics">
            <div><strong>{publishedPlans.length}</strong><span>publicados e prontos</span></div>
            <div><strong>{plansAwaitingOem}</strong><span>aguardando validação OEM</span></div>
            <div><strong>{publishedPlans.filter(plan => plan.recurrenceDays !== null).length}</strong><span>com periodicidade definida</span></div>
          </div>
          {!demoMode && batchSchedulingNotice ? <p className="pcm-plans-overview__notice" role="status">{batchSchedulingNotice}</p> : null}
          {publishedPlans.length ? <div className="pcm-plans-overview__list">
            {publishedPlans.slice(0, 6).map(plan => <article key={plan.versionId}>
              <strong>{plan.code}</strong>
              <span>{plan.name}</span>
              <small>{plan.asset}{plan.recurrenceDays ? ` · a cada ${plan.recurrenceDays} dias` : ' · agendamento manual'}</small>
            </article>)}
          </div> : <p className="pcm-empty">Nenhum plano preventivo publicado está disponível.</p>}
        </>}
      </section>

          {createOrderOpen ? <section ref={createOrderPanelRef} id="pcm-create-order-panel" className="pcm-panel pcm-create-order-panel pcm-create-order-modal" aria-labelledby="pcm-create-order-title" aria-describedby="pcm-create-order-description">
              <header className="pcm-create-order-modal__header">
                <div>
                  <span className="pcm-section-kicker">ORDEM DE SERVIÇO</span>
                  <h2 id="pcm-create-order-title" tabIndex={-1}>{createOrderMode === 'PREVENTIVE' ? 'Programar preventiva' : createOrderMode === 'IMPROVEMENT' ? 'Criar OS de melhoria' : 'Criar ordem de serviço'}</h2>
                  <p id="pcm-create-order-description">{createOriginEntityId ? 'Revise os dados da ocorrência antes de criar a OS.' : createOrderMode === 'PREVENTIVE' ? 'Escolha um plano preventivo publicado e informe quando a OS deve ser executada.' : createOrderMode === 'IMPROVEMENT' ? 'Escolha o equipamento e classifique a melhoria sem criar burocracia adicional.' : 'Escolha um plano publicado para definir o equipamento e o tipo de manutenção.'}</p>
                </div>
                <button className="pcm-create-order-modal__close" type="button" aria-label="Fechar criação da ordem de serviço" onClick={closeCreateOrder} disabled={createOrderBusy}>×</button>
              </header>

              <div className="pcm-create-order-modal__body">
                {createOriginEntityId ? <section className="pcm-create-order-modal__section pcm-create-order-modal__origin" aria-labelledby="pcm-origin-title">
                  <div className="pcm-create-order-modal__section-heading">
                    <span>ORIGEM DA SOLICITAÇÃO</span>
                    <h3 id="pcm-origin-title">Ocorrência operacional</h3>
                  </div>
                  {createOriginLoading ? <p className="pcm-create-order-modal__loading" role="status">Carregando equipamento da ocorrência…</p> : createOriginAssetId ? <dl className="pcm-create-order-modal__origin-grid">
                    <div><dt>Equipamento</dt><dd>{createOriginAssetName || 'Nome não informado'}</dd></div>
                    <div><dt>Código</dt><dd>{createOriginAssetTag || 'Não informado'}</dd></div>
                    <div><dt>Tipo</dt><dd>{createOriginType ? humanStatus(createOriginType) : 'Não informado'}</dd></div>
                    <div><dt>Prioridade</dt><dd><span className={`pcm-create-order-modal__priority is-${normalize(createPriority).toLowerCase()}`}>{humanPriority(createPriority)}</span></dd></div>
                  </dl> : <p className="pcm-create-order-modal__empty">O equipamento da ocorrência ainda não foi localizado.</p>}
                  {selectedCreatePlan ? <p className="pcm-create-order-modal__plan">Plano aplicável: <strong>{selectedCreatePlan.code} · {selectedCreatePlan.name}</strong></p> : createOriginAssetId ? <p className="pcm-create-order-modal__plan">Será criado um checklist corretivo padrão, auditado e vinculado a este equipamento.</p> : null}
                </section> : createOrderMode === 'IMPROVEMENT' ? <section className="pcm-create-order-modal__section" aria-labelledby="pcm-plan-title"><div className="pcm-create-order-modal__section-heading"><span>ORIGEM DA SOLICITAÇÃO</span><h3 id="pcm-plan-title">Equipamento da melhoria</h3></div><label>Equipamento<select value={createOriginAssetId} onChange={event => { const asset=assetCatalog.find(candidate => recordText(candidate.id)===event.target.value); setCreateOriginAssetId(event.target.value); setCreateOriginAssetTag(recordText(asset?.tag)); setCreateOriginAssetName(recordText(asset?.nome)) }}><option value="">Selecione o equipamento</option>{assetCatalog.map(asset => <option key={recordText(asset.id)} value={recordText(asset.id)}>{recordText(asset.tag)} · {recordText(asset.nome)}</option>)}</select></label></section> : <section className="pcm-create-order-modal__section" aria-labelledby="pcm-plan-title">
                  <div className="pcm-create-order-modal__section-heading"><span>ORIGEM DA SOLICITAÇÃO</span><h3 id="pcm-plan-title">Plano e equipamento</h3></div>
                  <label>Plano publicado
                    <select value={createPlanVersionId} onChange={event => selectCreatePlan(event.target.value)} disabled={createOrderBusy || createPlansLoading}>
                      <option value="">{createPlansLoading ? 'Carregando planos…' : createOrderMode === 'PREVENTIVE' ? 'Selecione um plano preventivo' : 'Selecione um plano publicado'}</option>
                      {executablePlans.map(plan => <option key={plan.versionId} value={plan.versionId}>{plan.code} · {plan.name} · {plan.asset}</option>)}
                    </select>
                  </label>
                  {selectedCreatePlan ? <p className="pcm-create-order-modal__context">Equipamento: <strong>{selectedCreatePlan.asset}</strong> · Tipo: <strong>{humanWorkType(selectedCreatePlan.workType)}</strong>{createOrderMode === 'PREVENTIVE' && selectedCreatePlan.recurrenceDays ? <> · Recorrência: <strong>{selectedCreatePlan.recurrenceDays} dias</strong></> : null}</p> : null}
                  {!createPlansLoading && createPlans.length > 0 && executablePlans.length === 0 ? <p className="pcm-order-detail__error">{createOrderMode === 'PREVENTIVE' ? 'Não há plano preventivo ativo e publicado com checklist disponível.' : 'Não há plano ativo e publicado com checklist disponível.'}</p> : null}
                </section>}

                <section className="pcm-create-order-modal__section" aria-labelledby="pcm-order-data-title">
                  <div className="pcm-create-order-modal__section-heading"><span>DADOS DA ORDEM DE SERVIÇO</span><h3 id="pcm-order-data-title">Informações para execução</h3></div>
                  <div className="pcm-create-order-modal__fields">
                    <label className="is-wide">Título<input value={createTitle} onChange={event => setCreateTitle(event.target.value)} maxLength={240} disabled={createOrderBusy} /></label>
                    <label className="is-wide">Descrição<textarea value={createDescription} onChange={event => setCreateDescription(event.target.value)} maxLength={8000} rows={4} disabled={createOrderBusy} /></label>
                    <label>Prioridade<select value={createPriority} onChange={event => setCreatePriority(event.target.value)} disabled={createOrderBusy}><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
                    <label>Modo de execução<select value={createExecutionMode} onChange={event => setCreateExecutionMode(event.target.value as 'INTERNAL' | 'EXTERNAL' | 'MIXED')} disabled={createOrderBusy}><option value="INTERNAL">Interna</option><option value="EXTERNAL">Externa</option><option value="MIXED">Mista</option></select></label>
                    {createOrderMode === 'IMPROVEMENT' ? <label>Categoria<select value={createImprovementCategory} onChange={event => setCreateImprovementCategory(event.target.value as typeof createImprovementCategory)} disabled={createOrderBusy}><option value="MODIFICATION">Modificação</option><option value="MANUFACTURE">Fabricação</option><option value="INSTALLATION">Instalação</option><option value="ADEQUACY">Adequação</option><option value="OTHER">Outra</option></select></label> : null}
                    <label>Programada para{createOrderMode === 'PREVENTIVE' ? '' : ' (opcional)'}<input type="datetime-local" value={createScheduledFor} onChange={event => setCreateScheduledFor(event.target.value)} disabled={createOrderBusy} required={createOrderMode === 'PREVENTIVE'} /></label>
                  </div>
                </section>

                <section className="pcm-create-order-modal__section" aria-labelledby="pcm-post-intervention-title">
                  <div className="pcm-create-order-modal__section-heading"><span>VALIDAÇÃO PÓS-INTERVENÇÃO</span><h3 id="pcm-post-intervention-title">Liberação formal</h3></div>
                  <label className="pcm-create-order-modal__post-intervention"><input type="checkbox" checked={createRequiresPostIntervention} onChange={event => {
                    const required = event.target.checked
                    setCreateRequiresPostIntervention(required)
                    if (!required) {
                      setCreateQualityValidation(false)
                      setCreateSafetyValidation(false)
                    }
                  }} disabled={createOrderBusy} /><span><strong>Exigir liberação pós-intervenção</strong><small>Quando marcada, a OS aguardará as validações das áreas selecionadas após a conclusão técnica.</small></span></label>
                  {createRequiresPostIntervention ? (
                    <fieldset className="pcm-post-intervention-areas" disabled={createOrderBusy}>
                      <legend>Áreas responsáveis pela liberação *</legend>
                      <label><input type="checkbox" checked={createQualityValidation} onChange={event => {
                        setCreateQualityValidation(event.target.checked)
                        setCreateOrderError('')
                      }} /> Qualidade</label>
                      <label><input type="checkbox" checked={createSafetyValidation} onChange={event => {
                        setCreateSafetyValidation(event.target.checked)
                        setCreateOrderError('')
                      }} /> Segurança</label>
                      {createOrderError.includes('Selecione ao menos uma área responsável') ? <p role="alert">Selecione ao menos uma área responsável pela liberação pós-intervenção.</p> : null}
                    </fieldset>
                  ) : null}
                </section>

                {createOrderError && !createOrderError.includes('Selecione ao menos uma área responsável') ? <p className="pcm-order-detail__error" role="alert">{createOrderError}</p> : null}
              </div>

              <footer className="pcm-create-order-modal__footer"><button className="pcm-create-order-modal__cancel" type="button" onClick={closeCreateOrder} disabled={createOrderBusy}>Cancelar</button><button className="pcm-create-order-modal__submit" type="button" onClick={() => void createWorkOrder()} disabled={createOrderBusy || createOriginLoading || createPlansLoading || (!selectedCreatePlan && !(createOrderMode === 'WORK_ORDER' && createOriginEntityId && createOriginAssetId) && !(createOrderMode === 'IMPROVEMENT' && createOriginAssetId))}>{createOrderBusy ? 'Criando…' : createOrderMode === 'PREVENTIVE' ? 'Programar preventiva' : 'Criar ordem de serviço'}</button></footer>
          </section> : null}
        </>
      )}
      {!demoMode && !insight ? <PcmPartShortagesPanel onSessionExpired={onSessionExpired} focusShortageId={partShortageFocusId} /> : null}
    </section>
  )
}
