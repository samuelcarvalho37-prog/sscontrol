import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import {
  completeOperatorAction,
  consumeOperatorMaterial,
  getOperatorAction,
  listOperatorActions,
  listOperatorMaterials,
  pauseExecution,
  resumeExecution,
  saveOperatorResponses,
  startOperatorAction,
  uploadExecutionEvidence,
  validateOperatorActionCompletion,
} from '../services/api/operatorActions'
import type { ConsumableMaterial, Execution, ExecutionCompletionBlocker, ExecutionItem, OperatorAction, OperatorActionDetail, StopMode, TechnicalCompletionInput } from '../types/operatorActions'

const stopModeLabels: Record<StopMode, string> = {
  NO_STOP: 'Sem parada',
  STOPPED: 'Equipamento parado',
  EXECUTOR_DECISION: 'Decisão do técnico',
}

function label(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  const labels: Record<string, string> = {
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta',
    CRITICAL: 'Crítica',
    PREVENTIVE: 'Preventiva',
    PREVENTIVA: 'Preventiva',
    CORRECTIVE: 'Corretiva',
    CORRETIVA: 'Corretiva',
    INSPECTION: 'Inspeção',
    INSPECAO: 'Inspeção',
    PREDICTIVE: 'Preditiva',
    PREDITIVA: 'Preditiva',
    IN_PROGRESS: 'Em execução',
    COMPLETED: 'Concluída',
    READY: 'Pronta para execução',
    BLOCKED: 'Bloqueada',
    PAUSED: 'Pausada',
    OPEN: 'Aberta',
  }
  return labels[normalized] ?? (String(value ?? '').replaceAll('_', ' ') || 'Não informado')
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não programada'
}

function elapsed(value: string | null | undefined) {
  if (!value) return 'Não informado'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return days ? `${days}d ${hours}h` : `${hours}h`
}

