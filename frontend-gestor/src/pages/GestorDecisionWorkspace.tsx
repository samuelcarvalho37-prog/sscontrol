import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionReviewDialog } from '../components/ActionReviewDialog'
import { ChecklistModelReviewDialog } from '../components/ChecklistModelReviewDialog'
import {
  CheckIcon,
  ChevronRightIcon,
  SearchIcon,
  ShieldIcon,
} from '../components/Icons'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { TechnicalDemandDialog } from '../components/TechnicalDemandDialog'
import {
  getGestorActions,
  getGestorChecklistModels,
  getGestorTechnicalContext,
  getGestorTechnicalDemands,
  getGestorTechnicalReports,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import type {
  GestorAction,
  GestorChecklistModel,
  GestorChecklistModelDecisionResult,
  GestorDecisionResult,
  GestorTechnicalContext,
  GestorTechnicalDemand,
  GestorTechnicalReport,
  GestorWorkView,
} from '../types/gestor'

export interface GestorDecisionFocus {
  kind?: 'demand' | 'action' | 'model' | 'workOrder'
  id?: string
}

interface GestorDecisionWorkspaceProps {
  capabilities?: string[]
  initialView?: GestorWorkView
  focus?: GestorDecisionFocus | null
  onQueueCountChange: (count: number) => void
  onOpenAnalytics: (assetId?: string) => void
  onSessionExpired: () => void
}

type DecisionKind = NonNullable<GestorDecisionFocus['kind']>
type QueueFilter = GestorWorkView | 'all'

interface DecisionItem {
  id: string
  kind: DecisionKind
  view: GestorWorkView
  title: string
  category: string
  context: string
  description: string
  priority: string
  status: string
  nextAction: string
  nextDetail: string
  overdue: boolean
  assetId?: string
  createdAt?: string
  raw:
    | GestorTechnicalDemand
    | GestorAction
    | GestorChecklistModel
}

const PRIORITY_SCORE: Record<string, number> = {
  CRITICA: 5,
  CRÍTICA: 5,
  ALTA: 4,
  MEDIA: 3,
  MÉDIA: 3,
  NORMAL: 2,
  BAIXA: 1,
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR')
}

function humanize(value: unknown): string {
  const raw = String(value ?? '').trim()
  const knownLabels: Record<string, string> = {
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta',
    CRITICAL: 'Crítica',
    PREVENTIVE: 'Preventiva',
    CORRECTIVE: 'Corretiva',
    PREDICTIVE: 'Preditiva',
    INSPECTION: 'Inspeção',
    INSPECAO: 'Inspeção',
    PREVENTIVA: 'Preventiva',
  }
  if (knownLabels[raw.toUpperCase()]) return knownLabels[raw.toUpperCase()]
  const normalized = raw
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Não informado'
}

function displayTitle(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^[A-Z_]+$/.test(text) ? humanize(text) : text
}

function formatDate(value?: string): string {
  if (!value) return 'sem data registrada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function isInReportPeriod(value: string, period: string): boolean {
  if (!period || period === 'ALL') return true
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return false
  const days = period === 'TODAY' ? 1 : period === '7D' ? 7 : 30
  return timestamp >= Date.now() - days * 86_400_000
}

function demandNextStep(demand: GestorTechnicalDemand) {
  const pending = Math.max(
    0,
    Number(demand.assinaturas_necessarias ?? 0) -
      Number(demand.assinaturas_realizadas ?? 0),
  )
  if (pending > 0) {
    return {
      label: 'Revisar e assinar',
      detail: pending === 1
        ? 'Sua assinatura pode concluir o filtro técnico.'
        : `${pending} assinaturas técnicas ainda são necessárias.`,
    }
  }
  if (
    ['CHECKLIST_MODELO', 'PLANO_CHECKLIST'].includes(
      upper(demand.entidade_tipo),
    )
  ) {
    return {
      label: 'Revisar checklist',
      detail: 'Confira todas as etapas, instruções e evidências antes de decidir.',
    }
  }
  return upper(demand.entidade_tipo) === 'ORDEM_SERVICO_RASCUNHO'
    ? {
      label: 'Revisar e liberar',
      detail: 'O resumo do Operador já está preparado para sua confirmação.',
    }
    : {
      label: 'Registrar decisão',
      detail: 'Aprove o conteúdo ou peça um ajuste ao Administrador.',
    }
}

function includesSearch(item: DecisionItem, search: string): boolean {
  if (!search) return true
  const normalized = search.toLocaleLowerCase('pt-BR')
  return [
    item.id,
    item.title,
    item.context,
    item.description,
    item.status,
    item.assetId,
  ].some((value) =>
    String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized),
  )
}

