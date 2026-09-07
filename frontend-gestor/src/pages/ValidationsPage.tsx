import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionReviewDialog } from '../components/ActionReviewDialog'
import { ChecklistModelReviewDialog } from '../components/ChecklistModelReviewDialog'
import { TechnicalAnalysisDialog } from '../components/TechnicalAnalysisDialog'
import { TechnicalDemandDialog } from '../components/TechnicalDemandDialog'
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  RefreshIcon,
  SearchIcon,
  StopIcon,
  ValidationIcon,
} from '../components/Icons'
import {
  getGestorActions,
  getGestorChecklistModels,
  getGestorOccurrences,
  getGestorStops,
  getGestorTechnicalContext,
  getGestorTechnicalDemands,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import type {
  GestorAction,
  GestorChecklistModel,
  GestorChecklistModelDecisionResult,
  GestorDecisionResult,
  GestorOccurrence,
  GestorStop,
  GestorTechnicalContext,
  GestorTechnicalDemand,
  GestorWorkView,
} from '../types/gestor'

export interface ValidationsPageProps {
  initialView: GestorWorkView
  onQueueCountChange: (count: number) => void
  onSessionExpired: () => void
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
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

function formatDate(value?: string): string {
  if (!value) return 'Sem data registrada'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function includesSearch(values: unknown[], search: string): boolean {
  if (!search) return true
  const normalized = search.toLocaleLowerCase('pt-BR')
  return values.some((value) =>
    String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized),
  )
}

export function ValidationsPage({
  initialView,
  onQueueCountChange,
  onSessionExpired,
}: ValidationsPageProps) {
  const [tab, setTab] = useState<GestorWorkView>(initialView)
  const [demands, setDemands] = useState<GestorTechnicalDemand[]>([])
  const [technicalContext, setTechnicalContext] =
    useState<GestorTechnicalContext | null>(null)
  const [actions, setActions] = useState<GestorAction[]>([])
  const [models, setModels] = useState<GestorChecklistModel[]>([])
  const [stops, setStops] = useState<GestorStop[]>([])
  const [occurrences, setOccurrences] = useState<GestorOccurrence[]>([])
  const [selectedDemand, setSelectedDemand] =
    useState<GestorTechnicalDemand | null>(null)
  const [selectedAction, setSelectedAction] = useState<GestorAction | null>(null)
  const [selectedModel, setSelectedModel] =
    useState<GestorChecklistModel | null>(null)
  const [selectedOccurrence, setSelectedOccurrence] =
    useState<GestorOccurrence | null>(null)
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (background) setRefreshing(true)
      else setLoading(true)
      setError('')

      try {
        const [
          actionData,
          modelData,
          stopData,
          occurrenceData,
          demandData,
          contextData,
        ] = await Promise.all([
          getGestorActions(signal),
          getGestorChecklistModels(signal),
          getGestorStops(signal),
          getGestorOccurrences(signal),
          getGestorTechnicalDemands(signal),
          getGestorTechnicalContext(signal),
        ])
        const validationActions = actionData.filter(
          (action) => upper(action.status) === 'AGUARDANDO_VALIDACAO',
        )
        setActions(validationActions)
        setModels(modelData)
        setStops(stopData)
        setOccurrences(occurrenceData)
        setDemands(demandData)
        setTechnicalContext(contextData)
        onQueueCountChange(
          demandData.length +
          validationActions.length +
          modelData.length +
          occurrenceData.length,
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
            : 'Não foi possível carregar a Central de trabalho.',
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

  useEffect(() => {
    setTab(initialView)
  }, [initialView])

  const filteredDemands = useMemo(
    () => demands.filter((demand) => {
      if (priority && upper(demand.prioridade) !== priority) return false
      return includesSearch(
        [
          demand.id,
          demand.titulo,
          demand.entidade_id,
          demand.area_atual_nome,
          demand.cargo_atual_nome,
        ],
        search,
      )
    }),
    [demands, priority, search],
  )

  const filteredActions = useMemo(
    () => actions.filter((action) => {
      if (priority && upper(action.prioridade) !== priority) return false
      return includesSearch(
        [
          action.id,
          action.titulo,
          action.ativo_tag,
          action.ativo_nome,
          action.componente_nome,
        ],
        search,
      )
    }),
    [actions, priority, search],
  )

  const filteredModels = useMemo(
    () => models.filter((model) => {
      if (priority && upper(model.criticidade) !== priority) return false
      return includesSearch(
        [
          model.id,
          model.nome,
          model.ativo_tag,
          model.ativo_nome,
          model.componente_nome,
        ],
        search,
      )
    }),
    [models, priority, search],
  )

  const filteredOccurrences = useMemo(
    () => occurrences.filter((occurrence) => {
      if (priority && upper(occurrence.severidade) !== priority) return false
      return includesSearch(
        [
          occurrence.id,
          occurrence.titulo,
          occurrence.descricao,
          occurrence.ativo_id,
        ],
        search,
      )
    }),
    [occurrences, priority, search],
  )

  async function handleActionDecision(result: GestorDecisionResult) {
    setNotice(
      result.decisao === 'APROVAR'
        ? 'Execução aprovada e liberada da fila.'
        : 'Execução devolvida ao fluxo operacional.',
    )
    await load(undefined, true)
  }

  async function handleModelDecision(
    result: GestorChecklistModelDecisionResult,
  ) {
    setNotice(
      result.decisao === 'APROVAR'
        ? 'Checklist técnico aprovado.'
        : 'Checklist devolvido ao Administrador.',
    )
    await load(undefined, true)
  }

  async function handleTechnicalChange(message: string) {
    setSelectedDemand(null)
    setSelectedOccurrence(null)
    setNotice(message)
    await load(undefined, true)
  }

  async function handleTechnicalProgress(message: string) {
    setNotice(message)
    await load(undefined, true)
  }

  function demandNextStep(demand: GestorTechnicalDemand): {
    label: string
    detail: string
    step: number
  } {
    if (!demand.responsavel_atual_id) {
      return {
        label: 'Assumir e analisar',
        detail: 'Confirme a responsabilidade e registre a primeira resposta.',
        step: 1,
      }
    }
    const pendingSignatures = Math.max(
      0,
      Number(demand.assinaturas_necessarias ?? 0) -
        Number(demand.assinaturas_realizadas ?? 0),
    )
    if (pendingSignatures > 0) {
      return technicalContext?.pode_assinar
        ? {
          label: 'Registrar assinatura',
          detail: `Ainda faltam ${pendingSignatures} assinatura(s) técnica(s).`,
          step: 2,
        }
        : {
          label: 'Encaminhar ao assinante',
          detail: `Direcione para um cargo autorizado; faltam ${pendingSignatures} assinatura(s).`,
          step: 2,
        }
    }
    return {
      label: upper(demand.entidade_tipo) === 'ORDEM_SERVICO_RASCUNHO'
        ? 'Liberar para operação'
        : 'Registrar decisão',
      detail: 'As verificações obrigatórias foram atendidas; aprove ou devolva com parecer.',
      step: 3,
    }
  }

  return (
    <>
      <main className="content validation-page manager-work-page">
        <section className="page-heading">
          <div>
            <span className="eyebrow">FILTRO TÉCNICO</span>
            <h1>Central de trabalho</h1>
            <p>Uma única entrada para assumir solicitações, revisar execuções, validar checklists e tratar ocorrências.</p>
          </div>
          <button
            className="icon-text-button"
            type="button"
            disabled={loading || refreshing}
            onClick={() => void load(undefined, true)}
          >
            <RefreshIcon />
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </section>

        {technicalContext ? (
          <div className="technical-identity-banner">
            <span>Seu escopo</span>
            <strong>
              {technicalContext.identidade.area_nome || 'Gestor sem área definida'}
            </strong>
            <small>
              {technicalContext.identidade.cargo_nome || 'Sem cargo específico'}
              {technicalContext.pode_assinar
                ? ' · assinatura autorizada'
                : ' · sem permissão de assinatura'}
            </small>
          </div>
        ) : null}

        {notice ? (
          <div className="dashboard-notice" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')}>Fechar</button>
          </div>
        ) : null}
        {error ? (
          <div className="dashboard-error" role="alert">
            <strong>Falha na Central de trabalho.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <section className="manager-work-guide" aria-label="Como tratar uma solicitação">
          <header>
            <span className="eyebrow">COMO TRATAR O QUE CHEGOU</span>
            <strong>Siga o próximo passo indicado em cada cartão</strong>
          </header>
          <ol>
            <li><b>1</b><span><strong>Assuma</strong><small>Registra a primeira resposta e define o responsável.</small></span></li>
            <li><b>2</b><span><strong>Analise</strong><small>Confira risco, evidências, escopo e requisitos.</small></span></li>
            <li><b>3</b><span><strong>Encaminhe ou assine</strong><small>Acione outra especialidade quando necessário.</small></span></li>
            <li><b>4</b><span><strong>Decida</strong><small>Aprove, devolva ou libere para a operação.</small></span></li>
          </ol>
        </section>

        <div
          className="validation-tabs"
          role="tablist"
          aria-label="Categorias da Central de trabalho"
        >
          <button
            className={tab === 'demands' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'demands'}
            onClick={() => setTab('demands')}
          >
            <ValidationIcon /> Solicitações <span>{demands.length}</span>
          </button>
          <button
            className={tab === 'actions' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'actions'}
            onClick={() => setTab('actions')}
          >
            <CheckIcon /> Execuções <span>{actions.length}</span>
          </button>
          <button
            className={tab === 'models' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'models'}
            onClick={() => setTab('models')}
          >
            <ValidationIcon /> Checklists <span>{models.length}</span>
          </button>
          <button
            className={tab === 'operations' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'operations'}
            onClick={() => setTab('operations')}
          >
            <AlertIcon /> Operação <span>{occurrences.length + stops.length}</span>
          </button>
        </div>

        <section className="filter-bar" aria-label="Filtros da central">
          <label className="search-field">
            <SearchIcon />
            <input
              value={search}
              placeholder="Buscar por ID, ativo, área, cargo ou título"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>Prioridade</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">Todas</option>
              <option value="CRITICA">Crítica</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Média</option>
              <option value="NORMAL">Normal</option>
              <option value="BAIXA">Baixa</option>
            </select>
          </label>
        </section>

        {tab === 'demands' ? (
          <section className="validation-grid" role="tabpanel">
            {loading ? (
              <p className="panel-state">Organizando solicitações por prioridade e SLA…</p>
            ) : null}
            {!loading && filteredDemands.length === 0 ? (
              <div className="manager-work-empty">
                <CheckIcon />
                <span>
                  <strong>Nenhuma solicitação aguardando você</strong>
                  <small>Quando o Administrador ou outra especialidade encaminhar algo para seu escopo, aparecerá aqui com o próximo passo indicado.</small>
                </span>
              </div>
            ) : null}
            {filteredDemands.map((demand) => {
              const nextStep = demandNextStep(demand)
              return (
                <article
                  className={`validation-card technical-demand-card ${demand.sla_resolucao_atrasado ? 'is-overdue' : ''}`}
                  key={demand.id}
                >
                  <div className="validation-card__topline">
                    <span className="status-pill status-pill--blue">
                      {humanize(demand.entidade_tipo)}
                    </span>
                    <span className="priority-chip">
                      {humanize(demand.prioridade)}
                    </span>
                  </div>
                  <h2>{demand.titulo}</h2>
                  <p>
                    {demand.area_atual_nome || 'Sem área'}
                    {demand.cargo_atual_nome ? ` · ${demand.cargo_atual_nome}` : ''}
                  </p>
                  <div className="manager-next-action">
                    <b>{nextStep.step}</b>
                    <span>
                      <small>PRÓXIMO PASSO</small>
                      <strong>{nextStep.label}</strong>
                      <p>{nextStep.detail}</p>
                    </span>
                    <ChevronRightIcon />
                  </div>
                  <dl>
                    <div><dt>Status</dt><dd>{humanize(demand.status)}</dd></div>
                    <div>
                      <dt>Assinaturas</dt>
                      <dd>{Number(demand.assinaturas_realizadas ?? 0)}/{Number(demand.assinaturas_necessarias ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>SLA</dt>
                      <dd className={demand.sla_resolucao_atrasado ? 'is-danger' : 'is-good'}>
                        {demand.sla_resolucao_atrasado ? 'Atrasado' : 'No prazo'}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="review-button"
                    type="button"
                    onClick={() => setSelectedDemand(demand)}
                  >
                    {nextStep.label}
                  </button>
                </article>
              )
            })}
          </section>
        ) : null}

        {tab === 'actions' ? (
          <section className="validation-grid" role="tabpanel">
            {loading ? <p className="panel-state">Carregando execuções…</p> : null}
            {!loading && filteredActions.length === 0 ? (
              <p className="panel-state">Nenhuma execução aguarda auditoria. Itens concluídos pelo Operador aparecerão aqui.</p>
            ) : null}
            {filteredActions.map((action) => (
              <article className="validation-card" key={action.id}>
                <div className="validation-card__topline">
                  <span className="status-pill">EXECUÇÃO</span>
                  <span className="priority-chip">
                    {humanize(action.prioridade || 'NORMAL')}
                  </span>
                </div>
                <h2>{action.titulo || 'Ação sem título'}</h2>
                <p>
                  {action.ativo_tag || action.ativo_id || 'Ativo não informado'}
                  {action.ativo_nome ? ` · ${action.ativo_nome}` : ''}
                </p>
                <div className="manager-next-action">
                  <b>1</b>
                  <span>
                    <small>PRÓXIMO PASSO</small>
                    <strong>Auditar evidências e checklist</strong>
                    <p>Confira respostas, bloqueios e resultado antes de aprovar ou devolver.</p>
                  </span>
                  <ChevronRightIcon />
                </div>
                <dl>
                  <div><dt>Gerada em</dt><dd>{formatDate(action.gerado_em)}</dd></div>
                  <div><dt>Locks</dt><dd>{action.locks_ativos ?? 0}</dd></div>
                  <div><dt>Status</dt><dd>{humanize(action.status)}</dd></div>
                </dl>
                <button
                  className="review-button"
                  type="button"
                  onClick={() => setSelectedAction(action)}
                >
                  Auditar execução
                </button>
              </article>
            ))}
          </section>
        ) : null}

        {tab === 'models' ? (
          <section className="validation-grid" role="tabpanel">
            {loading ? <p className="panel-state">Carregando checklists…</p> : null}
            {!loading && filteredModels.length === 0 ? (
              <p className="panel-state">Nenhum checklist aguarda validação. Novos modelos enviados pelo Administrador aparecerão aqui.</p>
            ) : null}
            {filteredModels.map((model) => (
              <article className="validation-card" key={model.id}>
                <div className="validation-card__topline">
                  <span className="status-pill status-pill--blue">
                    CHECKLIST R{model.revisao ?? 1}
                  </span>
                  <span className="priority-chip">
                    {humanize(model.criticidade || 'NORMAL')}
                  </span>
                </div>
                <h2>{model.nome || 'Checklist sem nome'}</h2>
                <p>
                  {model.ativo_tag || model.ativo_id || 'Ativo não informado'}
                  {model.componente_nome ? ` · ${model.componente_nome}` : ''}
                </p>
                <div className="manager-next-action">
                  <b>1</b>
                  <span>
                    <small>PRÓXIMO PASSO</small>
                    <strong>Validar conteúdo técnico</strong>
                    <p>Revise instruções, critérios de aceite, evidências e parâmetros.</p>
                  </span>
                  <ChevronRightIcon />
                </div>
                <dl>
                  <div><dt>Itens</dt><dd>{model.itens_count ?? 0}</dd></div>
                  <div><dt>Tempo</dt><dd>{model.tempo_estimado_min ?? 0} min</dd></div>
                  <div><dt>Enviado</dt><dd>{formatDate(model.enviado_validacao_em || model.atualizado_em)}</dd></div>
                </dl>
                <button
                  className="review-button"
                  type="button"
                  onClick={() => setSelectedModel(model)}
                >
                  Revisar checklist
                </button>
              </article>
            ))}
          </section>
        ) : null}

        {tab === 'operations' ? (
          <section className="operation-monitor" role="tabpanel">
            <div className="operation-column">
              <header className="section-heading">
                <div>
                  <span className="eyebrow">ANORMALIDADES</span>
                  <h2>Aguardando análise</h2>
                </div>
                <span className="section-count">{filteredOccurrences.length}</span>
              </header>
              {filteredOccurrences.length === 0 ? (
                <p className="panel-state">Nenhuma anormalidade aguarda análise técnica.</p>
              ) : null}
              {filteredOccurrences.map((occurrence) => (
                <article className="operation-card" key={occurrence.id}>
                  <span className="operation-card__icon operation-card__icon--danger">
                    <AlertIcon />
                  </span>
                  <div>
                    <div className="validation-card__topline">
                      <span className="priority-chip">
                        {humanize(occurrence.severidade || 'NÃO CLASSIFICADA')}
                      </span>
                      <small>{formatDate(occurrence.criado_em)}</small>
                    </div>
                    <h3>{occurrence.titulo || 'Ocorrência operacional'}</h3>
                    <p>{occurrence.descricao || occurrence.ativo_id || 'Sem descrição.'}</p>
                    <button
                      className="review-button"
                      type="button"
                      onClick={() => setSelectedOccurrence(occurrence)}
                    >
                      Criar análise técnica
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="operation-column">
              <header className="section-heading">
                <div>
                  <span className="eyebrow">PARADAS</span>
                  <h2>Monitoramento</h2>
                </div>
                <span className="section-count">{stops.length}</span>
              </header>
              {stops.length === 0 ? (
                <p className="panel-state">Nenhuma parada registrada.</p>
              ) : null}
              {stops.map((stop) => (
                <article className="operation-card" key={stop.id}>
                  <span className="operation-card__icon"><StopIcon /></span>
                  <div>
                    <div className="validation-card__topline">
                      <span className="status-pill">{humanize(stop.status)}</span>
                      <small>{formatDate(stop.iniciada_em)}</small>
                    </div>
                    <h3>{stop.ativo_id}</h3>
                    <p>{stop.motivo_parada || 'Parada sem motivo informado.'}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {selectedAction ? (
        <ActionReviewDialog
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          onDecisionComplete={handleActionDecision}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedModel ? (
        <ChecklistModelReviewDialog
          model={selectedModel}
          onClose={() => setSelectedModel(null)}
          onDecisionComplete={handleModelDecision}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedDemand && technicalContext ? (
        <TechnicalDemandDialog
          demand={selectedDemand}
          context={technicalContext}
          onClose={() => setSelectedDemand(null)}
          onProgress={handleTechnicalProgress}
          onChanged={handleTechnicalChange}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {selectedOccurrence ? (
        <TechnicalAnalysisDialog
          occurrence={selectedOccurrence}
          onClose={() => setSelectedOccurrence(null)}
          onChanged={handleTechnicalChange}
        />
      ) : null}
    </>
  )
}
