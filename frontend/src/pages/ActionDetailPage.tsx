import { useEffect, useMemo, useRef, useState } from 'react'
import type { MaintenanceStartDecision, MaintenanceStopMode, OperatorActionDetailData, OperatorStopData, RawChecklistItem } from '../types/api'
import { ActiveStopBanner } from '../components/ActiveStopBanner'
import { EvidenceFileLink } from '../components/EvidenceFileLink'

interface ActionDetailPageProps {
  detail: OperatorActionDetailData | null
  loading: boolean
  error: string
  starting: boolean
  activeStop: OperatorStopData | null
  onBack: () => void
  onRetry: () => void
  onStart: (decision: MaintenanceStartDecision) => Promise<void>
  onContinue: () => void
}

function normalizedStatus(status?: string): string {
  return (status ?? '').toUpperCase()
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

function detailAvailability(detail: OperatorActionDetailData, nowMs: number) {
  const plannedAt = detail.disponibilidade?.planejada_para || detail.os?.planejada_para
  const plannedMs = plannedAt ? new Date(plannedAt).getTime() : Number.NaN
  if (!Number.isFinite(plannedMs)) {
    return { canStart: true, state: 'SEM_AGENDAMENTO', plannedAt: undefined, secondsUntil: 0, secondsOverdue: 0 }
  }

  const alertMinutes = detail.disponibilidade?.alerta_minutos ?? 60
  const graceMinutes = detail.disponibilidade?.tolerancia_atraso_minutos ?? 15
  const secondsUntil = Math.ceil((plannedMs - nowMs) / 1000)
  if (secondsUntil > alertMinutes * 60) {
    return { canStart: false, state: 'AGENDADA', plannedAt, secondsUntil, secondsOverdue: 0 }
  }
  if (secondsUntil > 0) {
    return { canStart: false, state: 'EM_ALERTA', plannedAt, secondsUntil, secondsOverdue: 0 }
  }

  const secondsOverdue = Math.max(0, Math.floor((nowMs - plannedMs) / 1000))
  return {
    canStart: true,
    state: secondsOverdue > graceMinutes * 60 ? 'ATRASADA' : 'DISPONIVEL',
    plannedAt,
    secondsUntil: 0,
    secondsOverdue,
  }
}

function formatShortCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remaining = safe % 60
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':')
}

