import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertIcon,
  ChartIcon,
  CheckIcon,
  SearchIcon,
  StopIcon,
  ValidationIcon,
  WrenchIcon,
} from '../components/Icons'
import { AssetJourneyPanel } from '../components/AssetJourneyPanel'
import { AssetSearchSelect } from '../components/AssetSearchSelect'
import {
  getGestorAssetCatalog,
  getGestorAssetJourney,
  getGestorOverview,
  getGestorTechnicalKpisForPeriod,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import { ActionReviewDialog } from '../components/ActionReviewDialog'
import { TechnicalAnalysisDialog } from '../components/TechnicalAnalysisDialog'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type {
  GestorAction,
  GestorAsset,
  GestorAssetCatalog,
  GestorAssetJourney,
  GestorOverview,
  GestorOccurrence,
  GestorTechnicalContext,
  GestorTechnicalKpis,
} from '../types/gestor'

type AnalyticsView = 'indicators' | 'monitoring' | 'history' | 'library'
type MonitoringFilter = 'all' | 'executing' | 'pending' | 'blocked' | 'stopped'
type FieldWindow = 'all' | 'today' | '24h' | '7d'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const PERIOD_OPTIONS = [
  { value: 15 * MINUTE_MS, label: '15 min' },
  { value: HOUR_MS, label: '1 hora' },
  { value: 6 * HOUR_MS, label: '6 horas' },
  { value: DAY_MS, label: '24 horas' },
  { value: 7 * DAY_MS, label: '7 dias' },
  { value: 30 * DAY_MS, label: '30 dias' },
  { value: 90 * DAY_MS, label: '90 dias' },
  { value: 365 * DAY_MS, label: '12 meses' },
] as const

interface GestorAnalyticsWorkspaceProps {
  focusAssetId?: string
  focusOccurrenceId?: string
  technicalContext: GestorTechnicalContext | null
  onOpenNotifications: () => void
  onOpenDecision: (
    kind: 'demand' | 'action' | 'model' | 'occurrence',
    id: string,
  ) => void
  onSessionExpired: () => void
}

const EMPTY_CATALOG: GestorAssetCatalog = { assets: [], components: [] }

function upper(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR')
}

function humanize(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Não informado'
}

function localIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function periodRange(durationMs: number, offset = 0) {
  const end = new Date(Date.now() - (durationMs * offset))
  const start = new Date(end.getTime() - durationMs)
  return { inicio_em: localIso(start), fim_em: localIso(end) }
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Sem base'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Sem base'
  const seconds = Math.max(0, value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min`
  return `${Math.floor(seconds)} s`
}

function formatDate(value?: string): string {
  if (!value) return 'Não informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function elapsedLabel(value?: string): string {
  if (!value) return 'Ainda não iniciada'
  const startedAt = new Date(value).getTime()
  if (!Number.isFinite(startedAt)) return formatDate(value)
  const seconds = Math.max(0, (Date.now() - startedAt) / 1000)
  if (seconds < 60) return 'Iniciada agora'
  return `Há ${formatDuration(seconds)}`
}

function metricTrend(
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsBetter = false,
): { label: string; tone: string; compared: boolean } {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return { label: 'Sem base anterior', tone: 'neutral', compared: false }
  }
  const delta = current - previous
  if (Math.abs(delta) < 0.05) {
    return { label: 'Estável', tone: 'neutral', compared: true }
  }
  const good = lowerIsBetter ? delta < 0 : delta > 0
  const prefix = delta > 0 ? '+' : ''
  return {
    label: `${prefix}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`,
    tone: good ? 'good' : 'bad',
    compared: true,
  }
}

function actionAssetLabel(action: GestorAction): string {
  return action.ativo_tag || action.ativo_nome || action.ativo_id || 'Ativo não informado'
}

function assetOptionLabel(asset: GestorAsset): string {
  return `${asset.tag || asset.id} · ${asset.nome || 'Ativo sem nome'}`
}

function actionResponsible(action: GestorAction) {
  const id = String(action.responsavel_id || action.executor_id || '').trim()
  const name = String(
    action.responsavel_nome ||
    action.executor_nome ||
    id ||
    'Responsável não definido',
  ).trim()
  const profile = humanize(
    action.responsavel_perfil ||
    action.executor_perfil ||
    action.perfil_responsavel ||
    '',
  )
  return {
    value: id || name,
    label: profile === 'Não informado' ? name : `${name} · ${profile}`,
  }
}

function actionStartedAt(action: GestorAction): string {
  return String(
    action.iniciado_em ||
    action.gerado_em ||
    action.criado_em ||
    action.atualizado_em ||
    '',
  )
}

function isWithinFieldWindow(value: string, window: FieldWindow): boolean {
  if (window === 'all') return true
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return false
  if (window === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return time >= start.getTime()
  }
  return time >= Date.now() - (window === '24h' ? DAY_MS : 7 * DAY_MS)
}

function isWithinPeriod(value: string | undefined, durationMs: number): boolean {
  if (!value) return true
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return true
  return time >= Date.now() - durationMs
}

export function GestorAnalyticsWorkspace({
  focusAssetId,
  focusOccurrenceId,
  technicalContext,
  onOpenNotifications,
  onOpenDecision,
  onSessionExpired,
}: GestorAnalyticsWorkspaceProps) {
  const [view, setView] = useState<AnalyticsView>('indicators')
  const [periodMs, setPeriodMs] = useState(30 * DAY_MS)
  const [assetId, setAssetId] = useState(focusAssetId ?? '')
  const [componentId, setComponentId] = useState('')
  const [catalog, setCatalog] = useState<GestorAssetCatalog>(EMPTY_CATALOG)
  const [journey, setJourney] = useState<GestorAssetJourney | null>(null)
  const [overview, setOverview] = useState<GestorOverview | null>(null)
  const [current, setCurrent] = useState<GestorTechnicalKpis | null>(null)
  const [previous, setPrevious] = useState<GestorTechnicalKpis | null>(null)
  const [search, setSearch] = useState('')
  const [assetLookup, setAssetLookup] = useState('')
  const [monitoringFilter, setMonitoringFilter] =
    useState<MonitoringFilter>('all')
  const [fieldResponsible, setFieldResponsible] = useState('')
  const [fieldAsset, setFieldAsset] = useState('')
  const [fieldWindow, setFieldWindow] = useState<FieldWindow>('all')
  const [selectedHistoryAction, setSelectedHistoryAction] =
    useState<GestorAction | null>(null)
  const [selectedOccurrence, setSelectedOccurrence] =
    useState<GestorOccurrence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!background) setLoading(true)
    setError('')
    const currentRange = periodRange(periodMs)
    const previousRange = periodRange(periodMs, 1)
    const filters = assetId
      ? {
        ativo_id: assetId,
        ...(componentId ? { componente_id: componentId } : {}),
      }
      : {}

    try {
      const [overviewData, catalogData, currentData, previousData, journeyData] =
        await Promise.all([
          getGestorOverview(signal),
          getGestorAssetCatalog(signal),
          getGestorTechnicalKpisForPeriod(
            { ...currentRange, ...filters },
            signal,
          ),
          getGestorTechnicalKpisForPeriod(
            { ...previousRange, ...filters },
            signal,
          ),
          assetId
            ? getGestorAssetJourney(assetId, signal)
            : Promise.resolve(null),
        ])
      setOverview(overviewData)
      setCatalog(catalogData)
      setCurrent(currentData)
      setPrevious(previousData)
      setJourney(journeyData)
    } catch (cause) {
      if (signal?.aborted) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível consolidar os dados técnicos.',
      )
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [assetId, componentId, onSessionExpired, periodMs])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useAutoRefresh(
    () => load(undefined, true),
    { intervalMs: 15_000 },
  )

  useEffect(() => {
    if (!focusAssetId) return
    setAssetId(focusAssetId)
    setView('library')
  }, [focusAssetId])

  useEffect(() => {
    setComponentId('')
  }, [assetId])

  useEffect(() => {
    if (!focusOccurrenceId || !overview) return
    const occurrence = overview.occurrences.find(
      (item) => item.id === focusOccurrenceId,
    )
    if (occurrence) {
      if (occurrence.ativo_id) setAssetId(occurrence.ativo_id)
      setSelectedOccurrence(occurrence)
    }
    setView('library')
  }, [focusOccurrenceId, overview])

  const selectedAsset =
    catalog.assets.find((asset) => asset.id === assetId) ?? null
  const selectedComponents = selectedAsset
    ? (
      journey?.componentes.length
        ? journey.componentes
        : catalog.components.filter(
          (component) => component.ativo_id === selectedAsset.id,
        )
    )
    : []

  useEffect(() => {
    if (!selectedAsset) return
    const label = assetOptionLabel(selectedAsset)
    setAssetLookup((currentValue) => currentValue === label ? currentValue : label)
  }, [selectedAsset])

  const metrics = useMemo(() => {
    if (!current) return []
    return [
      {
        label: 'Disponibilidade',
        value: formatPercent(current.disponibilidade_pct),
        trend: metricTrend(current.disponibilidade_pct, previous?.disponibilidade_pct),
        hint: 'Percentual do período observado sem parada registrada. Uma falha só reduz este índice quando gera tempo de parada.',
      },
      {
        label: 'Falhas não planejadas',
        value: String(current.falhas_nao_planejadas),
        trend: metricTrend(
          current.falhas_nao_planejadas,
          previous?.falhas_nao_planejadas,
          true,
        ),
        hint: 'Falhas corretivas registradas no período',
      },
      {
        label: 'MTTR',
        value: formatDuration(current.mttr_segundos),
        trend: metricTrend(current.mttr_segundos, previous?.mttr_segundos, true),
        hint: componentId
          ? 'Tempo médio para reparar o componente selecionado, considerando falhas e intervenções vinculadas a ele.'
          : assetId
            ? 'Tempo médio para reparar o equipamento selecionado.'
          : 'Tempo médio para reparar os equipamentos no escopo selecionado.',
      },
      {
        label: 'MTBF',
        value: formatDuration(current.mtbf_segundos),
        trend: metricTrend(current.mtbf_segundos, previous?.mtbf_segundos),
        hint: componentId
          ? 'Tempo médio de operação do componente selecionado entre falhas não planejadas vinculadas.'
          : assetId
            ? 'Tempo médio de operação do equipamento selecionado entre falhas não planejadas.'
          : 'Tempo médio de operação entre falhas não planejadas no escopo.',
      },
      {
        label: 'Lead time',
        value: formatDuration(current.lead_time_os_segundos),
        trend: metricTrend(
          current.lead_time_os_segundos,
          previous?.lead_time_os_segundos,
          true,
        ),
        hint: 'Abertura até conclusão da OS',
      },
      {
        label: 'SLA de resposta',
        value: formatPercent(current.sla_resposta_pct),
        trend: metricTrend(current.sla_resposta_pct, previous?.sla_resposta_pct),
        hint: `${current.sla_resposta_amostra} demanda(s) avaliadas`,
      },
    ]
  }, [assetId, componentId, current, previous])

  const monitoredActions = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR')
    return (overview?.actions ?? [])
      .filter((action) => ['PENDENTE', 'EM_EXECUCAO', 'BLOQUEADA'].includes(upper(action.status)))
      .filter((action) => !assetId || action.ativo_id === assetId)
      .filter((action) => !fieldAsset || action.ativo_id === fieldAsset)
      .filter((action) =>
        !fieldResponsible || actionResponsible(action).value === fieldResponsible,
      )
      .filter((action) =>
        isWithinFieldWindow(actionStartedAt(action), fieldWindow),
      )
      .filter((action) => {
        if (!normalized) return true
        return [
          action.id,
          action.titulo,
          action.ativo_tag,
          action.ativo_nome,
          action.responsavel_nome,
          action.responsavel_id,
        ].some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized))
      })
  }, [
    assetId,
    fieldAsset,
    fieldResponsible,
    fieldWindow,
    overview?.actions,
    search,
  ])

  const fieldResponsibleOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const action of overview?.actions ?? []) {
      if (!['PENDENTE', 'EM_EXECUCAO', 'BLOQUEADA'].includes(upper(action.status))) {
        continue
      }
      if (assetId && action.ativo_id !== assetId) continue
      const responsible = actionResponsible(action)
      options.set(responsible.value, responsible.label)
    }
    return [...options].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [assetId, overview?.actions])

  const fieldAssetOptions = useMemo(() => {
    const ids = new Set(
      (overview?.actions ?? [])
        .filter((action) =>
          ['PENDENTE', 'EM_EXECUCAO', 'BLOQUEADA'].includes(upper(action.status)),
        )
        .map((action) => String(action.ativo_id || '').trim())
        .filter(Boolean),
    )
    return catalog.assets
      .filter((asset) => ids.has(asset.id))
      .map((asset) => ({ value: asset.id, label: assetOptionLabel(asset) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [catalog.assets, overview?.actions])

  const monitoredStops = useMemo(
    () => (overview?.openStops ?? [])
      .filter((stop) => !assetId || stop.ativo_id === assetId)
      .filter((stop) => !fieldAsset || stop.ativo_id === fieldAsset)
      .filter((stop) =>
        isWithinFieldWindow(String(stop.iniciada_em || ''), fieldWindow),
      ),
    [assetId, fieldAsset, fieldWindow, overview?.openStops],
  )

  const completedActions = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR')
    return (overview?.completedActions ?? [])
      .filter((action) => !assetId || action.ativo_id === assetId)
      .filter((action) => {
        if (!normalized) return true
        return [
          action.id,
          action.titulo,
          action.ativo_tag,
          action.ativo_nome,
          action.responsavel_nome,
          action.responsavel_id,
        ].some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized))
      })
  }, [assetId, overview?.completedActions, search])

  const monitoringCounts = useMemo(() => ({
    executing: monitoredActions.filter(
      (action) => upper(action.status) === 'EM_EXECUCAO',
    ).length,
    pending: monitoredActions.filter(
      (action) => upper(action.status) === 'PENDENTE',
    ).length,
    blocked: monitoredActions.filter(
      (action) => upper(action.status) === 'BLOQUEADA',
    ).length,
    stopped: monitoredStops.length,
  }), [monitoredActions, monitoredStops.length])

  const displayedMonitoringActions = useMemo(() => {
    if (monitoringFilter === 'all' || monitoringFilter === 'stopped') {
      return monitoringFilter === 'stopped' ? [] : monitoredActions
    }
    const expectedStatus = {
      executing: 'EM_EXECUCAO',
      pending: 'PENDENTE',
      blocked: 'BLOQUEADA',
    }[monitoringFilter]
    return monitoredActions.filter(
      (action) => upper(action.status) === expectedStatus,
    )
  }, [monitoredActions, monitoringFilter])

  const monitoringAttention = useMemo(() => [
    ...monitoredStops.map((stop) => ({
      id: `stop-${stop.id}`,
      tone: 'danger',
      label: 'Parada aberta',
      title: stop.ativo_id || 'Ativo não informado',
      detail: stop.motivo_parada || 'Aguardando diagnóstico da parada.',
      meta: stop.elapsed_seconds
        ? `Parado há ${formatDuration(stop.elapsed_seconds)}`
        : elapsedLabel(stop.iniciada_em),
      assetId: stop.ativo_id,
    })),
    ...monitoredActions
      .filter((action) => upper(action.status) === 'BLOQUEADA')
      .map((action) => ({
        id: `action-${action.id}`,
        tone: 'warning',
        label: 'Execução bloqueada',
        title: action.titulo || 'Ação operacional',
        detail: actionAssetLabel(action),
        meta: String(action.responsavel_nome || action.executor_nome || 'Responsável não definido'),
        assetId: action.ativo_id,
      })),
  ], [monitoredActions, monitoredStops])

  const displayedMonitoringAttention = useMemo(() => {
    if (monitoringFilter === 'all') return monitoringAttention
    if (monitoringFilter === 'stopped') {
      return monitoringAttention.filter((item) => item.id.startsWith('stop-'))
    }
    if (monitoringFilter === 'blocked') {
      return monitoringAttention.filter((item) => item.id.startsWith('action-'))
    }
    return []
  }, [monitoringAttention, monitoringFilter])

  const assetImpactRanking = useMemo(() => {
    const rows = new Map<string, {
      assetId: string
      label: string
      name: string
      stops: number
      occurrences: number
      downtime: number
      active: number
    }>()
    const ensure = (id: string) => {
      const asset = catalog.assets.find((item) => item.id === id)
      const currentRow = rows.get(id)
      if (currentRow) return currentRow
      const row = {
        assetId: id,
        label: asset?.tag || id || 'Ativo não informado',
        name: asset?.nome || 'Sem nome cadastrado',
        stops: 0,
        occurrences: 0,
        downtime: 0,
        active: 0,
      }
      rows.set(id, row)
      return row
    }

    for (const stop of overview?.stops ?? []) {
      if (
        !stop.ativo_id ||
        !isWithinPeriod(stop.iniciada_em, periodMs) ||
        (assetId && stop.ativo_id !== assetId)
      ) continue
      const row = ensure(stop.ativo_id)
      row.stops += 1
      row.downtime += Number(stop.elapsed_seconds ?? 0)
      if ((overview?.openStops ?? []).some((item) => item.id === stop.id)) {
        row.active += 1
      }
    }

    for (const occurrence of overview?.occurrenceHistory ?? []) {
      if (
        !occurrence.ativo_id ||
        !isWithinPeriod(occurrence.criado_em, periodMs) ||
        (assetId && occurrence.ativo_id !== assetId)
      ) continue
      ensure(occurrence.ativo_id).occurrences += 1
    }

    return [...rows.values()]
      .sort((a, b) => (
        (b.downtime + (b.stops * 3600) + (b.occurrences * 900)) -
        (a.downtime + (a.stops * 3600) + (a.occurrences * 900))
      ))
      .slice(0, 5)
  }, [
    assetId,
    catalog.assets,
    overview?.openStops,
    overview?.occurrenceHistory,
    overview?.stops,
    periodMs,
  ])

  const executionRanking = useMemo(() => {
    const rows = new Map<string, {
      id: string
      name: string
      completed: number
      totalSeconds: number
      measured: number
    }>()

    for (const action of overview?.completedActions ?? []) {
      if (
        !isWithinPeriod(action.finalizado_em || action.atualizado_em, periodMs) ||
        (assetId && action.ativo_id !== assetId)
      ) continue
      const id = String(
        action.responsavel_id ||
        action.executor_id ||
        action.responsavel_nome ||
        'SEM_RESPONSAVEL',
      )
      const row = rows.get(id) ?? {
        id,
        name: String(
          action.responsavel_nome ||
          action.executor_nome ||
          'Responsável não identificado',
        ),
        completed: 0,
        totalSeconds: 0,
        measured: 0,
      }
      row.completed += 1
      const started = new Date(action.iniciado_em ?? '').getTime()
      const finished = new Date(
        action.finalizado_em || action.atualizado_em || '',
      ).getTime()
      if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
        row.totalSeconds += (finished - started) / 1000
        row.measured += 1
      }
      rows.set(id, row)
    }

    return [...rows.values()]
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5)
  }, [assetId, overview?.completedActions, periodMs])

  const views: Array<{
    id: AnalyticsView
    label: string
    count?: number
  }> = [
    { id: 'indicators', label: 'Visão geral' },
    { id: 'monitoring', label: 'Em campo', count: monitoredActions.length },
    { id: 'history', label: 'Histórico', count: completedActions.length },
    { id: 'library', label: 'Ativos', count: catalog.assets.length },
  ]

  return (
    <main
      className="content manager-analytics-workspace"
      data-technical-scope={technicalContext?.identidade.area_codigo || 'GERAL'}
    >
      <section className="manager-workspace-heading">
        <div>
          <h1>Acompanhar</h1>
        </div>
        <div className="manager-analytics-filters">
          <AssetSearchSelect
            assets={catalog.assets}
            query={assetLookup}
            selectedId={assetId}
            onQueryChange={setAssetLookup}
            onSelect={(asset) => setAssetId(asset?.id ?? '')}
          />
          <select
            value={periodMs}
            onChange={(event) => setPeriodMs(Number(event.target.value))}
            aria-label="Período dos indicadores"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="manager-analytics-alert-slot">
        {error ? (
          <div className="dashboard-error" role="alert">
            <strong>Falha ao consolidar a análise.</strong>
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <nav className="manager-analytics-tabs" aria-label="Áreas do modo analítico">
        {views.map((item) => (
          <button
            className={view === item.id ? 'is-active' : ''}
            type="button"
            key={item.id}
            onClick={() => {
              setView(item.id)
              setSearch('')
            }}
          >
            {item.label}
            {item.count !== undefined ? <span>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      <section className={`manager-analytics-stage is-${view}`}>
        {view === 'indicators' ? (
          <div className="manager-analytics-indicators">
            {(overview?.occurrences.length ?? 0) + (overview?.openStops.length ?? 0) > 0 ? (
              <button
                className="manager-critical-callout"
                type="button"
                onClick={onOpenNotifications}
              >
                <span><AlertIcon /></span>
                <div>
                  <small>ATENÇÃO TÉCNICA</small>
                  <strong>
                    {(overview?.occurrences.length ?? 0) + (overview?.openStops.length ?? 0)}
                    {' '}
                    {(overview?.occurrences.length ?? 0) + (overview?.openStops.length ?? 0) === 1
                      ? 'situação requer tratamento'
                      : 'situações requerem tratamento'}
                  </strong>
                  <p>Ocorrências e paradas são tratadas pela Central de Notificações.</p>
                </div>
                <b>Abrir central</b>
              </button>
            ) : null}
            <div className="manager-analytics-kpis" aria-busy={loading}>
              {loading ? <p className="panel-state">Calculando indicadores…</p> : null}
              {!loading && metrics.map((metric) => (
                <article key={metric.label}>
                  <header>
                    <span>{metric.label}</span>
                    <button
                      type="button"
                      title={metric.hint}
                      aria-label={`Ajuda sobre ${metric.label}`}
                    >?</button>
                  </header>
                  <strong>{metric.value}</strong>
                  <footer>
                    <span className={`is-${metric.trend.tone}`}>{metric.trend.label}</span>
                    <small>
                      {metric.trend.compared
                        ? 'comparado ao período anterior'
                        : 'aguardando período comparável'}
                    </small>
                  </footer>
                </article>
              ))}
            </div>

            {!loading && current ? (
              <div className="manager-ranking-grid">
                <article className="manager-ranking-panel">
                  <header>
                    <div>
                      <span className="eyebrow">ATENDIMENTO TÉCNICO · CONFIABILIDADE</span>
                      <h2>Ativos com maior impacto</h2>
                      <p>Ordenados por parada, falhas e ocorrências do período.</p>
                    </div>
                    <strong>{assetImpactRanking.length}</strong>
                  </header>
                  <div className="manager-ranking-list">
                    {assetImpactRanking.map((row, index) => (
                      <button
                        type="button"
                        key={row.assetId}
                        onClick={() => {
                          setAssetId(row.assetId)
                          setView('library')
                        }}
                      >
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <span>
                          <strong>{row.label} · {row.name}</strong>
                          <small>
                            {row.stops} parada(s) · {row.occurrences} ocorrência(s)
                            {row.active ? ` · ${row.active} aberta(s)` : ''}
                          </small>
                        </span>
                        <em>{formatDuration(row.downtime)}</em>
                      </button>
                    ))}
                    {!assetImpactRanking.length ? (
                      <div className="manager-ranking-empty">
                        <CheckIcon />
                        <span>Nenhum impacto técnico registrado neste período.</span>
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className="manager-ranking-panel">
                  <header>
                    <div>
                      <span className="eyebrow">CAPACIDADE EM CAMPO</span>
                      <h2>Execuções concluídas por responsável</h2>
                      <p>Volume entregue e duração média com base válida.</p>
                    </div>
                    <strong>{executionRanking.reduce((total, row) => total + row.completed, 0)}</strong>
                  </header>
                  <div className="manager-ranking-list">
                    {executionRanking.map((row, index) => (
                      <div key={row.id}>
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <span>
                          <strong>{row.name}</strong>
                          <small>{row.completed} execução(ões) concluída(s)</small>
                        </span>
                        <em>
                          {row.measured
                            ? `Média ${formatDuration(row.totalSeconds / row.measured)}`
                            : 'Sem duração'}
                        </em>
                      </div>
                    ))}
                    {!executionRanking.length ? (
                      <div className="manager-ranking-empty">
                        <ChartIcon />
                        <span>As primeiras conclusões formarão este ranking.</span>
                      </div>
                    ) : null}
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === 'monitoring' ? (
          <div className="manager-monitoring-view">
            <header className="manager-stage-toolbar">
              <div>
                <h2>Em campo</h2>
              </div>
            </header>
            <div className="manager-field-filters">
              <label>
                <span>Responsável</span>
                <select
                  value={fieldResponsible}
                  onChange={(event) => setFieldResponsible(event.target.value)}
                >
                  <option value="">Todos</option>
                  {fieldResponsibleOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Local</span>
                <select
                  value={fieldAsset}
                  onChange={(event) => setFieldAsset(event.target.value)}
                >
                  <option value="">Todos os ativos</option>
                  {fieldAssetOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Início</span>
                <select
                  value={fieldWindow}
                  onChange={(event) => setFieldWindow(event.target.value as FieldWindow)}
                >
                  <option value="all">Qualquer período</option>
                  <option value="today">Hoje</option>
                  <option value="24h">Últimas 24 horas</option>
                  <option value="7d">Últimos 7 dias</option>
                </select>
              </label>
              <label className="manager-field-filters__search">
                <span>Busca</span>
                <div>
                  <SearchIcon />
                  <input
                    value={search}
                    placeholder="Título ou código"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </label>
            </div>
            <div
              className="manager-monitoring-overview"
              role="group"
              aria-label="Filtrar acompanhamento por situação"
            >
              <button
                type="button"
                className={`is-executing${monitoringFilter === 'executing' ? ' is-selected' : ''}`}
                aria-pressed={monitoringFilter === 'executing'}
                onClick={() => setMonitoringFilter(
                  monitoringFilter === 'executing' ? 'all' : 'executing',
                )}
              >
                <span><WrenchIcon /></span>
                <div><strong>{monitoringCounts.executing}</strong><small>Em execução</small></div>
              </button>
              <button
                type="button"
                className={monitoringFilter === 'pending' ? 'is-selected' : ''}
                aria-pressed={monitoringFilter === 'pending'}
                onClick={() => setMonitoringFilter(
                  monitoringFilter === 'pending' ? 'all' : 'pending',
                )}
              >
                <span><ValidationIcon /></span>
                <div><strong>{monitoringCounts.pending}</strong><small>Aguardando início</small></div>
              </button>
              <button
                type="button"
                className={`${monitoringCounts.blocked ? 'is-warning' : ''}${monitoringFilter === 'blocked' ? ' is-selected' : ''}`}
                aria-pressed={monitoringFilter === 'blocked'}
                onClick={() => setMonitoringFilter(
                  monitoringFilter === 'blocked' ? 'all' : 'blocked',
                )}
              >
                <span><AlertIcon /></span>
                <div><strong>{monitoringCounts.blocked}</strong><small>Bloqueadas</small></div>
              </button>
              <button
                type="button"
                className={`${monitoringCounts.stopped ? 'is-danger' : ''}${monitoringFilter === 'stopped' ? ' is-selected' : ''}`}
                aria-pressed={monitoringFilter === 'stopped'}
                onClick={() => setMonitoringFilter(
                  monitoringFilter === 'stopped' ? 'all' : 'stopped',
                )}
              >
                <span><StopIcon /></span>
                <div><strong>{monitoringCounts.stopped}</strong><small>Paradas abertas</small></div>
              </button>
            </div>

            <div className="manager-monitoring-dashboard">
              <aside className="manager-monitoring-attention">
                <header>
                  <div>
                    <span className="eyebrow">ATENÇÃO AGORA</span>
                    <h3>Situações que exigem ação</h3>
                    <p>Paradas abertas e execuções bloqueadas com impacto imediato.</p>
                  </div>
                  <span>{displayedMonitoringAttention.length}</span>
                </header>
                <div>
                  {displayedMonitoringAttention.map((item) => (
                    <article className={`is-${item.tone}`} key={item.id}>
                      <span>{item.tone === 'danger' ? <StopIcon /> : <AlertIcon />}</span>
                      <div>
                        <small>{item.label}</small>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                        <b>{item.meta}</b>
                      </div>
                      {item.assetId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssetId(item.assetId || '')
                            setView('library')
                          }}
                        >
                          Ver ativo
                        </button>
                      ) : null}
                    </article>
                  ))}
                  {!displayedMonitoringAttention.length ? (
                    <div className="manager-monitoring-clear">
                      <CheckIcon />
                      <strong>Nenhuma urgência neste filtro</strong>
                      <span>Selecione outro status para acompanhar o trabalho em campo.</span>
                    </div>
                  ) : null}
                </div>
              </aside>

              <section className="manager-monitoring-board">
                <header>
                  <div>
                    <span className="eyebrow">TRABALHO EM CAMPO</span>
                    <h3>
                      {monitoringFilter === 'all'
                        ? 'Execuções acompanhadas'
                        : monitoringFilter === 'stopped'
                          ? 'Equipamentos parados'
                          : monitoringFilter === 'pending'
                            ? 'Execuções · Aguardando início'
                            : monitoringFilter === 'executing'
                              ? 'Execuções · Em andamento'
                              : 'Execuções · Bloqueadas'}
                    </h3>
                  </div>
                  <span>
                    {monitoringFilter === 'stopped'
                      ? monitoredStops.length
                      : displayedMonitoringActions.length}
                  </span>
                </header>
                <div className="manager-monitoring-list">
                  {monitoringFilter !== 'stopped' && displayedMonitoringActions.length === 0 ? (
                    <div className="manager-decision-empty">
                      <CheckIcon />
                      <strong>Nenhuma execução nesta situação</strong>
                      <span>A lista será atualizada automaticamente quando houver mudança.</span>
                    </div>
                  ) : null}
                  {monitoringFilter === 'stopped' && monitoredStops.length === 0 ? (
                    <div className="manager-decision-empty">
                      <CheckIcon />
                      <strong>Nenhuma parada aberta</strong>
                      <span>Os ativos indisponíveis aparecerão aqui em tempo real.</span>
                    </div>
                  ) : null}
                  {monitoringFilter === 'stopped'
                    ? monitoredStops.map((stop) => (
                      <article className="manager-monitoring-stop-card" key={stop.id}>
                        <header>
                          <span className="manager-monitoring-state is-bloqueada">
                            <StopIcon />
                          </span>
                          <div>
                            <small>PARADA ABERTA · {formatDate(stop.iniciada_em)}</small>
                            <strong>{stop.ativo_id || 'Ativo não informado'}</strong>
                          </div>
                          <b className="is-bloqueada">
                            {stop.elapsed_seconds
                              ? formatDuration(stop.elapsed_seconds)
                              : 'Em aberto'}
                          </b>
                        </header>
                        <p>{stop.motivo_parada || 'Aguardando diagnóstico técnico.'}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setAssetId(stop.ativo_id || '')
                            setView('library')
                          }}
                        >
                          Abrir histórico do ativo
                        </button>
                      </article>
                    ))
                    : null}
                  {displayedMonitoringActions.map((action) => {
                    const status = upper(action.status)
                    const responsible = String(
                      action.responsavel_nome ||
                      action.executor_nome ||
                      action.responsavel_id ||
                      'Aguardando operador',
                    )
                    return (
                      <article key={action.id}>
                        <header>
                          <span className={`manager-monitoring-state is-${status.toLocaleLowerCase('pt-BR')}`}>
                            {status === 'EM_EXECUCAO' ? <WrenchIcon /> : <ValidationIcon />}
                          </span>
                          <div>
                            <small>{actionAssetLabel(action)}{action.componente_nome ? ` · ${action.componente_nome}` : ''}</small>
                            <strong>{action.titulo || 'Ação operacional'}</strong>
                          </div>
                          <b className={`is-${status.toLocaleLowerCase('pt-BR')}`}>{humanize(status)}</b>
                        </header>
                        <dl>
                          <div><dt>Responsável</dt><dd>{responsible}</dd></div>
                          <div><dt>Início</dt><dd>{elapsedLabel(action.iniciado_em)}</dd></div>
                          <div><dt>Prioridade</dt><dd>{humanize(action.prioridade || 'NORMAL')}</dd></div>
                        </dl>
                        <div className="manager-execution-progress" aria-label={`Etapa atual: ${humanize(status)}`}>
                          <span className="is-complete">Planejada</span>
                          <i />
                          <span className={status === 'EM_EXECUCAO' ? 'is-current' : status === 'BLOQUEADA' ? 'is-blocked' : ''}>Em campo</span>
                          <i />
                          <span>Auditoria</span>
                        </div>
                        {action.ativo_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAssetId(action.ativo_id || '')
                              setView('library')
                            }}
                          >
                            Acompanhar ativo
                          </button>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {view === 'history' ? (
          <div className="manager-completed-view">
            <header className="manager-stage-toolbar">
              <div>
                <span className="eyebrow">HISTÓRICO OPERACIONAL</span>
                <h2>Execuções concluídas</h2>
                <p>Registros preservados para consulta técnica e auditoria.</p>
              </div>
              <label>
                <SearchIcon />
                <input
                  value={search}
                  placeholder="Buscar execução, ativo ou responsável"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </header>
            <div className="manager-completed-list">
              {completedActions.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  onClick={() => setSelectedHistoryAction(action)}
                >
                  <span><CheckIcon /></span>
                  <div>
                    <small>{actionAssetLabel(action)}</small>
                    <strong>{action.titulo || 'Execução concluída'}</strong>
                    <p>
                      Finalizada em {formatDate(action.finalizado_em || action.atualizado_em)}
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>Responsável</dt>
                      <dd>{String(action.responsavel_nome || action.responsavel_id || 'Registro auditado')}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>Concluída</dd>
                    </div>
                  </dl>
                  <b>Ver auditoria</b>
                </button>
              ))}
              {!completedActions.length ? (
                <div className="manager-decision-empty">
                  <CheckIcon />
                  <strong>Nenhuma conclusão neste filtro</strong>
                  <span>As ações aprovadas pelo Gestor ficarão preservadas aqui.</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {view === 'library' ? (
          <div className="manager-library-view">
            <div className="manager-library-layout manager-library-layout--filter-only">
              <AssetAnalyticDetail
                asset={selectedAsset}
                components={selectedComponents}
                current={current}
                journey={journey}
                componentId={componentId}
                loading={loading}
                onComponentChange={setComponentId}
                onOpenDecision={onOpenDecision}
              />
            </div>
          </div>
        ) : null}
      </section>

      {selectedHistoryAction ? (
        <ActionReviewDialog
          action={selectedHistoryAction}
          readOnly
          onClose={() => setSelectedHistoryAction(null)}
          onDecisionComplete={() => undefined}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedOccurrence ? (
        <TechnicalAnalysisDialog
          occurrence={selectedOccurrence}
          onClose={() => setSelectedOccurrence(null)}
          onChanged={async () => {
            setSelectedOccurrence(null)
            await load(undefined, true)
          }}
        />
      ) : null}
    </main>
  )
}

function AssetAnalyticDetail({
  asset,
  components,
  current,
  journey,
  componentId,
  loading,
  onComponentChange,
  onOpenDecision,
}: {
  asset: GestorAsset | null
  components: GestorAssetCatalog['components']
  current: GestorTechnicalKpis | null
  journey: GestorAssetJourney | null
  componentId: string
  loading: boolean
  onComponentChange: (componentId: string) => void
  onOpenDecision: (
    kind: 'demand' | 'action' | 'model' | 'occurrence',
    id: string,
  ) => void
}) {
  return (
    <AssetJourneyPanel
      asset={asset}
      components={components}
      current={current}
      journey={journey}
      componentId={componentId}
      loading={loading}
      onComponentChange={onComponentChange}
      onOpenDecision={onOpenDecision}
    />
  )
}