export function GestorDecisionWorkspace({
  capabilities,
  focus,
  onQueueCountChange,
  onOpenAnalytics,
  onSessionExpired,
}: GestorDecisionWorkspaceProps) {
  const [demands, setDemands] = useState<GestorTechnicalDemand[]>([])
  const [actions, setActions] = useState<GestorAction[]>([])
  const [models, setModels] = useState<GestorChecklistModel[]>([])
  const [reports, setReports] = useState<GestorTechnicalReport[]>([])
  const [technicalContext, setTechnicalContext] =
    useState<GestorTechnicalContext | null>(null)
  const [activeView, setActiveView] = useState<QueueFilter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [reportPeriod, setReportPeriod] = useState('ALL')
  const [reportSigner, setReportSigner] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedDemand, setSelectedDemand] =
    useState<GestorTechnicalDemand | null>(null)
  const [selectedAction, setSelectedAction] = useState<GestorAction | null>(null)
  const [selectedModel, setSelectedModel] =
    useState<GestorChecklistModel | null>(null)

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const [actionData, modelData, demandData, contextData] =
        await Promise.all([
          capabilities === undefined || capabilities.includes('maintenance.executions.read') ? getGestorActions(signal) : Promise.resolve([]),
          capabilities === undefined || capabilities.includes('maintenance.checklists.read') ? getGestorChecklistModels(signal) : Promise.resolve([]),
          getGestorTechnicalDemands(signal),
          getGestorTechnicalContext(signal),
        ])
      const validationActions = actionData.filter(
        (action) => upper(action.status) === 'AGUARDANDO_VALIDACAO',
      )
      const routedChecklistIds = new Set(
        demandData
          .filter((demand) =>
            ['CHECKLIST_MODELO', 'PLANO_CHECKLIST'].includes(
              upper(demand.entidade_tipo),
            ),
          )
          .map((demand) => String(demand.entidade_id || ''))
          .filter(Boolean),
      )
      const standaloneModels = modelData.filter(
        (model) => !routedChecklistIds.has(String(model.id)),
      )
      const reportData = ['QUALITY', 'SAFETY'].includes(
        upper(contextData.identidade.area_codigo),
      )
        ? await getGestorTechnicalReports(signal)
        : []
      setActions(validationActions)
      setModels(standaloneModels)
      setDemands(demandData)
      setTechnicalContext(contextData)
      setReports(reportData)
      onQueueCountChange(
        demandData.length +
        validationActions.length +
        standaloneModels.length,
      )
    } catch (cause) {
      if (signal?.aborted) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível organizar as decisões.',
      )
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [onQueueCountChange, onSessionExpired, capabilities])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useAutoRefresh(
    () => load(undefined, true),
    { intervalMs: 12_000 },
  )

  const items = useMemo<DecisionItem[]>(() => {
    const demandItems = demands.map((demand): DecisionItem => {
      const next = demandNextStep(demand)
      return {
        id: demand.id,
        kind: 'demand',
        view: 'demands',
        title: demand.titulo,
        category: humanize(demand.entidade_tipo),
        context: [
          demand.area_atual_nome || 'Sem área',
          demand.cargo_atual_nome,
        ].filter(Boolean).join(' · '),
        description:
          demand.descricao || 'Solicitação enviada para validação técnica.',
        priority: upper(demand.prioridade || 'MEDIA'),
        status: demand.status,
        nextAction: next.label,
        nextDetail: next.detail,
        overdue: Boolean(
          demand.sla_resolucao_atrasado || demand.sla_resposta_atrasado,
        ),
        createdAt: demand.criado_em || demand.atualizado_em,
        raw: demand,
      }
    })
    const actionItems = actions.map((action): DecisionItem => ({
      id: action.id,
      kind: 'action',
      view: 'actions',
      title: action.titulo || 'Execução sem título',
      category: 'Execução concluída',
      context: [
        action.ativo_tag || action.ativo_nome || action.ativo_id,
        action.componente_nome,
      ].filter(Boolean).join(' · '),
      description: 'Checklist concluído e aguardando sua auditoria.',
      priority: upper(action.prioridade || 'NORMAL'),
      status: action.status,
      nextAction: 'Auditar execução',
      nextDetail: 'Confira respostas, evidências e o resultado registrado.',
      overdue: false,
      assetId: action.ativo_id,
      createdAt:
        action.finalizado_em || action.atualizado_em || action.gerado_em,
      raw: action,
    }))
    const modelItems = models.map((model): DecisionItem => ({
      id: model.id,
      kind: 'model',
      view: 'models',
      title: displayTitle(model.nome) || 'Checklist sem nome',
      category: `Checklist R${model.revisao ?? 1}`,
      context: [
        model.ativo_tag || model.ativo_nome || model.ativo_id,
        `${model.itens_count ?? 0} item(ns)`,
      ].filter(Boolean).join(' · '),
      description: 'Modelo enviado pelo Administrador para validação.',
      priority: upper(model.criticidade || 'NORMAL'),
      status: model.workflow_status || model.status || 'EM_VALIDACAO_GESTAO',
      nextAction: 'Validar checklist',
      nextDetail: 'Revise instruções, limites e critérios de aceite.',
      overdue: false,
      assetId: model.ativo_id,
      createdAt: model.enviado_validacao_em || model.atualizado_em,
      raw: model,
    }))
    return [...demandItems, ...actionItems, ...modelItems]
      .sort((left, right) => {
        if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
        const priorityDifference =
          (PRIORITY_SCORE[right.priority] ?? 0) -
          (PRIORITY_SCORE[left.priority] ?? 0)
        if (priorityDifference) return priorityDifference
        return String(left.createdAt ?? '').localeCompare(
          String(right.createdAt ?? ''),
        )
      })
  }, [actions, demands, models])

  const counts = useMemo(() => ({
    demands: items.filter((item) => item.view === 'demands').length,
    actions: items.filter((item) => item.view === 'actions').length,
    models: items.filter((item) => item.view === 'models').length,
  }), [items])

  const filteredItems = useMemo(() => items.filter((item) => {
    if (activeView !== 'all' && item.view !== activeView) return false
    if (
      priority === 'CRITICAL_OR_OVERDUE' &&
      !item.overdue &&
      !['CRITICA', 'CRÍTICA'].includes(item.priority)
    ) return false
    if (
      priority &&
      priority !== 'CRITICAL_OR_OVERDUE' &&
      item.priority !== priority
    ) return false
    return includesSearch(item, search.trim())
  }), [activeView, items, priority, search])

  useEffect(() => {
    if (focus?.kind && focus.id) {
      const focused = focus.kind === 'workOrder'
        ? items.find((item) => item.kind === 'demand' && item.raw.entidade_id === focus.id)
        : items.find((item) => item.kind === focus.kind && item.id === focus.id)
      if (focused) {
        setActiveView('all')
        setSelectedId(focused.id)
        return
      }
    }
    setSelectedId((current) =>
      filteredItems.some((item) => item.id === current)
        ? current
        : filteredItems[0]?.id ?? '',
    )
  }, [filteredItems, focus, items])

  const selected =
    filteredItems.find((item) => item.id === selectedId) ?? null
  const remainingItems = selected
    ? filteredItems.filter((item) => item.id !== selected.id)
    : filteredItems
  const criticalCount = items.filter(
    (item) => item.overdue || ['CRITICA', 'CRÍTICA'].includes(item.priority),
  ).length
  const reportsEnabled = ['QUALITY', 'SAFETY'].includes(
    upper(technicalContext?.identidade.area_codigo),
  )
  const reportSigners = useMemo(
    () => Array.from(new Set(reports.map((report) => report.assinante))).sort(),
    [reports],
  )
  const filteredReports = useMemo(
    () => reports.filter((report) => {
      if (reportSigner && report.assinante !== reportSigner) return false
      if (reportStatus && upper(report.status) !== reportStatus) return false
      if (!isInReportPeriod(report.aprovada_em, reportPeriod)) return false
      const normalized = search.trim().toLocaleLowerCase('pt-BR')
      return !normalized || [report.codigo, report.os_codigo, report.os_titulo, report.assinante]
        .some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized))
    }),
    [reportPeriod, reportSigner, reportStatus, reports, search],
  )

  if (technicalContext && !technicalContext.pode_validar) {
    return (
      <main className="content manager-decision-workspace">
        <section className="manager-decision-empty">
          <ShieldIcon />
          <strong>Perfil de acompanhamento técnico</strong>
          <span>
            As assinaturas ficam com Qualidade e Segurança. Use Acompanhar para
            investigar ativos, parâmetros, paradas e ocorrências.
          </span>
        </section>
      </main>
    )
  }

  async function changed(message: string) {
    setSelectedDemand(null)
    setSelectedAction(null)
    setSelectedModel(null)
    setNotice(message)
    await load(undefined, true)
  }

  function openDecision(item: DecisionItem) {
    if (item.kind === 'demand') {
      setSelectedDemand(item.raw as GestorTechnicalDemand)
    }
    if (item.kind === 'action') setSelectedAction(item.raw as GestorAction)
    if (item.kind === 'model') {
      setSelectedModel(item.raw as GestorChecklistModel)
    }
  }

  return (
    <>
      <main className="content manager-decision-workspace">
        <section className="manager-workspace-heading manager-decision-heading">
          <div>
            <h1>{showReports ? 'Relatórios Técnicos' : 'Validar'}</h1>
          </div>
          <div className="manager-decision-heading__controls">
            {reportsEnabled ? (
              <button
                className={showReports ? 'is-active' : ''}
                type="button"
                aria-pressed={showReports}
                onClick={() => setShowReports((current) => !current)}
              >
                {showReports ? 'Voltar às validações' : `Relatórios técnicos (${reports.length})`}
              </button>
            ) : null}
            <div className="manager-workspace-heading__status">
            <button
              type="button"
              className={!priority && activeView === 'all' ? 'is-active' : ''}
              aria-pressed={!priority && activeView === 'all'}
              onClick={() => {
                setPriority('')
                setActiveView('all')
                setFiltersOpen(false)
              }}
            >
              <strong>{items.length}</strong> pendentes
            </button>
            <button
              type="button"
              className={`${criticalCount ? 'is-critical ' : ''}${
                priority === 'CRITICAL_OR_OVERDUE' ? 'is-active' : ''
              }`}
              aria-pressed={priority === 'CRITICAL_OR_OVERDUE'}
              onClick={() => {
                setPriority((current) =>
                  current === 'CRITICAL_OR_OVERDUE'
                    ? ''
                    : 'CRITICAL_OR_OVERDUE',
                )
                setActiveView('all')
                setFiltersOpen(false)
              }}
            >
              <strong>{criticalCount}</strong> críticos
            </button>
            </div>

            <section className="manager-simple-search">
              <div className="manager-decision-search">
                <label>
                  <SearchIcon />
                  <input
                    value={search}
                    placeholder="Buscar documento"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button
                  className={
                    filtersOpen || priority || activeView !== 'all'
                      ? 'is-active'
                      : ''
                  }
                  type="button"
                  onClick={() => setFiltersOpen((current) => !current)}
                >
                  Refinar
                </button>
                {filtersOpen ? (
                  <div className="manager-filter-popover">
                    <label>
                      <span>Mostrar</span>
                      <select
                        value={activeView}
                        onChange={(event) =>
                          setActiveView(event.target.value as QueueFilter)}
                      >
                        <option value="all">Tudo ({items.length})</option>
                        <option value="demands">Solicitações ({counts.demands})</option>
                        <option value="actions">Execuções ({counts.actions})</option>
                        <option value="models">Checklists ({counts.models})</option>
                      </select>
                    </label>
                    <label>
                      <span>Prioridade</span>
                      <select
                        value={priority}
                        onChange={(event) => setPriority(event.target.value)}
                      >
                        <option value="">Todas</option>
                        <option value="CRITICAL_OR_OVERDUE">Críticas ou vencidas</option>
                        <option value="CRITICA">Crítica</option>
                        <option value="ALTA">Alta</option>
                        <option value="MEDIA">Média</option>
                        <option value="NORMAL">Normal</option>
                        <option value="BAIXA">Baixa</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setPriority('')
                        setActiveView('all')
                      }}
                    >
                      Limpar filtros
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </section>

        {notice ? (
          <div className="dashboard-notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')}>Fechar</button>
          </div>
        ) : null}
        {error ? (
          <div className="dashboard-error" role="alert">
            <strong>Falha ao atualizar.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {showReports ? (
          <section className="technical-reports-workspace" aria-label="Relatórios técnicos arquivados">
            <section className="technical-reports-workspace__filters" aria-label="Filtros dos relatórios técnicos">
              <label><span>OS ou relatório</span><input value={search} placeholder="Buscar código, OS ou título" onChange={(event) => setSearch(event.target.value)} /></label>
              <label><span>Período</span><select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}><option value="ALL">Todo o período</option><option value="TODAY">Hoje</option><option value="7D">Últimos 7 dias</option><option value="30D">Últimos 30 dias</option></select></label>
              <label><span>Responsável</span><select value={reportSigner} onChange={(event) => setReportSigner(event.target.value)}><option value="">Todos</option>{reportSigners.map((signer) => <option key={signer} value={signer}>{signer}</option>)}</select></label>
              <label><span>Status</span><select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)}><option value="">Todos</option><option value="ASSINADO">Assinado</option></select></label>
            </section>
            {loading ? <p className="panel-state">Carregando relatórios técnicos assinados…</p> : null}
            {!loading && filteredReports.length === 0 ? <div className="manager-decision-empty"><CheckIcon /><strong>Nenhum relatório técnico encontrado</strong><span>Relatórios assinados pela sua área aparecerão aqui com a rastreabilidade da assinatura.</span></div> : null}
            <div className="technical-reports-workspace__grid">
              {filteredReports.map((report) => <article className="technical-report-card" key={report.id}>
                <header><span>{report.codigo}</span><b>{humanize(report.status)}</b></header>
                <h2>{report.os_codigo} · {report.os_titulo}</h2>
                <dl><div><dt>Assinante</dt><dd>{report.assinante}</dd></div><div><dt>Data e hora</dt><dd>{formatDate(report.assinado_em)}</dd></div><div><dt>Área</dt><dd>{humanize(report.tipo)}</dd></div></dl>
                <section><strong>Parecer técnico</strong><p>{report.parecer || 'Sem parecer registrado.'}</p></section>
                <section className="technical-report-card__trace"><strong>Assinatura digital</strong><span>Referência: <code>{report.assinatura_referencia}</code></span>{report.assinatura_digital ? <span>Arquivo: <code>{report.assinatura_digital}</code></span> : null}<span>Hash imutável: <code>{report.hash}</code></span></section>
              </article>)}
            </div>
          </section>
        ) : (
        <section
          className={`manager-simple-decision-stage${remainingItems.length ? '' : ' is-single'}`}
        >
          {loading ? (
            <p className="panel-state">Organizando o que vem primeiro…</p>
          ) : null}
          {!loading && !selected ? (
            <div className="manager-decision-empty">
              <CheckIcon />
              <strong>Nenhum documento pendente</strong>
              <span>Quando o Administrador solicitar uma assinatura, aparecerá aqui.</span>
            </div>
          ) : null}

          {selected ? (
            <article className="manager-now-card">
              <header>
                <div>
                  <span className="manager-now-label">PRIMEIRO</span>
                  <small>{selected.category}</small>
                </div>
                <b className={selected.overdue ? 'is-overdue' : ''}>
                  {selected.overdue
                    ? 'SLA vencido'
                    : humanize(selected.priority)}
                </b>
              </header>
              <h2>{selected.title}</h2>
              <p className="manager-now-context">{selected.context}</p>
              <p className="manager-now-description">{selected.description}</p>
              <section>
                <span><ChevronRightIcon /></span>
                <div>
                  <small>PRÓXIMO PASSO</small>
                  <strong>{selected.nextAction}</strong>
                  <p>{selected.nextDetail}</p>
                </div>
              </section>
              <footer>
                <span>Recebido em {formatDate(selected.createdAt)}</span>
                <div>
                  {selected.assetId ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onOpenAnalytics(selected.assetId)}
                    >
                      Ver equipamento
                    </button>
                  ) : null}
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => openDecision(selected)}
                  >
                    <ShieldIcon />
                    {selected.nextAction}
                  </button>
                </div>
              </footer>
            </article>
          ) : null}

          {selected && remainingItems.length > 0 ? (
            <aside className="manager-later-queue" aria-label="Próximas decisões">
              <header>
                <div>
                  <small>EM SEGUIDA</small>
                  <strong>Próximos documentos</strong>
                </div>
                <span>{remainingItems.length}</span>
              </header>
              <div>
                {remainingItems.map((item) => (
                  <button
                    type="button"
                    key={`${item.kind}-${item.id}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span
                      className={`manager-queue-signal is-${item.priority.toLocaleLowerCase('pt-BR')}`}
                    />
                    <span>
                      <small>
                        {item.category}
                        {item.overdue ? ' · SLA vencido' : ''}
                      </small>
                      <strong>{item.title}</strong>
                      <p>{item.nextAction}</p>
                    </span>
                    <ChevronRightIcon />
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </section>
        )}
      </main>

      {selectedAction ? (
        <ActionReviewDialog
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          onDecisionComplete={(result: GestorDecisionResult) => changed(
            result.decisao === 'APROVAR'
              ? 'Execução aprovada.'
              : 'Execução devolvida para correção.',
          )}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedModel ? (
        <ChecklistModelReviewDialog
          model={selectedModel}
          onClose={() => setSelectedModel(null)}
          onDecisionComplete={(result: GestorChecklistModelDecisionResult) => changed(
            result.decisao === 'APROVAR'
              ? 'Checklist técnico aprovado.'
              : 'Checklist devolvido ao Administrador.',
          )}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedDemand && technicalContext ? (
        <TechnicalDemandDialog
          demand={selectedDemand}
          context={technicalContext}
          onClose={() => setSelectedDemand(null)}
          onProgress={async (message) => {
            setNotice(message)
            await load(undefined, true)
          }}
          onChanged={changed}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
    </>
  )
}
