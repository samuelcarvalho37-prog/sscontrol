import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertIcon,
  AssetIcon,
  ChartIcon,
  CheckIcon,
  RefreshIcon,
  StopIcon,
} from './Icons'
import {
  getGestorAssetCatalog,
  getGestorTechnicalKpisForPeriod,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import type { GestorAsset, GestorTechnicalKpis } from '../types/gestor'

interface GestorPerformancePanelProps {
  onSessionExpired: () => void
}

type MetricDirection = 'higher' | 'lower'

interface MetricDefinition {
  key: string
  label: string
  description: string
  value: number | null
  previous: number | null
  format: 'percent' | 'duration' | 'integer'
  direction: MetricDirection
  target?: number | null
  sample: string
}

const PERIOD_OPTIONS = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
] as const

function formatPercent(value: number | null): string {
  return value == null
    ? 'Sem amostra'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'Sem amostra'
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return minutes ? `${hours}h ${minutes}min` : `${hours}h`
  return `${minutes} min`
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(value)
}

function compareMetric(
  current: number | null,
  previous: number | null,
  direction: MetricDirection,
): { label: string; tone: 'good' | 'bad' | 'neutral' } {
  if (current == null || previous == null || previous === 0) {
    return { label: 'Sem histórico comparável', tone: 'neutral' }
  }

  const variation = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(variation) < 0.5) {
    return { label: 'Estável vs. período anterior', tone: 'neutral' }
  }

  const improved = direction === 'higher' ? variation > 0 : variation < 0
  const arrow = variation > 0 ? '↑' : '↓'
  return {
    label: `${arrow} ${Math.abs(variation).toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    })}% vs. período anterior`,
    tone: improved ? 'good' : 'bad',
  }
}

function progressValue(value: number | null): number {
  return value == null ? 0 : Math.max(0, Math.min(100, value))
}

function isActive(asset: GestorAsset): boolean {
  return String(asset.status ?? 'ATIVO').trim().toUpperCase() !== 'INATIVO'
}