function formatDuration(seconds?: number): string {
  const total = Math.max(0, Number(seconds ?? 0))
  if (!total) return 'Não informada'
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = Math.floor(total % 60)
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${remainingSeconds} s`
  return `${remainingSeconds} s`
}

function checklistAnswer(item: RawChecklistItem): string {
  if (item.valor_numero !== undefined && item.valor_numero !== '') {
    return `${item.valor_numero}${item.unidade ? ` ${item.unidade}` : ''}`
  }
  return item.resposta || item.observacao || (item.respondido ? 'Respondido' : 'Sem resposta')
}

function modeLabel(value?: string): string {
  const mode = normalizedStatus(value)
  if (mode === 'SEM_PARADA') return 'Executado sem parada do equipamento'
  if (mode === 'COM_PARADA' || mode === 'PARAR_EQUIPAMENTO') return 'Executado com parada do equipamento'
  return 'Condição de execução não informada'
}

function CompletedActionSummary({ detail, onBack }: { detail: OperatorActionDetailData; onBack: () => void }) {
  const items = detail.checklist?.itens ?? []
  const preview = items.slice(0, 5)
  const evidences = items.flatMap((item) => item.evidencias ?? [])
  const finalDate = detail.execucao?.finalizou_em || detail.acao.finalizado_em || detail.os?.finalizada_em
  const deadline = detail.os?.planejada_para
  const finalTime = finalDate ? new Date(finalDate).getTime() : Number.NaN
  const deadlineTime = deadline ? new Date(deadline).getTime() : Number.NaN
  const hasDeadline = Number.isFinite(deadlineTime)
  const onTime = hasDeadline && Number.isFinite(finalTime) ? finalTime <= deadlineTime : null
  const location = detail.componente?.localizacao_tecnica || detail.ativo?.localizacao_tecnica || 'Não informada'
  const status = normalizedStatus(detail.acao.status)

  return (
    <section className="screen completed-action-screen">
      <button type="button" className="back-link" onClick={onBack}>← Voltar para a fila</button>

      <article className="completed-action-hero">
        <div className="completed-action-hero__top">
          <span className={status === 'CONCLUIDA' ? 'status-chip status-chip--online' : 'status-chip status-chip--pending'}>
            {status === 'CONCLUIDA' ? 'Concluída' : status === 'AGUARDANDO_VALIDACAO' ? 'Aguardando validação' : 'Execução finalizada'}
          </span>
          <span className="type-chip">Somente leitura</span>
        </div>
        <h1>{detail.acao.titulo || detail.os?.titulo || 'Serviço executado'}</h1>
        <p>{detail.acao.descricao || detail.os?.descricao || 'Sem descrição operacional.'}</p>
        <div className="technical-identification">
          <span><strong>{detail.ativo?.tag || detail.ativo?.id}</strong>{detail.ativo?.nome}</span>
          <span><strong>{detail.componente?.tag || detail.componente?.id || 'GERAL'}</strong>{detail.componente?.nome || 'Equipamento em geral'}</span>
        </div>
      </article>

      <article className="completed-action-card">
        <div className="completed-action-heading"><div><span className="technical-kicker">Dados técnicos</span><h2>Resumo da execução</h2></div></div>
        <div className="completed-action-data-grid">
          <div><span>Onde foi executado</span><strong>{location}</strong></div>
          <div><span>Executado por</span><strong>{detail.executor?.nome || detail.execucao?.operador_id || 'Não informado'}</strong></div>
          <div><span>Início</span><strong>{formatDate(detail.execucao?.iniciou_em || detail.acao.iniciado_em)}</strong></div>
          <div><span>Conclusão</span><strong>{formatDate(finalDate)}</strong></div>
          <div><span>Duração</span><strong>{formatDuration(detail.execucao?.duracao_segundos)}</strong></div>
          <div><span>Como foi executado</span><strong>{modeLabel(detail.execucao?.modo_execucao_manutencao)}</strong></div>
          <div><span>Resultado</span><strong>{detail.execucao?.resultado || 'Não informado'}</strong></div>
          <div><span>OS</span><strong>{detail.os?.codigo || detail.os?.id || 'Não informada'}</strong></div>
        </div>
        {detail.execucao?.observacao && <div className="completed-action-observation"><span>Observação técnica</span><p>{detail.execucao.observacao}</p></div>}
      </article>

      <article className="completed-action-card">
        <div className="completed-action-heading"><div><span className="technical-kicker">Checklist salvo</span><h2>Prévia das respostas</h2></div><strong>{detail.checklist?.respondidos ?? 0}/{detail.checklist?.total ?? items.length}</strong></div>
        {preview.length ? (
          <div className="completed-checklist-preview">
            {preview.map((item) => (
              <div key={item.id}>
                <span>{String(item.ordem).padStart(2, '0')}</span>
                <div><strong>{item.titulo}</strong><p>{checklistAnswer(item)}</p>{item.observacao && item.observacao !== checklistAnswer(item) && <small>{item.observacao}</small>}</div>
                <b>{item.conforme || item.status || 'SALVO'}</b>
              </div>
            ))}
            {items.length > preview.length && <p className="completed-more-items">Mais {items.length - preview.length} itens permanecem salvos no checklist.</p>}
          </div>
        ) : <p className="completed-empty">Nenhum item de checklist foi retornado.</p>}
      </article>

      <article className="completed-action-card">
        <div className="completed-action-heading"><div><span className="technical-kicker">Evidências</span><h2>Arquivos anexados</h2></div><strong>{evidences.length}</strong></div>
        {evidences.length ? (
          <div className="completed-evidence-grid">
            {evidences.slice(0, 4).map((evidence, index) => (
              <EvidenceFileLink
                key={evidence.id || `${evidence.url}-${index}`}
                evidence={evidence}
                index={index}
                showFileName
              />
            ))}
          </div>
        ) : <p className="completed-empty">Nenhuma evidência foi anexada.</p>}
      </article>

      <article className="completed-action-card completed-deadline-card">
        <div><span>Prazo previsto</span><strong>{formatDate(deadline)}</strong></div>
        <div><span>Executado no prazo?</span><strong>{onTime === null ? 'Prazo não informado' : onTime ? 'Sim' : 'Não'}</strong></div>
      </article>

      <div className="completed-action-footer"><button type="button" className="primary-button" onClick={onBack}>Voltar para a fila</button></div>
    </section>
  )
}

function getRisk(item: RawChecklistItem): { icon: string; title: string; text: string } | null {
  const text = `${item.titulo} ${item.instrucao ?? ''}`.toLowerCase()
  if (text.includes('elétr') || text.includes('energia')) {
    return { icon: '⚡', title: 'Choque elétrico', text: item.instrucao || item.titulo }
  }
  if (text.includes('press') || text.includes('pneum')) {
    return { icon: '◉', title: 'Pressão', text: item.instrucao || item.titulo }
  }
  if (text.includes('esmag') || text.includes('prens') || text.includes('aprision')) {
    return { icon: '↔', title: 'Prensamento', text: item.instrucao || item.titulo }
  }
  if (text.includes('corte') || text.includes('lâmina')) {
    return { icon: '✦', title: 'Corte', text: item.instrucao || item.titulo }
  }
  if (item.categoria?.toUpperCase() === 'SEGURANCA') {
    return { icon: '!', title: 'Risco mecânico', text: item.instrucao || item.titulo }
  }
  return null
}

export function ActionDetailPage({
  detail,
  loading,
  error,
  starting,
  activeStop,
  onBack,
  onRetry,
  onStart,
  onContinue,
}: ActionDetailPageProps) {
  const [readProgress, setReadProgress] = useState(0)
  const [readComplete, setReadComplete] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [startDecisionOpen, setStartDecisionOpen] = useState(false)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const maxProgressRef = useRef(0)
  const screenRef = useRef<HTMLElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    maxProgressRef.current = 0
    setReadProgress(0)
    setReadComplete(false)
    setAccepted(false)
    setStartDecisionOpen(false)

    const scrollRoot = screenRef.current?.closest('.app-content') as HTMLElement | null
    if (scrollRoot) scrollRoot.scrollTo({ top: 0, behavior: 'auto' })
  }, [detail?.acao.id])

  useEffect(() => {
    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null

    const calculateReadingProgress = () => {
      const screen = screenRef.current
      const gate = endRef.current
      if (!screen || !gate) return

      const scrollRoot = screen.closest('.app-content') as HTMLElement | null
      const rootBounds = scrollRoot?.getBoundingClientRect()
      const viewportTop = rootBounds?.top ?? 0
      const viewportBottom = rootBounds?.bottom ?? window.innerHeight
      const viewportHeight = Math.max(1, viewportBottom - viewportTop)
      const screenBounds = screen.getBoundingClientRect()
      const gateBounds = gate.getBoundingClientRect()

      // Funciona tanto quando o scroll ocorre em .app-content quanto no documento.
      const distanceRead = Math.max(0, viewportTop - screenBounds.top)
      const gateOffset = Math.max(1, gate.offsetTop)
      const readingTarget = Math.max(
        1,
        gateOffset - viewportHeight + Math.min(220, viewportHeight * 0.35),
      )

      const gateReached =
        gateBounds.top <= viewportBottom - Math.min(72, viewportHeight * 0.1)

      const rootAtBottom = scrollRoot
        ? scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight <= 12
        : document.documentElement.scrollHeight - window.scrollY - window.innerHeight <= 12

      const calculated = gateReached || rootAtBottom
        ? 100
        : Math.min(99, Math.max(0, Math.round((distanceRead / readingTarget) * 100)))

      const nextProgress = Math.max(maxProgressRef.current, calculated)
      maxProgressRef.current = nextProgress
      setReadProgress((current) => current === nextProgress ? current : nextProgress)

      if (nextProgress >= 100) setReadComplete(true)
    }

    const scheduleCalculation = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(calculateReadingProgress)
    }

    // Captura scroll de qualquer elemento, incluindo navegadores móveis.
    document.addEventListener('scroll', scheduleCalculation, true)
    document.addEventListener('touchmove', scheduleCalculation, { passive: true, capture: true })
    window.addEventListener('scroll', scheduleCalculation, { passive: true })
    window.addEventListener('resize', scheduleCalculation)
    window.addEventListener('orientationchange', scheduleCalculation)

    // Verificação periódica evita depender exclusivamente do evento de scroll.
    const pollingId = window.setInterval(calculateReadingProgress, 120)

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleCalculation)
      if (screenRef.current) resizeObserver.observe(screenRef.current)
      const scrollRoot = screenRef.current?.closest('.app-content')
      if (scrollRoot) resizeObserver.observe(scrollRoot)
    }

    scheduleCalculation()

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.clearInterval(pollingId)
      document.removeEventListener('scroll', scheduleCalculation, true)
      document.removeEventListener('touchmove', scheduleCalculation, true)
      window.removeEventListener('scroll', scheduleCalculation)
      window.removeEventListener('resize', scheduleCalculation)
      window.removeEventListener('orientationchange', scheduleCalculation)
      resizeObserver?.disconnect()
    }
  }, [detail?.acao.id, loading])

  useEffect(() => {
    const interval = window.setInterval(() => setClockMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const items = detail?.checklist?.itens ?? []
  const risks = useMemo(() => {
    const seen = new Set<string>()
    return items
      .map(getRisk)
      .filter((risk): risk is NonNullable<typeof risk> => {
        if (!risk || seen.has(risk.title)) return false
        seen.add(risk.title)
        return true
      })
  }, [items])

  const status = normalizedStatus(
    detail?.acao.status || detail?.operator_screen?.header?.status,
  )
  const uiState = normalizedStatus(detail?.ui?.state)
  const alreadyStarted = status === 'EM_EXECUCAO' || uiState === 'EM_EXECUCAO'
  const startButton = detail?.operator_screen?.action_bar?.buttons?.find(
    (button) =>
      button.endpoint === 'operador.iniciar_acao' ||
      ['INICIAR', 'INICIAR_ACAO', 'START'].includes(
        normalizedStatus(button.id),
      ),
  )
  const availability = detail ? detailAvailability(detail, clockMs) : null
  const canStartByState = Boolean(availability?.canStart) && (
    ['PENDENTE', 'ABERTA', 'AGUARDANDO_INICIO'].includes(status) ||
    uiState === 'AGUARDANDO_INICIO'
  )
  const canStart = Boolean(availability?.canStart) && Boolean(
    detail?.ui?.can_start ||
    startButton?.enabled ||
    canStartByState,
  )
  const acceptanceId = `technical-acceptance-${detail?.acao.id ?? 'action'}`
  const configuredStopMode = (
    detail?.acao.modo_parada_manutencao ||
    detail?.plano?.modo_parada_manutencao ||
    'DECISAO_EXECUTOR'
  ).toUpperCase() as MaintenanceStopMode
  const equipmentAlreadyStopped =
    Boolean(activeStop) ||
    normalizedStatus(detail?.ativo?.status) === 'PARADO'

  function startWithConfiguredMode() {
    if (configuredStopMode === 'OBRIGATORIA' || equipmentAlreadyStopped) {
      void onStart('PARAR_EQUIPAMENTO')
      return
    }
    if (configuredStopMode === 'SEM_PARADA') {
      void onStart('SEM_PARADA')
      return
    }
    setStartDecisionOpen(true)
  }

  if (loading) {
    return (
      <section
        className="screen action-detail-loading-placeholder"
        aria-busy="true"
        aria-label="Carregando análise técnica"
      />
    )
  }

  if (error || !detail) {
    return (
      <section className="screen">
        <article className="state-panel state-panel--error">
          <span className="state-panel__kicker">Detalhes indisponíveis</span>
          <h1>Não foi possível abrir a ação</h1>
          <p>{error || 'A API não retornou conteúdo.'}</p>
          <div className="detail-error-actions">
            <button type="button" className="secondary-button" onClick={onBack}>Voltar</button>
            <button type="button" onClick={onRetry}>Tentar novamente</button>
          </div>
        </article>
      </section>
    )
  }

  const completedReadOnly = ['AGUARDANDO_VALIDACAO', 'CONCLUIDA', 'BLOQUEADA'].includes(
    normalizedStatus(detail.acao.status || detail.ui?.state),
  )
  if (completedReadOnly) return <CompletedActionSummary detail={detail} onBack={onBack} />

  const technical = detail.analise_tecnica
  const defaultSteps = [
    {
      ordem: 1,
      titulo: 'Preparar e isolar',
      descricao: 'Confirmar o equipamento, a autorização e as medidas de segurança.',
    },
    {
      ordem: 2,
      titulo: 'Inspecionar',
      descricao: 'Verificar a condição informada e registrar a evidência inicial.',
    },
    {
      ordem: 3,
      titulo: 'Executar',
      descricao: 'Realizar somente o serviço aprovado e comunicar qualquer desvio.',
    },
    {
      ordem: 4,
      titulo: 'Testar e liberar',
      descricao: 'Validar o resultado e registrar a condição operacional final.',
    },
  ]
  const steps =
    technical?.etapas?.length
      ? technical.etapas.map((step, index) => ({
          ordem: step.ordem ?? index + 1,
          titulo: step.titulo || `Etapa ${index + 1}`,
          descricao: step.descricao || '',
        }))
      : items.length
        ? items.map((item) => ({
            ordem: item.ordem,
            titulo: item.titulo,
            descricao: item.instrucao || 'Executar conforme procedimento.',
          }))
        : defaultSteps

  const nrs = technical?.nrs ?? []
  const tools = technical?.ferramentas ?? []
  const displayRisks = technical?.riscos?.length
    ? technical.riscos.map((risk) => ({
        icon: '⚠',
        title: risk.titulo || risk.tipo || 'Risco técnico',
        text: risk.descricao || 'Interromper a atividade se a condição exceder o escopo.',
      }))
    : risks
  const safetyItems = technical?.seguranca?.length
    ? technical.seguranca
    : [
        ...(detail.plano?.requer_bloqueio === 'SIM'
          ? ['Aplicar bloqueio e confirmar energia zero antes da intervenção.']
          : []),
        'Confirmar autorização, identificação do ativo e condição segura da área.',
        'Isolar as fontes de energia aplicáveis antes de acessar a zona de risco.',
        'Executar somente o escopo aprovado e comunicar qualquer desvio.',
      ]
  const requiredEvidence = technical?.evidencias_requeridas?.length
    ? technical.evidencias_requeridas
    : detail.plano?.requer_evidencia === 'SIM'
      ? ['Foto da condição encontrada', 'Registro do teste ou condição final']
      : ['Registro da condição final']
  const checklistTotal = Number(detail.checklist?.total ?? items.length)
  const stopModeLabel = alreadyStarted && detail.execucao?.modo_execucao_manutencao
    ? detail.execucao.modo_execucao_manutencao === 'SEM_PARADA'
      ? 'Execução sem parada'
      : 'Parada do equipamento ativa'
    : configuredStopMode === 'OBRIGATORIA'
      ? 'Obrigatória'
      : configuredStopMode === 'SEM_PARADA'
        ? 'Sem parada'
        : 'Decisão do executor'
  const technicalFacts = [
    detail.os?.codigo || detail.os?.id
      ? { label: 'OS', value: String(detail.os?.codigo || detail.os?.id) }
      : null,
    Number(detail.plano?.tempo_estimado_min) > 0
      ? {
          label: 'Duração prevista',
          value: `${Number(detail.plano?.tempo_estimado_min)} min`,
        }
      : null,
    detail.acao.gerado_em
      ? { label: 'Gerada em', value: formatDate(detail.acao.gerado_em) }
      : null,
    checklistTotal > 0
      ? {
          label: 'Checklist',
          value: `${checklistTotal} ${checklistTotal === 1 ? 'item' : 'itens'}`,
        }
      : null,
    { label: 'Parada da máquina', value: stopModeLabel },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact))
  const technicalIdentifications = [
    {
      key: 'ativo',
      code: String(detail.ativo?.tag || detail.ativo?.id || '').trim(),
      name: String(detail.ativo?.nome || '').trim(),
    },
    {
      key: 'componente',
      code: String(
        detail.componente?.tag || detail.componente?.id || '',
      ).trim(),
      name: String(detail.componente?.nome || '').trim(),
    },
  ].filter((item) => item.code || item.name)

  return (
    <section ref={screenRef} className="screen technical-screen">
      <div className="technical-progress">
        <div>
          <strong>Leitura da análise técnica</strong>
          <span>{readComplete ? '100% concluída' : `${readProgress}% lida`}</span>
        </div>
        <div
          className="technical-progress__bar"
          role="progressbar"
          aria-label="Progresso da leitura técnica"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={readProgress}
        >
          <span style={{ width: `${readProgress}%` }} />
        </div>
      </div>

      <button type="button" className="back-link" onClick={onBack}>← Voltar para a fila</button>

      {activeStop && <ActiveStopBanner stop={activeStop} />}

      <article className="technical-hero">
        <div className="technical-hero__top">
          <span className={`status-chip status-chip--${alreadyStarted ? 'online' : 'pending'}`}>
            {alreadyStarted ? 'Em execução' : 'Aguardando início'}
          </span>
          <span className="type-chip">{detail.acao.tipo || detail.plano?.tipo || 'MANUTENÇÃO'}</span>
        </div>
        <h1>{detail.acao.titulo || detail.os?.titulo || 'Ação de manutenção'}</h1>
        <p>{detail.acao.descricao || detail.os?.descricao || 'Sem descrição operacional.'}</p>
        {technicalIdentifications.length ? (
          <div className="technical-identification">
            {technicalIdentifications.map((item) => (
              <span key={item.key}>
                {item.code ? <strong>{item.code}</strong> : null}
                {item.name}
              </span>
            ))}
          </div>
        ) : null}
      </article>

      {availability?.plannedAt && !alreadyStarted && (
        <article className={`schedule-detail-card schedule-detail-card--${availability.state.toLowerCase()}`}>
          <div>
            <span>Início planejado</span>
            <strong>{formatDate(availability.plannedAt)}</strong>
          </div>
          <div>
            <span>Situação</span>
            <strong>
              {availability.state === 'AGENDADA' && 'Agendada'}
              {availability.state === 'EM_ALERTA' && `Libera em ${formatShortCountdown(availability.secondsUntil)}`}
              {availability.state === 'DISPONIVEL' && 'Disponível agora'}
              {availability.state === 'ATRASADA' && `Atrasada há ${formatDuration(availability.secondsOverdue)}`}
            </strong>
          </div>
        </article>
      )}

      <article className="technical-summary-card">
        <span className="technical-kicker">Relatório técnico operacional</span>
        <div className="technical-summary-row">
          <b>01</b>
          <div>
            <strong>Situação identificada</strong>
            <p>{technical?.situacao || detail.acao.descricao || detail.os?.descricao || 'Ação cadastrada para execução.'}</p>
          </div>
        </div>
        <div className="technical-summary-row">
          <b>02</b>
          <div>
            <strong>Causa provável</strong>
            <p>{technical?.causa_provavel || 'Confirmar a causa durante a inspeção e registrar o diagnóstico encontrado.'}</p>
          </div>
        </div>
        <div className="technical-summary-row">
          <b>03</b>
          <div>
            <strong>Resultado esperado</strong>
            <p>{technical?.resultado_esperado || `Concluir ${detail.plano?.nome || detail.acao.titulo} com registros e evidências exigidos.`}</p>
          </div>
        </div>
      </article>

      <article className="workflow-card-real">
        <div className="workflow-card-real__heading">
          <div>
            <span className="technical-kicker">Fluxo de execução</span>
            <h2>Etapas do serviço</h2>
          </div>
          <span>{steps.length} etapas</span>
        </div>
        <div className="workflow-track-real">
          {steps.map((step) => (
            <div className="workflow-step-real" key={`${step.ordem}-${step.titulo}`}>
              <b>{String(step.ordem).padStart(2, '0')}</b>
              <div>
                <strong>{step.titulo}</strong>
                <p>{step.descricao}</p>
              </div>
            </div>
          ))}
        </div>
      </article>

      {displayRisks.length > 0 && (
        <article className="technical-section-card">
          <span className="technical-kicker">Riscos identificados</span>
          <div className="risk-icon-grid">
            {displayRisks.map((risk) => (
              <div className="risk-icon-card" key={risk.title}>
                <span aria-hidden="true">{risk.icon}</span>
                <div><strong>{risk.title}</strong><p>{risk.text}</p></div>
              </div>
            ))}
          </div>
        </article>
      )}

      <div className="technical-requirements-grid">
        <article className="technical-section-card">
          <span className="technical-kicker">Segurança obrigatória</span>
          <ul className="technical-list">
            {safetyItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {nrs.length > 0 && (
            <div className="nr-chip-row">
              {nrs.map((nr) => <span key={nr}>{nr}</span>)}
            </div>
          )}
        </article>

        <article className="technical-section-card">
          <span className="technical-kicker">Aceite e evidências</span>
          <strong className="technical-acceptance-title">Condição para concluir</strong>
          <p className="technical-acceptance-copy">
            {technical?.criterio_aceite || 'Serviço concluído, condição segura confirmada e evidências registradas.'}
          </p>
          <ul className="technical-list">
            {requiredEvidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>
      </div>

      {tools.length > 0 && (
        <article className="technical-section-card">
          <span className="technical-kicker">Ferramentas e instrumentos</span>
          <div className="tool-icon-grid">
            {tools.map((tool, index) => (
              <div className="tool-icon-card" key={`${tool.nome}-${index}`}>
                <span aria-hidden="true">⌁</span>
                <strong>{tool.nome}</strong>
              </div>
            ))}
          </div>
        </article>
      )}

      <div className="technical-data-grid">
        {technicalFacts.map((fact) => (
          <div key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>

      <div ref={endRef} className="reading-gate">
        <div className={readComplete ? 'reading-gate__message reading-gate__message--ready' : 'reading-gate__message'}>
          {readComplete
            ? 'Análise percorrida até o final. Confirme a leitura.'
            : 'Role a análise até o final para liberar a confirmação.'}
        </div>
        <label
          htmlFor={acceptanceId}
          className={readComplete ? 'reading-confirmation' : 'reading-confirmation reading-confirmation--locked'}
        >
          <input
            id={acceptanceId}
            type="checkbox"
            checked={accepted}
            disabled={!readComplete}
            onChange={(event) => setAccepted(event.currentTarget.checked)}
          />
          <span>
            <strong>Confirmo a leitura técnica</strong>
            Li a análise, compreendi as etapas e os riscos da atividade.
          </span>
        </label>
      </div>

      {startDecisionOpen && (
        <div className="evidence-modal-backdrop">
          <article className="evidence-modal maintenance-start-modal" role="dialog" aria-modal="true">
            <div>
              <span>Condição de execução</span>
              <h2>Como esta manutenção será realizada?</h2>
              <p>
                Esta escolha define se o equipamento será parado. A parada iniciada aqui usa
                o mesmo controle operacional disponível pelo QR Code.
              </p>
            </div>

            <button
              type="button"
              className="maintenance-start-choice maintenance-start-choice--stop"
              disabled={starting}
              onClick={() => {
                setStartDecisionOpen(false)
                void onStart('PARAR_EQUIPAMENTO')
              }}
            >
              <strong>Parar equipamento</strong>
              <span>O status do equipamento mudará para parado e ficará visível para gestão e administração.</span>
            </button>

            <button
              type="button"
              className="maintenance-start-choice"
              disabled={starting}
              onClick={() => {
                setStartDecisionOpen(false)
                void onStart('SEM_PARADA')
              }}
            >
              <strong>Executar sem parada</strong>
              <span>A intervenção será realizada mantendo o equipamento em operação.</span>
            </button>

            <button
              type="button"
              className="secondary-button"
              disabled={starting}
              onClick={() => setStartDecisionOpen(false)}
            >
              Cancelar
            </button>
          </article>
        </div>
      )}

      <div className="technical-action-bar">
        <button type="button" className="secondary-button" onClick={onBack}>Voltar</button>
        {alreadyStarted ? (
          <button type="button" className="primary-button" onClick={onContinue}>
            Continuar execução
          </button>
        ) : readComplete && accepted && canStart ? (
          <button
            type="button"
            className="primary-button"
            onClick={startWithConfiguredMode}
            disabled={starting}
          >
            {starting ? 'Iniciando…' : 'Iniciar execução'}
          </button>
        ) : (
          <div className="start-locked" aria-live="polite">
            {!readComplete
              ? 'Leia até o final'
              : !accepted
                ? 'Marque a confirmação de leitura'
                : !canStart
                  ? availability?.state === 'EM_ALERTA'
                    ? `Libera em ${formatShortCountdown(availability.secondsUntil)}`
                    : availability?.state === 'AGENDADA'
                      ? `Agendada para ${formatDate(availability.plannedAt)}`
                      : 'Ação indisponível para início'
                  : 'Preparando início'}
          </div>
        )}
      </div>
    </section>
  )
}