function duration(value: number | null | undefined) {
  const total = Math.max(0, Math.floor(Number(value ?? 0)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}min`
  if (minutes > 0) return `${minutes}min ${seconds}s`
  return `${seconds}s`
}

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0))
}

function overdue(action: OperatorAction) {
  return Boolean(action.programada_para && new Date(action.programada_para).getTime() < Date.now() && action.status !== 'COMPLETED')
}

type ScheduleIndicator = { label: string; tone: 'early' | 'on-time' | 'late' | 'scheduled' | 'unscheduled'; description: string }

function scheduleIndicator(plannedAt: string | null | undefined, actualAt: string | null | undefined, status: string): ScheduleIndicator {
  if (!plannedAt || Number.isNaN(new Date(plannedAt).getTime())) return { label: 'Sem programação', tone: 'unscheduled', description: 'A OS não possui data planejada.' }
  const planned = new Date(plannedAt).getTime()
  const actual = actualAt ? new Date(actualAt).getTime() : NaN
  const comparedAt = Number.isFinite(actual) ? actual : Date.now()
  const isCompletedOrStarted = Boolean(actualAt) || ['IN_PROGRESS', 'COMPLETED'].includes(status)

  if (!isCompletedOrStarted && planned > Date.now()) return { label: 'Pode antecipar', tone: 'scheduled', description: 'A OS está programada para o futuro e pode ser executada antecipadamente.' }
  if (comparedAt < planned) return { label: 'Antecipada', tone: 'early', description: 'A execução foi iniciada ou concluída antes da programação.' }
  if (comparedAt <= planned + 86400000) return { label: 'No prazo', tone: 'on-time', description: 'A execução ocorreu dentro da janela de um dia da programação.' }
  return { label: 'Atrasada', tone: 'late', description: 'A execução ocorreu após a janela planejada.' }
}

function itemText(item: ExecutionItem) {
  return item.resposta_texto ?? item.resposta_opcao ?? (item.resposta_booleano === true ? 'SIM' : item.resposta_booleano === false ? 'NÃO' : '')
}

type ActionFilter = 'PENDING' | 'IN_PROGRESS' | 'CRITICAL' | 'OVERDUE' | null

export function TechnicianDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  return <TechnicianDashboardBoundary><TechnicianDashboardContent onSessionExpired={onSessionExpired} /></TechnicianDashboardBoundary>
}

class TechnicianDashboardBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(cause: Error) {
    return { message: cause.message || 'Falha inesperada ao exibir a Central do Técnico.' }
  }

  componentDidCatch(cause: Error, info: ErrorInfo) {
    console.error('Falha na Central do Técnico.', cause, info)
  }

  render() {
    if (this.state.message) return <section className="technician-dashboard"><section className="technician-dashboard__panel technician-dashboard__fatal-error" role="alert"><h1>Não foi possível atualizar esta tela</h1><p>{this.state.message}</p><button type="button" onClick={() => window.location.reload()}>Recarregar Central do Técnico</button></section></section>
    return this.props.children
  }
}

function TechnicianDashboardContent({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [actions, setActions] = useState<OperatorAction[]>([])
  const [history, setHistory] = useState<OperatorAction[]>([])
  const [selected, setSelected] = useState<OperatorActionDetail | null>(null)
  const [execution, setExecution] = useState<Execution | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<StopMode>('NO_STOP')
  const [pauseReason, setPauseReason] = useState('')
  const [responses, setResponses] = useState<Record<string, { resposta: string; valor: string; observacao: string }>>({})
  const [completion, setCompletion] = useState<TechnicalCompletionInput>({ resultado: '', observacao: null, modo_parada: 'NO_STOP' })
  const [blockers, setBlockers] = useState<ExecutionCompletionBlocker[]>([])
  const [actionFilter, setActionFilter] = useState<ActionFilter>(null)
  const [showAllActions, setShowAllActions] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [materials, setMaterials] = useState<ConsumableMaterial[]>([])
  const [materialId, setMaterialId] = useState('')
  const [materialQuantity, setMaterialQuantity] = useState('1')
  const [materialObservation, setMaterialObservation] = useState('')

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [operatorActions, completedActions] = await Promise.all([listOperatorActions(), listOperatorActions(true)])
      setActions(operatorActions)
      setHistory(completedActions)
    }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Não foi possível carregar suas ações.'; if (/sessão|autentica|token/i.test(message)) onSessionExpired(); else setError(message) }
    finally { setLoading(false) }
  }, [onSessionExpired])

  useEffect(() => { void reload() }, [reload])

  const counts = useMemo(() => ({
    pending: actions.filter(action => action.status === 'READY').length,
    progress: actions.filter(action => action.status === 'IN_PROGRESS').length,
    critical: actions.filter(action => action.prioridade === 'CRITICAL').length,
    overdue: actions.filter(overdue).length,
  }), [actions])

  const filteredActions = useMemo(() => actions.filter((action) => {
    if (actionFilter === 'PENDING') return action.status === 'READY'
    if (actionFilter === 'IN_PROGRESS') return action.status === 'IN_PROGRESS'
    if (actionFilter === 'CRITICAL') return action.prioridade === 'CRITICAL'
    if (actionFilter === 'OVERDUE') return overdue(action)
    return true
  }), [actions, actionFilter])

  const prioritizedActions = useMemo(() => [...filteredActions].sort((left, right) => {
    const score = (action: OperatorAction) => {
      if (action.status === 'IN_PROGRESS') return 0
      if (action.prioridade === 'CRITICAL') return 1
      if (overdue(action)) return 2
      if (action.prioridade === 'HIGH') return 3
      return 4
    }
    return score(left) - score(right)
  }), [filteredActions])
  const nextAction = useMemo(() => [...actions].sort((left, right) => {
    const score = (action: OperatorAction) => action.status === 'IN_PROGRESS' ? 0 : action.prioridade === 'CRITICAL' ? 1 : overdue(action) ? 2 : action.prioridade === 'HIGH' ? 3 : 4
    return score(left) - score(right)
  })[0] ?? null, [actions])
  const visibleActions = showAllActions || actionFilter ? prioritizedActions : prioritizedActions.slice(0, 8)
  const visibleHistory = showAllHistory ? history : history.slice(0, 5)

  async function open(actionId: string) {
    setBusy(true); setError(''); setBlockers([])
    try { const [data, availableMaterials] = await Promise.all([getOperatorAction(actionId), listOperatorMaterials(actionId)]); setSelected(data.acao); setExecution(data.execucao); setMaterials(availableMaterials); setMaterialId(availableMaterials[0]?.id ?? ''); setMode(data.execucao?.modo_parada ?? data.acao.modo_parada ?? 'NO_STOP'); setCompletion(current => ({ ...current, modo_parada: data.execucao?.modo_parada ?? data.acao.modo_parada ?? 'NO_STOP' })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a ação.') }
    finally { setBusy(false) }
  }

  async function start() {
    if (!selected) return
    setBusy(true); setError('')
    try { setExecution(await startOperatorAction(selected.id, mode)); await reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a execução.') }
    finally { setBusy(false) }
  }

  async function pause() {
    if (!execution) return
    const reason = pauseReason.trim()
    if (reason.length < 3) {
      setError('Informe o motivo da pausa antes de continuar.')
      return
    }
    setBusy(true); setError('')
    try {
      setExecution(await pauseExecution(execution.id, reason))
      setPauseReason('')
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível pausar a execução.') }
    finally { setBusy(false) }
  }

  async function resume() {
    if (!execution) return
    setBusy(true); setError('')
    try {
      setExecution(await resumeExecution(execution.id))
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível retomar a execução.') }
    finally { setBusy(false) }
  }

  async function refreshBlockers(actionId: string | undefined) {
    if (!actionId) return
    try { setBlockers((await validateOperatorActionCompletion(actionId)).pendencias ?? []) }
    catch { /* A próxima validação explícita mostrará qualquer indisponibilidade da API. */ }
  }

  async function save(item: ExecutionItem) {
    if (!selected) return
    const answer = responses[item.id] ?? { resposta: itemText(item), valor: item.resposta_numero?.toString() ?? '', observacao: item.observacao ?? '' }
    setBusy(true); setError('')
    try {
      const numeric = answer.valor.trim() === '' ? null : Number(answer.valor)
      if (numeric !== null && !Number.isFinite(numeric)) throw new Error('Informe um valor numérico válido.')
      setExecution(await saveOperatorResponses(selected.id, [{ id: item.id, resposta: answer.resposta.trim() || null, valor: numeric, observacao: answer.observacao.trim() || null }]))
      await refreshBlockers(selected.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a resposta.') }
    finally { setBusy(false) }
  }

  async function uploadEvidence(item: ExecutionItem, file: File) {
    if (!execution) return
    setBusy(true); setError('')
    try {
      setExecution(await uploadExecutionEvidence(execution.id, item.id, file, responses[item.id]?.observacao?.trim() || item.observacao || null))
      await refreshBlockers(selected?.id)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a evidência.') }
    finally { setBusy(false) }
  }

  async function consumeMaterial() {
    if (!selected) return
    const quantity = Number(materialQuantity)
    if (!materialId || !Number.isFinite(quantity) || quantity <= 0) {
      setError('Selecione a peça e informe uma quantidade válida.')
      return
    }
    setBusy(true); setError('')
    try {
      setExecution(await consumeOperatorMaterial(selected.id, materialId, quantity, materialObservation.trim() || null))
      const availableMaterials = await listOperatorMaterials(selected.id)
      setMaterials(availableMaterials)
      setMaterialId(availableMaterials[0]?.id ?? '')
      setMaterialQuantity('1'); setMaterialObservation('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a saída de material.') }
    finally { setBusy(false) }
  }

  async function validateAndComplete() {
    if (!selected) return
    setBusy(true); setError(''); setBlockers([])
    try {
      const validation = await validateOperatorActionCompletion(selected.id)
      if (!validation.pode_concluir) {
        setBlockers(validation.pendencias ?? [])
        return
      }
      if (completion.resultado.trim().length < 3) throw new Error('Informe o resultado da execução.')
      const completedExecution = await completeOperatorAction(selected.id, { ...completion, resultado: completion.resultado.trim(), observacao: completion.observacao?.trim() || null, modo_parada: mode })
      setExecution(completedExecution)
      setSelected(current => current ? {
        ...current,
        status: 'COMPLETED',
        finalizada_em: completedExecution.concluida_em ?? current.finalizada_em,
      } : current)
      setActions(current => current.filter(action => action.id !== selected.id))
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a execução.') }
    finally { setBusy(false) }
  }

  const items = execution?.itens ?? selected?.checklist_itens ?? []
  const isSupportTechnician = selected?.papel_na_equipe === 'APOIO'
  const selectedSchedule = selected ? scheduleIndicator(selected.programada_para, execution?.concluida_em ?? execution?.iniciada_em ?? selected.finalizada_em ?? selected.iniciada_em, selected.status) : null
  const itemGroups = useMemo(() => {
    const groups = new Map<string, ExecutionItem[]>()
    for (const item of items) {
      const category = String(item.categoria ?? 'GERAL').trim().toUpperCase() || 'GERAL'
      groups.set(category, [...(groups.get(category) ?? []), item])
    }
    return [...groups.entries()]
  }, [items])
  return <section className="technician-dashboard" aria-busy={loading || busy}>
    <header className="technician-dashboard__heading"><div><span className="eyebrow">EXECUÇÃO DE MANUTENÇÃO</span><h1>Central do Técnico</h1><p>Priorize, execute e registre cada ordem com clareza no chão de fábrica.</p><div className="technician-dashboard__connection"><span aria-hidden="true" />Fila operacional sincronizada <b>{actions.length} ordem(ns) disponível(is)</b></div></div><button type="button" onClick={() => void reload()} disabled={loading || busy}>{loading ? 'Sincronizando…' : 'Sincronizar fila'}</button></header>
    {error && <p className="technician-dashboard__error" role="alert">{error}</p>}
    <div className="technician-dashboard__metrics"><Metric label="Pendentes" value={counts.pending} filter="PENDING" active={actionFilter === 'PENDING'} onClick={() => setActionFilter(current => current === 'PENDING' ? null : 'PENDING')} /><Metric label="Em execução" value={counts.progress} filter="IN_PROGRESS" active={actionFilter === 'IN_PROGRESS'} onClick={() => setActionFilter(current => current === 'IN_PROGRESS' ? null : 'IN_PROGRESS')} /><Metric label="Críticas" value={counts.critical} filter="CRITICAL" active={actionFilter === 'CRITICAL'} tone="danger" onClick={() => setActionFilter(current => current === 'CRITICAL' ? null : 'CRITICAL')} /><Metric label="Atrasadas" value={counts.overdue} filter="OVERDUE" active={actionFilter === 'OVERDUE'} tone="warning" onClick={() => setActionFilter(current => current === 'OVERDUE' ? null : 'OVERDUE')} /></div>
    {!selected ? <>
      <section className="technician-dashboard__panel technician-dashboard__next-action" aria-label="Próxima ação recomendada">
        <div className="technician-dashboard__panel-heading"><div><span className="pcm-section-kicker">PRÓXIMA AÇÃO</span><h2>{nextAction ? 'Comece por aqui' : 'Fila em dia'}</h2></div>{nextAction ? <span>{label(nextAction.prioridade)}</span> : null}</div>
        {nextAction ? <button type="button" className="technician-action" onClick={() => void open(nextAction.id)}><span className="technician-action__top"><strong>{nextAction.ordem_codigo}</strong><em>{nextAction.status === 'IN_PROGRESS' ? 'Retomar agora' : 'Abrir OS'}</em></span><strong>{nextAction.titulo}</strong><span>{[nextAction.ativo_tag, nextAction.ativo_nome].filter(Boolean).join(' · ')}</span><small>{[nextAction.setor_nome, nextAction.linha_nome, label(nextAction.tipo)].filter(Boolean).join(' · ')}</small></button> : <p>Não há OS pendente ou em execução no momento.</p>}
      </section>
      <section className="technician-dashboard__shortcuts" aria-label="Atalhos da central do técnico"><div><span className="pcm-section-kicker">ATALHOS DE EXECUÇÃO</span><strong>Organize sua próxima ação</strong></div><div className="technician-dashboard__shortcut-list"><button type="button" className={actionFilter === 'PENDING' ? 'is-active' : ''} onClick={() => setActionFilter(current => current === 'PENDING' ? null : 'PENDING')} aria-pressed={actionFilter === 'PENDING'}><small>FILA</small><span>Ver pendentes</span><b>{counts.pending}</b></button><button type="button" className={actionFilter === 'IN_PROGRESS' ? 'is-active' : ''} onClick={() => setActionFilter(current => current === 'IN_PROGRESS' ? null : 'IN_PROGRESS')} aria-pressed={actionFilter === 'IN_PROGRESS'}><small>AGORA</small><span>Continuar execução</span><b>{counts.progress}</b></button><button type="button" className={actionFilter === 'OVERDUE' ? 'is-active' : ''} onClick={() => setActionFilter(current => current === 'OVERDUE' ? null : 'OVERDUE')} aria-pressed={actionFilter === 'OVERDUE'}><small>ATENÇÃO</small><span>Tratar atrasadas</span><b>{counts.overdue}</b></button><button type="button" className="technician-dashboard__shortcut-sync" onClick={() => void reload()} disabled={loading || busy}><small>SISTEMA</small><span>Atualizar dados</span><b>↻</b></button></div></section>
      <section className="technician-dashboard__panel" id="technician-actions"><div className="technician-dashboard__panel-heading"><div><span className="pcm-section-kicker">FILA DE EXECUÇÃO</span><h2>{actionFilter ? 'Ordens filtradas' : 'Ordens disponíveis'}</h2></div><span>{filteredActions.length} disponível(is)</span></div><p>Selecione uma OS para consultar o escopo e iniciar a execução. As mais urgentes aparecem primeiro.</p>{actionFilter ? <button type="button" className="technician-dashboard__clear-filter" onClick={() => setActionFilter(null)}>Limpar filtro</button> : null}{loading ? <p>Carregando suas ações…</p> : actions.length === 0 ? <p>Nenhuma ação executável foi encontrada para você.</p> : filteredActions.length === 0 ? <p>Nenhuma ordem corresponde a este filtro.</p> : <><div className="technician-dashboard__list">{visibleActions.map(action => { const schedule = scheduleIndicator(action.programada_para, null, action.status); return <button type="button" className="technician-action" onClick={() => void open(action.id)} key={action.id}><span className="technician-action__top"><strong>{action.ordem_codigo}</strong><em>{label(action.prioridade)}</em></span><strong>{action.titulo}</strong><span>{[action.ativo_tag, action.ativo_nome].filter(Boolean).join(' · ')}</span><small>{[action.setor_nome, action.linha_nome, label(action.tipo)].filter(Boolean).join(' · ')} · {date(action.programada_para)}</small><span className={`technician-schedule-indicator technician-schedule-indicator--${schedule.tone}`}>{schedule.label}</span></button> })}</div>{!actionFilter && prioritizedActions.length > visibleActions.length ? <button type="button" className="technician-dashboard__clear-filter" onClick={() => setShowAllActions(true)}>Mostrar as demais {prioritizedActions.length - visibleActions.length} OS</button> : null}</>}</section>
      <section className="technician-dashboard__panel technician-dashboard__history" aria-labelledby="technician-history-title"><div className="technician-dashboard__panel-heading"><div><span className="pcm-section-kicker">HISTÓRICO</span><h2 id="technician-history-title">Últimas execuções concluídas</h2></div><span>{history.length} recente(s)</span></div>{loading ? <p>Carregando histórico…</p> : history.length === 0 ? <p>Nenhuma execução concluída foi encontrada para este técnico.</p> : <><div className="technician-dashboard__list">{visibleHistory.map(action => <article className="technician-action technician-action--completed" key={action.id}><span className="technician-action__top"><strong>{action.ordem_codigo}</strong><em>Concluída</em></span><strong>{action.titulo}</strong><span>{[action.ativo_tag, action.ativo_nome].filter(Boolean).join(' · ')}</span><small>{[action.setor_nome, action.linha_nome, label(action.tipo)].filter(Boolean).join(' · ')} · Concluída em {date(action.concluida_em)}</small></article>)}</div>{history.length > visibleHistory.length ? <button type="button" className="technician-dashboard__clear-filter" onClick={() => setShowAllHistory(true)}>Ver histórico completo</button> : null}</>}</section>
    </> : <section className="technician-dashboard__detail">
      <button type="button" className="technician-dashboard__back" onClick={() => { setSelected(null); setExecution(null); setBlockers([]) }}>← Voltar para minhas ordens</button>
      <div className="technician-dashboard__panel"><div className="technician-dashboard__panel-heading"><div><span className="pcm-section-kicker">{selected.ordem_codigo}</span><h2>{selected.titulo}</h2></div><span>{label(selected.status)}</span></div><p>{selected.descricao}</p>{selectedSchedule ? <div className={`technician-schedule-summary technician-schedule-summary--${selectedSchedule.tone}`}><strong>{selectedSchedule.label}</strong><span>{selectedSchedule.description}</span></div> : null}<dl className="technician-dashboard__facts"><Fact label="Equipamento" value={[selected.ativo_tag, selected.ativo_nome].filter(Boolean).join(' · ')} /><Fact label="Setor" value={[selected.setor_tag, selected.setor_nome].filter(Boolean).join(' · ')} /><Fact label="Linha" value={[selected.linha_tag, selected.linha_nome].filter(Boolean).join(' · ')} /><Fact label="Componente" value={[selected.componente_tag, selected.componente_nome].filter(Boolean).join(' · ')} /><Fact label="Prioridade" value={label(selected.prioridade)} /><Fact label="Tipo" value={label(selected.tipo)} /><Fact label="Programação" value={date(selected.programada_para)} /><Fact label="Tempo em aberto" value={elapsed(selected.gerada_em)} /></dl></div>
      {isSupportTechnician ? <><section className="technician-dashboard__panel"><span className="pcm-section-kicker">EQUIPE DE APOIO</span><h2>OS acompanhada em equipe</h2><p>Você foi atribuído como apoio. Consulte o checklist e o andamento desta OS; o técnico líder registra a execução e realiza a conclusão.</p></section><section className="technician-dashboard__panel"><span className="pcm-section-kicker">CHECKLIST</span><h2>{selected.checklist_nome}</h2><p>{items.length} etapa(s) disponível(is) para acompanhamento.</p><ol>{items.map(item => <li key={item.id}><strong>{item.sequencia}. {item.titulo}</strong>{item.instrucao ? <span> — {item.instrucao}</span> : null}</li>)}</ol></section></> : selected.status === 'BLOCKED' ? <section className="technician-dashboard__panel"><h2>Ação bloqueada</h2><p>Esta ação não está disponível para início. Consulte o PCM para tratar o bloqueio.</p></section> : execution?.status === 'COMPLETED' ? <section className="technician-dashboard__panel"><span className="pcm-section-kicker">CONCLUÍDA</span><h2>Execução concluída</h2><p>A execução foi concluída e não aceita novas respostas, evidências ou finalização.</p><dl className="technician-dashboard__facts"><Fact label="Iniciada em" value={date(execution.iniciada_em)} /><Fact label="Finalizada em" value={date(execution.concluida_em)} /><Fact label="Tempo líquido" value={duration(execution.duracao_segundos)} /><Fact label="Pausas descontadas" value={duration(execution.segundos_pausados)} /></dl></section> : !execution || execution.status === 'OPEN' ? <section className="technician-dashboard__panel"><h2>Iniciar execução</h2><p>Informe a condição da parada antes de iniciar.</p><div className="technician-dashboard__modes">{(Object.keys(stopModeLabels) as StopMode[]).map(value => <label key={value}><input type="radio" checked={mode === value} onChange={() => setMode(value)} name="stop-mode" /> {stopModeLabels[value]}</label>)}</div><button type="button" onClick={() => void start()} disabled={busy}>Iniciar execução</button></section> : execution.status === 'PAUSED' ? <section className="technician-dashboard__panel"><span className="pcm-section-kicker">EXECUÇÃO PAUSADA</span><h2>O cronômetro está parado</h2><p>{execution.observacao || 'A execução está temporariamente pausada. Retome quando o trabalho puder continuar.'}</p><p>O período de pausa não será considerado no tempo de execução da OS.</p><button type="button" onClick={() => void resume()} disabled={busy}>{busy ? 'Retomando…' : 'Retomar execução'}</button></section> : <>
        <section className="technician-dashboard__panel"><span className="pcm-section-kicker">CONTROLE DE TEMPO</span><h2>Execução em andamento</h2><p>O tempo líquido da OS está sendo contabilizado. Se precisar interromper o trabalho, registre o motivo abaixo.</p><label className="technician-dashboard__pause"><span>Motivo da pausa</span><textarea value={pauseReason} onChange={event => setPauseReason(event.target.value)} placeholder="Ex.: aguardando liberação de segurança ou material" maxLength={500} /></label><button type="button" className="technician-dashboard__pause-button" onClick={() => void pause()} disabled={busy || pauseReason.trim().length < 3}>{busy ? 'Pausando…' : 'Pausar execução'}</button></section>
        <section className="technician-dashboard__panel"><span className="pcm-section-kicker">MATERIAL E CUSTO</span><h2>Registrar saída de peça</h2><p>Ao confirmar, o estoque é baixado e o custo fica vinculado de forma permanente a esta OS.</p><div className="technician-dashboard__report"><label>Peça por SKU ou nome<select value={materialId} onChange={event => setMaterialId(event.target.value)} disabled={busy || materials.length === 0}>{materials.length === 0 ? <option value="">Nenhum material disponível em estoque</option> : materials.map(material => <option value={material.id} key={material.id}>{material.sku} · {material.nome_facil || material.nome} · {currency(material.valor_unitario)} · saldo {material.estoque_atual} {material.unidade}{material.situacao_estoque === 'LOW' ? ' · estoque baixo' : ''}</option>)}</select></label><label>Quantidade<input type="number" min="0.0001" step="0.0001" value={materialQuantity} onChange={event => setMaterialQuantity(event.target.value)} disabled={busy || materials.length === 0} /></label><label>Observação (opcional)<input value={materialObservation} onChange={event => setMaterialObservation(event.target.value)} maxLength={500} disabled={busy} /></label></div><button type="button" onClick={() => void consumeMaterial()} disabled={busy || !materialId}>{busy ? 'Registrando…' : 'Baixar material e registrar custo'}</button>{execution?.materiais?.length ? <div className="technician-dashboard__report"><strong>Materiais desta OS · total {currency(execution.custo_materiais_total)}</strong>{execution.materiais.map(material => <p key={material.id}>{material.sku} · {material.nome_facil || material.nome} — {material.quantidade} {material.unidade} · {currency(material.valor_unitario)} cada · <strong>{currency(material.custo_total)}</strong></p>)}</div> : <p>Nenhum material foi consumido nesta execução.</p>}</section>
        <section className="technician-dashboard__panel"><div className="technician-dashboard__panel-heading"><div><span className="pcm-section-kicker">CHECKLIST</span><h2>{selected.checklist_nome}</h2></div><span>{items.length} item(ns)</span></div>{itemGroups.map(([category, group]) => <section className="technician-checklist-group" key={category}><h3>{checklistCategoryLabel(category)}</h3>{group.map(item => <ChecklistItemBoundary key={item.id}><ChecklistItem item={item} disabled={busy} value={responses[item.id]} onChange={value => setResponses(current => ({ ...current, [item.id]: { ...(current[item.id] ?? { resposta: itemText(item), valor: item.resposta_numero?.toString() ?? '', observacao: item.observacao ?? '' }), ...value } }))} onSave={() => void save(item)} onUpload={file => void uploadEvidence(item, file)} /></ChecklistItemBoundary>)}</section>)}</section>
        <section className="technician-dashboard__panel"><span className="pcm-section-kicker">CONCLUSÃO</span><h2>Relatório técnico</h2><div className="technician-dashboard__report">{[['diagnostico_tecnico', 'Diagnóstico técnico'], ['acao_realizada', 'Ação realizada'], ['pecas_materiais', 'Peças / materiais'], ['medicoes', 'Medições']].map(([field, text]) => <label key={field}>{text}<textarea value={completion.relatorio_tecnico?.[field as keyof NonNullable<TechnicalCompletionInput['relatorio_tecnico']>] ?? ''} onChange={event => setCompletion(current => ({ ...current, relatorio_tecnico: { diagnostico_tecnico: '', acao_realizada: '', pecas_materiais: '', medicoes: '', ...current.relatorio_tecnico, [field]: event.target.value } }))} /></label>)}<label>Resultado<textarea value={completion.resultado} onChange={event => setCompletion(current => ({ ...current, resultado: event.target.value }))} required /></label><label>Observação<textarea value={completion.observacao ?? ''} onChange={event => setCompletion(current => ({ ...current, observacao: event.target.value }))} /></label></div>{blockers.length > 0 && <div className="technician-dashboard__blockers" role="alert"><strong>Conclusão bloqueada</strong><ul>{blockers.map(blocker => <li key={`${blocker.item_id}-${blocker.tipo}`}>{blocker.sequencia}. {blocker.titulo} — {blocker.mensagem}</li>)}</ul></div>}<button type="button" onClick={() => void validateAndComplete()} disabled={busy}>{busy ? 'Validando…' : 'Validar e concluir'}</button></section>
      </>}
    </section>}
  </section>
}

function Metric({ label, value, tone = '', filter, active, onClick }: { label: string; value: number; tone?: string; filter: Exclude<ActionFilter, null>; active: boolean; onClick: () => void }) { return <button type="button" className={`technician-dashboard__metric ${tone} ${active ? 'is-active' : ''}`} aria-pressed={active} aria-label={`${label}: ${value}. Filtrar ordens.`} data-filter={filter} onClick={onClick}><span>{label}</span><strong>{value}</strong></button> }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value || 'Não informado'}</dd></div> }
function checklistCategoryLabel(category: string) {
  return ({ SEGURANCA: 'Segurança', MECANICA: 'Falha mecânica', ELETRICA: 'Falha elétrica', CONDICAO: 'Condição operacional', OPERACAO: 'Retorno à operação', RELATORIO: 'Registro técnico', DECISAO: 'Decisão final', EVIDENCIA: 'Evidências', GERAL: 'Etapas gerais' } as Record<string, string>)[category] ?? category.replaceAll('_', ' ')
}

function optionLabel(option: string) {
  return ({ OK: 'Normal', NOK: 'Falha encontrada', NA: 'Não aplicável', APTO: 'Apto', APTO_COM_RESTRICAO: 'Apto com restrição', NAO_APTO: 'Não apto' } as Record<string, string>)[option] ?? option.replaceAll('_', ' ')
}

function ChoiceButtons({ name, value, choices, onChange, disabled }: { name: string; value: string; choices: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void; disabled: boolean }) {
  return <div className="technician-choice-buttons" role="group" aria-label={name}>{choices.map(choice => <button type="button" className={value === choice.value ? 'is-selected' : ''} key={choice.value} aria-pressed={value === choice.value} disabled={disabled} onClick={() => onChange(choice.value)}>{choice.label}</button>)}</div>
}

class ChecklistItemBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(cause: Error, info: ErrorInfo) {
    console.error('Não foi possível renderizar uma etapa do checklist.', cause, info)
  }

  render() {
    if (this.state.failed) return <article className="technician-checklist-item technician-checklist-item--failed" role="alert"><strong>Não foi possível exibir esta etapa.</strong><p>Atualize a página e tente novamente. As demais etapas continuam disponíveis.</p></article>
    return this.props.children
  }
}

function ChecklistItem({ item, value, onChange, onSave, onUpload, disabled }: { item: ExecutionItem; value?: { resposta: string; valor: string; observacao: string }; onChange: (value: Partial<{ resposta: string; valor: string; observacao: string }>) => void; onSave: () => void; onUpload: (file: File) => void; disabled: boolean }) {
  const responseType = String(item.tipo_resposta ?? '').toUpperCase()
  const answer = String(value?.resposta ?? itemText(item) ?? '')
  const normalizedAnswer = answer.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase()
  const confirmed = ['SIM', 'LIDO', 'TRUE', 'OK', 'CONFIRMADO'].includes(normalizedAnswer)
  const confirmation = confirmed ? 'SIM' : normalizedAnswer === 'NAO' ? 'NÃO' : ''
  const options = Array.isArray(item.opcoes) ? item.opcoes.filter((option): option is string => typeof option === 'string') : []
  const saveDisabled = disabled || ((responseType === 'CONFIRMACAO' || responseType === 'INSTRUCAO') && confirmation === 'NÃO')

  return <article className="technician-checklist-item"><header><strong>{item.sequencia}. {item.titulo}</strong>{item.obrigatorio && <span>Obrigatório</span>}</header>{item.instrucao && <p>{item.instrucao}</p>}{responseType === 'CONFIRMACAO' || responseType === 'INSTRUCAO' ? <><span className="technician-checklist-item__answer-label">Etapa executada?</span><ChoiceButtons name={`confirmation-${item.id}`} value={confirmation} choices={[{ value: 'SIM', label: 'Sim' }, { value: 'NÃO', label: 'Não' }]} disabled={disabled} onChange={resposta => onChange({ resposta })} />{confirmation === 'NÃO' ? <small>Esta etapa precisa ser confirmada como concluída antes de ser salva.</small> : null}</> : responseType === 'EVIDENCIA' ? <p className="technician-checklist-item__evidence-note">Esta etapa é atendida pelo envio da evidência abaixo.</p> : responseType.includes('NUMBER') || responseType.includes('NUM') || item.minimo !== null || item.maximo !== null ? <label>Valor <input type="number" value={value?.valor ?? item.resposta_numero ?? ''} onChange={event => onChange({ valor: event.target.value })} /> {item.unidade ?? ''}</label> : responseType === 'OK_NOK' ? <><span className="technician-checklist-item__answer-label">Condição encontrada</span><ChoiceButtons name={`condition-${item.id}`} value={answer} choices={[{ value: 'OK', label: 'Normal' }, { value: 'NOK', label: 'Falha encontrada' }, { value: 'NA', label: 'Não aplicável' }]} disabled={disabled} onChange={resposta => onChange({ resposta })} /></> : responseType.includes('BOOLEAN') || responseType.includes('SIM_NAO') ? <><span className="technician-checklist-item__answer-label">Resposta</span><ChoiceButtons name={`boolean-${item.id}`} value={answer} choices={[{ value: 'SIM', label: 'Sim' }, { value: 'NÃO', label: 'Não' }]} disabled={disabled} onChange={resposta => onChange({ resposta })} /></> : options.length > 0 ? <><span className="technician-checklist-item__answer-label">Resposta</span><ChoiceButtons name={`option-${item.id}`} value={answer} choices={options.map(option => ({ value: option, label: optionLabel(option) }))} disabled={disabled} onChange={resposta => onChange({ resposta })} /></> : <label>Resposta <input value={answer} onChange={event => onChange({ resposta: event.target.value })} /></label>}<details className="technician-checklist-item__observation" open={Boolean(value?.observacao ?? item.observacao)}><summary>Adicionar observação (opcional)</summary><label>Observação <input value={value?.observacao ?? item.observacao ?? ''} onChange={event => onChange({ observacao: event.target.value })} /></label></details>{item.evidencia_obrigatoria && <small>Exige ao menos {item.minimo_evidencias} evidência(s). Evidências: {item.quantidade_evidencias ?? 0}.</small>}{item.evidencias?.length ? <small>{item.evidencias.map(evidence => evidence.nome_arquivo || 'Evidência').join(', ')}</small> : null}{item.evidencia_obrigatoria && <label>Foto da evidência <input type="file" accept="image/*" capture="environment" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = '' }} /></label>}{item.mensagem_validacao && <small>{item.mensagem_validacao}</small>}<button type="button" onClick={onSave} disabled={saveDisabled}>{responseType === 'EVIDENCIA' ? 'Atualizar item' : 'Salvar item'}</button></article>
}
