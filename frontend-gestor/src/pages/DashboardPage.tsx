import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GestorSection } from '../components/AppNavigation'
import { GestorPerformancePanel } from '../components/GestorPerformancePanel'
import {
  AlertIcon,
  AssetIcon,
  CheckIcon,
  ChevronRightIcon,
  RefreshIcon,
  StopIcon,
  ValidationIcon,
} from '../components/Icons'
import {
  getGestorChecklistModels,
  getGestorOverview,
  getGestorTechnicalDemands,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import type {
  GestorChecklistModel,
  GestorOverview,
  GestorTechnicalDemand,
  GestorWorkView,
} from '../types/gestor'

export interface DashboardPageProps {
  onNavigate: (section: GestorSection) => void
  onOpenWork: (view?: GestorWorkView) => void
  onQueueCountChange: (count: number) => void
  onSessionExpired: () => void
}

interface WorkItem {
  id: string
  view: GestorWorkView
  category: string
  title: string
  context: string
  priority: string
  overdue: boolean
  nextAction: string
  createdAt?: string
}

const EMPTY_OVERVIEW: GestorOverview = {
  actions: [],
  validationQueue: [],
  stops: [],
  openStops: [],
  occurrences: [],
  completedActions: [],
  occurrenceHistory: [],
  kpis: {
    ativo_id: 'TODOS',
    inicio_em: '',
    fim_em: '',
    ativos_considerados: 0,
    disponibilidade_pct: null,
    tempo_observado_segundos: 0,
    tempo_operacao_segundos: 0,
    tempo_parada_segundos: 0,
    falhas_nao_planejadas: 0,
    mttr_segundos: null,
    mtbf_segundos: null,
    lead_time_os_segundos: null,
    lead_time_demanda_segundos: null,
    sla_resposta_pct: null,
    sla_resolucao_pct: null,
    sla_resposta_amostra: 0,
    sla_resolucao_amostra: 0,
    oee_disponivel: false,
    oee_pct: null,
    oee_disponibilidade_pct: null,
    oee_performance_pct: null,
    oee_qualidade_pct: null,
    producao_amostra: 0,
  },
  counts: {
    pending: 0,
    executing: 0,
    awaitingValidation: 0,
    blocked: 0,
    openStops: 0,
    awaitingOccurrences: 0,
  },
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
  const normalized = String(value ?? '').trim().replaceAll('_', ' ').toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Não informado'
}

function formatDate(value?: string): string {
  if (!value) return 'Sem data registrada'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function demandNextAction(demand: GestorTechnicalDemand): string {
  if (!demand.responsavel_atual_id) return 'Assumir e iniciar análise'
  const pendingSignatures = Math.max(
    0,
    Number(demand.assinaturas_necessarias ?? 0) -
      Number(demand.assinaturas_realizadas ?? 0),
  )
  if (pendingSignatures > 0) return 'Registrar ou solicitar assinatura'
  return upper(demand.entidade_tipo) === 'ORDEM_SERVICO_RASCUNHO'
    ? 'Liberar para operação'
    : 'Registrar decisão técnica'
}

function modelWorkItem(model: GestorChecklistModel): WorkItem {
  return {
    id: model.id,
    view: 'models',
    category: 'Checklist técnico',
    title: model.nome || 'Modelo sem nome',
    context: [
      model.ativo_tag || model.ativo_nome || model.ativo_id,
      `Revisão ${model.revisao ?? 1}`,
      `${model.itens_count ?? 0} item(ns)`,
    ].filter(Boolean).join(' · '),
    priority: upper(model.criticidade || 'NORMAL'),
    overdue: false,
    nextAction: 'Revisar conteúdo e decidir',
    createdAt: model.enviado_validacao_em || model.atualizado_em,
  }
}

export function DashboardPage({
  onNavigate,
  onOpenWork,
  onQueueCountChange,
  onSessionExpired,
}: DashboardPageProps) {
  const [overview, setOverview] = useState<GestorOverview>(EMPTY_OVERVIEW)
  const [models, setModels] = useState<GestorChecklistModel[]>([])
  const [demands, setDemands] = useState<GestorTechnicalDemand[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')

  const load = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (background) setRefreshing(true)
      else setLoading(true)
      setError('')

      try {
        const [overviewData, modelData, demandData] = await Promise.all([
          getGestorOverview(signal),
          getGestorChecklistModels(signal),
          getGestorTechnicalDemands(signal),
        ])
        setOverview(overviewData)
        setModels(modelData)
        setDemands(demandData)
        setUpdatedAt(new Date().toISOString())
        onQueueCountChange(
          demandData.length +
          overviewData.validationQueue.length +
          modelData.length +
          overviewData.occurrences.length,
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
            : 'Não foi possível carregar o painel do gestor.',
        )
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [onQueueCountChange, onSessionExpired],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const workItems = useMemo<WorkItem[]>(() => {
    const items: WorkItem[] = [
      ...demands.map((demand) => ({
        id: demand.id,
        view: 'demands' as const,
        category: humanize(demand.entidade_tipo),
        title: demand.titulo,
        context: [
          demand.area_atual_nome || 'Sem área',
          demand.cargo_atual_nome,
          humanize(demand.status),
        ].filter(Boolean).join(' · '),
        priority: upper(demand.prioridade || 'MEDIA'),
        overdue: Boolean(demand.sla_resolucao_atrasado || demand.sla_resposta_atrasado),
        nextAction: demandNextAction(demand),
        createdAt: demand.criado_em || demand.atualizado_em,
      })),
      ...overview.validationQueue.map((action) => ({
        id: action.id,
        view: 'actions' as const,
        category: 'Execução concluída',
        title: action.titulo || 'Execução sem título',
        context: [
          action.ativo_tag || action.ativo_nome || action.ativo_id,
          humanize(action.status),
        ].filter(Boolean).join(' · '),
        priority: upper(action.prioridade || 'NORMAL'),
        overdue: false,
        nextAction: 'Auditar evidências e aprovar',
        createdAt: action.finalizado_em || action.atualizado_em || action.gerado_em,
      })),
      ...models.map(modelWorkItem),
      ...overview.occurrences.map((occurrence) => ({
        id: occurrence.id,
        view: 'operations' as const,
        category: 'Anormalidade',
        title: occurrence.titulo || 'Ocorrência operacional',
        context: occurrence.descricao || occurrence.ativo_id || 'Sem descrição',
        priority: upper(occurrence.severidade || 'MEDIA'),
        overdue: false,
        nextAction: 'Criar análise técnica',
        createdAt: occurrence.criado_em,
      })),
    ]

    return items.sort((left, right) => {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
      const priorityDifference =
        (PRIORITY_SCORE[right.priority] ?? 0) - (PRIORITY_SCORE[left.priority] ?? 0)
      if (priorityDifference) return priorityDifference
      return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    })
  }, [demands, models, overview.occurrences, overview.validationQueue])

  const nextWork = workItems[0]
  const overdueCount = demands.filter(
    (demand) => demand.sla_resolucao_atrasado || demand.sla_resposta_atrasado,
  ).length

  const workGroups = [
    {
      view: 'demands' as const,
      label: 'Solicitações técnicas',
      description: 'Assumir, assinar, encaminhar ou decidir',
      count: demands.length,
      Icon: ValidationIcon,
    },
    {
      view: 'actions' as const,
      label: 'Execuções concluídas',
      description: 'Auditar checklist e evidências',
      count: overview.validationQueue.length,
      Icon: CheckIcon,
    },
    {
      view: 'models' as const,
      label: 'Checklists',
      description: 'Revisar modelos antes da operação',
      count: models.length,
      Icon: ValidationIcon,
    },
    {
      view: 'operations' as const,
      label: 'Ocorrências',
      description: 'Analisar anormalidades e paradas',
      count: overview.occurrences.length,
      Icon: AlertIcon,
    },
  ]

  const summaryMetrics = [
    {
      label: 'Precisa de você',
      value: workItems.length,
      detail: 'itens aguardando tratamento',
      tone: workItems.length ? 'attention' : 'good',
    },
    {
      label: 'SLA em atraso',
      value: overdueCount,
      detail: overdueCount ? 'priorize imediatamente' : 'nenhum prazo vencido',
      tone: overdueCount ? 'danger' : 'good',
    },
    {
      label: 'Em execução',
      value: overview.counts.executing,
      detail: 'trabalhos no chão de fábrica',
      tone: 'active',
    },
    {
      label: 'Paradas abertas',
      value: overview.counts.openStops,
      detail: 'equipamentos indisponíveis',
      tone: overview.counts.openStops ? 'danger' : 'neutral',
    },
  ]

  return (
    <main className="content manager-dashboard">
      <section className="page-heading manager-dashboard__heading">
        <div>
          <span className="eyebrow">PAINEL DO GESTOR</span>
          <h1>Decisões e desempenho</h1>
          <p>Comece pelo item mais urgente, conclua o filtro técnico e acompanhe o efeito na operação.</p>
        </div>
        <button
          className="icon-text-button"
          type="button"
          disabled={loading || refreshing}
          onClick={() => void load(undefined, true)}
        >
          <RefreshIcon />
          {refreshing ? 'Atualizando…' : 'Atualizar painel'}
        </button>
      </section>

      {error ? (
        <div className="dashboard-error" role="alert">
          <strong>Falha ao atualizar o painel.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="manager-summary-grid" aria-label="Resumo do trabalho">
        {summaryMetrics.map((metric) => (
          <article className={`manager-summary-card is-${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{loading ? '—' : metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="manager-workspace">
        <article className="manager-next-work">
          <header>
            <div>
              <span className="eyebrow">PRÓXIMO PASSO</span>
              <h2>{nextWork ? 'Trate primeiro este item' : 'Tudo sob controle'}</h2>
            </div>
            {nextWork?.overdue ? <span className="manager-overdue-chip">SLA vencido</span> : null}
          </header>

          {loading ? (
            <p className="panel-state">Organizando suas prioridades…</p>
          ) : nextWork ? (
            <>
              <div className="manager-next-work__identity">
                <span className="manager-next-work__icon"><ValidationIcon /></span>
                <span>
                  <small>{nextWork.category} · {nextWork.priority}</small>
                  <strong>{nextWork.title}</strong>
                  <p>{nextWork.context}</p>
                </span>
              </div>
              <ol className="manager-next-work__steps">
                <li className="is-current"><b>1</b><span><strong>Abrir</strong><small>Leia o contexto e confirme o escopo.</small></span></li>
                <li><b>2</b><span><strong>Analisar</strong><small>Confira risco, evidências e pendências.</small></span></li>
                <li><b>3</b><span><strong>Decidir</strong><small>{nextWork.nextAction}.</small></span></li>
              </ol>
              <footer>
                <span>Recebido em {formatDate(nextWork.createdAt)}</span>
                <button type="button" onClick={() => onOpenWork(nextWork.view)}>
                  {nextWork.nextAction} <ChevronRightIcon />
                </button>
              </footer>
            </>
          ) : (
            <div className="manager-clear-state">
              <CheckIcon />
              <span>
                <strong>Nenhuma decisão pendente</strong>
                <small>Novas solicitações aparecerão aqui já ordenadas por SLA e prioridade.</small>
              </span>
            </div>
          )}
        </article>

        <aside className="manager-work-groups">
          <header>
            <span className="eyebrow">CENTRAL DE TRABALHO</span>
            <h2>Uma única entrada</h2>
            <p>Tudo que exige sua intervenção fica organizado nestas quatro categorias.</p>
          </header>
          <div>
            {workGroups.map(({ view, label, description, count, Icon }) => (
              <button type="button" key={view} onClick={() => onOpenWork(view)}>
                <Icon />
                <span><strong>{label}</strong><small>{description}</small></span>
                <b>{count}</b>
                <ChevronRightIcon />
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="manager-operation-strip">
        <header>
          <div>
            <span className="eyebrow">SITUAÇÃO DA FÁBRICA</span>
            <h2>Operação em tempo real</h2>
          </div>
          <button type="button" onClick={() => onNavigate('validations')}>
            <AssetIcon /> Consultar ativos
          </button>
        </header>
        <div>
          <article>
            <StopIcon />
            <span><strong>{overview.counts.openStops}</strong><small>paradas abertas</small></span>
          </article>
          <article>
            <AlertIcon />
            <span><strong>{overview.counts.awaitingOccurrences}</strong><small>anormalidades sem análise</small></span>
          </article>
          <article>
            <ValidationIcon />
            <span><strong>{overview.counts.blocked}</strong><small>ações bloqueadas</small></span>
          </article>
          <article>
            <CheckIcon />
            <span><strong>{overview.counts.executing}</strong><small>execuções em andamento</small></span>
          </article>
        </div>
      </section>

      <GestorPerformancePanel onSessionExpired={onSessionExpired} />

      <p className="manager-dashboard__updated">
        Última consolidação: {updatedAt ? formatDate(updatedAt) : 'pendente'}
      </p>
    </main>
  )
}
