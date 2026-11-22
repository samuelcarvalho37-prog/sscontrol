import { workLabels as labels, workText as text, type SharedRow as Row } from './sharedWorkModel'
import './QualitySafetyOverview.css'

export type QualitySafetyArea = 'quality' | 'safety'

type Props = {
  area: QualitySafetyArea
  items: Row[]
  loading: boolean
  canRequest: boolean
  onRequest: () => void
  onRefresh: () => void
  onOpen: (row: Row) => void
  onOpenValidations?: () => void
  onOpenQr?: () => void
  onBrowseOrders?: (status?: 'ALL' | 'OPEN' | 'CLOSED') => void
}

const CLOSED = new Set(['COMPLETED', 'RESOLVED', 'CLOSED'])
const REVIEW = new Set(['IN_TECHNICAL_REVIEW', 'PENDING_VALIDATION'])
const ACTIVE = new Set(['RELEASED', 'IN_PROGRESS', 'PAUSED'])

function stateOf(row: Row): string {
  return String(row.execucao_status === 'PAUSED' ? 'PAUSED' : (row.os_status ?? row.status ?? ''))
}

function metricLabel(state: string): string {
  return labels[state] ?? text(state)
}

export function QualitySafetyOverview({
  area,
  items,
  loading,
  canRequest,
  onRequest,
  onRefresh,
  onOpen,
  onOpenValidations,
  onOpenQr,
  onBrowseOrders,
}: Props) {
  const isQuality = area === 'quality'
  const noun = isQuality ? 'Qualidade' : 'Segurança'
  const eyebrow = isQuality ? 'GARANTIA DA QUALIDADE' : 'SEGURANÇA OPERACIONAL'
  const summary = isQuality
    ? 'Centralize inspeções, liberações e acompanhamento de processos.'
    : 'Acompanhe riscos, liberações e controles críticos da operação.'
  const review = items.filter(item => REVIEW.has(stateOf(item))).length
  const active = items.filter(item => ACTIVE.has(stateOf(item))).length
  const completed = items.filter(item => CLOSED.has(stateOf(item))).length
  // Alertas operacionais não incluem itens já finalizados.
  const alerts = items.filter(item => !CLOSED.has(stateOf(item)) && ['CRITICAL', 'HIGH'].includes(String(item.prioridade))).length
  const queue = items.filter(item => !CLOSED.has(stateOf(item))).slice(0, 3)

  return (
    <section className="quality-safety-overview" aria-label={`Resumo de ${noun}`}>
      <div className={`quality-safety-overview__hero quality-safety-overview__hero--${area}`}>
        <div>
          <span>{eyebrow}</span>
          <h2>{isQuality ? 'Qualidade em campo, com decisões claras.' : 'Segurança presente antes, durante e depois da intervenção.'}</h2>
          <p>{summary}</p>
        </div>
        <div className="quality-safety-overview__hero-actions">
          {canRequest ? <button type="button" onClick={onRequest}>Solicitar OS</button> : null}
          <button type="button" className="quality-safety-overview__secondary" disabled={loading} onClick={onRefresh}>
            {loading ? 'Atualizando…' : 'Atualizar painel'}
          </button>
          {onOpenQr ? <button type="button" className="quality-safety-overview__secondary" onClick={onOpenQr}>Ler QR Code</button> : null}
        </div>
      </div>

      <div className="quality-safety-overview__metrics" aria-label="Indicadores do escopo consultado">
        <button type="button" className="quality-safety-overview__metric" onClick={onOpenValidations ?? (() => onBrowseOrders?.('OPEN'))} aria-label="Abrir validações pendentes"><span>VALIDAÇÕES PENDENTES</span><strong>{review}</strong><small>no escopo atual</small></button>
        <button type="button" className="quality-safety-overview__metric" onClick={() => onBrowseOrders?.('OPEN')} aria-label="Abrir ordens em acompanhamento"><span>EM ACOMPANHAMENTO</span><strong>{active}</strong><small>ordens ativas</small></button>
        <button type="button" className="quality-safety-overview__metric" onClick={() => onBrowseOrders?.('CLOSED')} aria-label="Abrir ordens concluídas"><span>CONCLUÍDAS</span><strong>{completed}</strong><small>na consulta atual</small></button>
        <button type="button" className="quality-safety-overview__metric" onClick={() => onBrowseOrders?.('OPEN')} aria-label="Abrir ordens de prioridade alta"><span>PRIORIDADE ALTA</span><strong>{alerts}</strong><small>itens para atenção</small></button>
      </div>

      <div className="quality-safety-overview__content">
        <section className="quality-safety-overview__queue" aria-label="Fila de decisão">
          <header>
            <div><h3>Fila de decisão</h3><p>Itens visíveis no seu escopo de acesso.</p></div>
            {onOpenValidations ? <button type="button" onClick={onOpenValidations}>Abrir validações</button> : null}
          </header>
          {loading ? <p className="quality-safety-overview__empty">Atualizando informações…</p> : null}
          {!loading && !queue.length ? <p className="quality-safety-overview__empty">Nenhum item pendente neste filtro. As ordens concluídas continuam disponíveis no histórico.</p> : null}
          {!loading && queue.map((row) => {
            const state = stateOf(row)
            return <button className="quality-safety-overview__item" type="button" key={row.id} onClick={() => onOpen(row)}>
              <span className={`quality-safety-overview__state quality-safety-overview__state--${state.toLowerCase()}`} aria-hidden="true">{REVIEW.has(state) ? '!' : ACTIVE.has(state) ? '↻' : '•'}</span>
              <span><strong>{text(row.titulo)}</strong><small>{text(row.codigo)} · {metricLabel(state)}</small></span>
              <span aria-hidden="true">›</span>
            </button>
          })}
        </section>
        <aside className="quality-safety-overview__guide" aria-label="Fluxo de acompanhamento">
          <span>FLUXO DE TRABALHO</span>
          <h3>{isQuality ? 'Da inspeção à liberação.' : 'Do risco à operação segura.'}</h3>
          <ol>
            <li><b>1</b><div><strong>Identifique</strong><small>Use o QR Code ou solicite uma OS com a localização correta.</small></div></li>
            <li><b>2</b><div><strong>Acompanhe</strong><small>Consulte executor, situação e evidências sem duplicar chamados.</small></div></li>
            <li><b>3</b><div><strong>Valide</strong><small>Assine somente quando a sua área for exigida na liberação.</small></div></li>
          </ol>
        </aside>
      </div>
    </section>
  )
}