export function GestorPerformancePanel({
  onSessionExpired,
}: GestorPerformancePanelProps) {
  const [periodDays, setPeriodDays] = useState(30)
  const [assetId, setAssetId] = useState('')
  const [assets, setAssets] = useState<GestorAsset[]>([])
  const [current, setCurrent] = useState<GestorTechnicalKpis | null>(null)
  const [previous, setPrevious] = useState<GestorTechnicalKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')

    const end = new Date()
    const start = new Date(end.getTime() - periodDays * 86_400_000)
    const previousEnd = new Date(start.getTime() - 1)
    const previousStart = new Date(previousEnd.getTime() - periodDays * 86_400_000)

    try {
      const filters = {
        ativo_id: assetId || undefined,
        inicio_em: start.toISOString(),
        fim_em: end.toISOString(),
      }
      const previousFilters = {
        ativo_id: assetId || undefined,
        inicio_em: previousStart.toISOString(),
        fim_em: previousEnd.toISOString(),
      }
      const [currentData, previousData, catalog] = await Promise.all([
        getGestorTechnicalKpisForPeriod(filters, signal),
        getGestorTechnicalKpisForPeriod(previousFilters, signal),
        getGestorAssetCatalog(signal),
      ])
      setCurrent(currentData)
      setPrevious(previousData)
      setAssets(catalog.assets.filter(isActive))
      setUpdatedAt(new Date())
    } catch (cause) {
      if (signal?.aborted) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível calcular o desempenho técnico.',
      )
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [assetId, onSessionExpired, periodDays])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const periodLabel = useMemo(() => {
    const end = new Date()
    const start = new Date(end.getTime() - periodDays * 86_400_000)
    return `${formatDate(start)} – ${formatDate(end)}`
  }, [periodDays])

  const metrics = useMemo<MetricDefinition[]>(() => {
    if (!current) return []
    return [
      {
        key: 'availability',
        label: 'Disponibilidade',
        description: 'Tempo realmente disponível para operar',
        value: current.disponibilidade_pct,
        previous: previous?.disponibilidade_pct ?? null,
        format: 'percent',
        direction: 'higher',
        target: current.metas?.disponibilidade_pct ?? 90,
        sample: `${current.ativos_considerados} ativo(s) observado(s)`,
      },
      {
        key: 'mtbf',
        label: 'MTBF',
        description: 'Tempo médio de operação entre falhas',
        value: current.mtbf_segundos,
        previous: previous?.mtbf_segundos ?? null,
        format: 'duration',
        direction: 'higher',
        sample: `${current.falhas_nao_planejadas} falha(s) no período`,
      },
      {
        key: 'mttr',
        label: 'MTTR',
        description: 'Tempo médio para restaurar o equipamento',
        value: current.mttr_segundos,
        previous: previous?.mttr_segundos ?? null,
        format: 'duration',
        direction: 'lower',
        sample: `${current.falhas_nao_planejadas} reparo(s) considerado(s)`,
      },
      {
        key: 'sla',
        label: 'SLA de resolução',
        description: 'Demandas concluídas dentro do prazo',
        value: current.sla_resolucao_pct,
        previous: previous?.sla_resolucao_pct ?? null,
        format: 'percent',
        direction: 'higher',
        target: 90,
        sample: `${current.sla_resolucao_amostra} demanda(s) elegível(is)`,
      },
      {
        key: 'lead-time',
        label: 'Lead time de OS',
        description: 'Da abertura ao encerramento da ordem',
        value: current.lead_time_os_segundos,
        previous: previous?.lead_time_os_segundos ?? null,
        format: 'duration',
        direction: 'lower',
        sample: current.lead_time_os_segundos == null
          ? 'Nenhuma OS encerrada no período'
          : 'Ordens encerradas no período',
      },
      {
        key: 'failures',
        label: 'Falhas não planejadas',
        description: 'Ocorrências corretivas registradas no período',
        value: current.falhas_nao_planejadas,
        previous: previous?.falhas_nao_planejadas ?? null,
        format: 'integer',
        direction: 'lower',
        sample: `${current.ativos_considerados} ativo(s) observado(s)`,
      },
    ]
  }, [current, previous])

  const insights = useMemo(() => {
    if (!current) return []
    const messages: Array<{
      tone: 'attention' | 'good' | 'info'
      title: string
      detail: string
    }> = []
    const availabilityTarget = current.metas?.disponibilidade_pct ?? 90

    if (
      current.disponibilidade_pct != null &&
      current.disponibilidade_pct < availabilityTarget
    ) {
      messages.push({
        tone: 'attention',
        title: 'Disponibilidade abaixo da meta',
        detail: `Priorize as ${current.falhas_nao_planejadas} falha(s) não planejada(s) e as paradas com maior duração.`,
      })
    } else if (current.disponibilidade_pct != null) {
      messages.push({
        tone: 'good',
        title: 'Disponibilidade dentro da meta',
        detail: 'Mantenha o acompanhamento das paradas e dos ativos críticos.',
      })
    }

    if (current.sla_resolucao_pct != null && current.sla_resolucao_pct < 90) {
      messages.push({
        tone: 'attention',
        title: 'SLA técnico requer ação',
        detail: 'Repriorize demandas atrasadas e encaminhe rapidamente itens fora da sua especialidade.',
      })
    }

    if (!messages.length) {
      messages.push({
        tone: 'info',
        title: 'Amostra em formação',
        detail: 'Os indicadores serão consolidados conforme ocorrências, reparos, OS e produção forem registrados.',
      })
    }
    return messages.slice(0, 3)
  }, [current])

  const operationSeconds = current?.tempo_operacao_segundos ?? 0
  const downtimeSeconds = current?.tempo_parada_segundos ?? 0
  const totalTrackedSeconds = operationSeconds + downtimeSeconds
  const operationShare = totalTrackedSeconds
    ? (operationSeconds / totalTrackedSeconds) * 100
    : 0

  return (
    <section className="manager-performance" aria-labelledby="manager-performance-title">
      <header className="manager-performance__header">
        <div>
          <span className="eyebrow">DESEMPENHO TÉCNICO</span>
          <h2 id="manager-performance-title">Confiabilidade e eficiência</h2>
          <p>Compare o período atual com a janela anterior e identifique onde agir primeiro.</p>
        </div>
        <div className="manager-performance__filters">
          <label>
            <span>Período</span>
            <select
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Ativo</span>
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
              <option value="">Todos os ativos</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.tag ? `${asset.tag} · ` : ''}{asset.nome || asset.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Atualizar indicadores"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshIcon />
          </button>
        </div>
      </header>

      <div className="manager-performance__context">
        <span><strong>{periodLabel}</strong> comparado ao período anterior</span>
        <span>
          {updatedAt
            ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
            : 'Calculando indicadores'}
        </span>
      </div>

      {error ? (
        <div className="dashboard-error" role="alert">
          <strong>Falha ao calcular indicadores.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="manager-kpi-grid" aria-busy={loading}>
        {loading && !current ? (
          <p className="panel-state">Consolidando dados de manutenção e produção…</p>
        ) : null}
        {metrics.map((metric) => {
          const comparison = compareMetric(
            metric.value,
            metric.previous,
            metric.direction,
          )
          const formattedValue = metric.format === 'percent'
            ? formatPercent(metric.value)
            : metric.format === 'integer'
              ? String(metric.value ?? 0)
              : formatDuration(metric.value)
          const targetMet = metric.target == null || metric.value == null
            ? null
            : metric.value >= metric.target
          return (
            <article
              className={`manager-kpi-card manager-kpi-card--${comparison.tone}`}
              key={metric.key}
            >
              <header>
                <span>{metric.label}</span>
                {metric.target != null ? (
                  <small className={targetMet ? 'is-good' : 'is-attention'}>
                    Meta {formatPercent(metric.target)}
                  </small>
                ) : null}
              </header>
              <strong>{formattedValue}</strong>
              <p>{metric.description}</p>
              {metric.format === 'percent' ? (
                <span className="manager-kpi-card__bar" aria-hidden="true">
                  <i style={{ width: `${progressValue(metric.value)}%` }} />
                  {metric.target != null ? (
                    <b style={{ left: `${progressValue(metric.target)}%` }} />
                  ) : null}
                </span>
              ) : null}
              <footer>
                <span className={`manager-kpi-card__trend is-${comparison.tone}`}>
                  {comparison.label}
                </span>
                <small>{metric.sample}</small>
              </footer>
            </article>
          )
        })}
      </div>

      {current ? (
        <div className="manager-performance__detail-grid">
          <article className="manager-oee-panel manager-reliability-panel">
            <header>
              <div>
                <span className="eyebrow">CONFIABILIDADE</span>
                <h3>Comportamento da manutenção</h3>
              </div>
              <ChartIcon />
            </header>
            <dl>
              <div><dt>Falhas não planejadas</dt><dd>{current.falhas_nao_planejadas}</dd></div>
              <div><dt>Tempo médio entre falhas</dt><dd>{formatDuration(current.mtbf_segundos)}</dd></div>
              <div><dt>Tempo médio para reparar</dt><dd>{formatDuration(current.mttr_segundos)}</dd></div>
              <div><dt>SLA de resposta</dt><dd>{formatPercent(current.sla_resposta_pct)}</dd></div>
            </dl>
          </article>

          <article className="manager-time-panel">
            <header>
              <div>
                <span className="eyebrow">TEMPO OBSERVADO</span>
                <h3>Operação x parada</h3>
              </div>
              <StopIcon />
            </header>
            <div className="manager-time-panel__bar" aria-hidden="true">
              <i style={{ width: `${operationShare}%` }} />
            </div>
            <dl>
              <div>
                <dt><i className="is-operation" /> Em operação</dt>
                <dd>{formatDuration(operationSeconds)}</dd>
              </div>
              <div>
                <dt><i className="is-downtime" /> Paradas não planejadas</dt>
                <dd>{formatDuration(downtimeSeconds)}</dd>
              </div>
            </dl>
          </article>

          <article className="manager-data-panel">
            <header>
              <div>
                <span className="eyebrow">COBERTURA DOS DADOS</span>
                <h3>Confiabilidade da leitura</h3>
              </div>
              <AssetIcon />
            </header>
            <div className="manager-data-grid">
              <span><strong>{current.ativos_considerados}</strong><small>ativos</small></span>
              <span><strong>{current.falhas_nao_planejadas}</strong><small>falhas</small></span>
              <span><strong>{current.sla_resolucao_amostra}</strong><small>SLAs</small></span>
              <span><strong>{current.producao_amostra}</strong><small>apontamentos</small></span>
            </div>
            <dl className="manager-support-metrics">
              <div>
                <dt>SLA de primeira resposta</dt>
                <dd>{formatPercent(current.sla_resposta_pct)}</dd>
                <small>{current.sla_resposta_amostra} demanda(s) elegível(is)</small>
              </div>
              <div>
                <dt>Lead time técnico</dt>
                <dd>{formatDuration(current.lead_time_demanda_segundos)}</dd>
                <small>Do recebimento à decisão técnica</small>
              </div>
            </dl>
            <p>{current.metodologia || 'Indicadores calculados a partir dos registros operacionais.'}</p>
          </article>

          <article className="manager-insights-panel">
            <header>
              <div>
                <span className="eyebrow">LEITURA GERENCIAL</span>
                <h3>Onde agir agora</h3>
              </div>
              <AlertIcon />
            </header>
            <div>
              {insights.map((insight) => (
                <span className={`is-${insight.tone}`} key={insight.title}>
                  {insight.tone === 'good' ? <CheckIcon /> : <AlertIcon />}
                  <span><strong>{insight.title}</strong><small>{insight.detail}</small></span>
                </span>
              ))}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  )
}
