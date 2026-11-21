import { workLabels as labels, workText as text, type SharedRow as Row } from './sharedWorkModel'
import './ProductionOverview.css'

type Props = {
  items: Row[]
  loading: boolean
  canRequest: boolean
  onRequest: () => void
  onRefresh: () => void
  onOpen: (row: Row) => void
  onOpenQr?: () => void
}

const CLOSED = new Set(['COMPLETED', 'RESOLVED', 'CLOSED', 'CANCELLED'])
const ACTIVE = new Set(['RELEASED', 'IN_PROGRESS', 'PAUSED'])
const PENDING_RETURN = new Set(['IN_TECHNICAL_REVIEW', 'PENDING_VALIDATION'])

function stateOf(row: Row): string {
  return String(row.execucao_status === 'PAUSED' ? 'PAUSED' : (row.os_status ?? row.status ?? ''))
}

function priorityClass(row: Row) {
  const priority = String(row.prioridade ?? '').toUpperCase()
  return priority === 'CRITICAL' ? 'critical' : priority === 'HIGH' ? 'high' : priority === 'MEDIUM' ? 'medium' : 'normal'
}

export function ProductionOverview({ items, loading, canRequest, onRequest, onRefresh, onOpen, onOpenQr }: Props) {
  const openItems = items.filter(item => !CLOSED.has(stateOf(item)))
  const active = openItems.filter(item => ACTIVE.has(stateOf(item)))
  const pendingReturn = openItems.filter(item => PENDING_RETURN.has(stateOf(item)))
  const alerts = openItems.filter(item => ['CRITICAL', 'HIGH'].includes(String(item.prioridade ?? '').toUpperCase()))
  const lines = new Set(openItems.map(item => String(item.linha_nome ?? item.linha ?? '').trim()).filter(Boolean)).size
  const attention = [...alerts, ...active.filter(item => !alerts.includes(item))].slice(0, 3)
  const requests = items.filter(item => !CLOSED.has(stateOf(item))).slice(0, 3)

  return <section className="production-overview" aria-label="Painel da produção">
    <header className="production-overview__hero">
      <div><span>OPERAÇÃO INDUSTRIAL</span><h2>Painel da Produção</h2><p>Turno, linhas e acompanhamento da manutenção.</p></div>
      <div className="production-overview__hero-actions">
        {canRequest ? <button type="button" className="production-overview__primary" onClick={onRequest}>Registrar ocorrência</button> : null}
        <button type="button" disabled={loading} onClick={onRefresh}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
        {onOpenQr ? <button type="button" onClick={onOpenQr}>Ler QR Code</button> : null}
      </div>
    </header>

    <div className="production-overview__metrics" aria-label="Resumo operacional">
      <article><span>LINHAS EM ACOMPANHAMENTO</span><strong>{lines}</strong><small>com OS visível no período</small></article>
      <article className="production-overview__metric--warning"><span>OS EM EXECUÇÃO</span><strong>{active.length}</strong><small>intervenções em curso</small></article>
      <article><span>SOLICITAÇÕES / OS ABERTAS</span><strong>{openItems.length}</strong><small>no seu escopo</small></article>
      <article className="production-overview__metric--attention"><span>AGUARDANDO RETORNO</span><strong>{pendingReturn.length}</strong><small>em validação técnica</small></article>
    </div>

    <div className="production-overview__grid">
      <section className="production-overview__card production-overview__attention"><header><div><h3>Atenções do turno</h3><p>Prioridades da operação e manutenção.</p></div><span>{alerts.length} alta(s)</span></header>{loading ? <p className="production-overview__empty">Atualizando informações…</p> : !attention.length ? <p className="production-overview__empty">Nenhuma prioridade operacional visível agora.</p> : attention.map(row => <button type="button" key={row.id} className="production-overview__row" onClick={() => onOpen(row)}><i className={`production-overview__priority production-overview__priority--${priorityClass(row)}`} /><span><strong>{text(row.linha_nome ?? row.linha ?? row.ativo_nome ?? row.ativo)}</strong><small>{text(row.titulo)}</small></span><em>{labels[stateOf(row)] ?? text(stateOf(row))}</em><b aria-hidden="true">›</b></button>)}</section>
      <section className="production-overview__card production-overview__active"><header><div><h3>Manutenções em andamento</h3><p>Veja a intervenção sem duplicar solicitações.</p></div><span>{active.length} ativa(s)</span></header>{loading ? <p className="production-overview__empty">Atualizando informações…</p> : !active.length ? <p className="production-overview__empty">Nenhuma manutenção em execução no seu escopo.</p> : active.slice(0, 3).map(row => <button type="button" key={row.id} className="production-overview__row" onClick={() => onOpen(row)}><i className="production-overview__priority production-overview__priority--medium" /><span><strong>{text(row.ativo_nome ?? row.ativo)}</strong><small>{text(row.executor_nome ?? row.tecnico_nome ?? 'Técnico em definição')} · {text(row.linha_nome ?? row.linha)}</small></span><em>{labels[stateOf(row)] ?? text(stateOf(row))}</em><b aria-hidden="true">›</b></button>)}</section>
      <section className="production-overview__card production-overview__requests"><header><div><h3>Minhas solicitações e OS</h3><p>Acompanhe antes de abrir um novo chamado.</p></div><span>{requests.length} visível(is)</span></header>{loading ? <p className="production-overview__empty">Atualizando informações…</p> : !requests.length ? <p className="production-overview__empty">Ainda não há solicitações ou OS abertas no seu escopo.</p> : requests.map(row => <button type="button" key={row.id} className="production-overview__row" onClick={() => onOpen(row)}><span><strong>{text(row.titulo)}</strong><small>{text(row.codigo ?? row.os_codigo)} · {text(row.ativo_nome ?? row.ativo)}</small></span><em>{labels[stateOf(row)] ?? text(stateOf(row))}</em><b aria-hidden="true">›</b></button>)}</section>
      <section className="production-overview__card production-overview__return"><header><div><h3>Retorno à operação</h3><p>Itens que exigem acompanhamento ou confirmação.</p></div><span>{pendingReturn.length} pendente(s)</span></header>{loading ? <p className="production-overview__empty">Atualizando informações…</p> : !pendingReturn.length ? <p className="production-overview__empty">Nenhum retorno aguardando validação neste momento.</p> : pendingReturn.slice(0, 3).map(row => <button type="button" key={row.id} className="production-overview__row" onClick={() => onOpen(row)}><span><strong>{text(row.ativo_nome ?? row.ativo)}</strong><small>{text(row.titulo)}</small></span><em>Ver detalhes</em><b aria-hidden="true">›</b></button>)}</section>
    </div>
  </section>
}
