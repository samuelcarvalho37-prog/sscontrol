import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAdminTechnicalKpis } from '../services/api/analytics'
import { listAdminEntity } from '../services/api/catalog'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminEntityRecord } from '../types/catalog'
import type { GestorTechnicalKpis } from '../types/gestor'
import { AssetIcon, CheckIcon, ShieldIcon, StopIcon } from './Icons'

interface AdminAnalyticsWorkspaceProps {
  onSessionExpired: () => void
}

const EMPTY_KPIS: GestorTechnicalKpis = {
  ativo_id: 'TODOS', inicio_em: '', fim_em: '', ativos_considerados: 0, disponibilidade_pct: null,
  tempo_observado_segundos: 0, tempo_operacao_segundos: 0, tempo_parada_segundos: 0,
  falhas_nao_planejadas: 0, mttr_segundos: null, mtbf_segundos: null, lead_time_os_segundos: null,
  lead_time_demanda_segundos: null, sla_resposta_pct: null, sla_resolucao_pct: null,
  sla_resposta_amostra: 0, sla_resolucao_amostra: 0, oee_disponivel: false, oee_pct: null,
  oee_disponibilidade_pct: null, oee_performance_pct: null, oee_qualidade_pct: null, producao_amostra: 0,
}

function dateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function periodDates(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end.getTime() - days * 86400000)
  return { start: dateInput(start), end: dateInput(end) }
}

