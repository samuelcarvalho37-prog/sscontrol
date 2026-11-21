import { useEffect, useId, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, CalendarCheck2, ChartNoAxesCombined, CheckCircle2, CircleDollarSign, ClipboardList, Clock3, HardHat, LayoutDashboard, RefreshCw, SlidersHorizontal, Target, TriangleAlert, Wrench } from 'lucide-react'
import type { PcmData } from './PcmDashboard'
import type { AdminEntityRecord } from '../types/catalog'
import { getDevelopmentTenantSlug } from '../services/api/config'
import { getPcmMonthlyOrders, type PcmMonthlyOrders } from '../services/api/pcmMonthlyOrders'
import './PcmExecutiveOverview.css'

const money = (value: number | string) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const numeric = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const hours = (value: number | null | undefined) => value == null ? '—' : `${numeric(value / 3600)} h`
const month = (value: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`)).replace('.', '')

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="pcm-executive__empty"><ChartNoAxesCombined size={30} strokeWidth={1.2} aria-hidden="true" /><span>{children}</span></div>
}

function DeadlineRing({ label, value, numerator, denominator }: { label: string; value: number | null; numerator: number; denominator: number }) {
  const percent = value == null ? null : Math.min(100, Math.max(0, value))
  return <div className="pcm-executive__goal"><h3>{label}</h3><div className="pcm-executive__ring" role="img" aria-label={`${label}: ${percent == null ? 'sem vencimentos no período' : `${numeric(percent)}% no prazo`}`}>
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="49" /><circle cx="60" cy="60" r="49" pathLength="100" strokeDasharray={`${percent ?? 0} 100`} transform="rotate(-90 60 60)" /></svg><strong>{percent == null ? '—' : `${numeric(percent)}%`}</strong>
  </div><small>{denominator ? `${numerator} de ${denominator} no prazo` : 'Sem vencimentos'}</small></div>
}

interface Props {
  data: PcmData
  days: string
  assetId: string
  assets: AdminEntityRecord[]
  loading: boolean
  onDays: (value: string) => void
  onAsset: (value: string) => void
  onRefresh: () => void
  onCustomize: () => void
  onOrders: () => void
  onOrder: (id: string) => void
}

export function PcmExecutiveOverview({ data, days, assetId, assets, loading, onDays, onAsset, onRefresh, onCustomize, onOrders, onOrder }: Props) {
  const id = useId()
  const [lineId, setLineId] = useState('')
  const [series, setSeries] = useState<PcmMonthlyOrders[] | null>(null)
  const [seriesError, setSeriesError] = useState('')
  const [seriesLoading, setSeriesLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setSeries(null)
    setSeriesError('')
    setSeriesLoading(true)
    void getPcmMonthlyOrders(assetId, controller.signal).then(rows => {
      if (!controller.signal.aborted) setSeries(rows)
    }).catch(cause => {
      if (!controller.signal.aborted) setSeriesError(cause instanceof Error ? cause.message : 'Não foi possível consultar o histórico.')
    }).finally(() => { if (!controller.signal.aborted) setSeriesLoading(false) })
    return () => controller.abort()
  }, [assetId, data.atualizado_em])
  const report = data.relatorios
  const management = report?.gestao
  const costs = management?.custos_linhas ?? []
  const lineCosts = costs.filter(line => !lineId || line.line_id === lineId).sort((a, b) => Number(b.total) - Number(a.total))
  const total = management ? costs.reduce((sum, line) => sum + Number(line.total), 0) : null
  const pending = costs.reduce((sum, line) => sum + line.pendencias, 0)
  const monthly = management?.metas.find(item => item.periodo === 'MES')
  const annual = management?.metas.find(item => item.periodo === 'ANO')
  const external = [...(management?.externos_mensais ?? [])].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-6)
  const thisMonth = management?.mes_atual
  const externalAmount = management ? Number(external.find(item => item.mes === thisMonth)?.mao_obra ?? 0) : null
  const budgetRow = management?.orcamentos_externos?.find(item => item.mes === thisMonth)
  const budget = budgetRow == null ? null : Number(budgetRow.valor)
  const externalMax = Math.max(1, ...external.map(item => Number(item.mao_obra)), budget ?? 0)
  const costMax = Math.max(1, ...lineCosts.map(item => Number(item.total)))
  const seriesMax = Math.max(4, Math.ceil(Math.max(0, ...(series ?? []).flatMap(item => [item.preventive, item.corrective])) / 4) * 4)
  const plotX = (index: number) => 65 + index * 100
  const plotY = (value: number) => 160 - value / seriesMax * 130
  const company = getDevelopmentTenantSlug().replace(/-/g, ' ').toLocaleUpperCase('pt-BR')
  const notices = [
    ...(management?.corretivas_recorrentes ?? []).map(item => ({ key: item.asset_id, title: `${item.line_name} · ${item.asset_tag}`, detail: `${item.corretivas} corretivas no período`, danger: false, orderId: '' })),
    ...(data.contextos?.ordens_abertas ?? []).filter(item => item.programada_para && new Date(item.programada_para).getTime() < Date.now()).map(item => ({ key: item.id, title: `${item.ativo_tag} · ${item.ativo_nome}`, detail: `${item.codigo} · prazo vencido`, danger: true, orderId: item.id })),
  ].slice(0, 3)
  const kpis = [
    { label: 'Disponibilidade', value: data.confiabilidade.disponibilidade_percentual == null ? '—' : `${numeric(data.confiabilidade.disponibilidade_percentual)}%`, Icon: Activity, note: `${data.confiabilidade.ativos_considerados} ativos considerados` },
    { label: 'OS abertas', value: numeric(data.atual.ordens_abertas), Icon: ClipboardList, note: 'Situação atual' },
    { label: 'OS concluídas', value: report?.ordens?.concluidas_no_periodo == null ? '—' : numeric(report.ordens.concluidas_no_periodo), Icon: CheckCircle2, note: 'No período selecionado' },
    { label: 'MTTR', value: hours(data.confiabilidade.mttr_segundos), Icon: Clock3, note: 'Tempo médio de reparo' },
    { label: 'MTBF', value: hours(data.confiabilidade.mtbf_segundos), Icon: ChartNoAxesCombined, note: 'Tempo médio entre falhas' },
    { label: 'Custo total', value: total == null ? '—' : money(total), Icon: CircleDollarSign, note: pending ? `${pending} custos pendentes` : 'Valores registrados no período' },
  ]

  return <section className="pcm-executive" aria-label="Visão geral da manutenção">
    <header className="pcm-executive__heading"><div><span className="pcm-executive__company">{company || 'PAINEL DO PCM'}</span><h1>Visão geral da manutenção</h1><p>Indicadores da unidade · dados reais{data.atualizado_em ? ` · atualizado às ${new Date(data.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
      <div className="pcm-executive__filters"><label><CalendarCheck2 size={17} aria-hidden="true" /><span className="pcm-executive__sr">Período dos indicadores</span><select value={days} onChange={event => onDays(event.target.value)} disabled={loading}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 6 meses</option><option value="365">Últimos 12 meses</option></select></label>
        <label><Wrench size={16} aria-hidden="true" /><span className="pcm-executive__sr">Equipamento dos indicadores</span><select value={assetId} onChange={event => onAsset(event.target.value)} disabled={loading || !assets.length}><option value="">Todos os equipamentos</option>{assets.map(asset => <option key={String(asset.id)} value={String(asset.id)}>{String(asset.tag)} · {String(asset.nome)}</option>)}</select></label>
        <button type="button" title="Atualizar indicadores" aria-label="Atualizar indicadores" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'is-loading' : ''} /></button><button type="button" className="pcm-executive__customize" onClick={onCustomize}><SlidersHorizontal size={16} />Personalizar lousa</button>
      </div>
    </header>

    <div className="pcm-executive__kpis">{kpis.map(({ label, value, Icon, note }) => <article className="pcm-executive__kpi" key={label}><h2><Icon size={21} strokeWidth={1.7} aria-hidden="true" />{label}</h2><strong>{value}</strong><small>{note}</small></article>)}</div>

    <div className="pcm-executive__middle">
      <section className="pcm-executive__panel pcm-executive__costs" aria-labelledby={`${id}-costs`}><header><h2 id={`${id}-costs`}><CircleDollarSign size={22} />Custos de manutenção por linha</h2><label><span className="pcm-executive__sr">Linha dos custos</span><select value={lineId} onChange={event => setLineId(event.target.value)}><option value="">Todas as linhas</option>{costs.map(line => <option key={line.line_id} value={line.line_id}>{line.line_name}</option>)}</select></label></header>
        {lineCosts.some(line => Number(line.total) > 0) ? <div className="pcm-executive__cost-bars">{lineCosts.slice(0, 5).map(line => <div className="pcm-executive__cost-row" key={line.line_id}><span title={`${line.sector_name} · ${line.line_name}`}>{line.line_name}</span><div className="pcm-executive__cost-track" role="img" aria-label={`${line.line_name}: peças ${money(line.materiais)}, mão de obra interna ${money(line.mao_obra_interna)}, serviços externos ${money(line.externos)}`}>
          <i style={{ width: `${Number(line.materiais) / costMax * 100}%` }} /><i style={{ width: `${Number(line.mao_obra_interna) / costMax * 100}%` }} /><i style={{ width: `${Number(line.externos) / costMax * 100}%` }} /></div><strong>{money(line.total)}</strong></div>)}</div> : <EmptyChart>Nenhum custo de manutenção registrado no período.</EmptyChart>}
        <footer className="pcm-executive__legend"><span><i />Peças</span><span><i />Mão de obra interna</span><span><i />Serviços externos</span></footer>{pending > 0 ? <p className="pcm-executive__pending">{pending} lançamento(s) aguardando custo. O total considera valores conhecidos.</p> : null}
      </section>

      <section className="pcm-executive__panel" aria-labelledby={`${id}-goals`}><header><h2 id={`${id}-goals`}><Target size={22} />Cumprimento de prazo</h2></header><div className="pcm-executive__goals"><DeadlineRing label="Mês atual" value={monthly?.cumprimento_percentual ?? null} numerator={monthly?.no_prazo ?? 0} denominator={monthly?.vencimento_ate_hoje ?? 0} /><DeadlineRing label="Ano atual" value={annual?.cumprimento_percentual ?? null} numerator={annual?.no_prazo ?? 0} denominator={annual?.vencimento_ate_hoje ?? 0} /></div><p className="pcm-executive__footnote">Base: ordens com vencimento até hoje.</p></section>

      <section className="pcm-executive__panel pcm-executive__external" aria-labelledby={`${id}-external`}><header><h2 id={`${id}-external`}><HardHat size={22} />Mão de obra externa</h2></header><div className="pcm-executive__external-summary"><div><strong>{externalAmount == null ? '—' : money(externalAmount)}</strong><span>Acumulado no mês atual</span></div>{budget != null ? <small>Orçamento<strong>{money(budget)}</strong></small> : null}</div>
        {external.some(item => Number(item.mao_obra) > 0) ? <div className="pcm-executive__external-chart" role="img" aria-label="Gasto mensal com mão de obra externa"><div className="pcm-executive__budget-line" style={budget == null ? { display: 'none' } : { bottom: `${budget / externalMax * 100}%` }} />{external.map(item => <div key={item.mes}><span>{money(item.mao_obra)}</span><i style={{ height: `${Number(item.mao_obra) / externalMax * 100}%` }} /><small>{month(item.mes)}</small></div>)}</div> : <EmptyChart>Aguardando lançamentos de mão de obra externa.</EmptyChart>}
        <footer className="pcm-executive__balance"><span>{budget == null ? 'Orçamento mensal' : budget - (externalAmount ?? 0) < 0 ? 'Acima do orçamento' : 'Saldo disponível'}</span><strong>{budget == null ? 'Não definido' : money(Math.abs(budget - (externalAmount ?? 0)))}</strong></footer>
      </section>
    </div>

    <div className="pcm-executive__bottom"><section className="pcm-executive__panel" aria-labelledby={`${id}-types`}><header><h2 id={`${id}-types`}><Wrench size={22} />Preventivas e corretivas</h2><span>Últimos 6 meses · mês atual em andamento</span></header>
      {seriesLoading ? <EmptyChart>Consultando histórico mensal…</EmptyChart> : seriesError ? <p className="pcm-executive__series-error" role="status">{seriesError} Use Atualizar indicadores para tentar novamente.</p> : series?.some(item => item.preventive + item.corrective > 0) ? <div className="pcm-executive__trend"><svg viewBox="0 0 610 200" role="img" aria-label="Quantidade mensal de ordens preventivas e corretivas"><title>Ordens preventivas e corretivas nos últimos seis meses</title>
        {Array.from({ length: 5 }, (_, index) => { const value = index * seriesMax / 4; return <g key={index}><line x1="50" x2="590" y1={plotY(value)} y2={plotY(value)} /><text x="40" y={plotY(value) + 4} textAnchor="end">{value}</text></g> })}
        {(['preventive', 'corrective'] as const).map((key, seriesIndex) => <g key={key} className={`pcm-executive__series-${seriesIndex}`}><polyline points={series.map((item, index) => `${plotX(index)},${plotY(item[key])}`).join(' ')} />{series.map((item, index) => <g key={item.month}><circle cx={plotX(index)} cy={plotY(item[key])} r="4" /><text x={plotX(index)} y={plotY(item[key]) + (seriesIndex === 0 ? -12 : 19)} textAnchor="middle">{item[key]}</text></g>)}</g>)}
        {series.map((item, index) => <text key={item.month} x={plotX(index)} y="194" textAnchor="middle">{month(item.month)}</text>)}
      </svg><table className="pcm-executive__sr"><caption>Valores mensais das ordens</caption><thead><tr><th>Mês</th><th>Preventivas</th><th>Corretivas</th></tr></thead><tbody>{series.map(item => <tr key={item.month}><th>{item.month}</th><td>{item.preventive}</td><td>{item.corrective}</td></tr>)}</tbody></table></div> : <EmptyChart>As ordens aparecerão aqui quando forem registradas.</EmptyChart>}
      <footer className="pcm-executive__legend"><span><i />Preventivas</span><span><i />Corretivas</span></footer>
    </section><section className="pcm-executive__panel pcm-executive__attention" aria-labelledby={`${id}-attention`}><header><h2 id={`${id}-attention`}><TriangleAlert size={22} />Atenção do PCM</h2><button type="button" onClick={onOrders}>Ver fila<ArrowRight size={15} /></button></header>
      {notices.length ? <ul>{notices.map(notice => <li key={notice.key}><button type="button" data-danger={notice.danger} onClick={() => notice.orderId ? onOrder(notice.orderId) : onOrders()}><TriangleAlert size={24} /><span><strong>{notice.title}</strong><small>{notice.detail}</small></span><ArrowRight size={16} /></button></li>)}</ul> : <div className="pcm-executive__all-clear"><CheckCircle2 size={32} strokeWidth={1.3} /><strong>Nenhum alerta no momento</strong><span>Corretivas recorrentes e ordens atrasadas aparecerão aqui.</span></div>}
    </section></div>
    <footer className="pcm-executive__footer"><span><LayoutDashboard size={14} />VORQIX · Gestão de manutenção</span><span>Custos e confiabilidade: últimos {days} dias · prazos: mês e ano atuais</span></footer>
  </section>
}