function duration(value: number | null): string {
  if (value == null) return 'Sem amostra'
  const minutes = Math.round(value / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`
}

function percent(value: number | null): string {
  return value == null ? 'Sem amostra' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR')
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function AdminAnalyticsWorkspace({ onSessionExpired }: AdminAnalyticsWorkspaceProps) {
  const initialPeriod = useMemo(() => periodDates(30), [])
  const [assets, setAssets] = useState<AdminEntityRecord[]>([])
  const [kpis, setKpis] = useState<GestorTechnicalKpis>(EMPTY_KPIS)
  const [assetId, setAssetId] = useState('')
  const [period, setPeriod] = useState('30')
  const [start, setStart] = useState(initialPeriod.start)
  const [end, setEnd] = useState(initialPeriod.end)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const handleFailure = useCallback((cause: unknown) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : 'Não foi possível calcular os indicadores.')
  }, [onSessionExpired])

  const loadKpis = useCallback(async (
    nextAssetId: string,
    nextStart: string,
    nextEnd: string,
    signal?: AbortSignal,
  ) => {
    const data = await getAdminTechnicalKpis({
      ativo_id: nextAssetId,
      inicio_em: new Date(nextStart).toISOString(),
      fim_em: new Date(nextEnd).toISOString(),
    }, signal)
    setKpis(data)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void Promise.all([
      listAdminEntity('ativos', controller.signal),
      loadKpis('', initialPeriod.start, initialPeriod.end, controller.signal),
    ]).then(([assetList]) => setAssets(assetList.rows))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [handleFailure, initialPeriod.end, initialPeriod.start, loadKpis])

  useAutoRefresh(async () => {
    if (!start || !end || new Date(start).getTime() >= new Date(end).getTime()) return
    try {
      await loadKpis(assetId, start, end)
    } catch (cause) {
      handleFailure(cause)
    }
  }, {
    enabled: !refreshing,
    intervalMs: 20_000,
  })

  function changePeriod(value: string) {
    setPeriod(value)
    if (value !== 'CUSTOM') {
      const dates = periodDates(Number(value))
      setStart(dates.start)
      setEnd(dates.end)
    }
  }

  async function applyFilters() {
    if (!start || !end || new Date(start).getTime() >= new Date(end).getTime()) {
      setError('Selecione um período válido para o relatório.')
      return
    }
    setRefreshing(true)
    setError('')
    try {
      await loadKpis(assetId, start, end)
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setRefreshing(false)
    }
  }

  function exportReport() {
    const asset = assets.find((item) => item.id === assetId)
    const rows = [
      ['Relatório', 'Indicadores técnicos Fab Control'],
      ['Ativo', asset ? `${asset.tag || asset.id} - ${asset.nome}` : 'Todos os ativos'],
      ['Início', kpis.inicio_em], ['Fim', kpis.fim_em], ['Ativos considerados', kpis.ativos_considerados],
      ['Disponibilidade (%)', kpis.disponibilidade_pct ?? 'Sem amostra'],
      ['MTTR (segundos)', kpis.mttr_segundos ?? 'Sem amostra'],
      ['MTBF (segundos)', kpis.mtbf_segundos ?? 'Sem amostra'],
      ['Lead time OS (segundos)', kpis.lead_time_os_segundos ?? 'Sem amostra'],
      ['Lead time demanda (segundos)', kpis.lead_time_demanda_segundos ?? 'Sem amostra'],
      ['SLA primeira resposta (%)', kpis.sla_resposta_pct ?? 'Sem amostra'],
      ['SLA resolução (%)', kpis.sla_resolucao_pct ?? 'Sem amostra'],
      ['Falhas não planejadas', kpis.falhas_nao_planejadas],
      ['Metodologia', kpis.metodologia || ''],
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fab-control-indicadores-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const availabilityTarget = kpis.metas?.disponibilidade_pct ?? 90
  const healthItems = [
    { label: 'Disponibilidade', value: kpis.disponibilidade_pct, target: availabilityTarget },
    { label: 'SLA resposta', value: kpis.sla_resposta_pct, target: 90 },
    { label: 'SLA resolução', value: kpis.sla_resolucao_pct, target: 90 },
  ]

  if (loading) return <div className="dashboard-loading">Calculando indicadores administrativos…</div>

  return (
    <section className="admin-analytics-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Relatório indisponível.</strong><span>{error}</span></div> : null}
      <section className="admin-analytics-filters">
        <label><span>Equipamento</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Todos os ativos</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{String(asset.tag || asset.id)} · {String(asset.nome)}</option>)}</select></label>
        <label><span>Período</span><select value={period} onChange={(event) => changePeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option><option value="CUSTOM">Personalizado</option></select></label>
        {period === 'CUSTOM' ? <><label><span>Início</span><input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label><label><span>Fim</span><input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label></> : null}
        <button type="button" disabled={refreshing} onClick={() => void applyFilters()}><CheckIcon />{refreshing ? 'Calculando…' : 'Aplicar período'}</button>
        <button type="button" onClick={exportReport}>Exportar CSV</button>
      </section>

      <section className="admin-analytics-kpis">
        <article><StopIcon /><span><small>MTTR · tempo médio de reparo</small><strong>{duration(kpis.mttr_segundos)}</strong><i>{kpis.falhas_nao_planejadas} falha(s) não planejada(s)</i></span></article>
        <article><AssetIcon /><span><small>MTBF · tempo entre falhas</small><strong>{duration(kpis.mtbf_segundos)}</strong><i>{kpis.ativos_considerados} ativo(s) considerados</i></span></article>
        <article><ShieldIcon /><span><small>Lead time de OS</small><strong>{duration(kpis.lead_time_os_segundos)}</strong><i>abertura até finalização</i></span></article>
        <article><CheckIcon /><span><small>Lead time técnico</small><strong>{duration(kpis.lead_time_demanda_segundos)}</strong><i>envio até decisão</i></span></article>
      </section>

      <div className="admin-analytics-grid">
        <section className="admin-analytics-health">
          <header><span className="eyebrow">DESEMPENHO E METAS</span><h2>Saúde operacional</h2><p>Valores sem amostra permanecem identificados; o sistema não transforma ausência de dados em zero.</p></header>
          <div>{healthItems.map((item) => {
            const current = item.value ?? 0
            const available = item.value != null
            const met = available && current >= item.target
            return <article key={item.label}><header><span><strong>{item.label}</strong><small>Meta {item.target}%</small></span><b className={met ? 'is-met' : available ? 'is-below' : ''}>{percent(item.value)}</b></header><div><i style={{ width: `${Math.max(0, Math.min(100, current))}%` }} /></div><small>{!available ? 'Aguardando dados válidos' : met ? 'Meta atingida' : `${(item.target - current).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. abaixo da meta`}</small></article>
          })}</div>
        </section>

        <section className="admin-analytics-oee admin-analytics-reliability">
          <header><span className="eyebrow">CONFIABILIDADE</span><h2>Comportamento da manutenção</h2><strong>{kpis.falhas_nao_planejadas} falha(s)</strong><small>Somente dados técnicos registrados no período</small></header>
          <div>
            <article><span>Tempo em operação</span><b>{duration(kpis.tempo_operacao_segundos)}</b></article>
            <article><span>Tempo em parada</span><b>{duration(kpis.tempo_parada_segundos)}</b></article>
            <article><span>MTBF observado</span><b>{duration(kpis.mtbf_segundos)}</b></article>
          </div>
          <footer><strong>Janela analisada</strong><span>{dateLabel(kpis.inicio_em)} → {dateLabel(kpis.fim_em)}</span><small>{kpis.metodologia}</small></footer>
        </section>
      </div>
    </section>
  )
}
