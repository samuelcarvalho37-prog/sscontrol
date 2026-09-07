import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader, type ConnectionState } from '../components/AppHeader'
import { BottomNavigation, type AppSection } from '../components/BottomNavigation'
import { ExecutionErrorBoundary } from '../components/ExecutionErrorBoundary'
import { OperationOverlay } from '../components/OperationOverlay'
import { ActionDetailPage } from '../pages/ActionDetailPage'
import { ChecklistExecutionPage } from '../pages/ChecklistExecutionPage'
import { OperatorHome } from '../pages/OperatorHome'
import { LoginPage } from '../pages/LoginPage'
import { revokeOperatorSession } from '../services/api/auth'
import {
  clearOperatorSession,
  markExpiredOperatorSession,
  readOperatorSession,
  saveOperatorSession,
} from '../services/auth/session'
import { QrPage } from '../pages/QrPage'
import { SettingsPage } from '../pages/SettingsPage'
import { ApiRequestError } from '../services/api/client'
import { hasApiConfiguration } from '../services/api/config'
import {
  finalizeOperatorAction,
  getOperatorActionDetail,
  getOperatorActionState,
  getOperatorActions,
  getOperatorActiveStop,
  getSystemHealth,
  saveOperatorChecklistBatch,
  startOperatorAction,
  uploadOperatorEvidencePhoto,
} from '../services/api/operator'
import {
  clearOperatorCache,
  readActionDetailCache,
  readActionsCache,
  removeActionDetailCache,
  writeActionDetailCache,
  writeActionsCache,
} from '../services/storage/operatorCache'
import type {
  ChecklistBatchItemInput,
  EvidencePhotoUploadInput,
  OperatorFinalOutcome,
  EvidenceSaveData,
  MaintenanceStartDecision,
  OperatorActionDetailData,
  OperatorStopData,
  StartActionData,
} from '../types/api'
import type { OperatorAction } from '../types/operator'

type AppView = 'navigation' | 'action-detail' | 'checklist'

type RefreshOptions = { forceHealth?: boolean; silent?: boolean }
type DetailLoadOptions = { forceNetwork?: boolean; background?: boolean }

const HEALTH_REFRESH_INTERVAL_MS = 5 * 60_000

const ACTIVE_EXECUTION_CONTEXT_KEY = 'fab-control.active-execution-context'

type StoredExecutionContext = {
  actionId: string
  view: Extract<AppView, 'action-detail' | 'checklist'>
}

function readActiveExecutionContext(): StoredExecutionContext | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_EXECUTION_CONTEXT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredExecutionContext>
    if (
      !parsed.actionId ||
      (parsed.view !== 'action-detail' && parsed.view !== 'checklist')
    ) {
      window.localStorage.removeItem(ACTIVE_EXECUTION_CONTEXT_KEY)
      return null
    }
    return {
      actionId: parsed.actionId,
      view: parsed.view,
    }
  } catch {
    return null
  }
}

function saveActiveExecutionContext(
  actionId: string,
  view: StoredExecutionContext['view'],
): void {
  if (!actionId) return
  try {
    window.localStorage.setItem(
      ACTIVE_EXECUTION_CONTEXT_KEY,
      JSON.stringify({ actionId, view }),
    )
  } catch {
    // Persistência auxiliar indisponível; a execução continua em memória.
  }
}

function clearActiveExecutionContext(): void {
  try {
    window.localStorage.removeItem(ACTIVE_EXECUTION_CONTEXT_KEY)
  } catch {
    // Sem impacto na operação corrente.
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function mergeStartedDetail(
  current: OperatorActionDetailData,
  result: StartActionData,
): OperatorActionDetailData {
  const mode = result.modo_execucao_manutencao === 'SEM_PARADA'
    ? 'SEM_PARADA'
    : 'COM_PARADA'
  const now = new Date().toISOString()
  const checklist = result.checklist?.itens?.length
    ? result.checklist
    : current.checklist

  return {
    ...current,
    acao: {
      ...current.acao,
      status: 'EM_EXECUCAO',
      iniciado_em: current.acao.iniciado_em || now,
    },
    ativo: current.ativo
      ? {
          ...current.ativo,
          status: mode === 'COM_PARADA' ? 'PARADO' : current.ativo.status,
        }
      : current.ativo,
    execucao: {
      ...(current.execucao ?? {}),
      ...(result.execucao ?? {}),
      id: result.execucao?.id || result.execucao_id || current.execucao?.id,
      acao_id: result.acao_id || current.acao.id,
      iniciou_em: result.execucao?.iniciou_em || current.execucao?.iniciou_em || now,
      abriu_em: result.execucao?.abriu_em || current.execucao?.abriu_em || now,
      status: 'EM_EXECUCAO',
      modo_execucao_manutencao: mode,
    },
    checklist,
    ui: {
      ...(current.ui ?? {}),
      state: 'EM_EXECUCAO',
      can_start: false,
      can_answer: true,
      can_save_batch: true,
      can_register_evidence: true,
      message: 'Execução iniciada. Checklist liberado.',
    },
    operator_screen: current.operator_screen
      ? {
          ...current.operator_screen,
          header: {
            ...(current.operator_screen.header ?? {}),
            execucao_id: result.execucao_id,
            status: 'EM_EXECUCAO',
          },
        }
      : current.operator_screen,
  }
}

function mergeEvidenceIntoDetail(
  current: OperatorActionDetailData,
  saved: EvidenceSaveData,
  input: EvidencePhotoUploadInput,
): OperatorActionDetailData {
  const checklistId = saved.checklist_execucao_id || input.checklist_execucao_id
  const items = current.checklist?.itens ?? []
  const nextItems = items.map((item) => {
    if (item.id !== checklistId) return item

    const previousEvidence = item.evidencias ?? []
    const evidence = saved.evidencia ?? {
      id: saved.arquivo_id,
      checklist_execucao_id: checklistId,
      tipo: 'FOTO',
      nome_arquivo: input.nome_arquivo,
      url: saved.url,
      thumbnail_url: saved.thumbnail_url,
      arquivo_id: saved.arquivo_id,
      mime_type: saved.mime_type || input.mime_type,
      tamanho_bytes: saved.tamanho_bytes || input.tamanho_bytes,
      observacao: input.observacao,
      criado_em: new Date().toISOString(),
    }
    const duplicate = previousEvidence.some((record) =>
      Boolean(evidence.id && record.id === evidence.id) ||
      Boolean(evidence.url && record.url === evidence.url),
    )
    const count = Number(
      saved.evidencias_count ??
      saved.fotos_registradas ??
      (item.evidencias_count ?? 0) + 1,
    )

    return {
      ...item,
      evidencias_count: Number.isFinite(count) ? count : (item.evidencias_count ?? 0) + 1,
      evidencias: duplicate ? previousEvidence : [...previousEvidence, evidence],
      status: 'RESPONDIDO',
      respondido: true,
      resposta: item.resposta || 'EVIDENCIA_ANEXADA',
    }
  })

  return {
    ...current,
    checklist: current.checklist
      ? {
          ...current.checklist,
          itens: nextItems,
        }
      : current.checklist,
  }
}

export function App() {
  const [operatorSession, setOperatorSession] = useState(readOperatorSession)
  const initialExecutionContextRef = useRef<StoredExecutionContext | null>(
    readActiveExecutionContext(),
  )

  const [section, setSection] = useState<AppSection>('home')
  const [view, setView] = useState<AppView>(
    () => initialExecutionContextRef.current?.view ?? 'navigation',
  )
  const [toast, setToast] = useState('')
  const [actions, setActions] = useState<OperatorAction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [connectionState, setConnectionState] =
    useState<ConnectionState>(hasApiConfiguration() ? 'checking' : 'unconfigured')
  const [apiVersion, setApiVersion] = useState('')
  const [configurationRevision, setConfigurationRevision] = useState(0)

  const [selectedActionId, setSelectedActionId] = useState(
  () => initialExecutionContextRef.current?.actionId ?? '',
)
  const [actionDetail, setActionDetail] = useState<OperatorActionDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailRefreshing, setDetailRefreshing] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [starting, setStarting] = useState(false)
  const [savingChecklist, setSavingChecklist] = useState(false)
  const [savingEvidence, setSavingEvidence] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [activeStop, setActiveStop] = useState<OperatorStopData | null>(null)
  const [showDetailOverlay, setShowDetailOverlay] = useState(false)

  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const actionsRef = useRef<OperatorAction[]>([])
  const selectedActionIdRef = useRef(
  initialExecutionContextRef.current?.actionId ?? '',
)
  const actionDetailRef = useRef<OperatorActionDetailData | null>(null)
  const detailRequestRef = useRef(0)
  const writeBusyRef = useRef(false)
  const viewRef = useRef<AppView>(
  initialExecutionContextRef.current?.view ?? 'navigation',
)
  const sectionRef = useRef<AppSection>('home')
  const apiVersionRef = useRef('')
  const lastHealthCheckRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)

  const configured = hasApiConfiguration()

  useEffect(() => {
    if (!operatorSession) return

    const remainingSessionTime = operatorSession.expiresAt - Date.now()
    if (remainingSessionTime <= 0) {
      expireOperatorSession()
      return
    }

    const timer = window.setTimeout(expireOperatorSession, remainingSessionTime)
    return () => window.clearTimeout(timer)
  }, [operatorSession])

  useEffect(() => {
    actionDetailRef.current = actionDetail
  }, [actionDetail])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    sectionRef.current = section
  }, [section])

  function setVisibleActionDetail(detail: OperatorActionDetailData | null) {
    actionDetailRef.current = detail
    setActionDetail(detail)
  }

  function notify(message: string) {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast('')
      toastTimerRef.current = null
    }, 3200)
  }

  const refresh = useCallback(async (options: RefreshOptions = {}) => {
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current
      return
    }

    const run = (async () => {
      if (!hasApiConfiguration()) {
        setConnectionState('unconfigured')
        setActions([])
        setError('')
        setLoading(false)
        return
      }

      const cached = await readActionsCache()
      const hasCached = cached !== null
      const hasVisibleActions = hasCached || actionsRef.current.length > 0
      if (cached) {
        actionsRef.current = cached
        setActions(cached)
      }

      if (!options.silent) setLoading(true)
      if (!options.silent) setError('')
      if (!hasVisibleActions) setConnectionState('checking')

      const shouldCheckHealth =
        options.forceHealth ||
        !apiVersionRef.current ||
        Date.now() - lastHealthCheckRef.current >= HEALTH_REFRESH_INTERVAL_MS

      const [actionsResult, healthResult] = await Promise.allSettled([
        getOperatorActions(),
        shouldCheckHealth ? getSystemHealth() : Promise.resolve(null),
      ])

      if (actionsResult.status === 'fulfilled') {
        actionsRef.current = actionsResult.value
        setActions(actionsResult.value)
        await writeActionsCache(actionsResult.value)
        setConnectionState('online')
        setError('')
      } else {
        const message = actionsResult.reason instanceof Error
          ? actionsResult.reason.message
          : 'Falha ao carregar a fila do operador.'
        if (!options.silent) {
          setError(
            hasVisibleActions
              ? 'Atualização online indisponível. Exibindo a fila salva neste aparelho.'
              : message,
          )
        }
        if (!hasVisibleActions) {
          actionsRef.current = []
          setActions([])
        }
        setConnectionState('offline')
      }

      if (healthResult.status === 'fulfilled' && healthResult.value) {
        apiVersionRef.current = healthResult.value.version
        setApiVersion(healthResult.value.version)
        lastHealthCheckRef.current = Date.now()
        setConnectionState('online')
      }

      if (!options.silent) setLoading(false)
    })()

    refreshInFlightRef.current = run
    try {
      await run
    } finally {
      refreshInFlightRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!operatorSession) return
    void refresh({ forceHealth: true })
  }, [refresh, configurationRevision, operatorSession?.token])

  useEffect(() => {
    const canRefreshHome = () =>
      document.visibilityState === 'visible' &&
      !writeBusyRef.current &&
      viewRef.current === 'navigation' &&
      sectionRef.current === 'home'

    const refreshWhenVisible = () => {
      if (canRefreshHome()) void refresh({ silent: true })
    }
    const refreshOnFocus = () => {
      if (canRefreshHome()) void refresh({ silent: true })
    }
    const interval = window.setInterval(() => {
      if (canRefreshHome()) void refresh({ silent: true })
    }, 12_000)

    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('online', refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('online', refreshOnFocus)
    }
  }, [refresh])

  useEffect(() => {
    const blocking = detailLoading && !actionDetail
    if (!blocking) {
      setShowDetailOverlay(false)
      return
    }

    const timer = window.setTimeout(() => setShowDetailOverlay(true), 320)
    return () => window.clearTimeout(timer)
  }, [detailLoading, actionDetail])

  const loadActionDetail = useCallback(async (
    actionId: string,
    options: DetailLoadOptions = {},
  ) => {
    const requestId = ++detailRequestRef.current
    const isCurrentRequest = () =>
      detailRequestRef.current === requestId && selectedActionIdRef.current === actionId
    const hadVisibleDetail = actionDetailRef.current?.acao.id === actionId

    if (isCurrentRequest() && !options.background) setDetailError('')
    const cached = options.forceNetwork ? null : await readActionDetailCache(actionId)
    if (!isCurrentRequest()) return

    if (cached) {
      setVisibleActionDetail(cached)
      setDetailLoading(false)
      if (!options.background) setDetailRefreshing(true)
    } else if (!hadVisibleDetail && !options.background) {
      setDetailLoading(true)
      setDetailRefreshing(false)
    } else if (!options.background) {
      setDetailRefreshing(true)
    }

    try {
      const detail = await getOperatorActionDetail(actionId)
      if (!isCurrentRequest()) {
        await writeActionDetailCache(actionId, detail)
        return
      }

      setVisibleActionDetail(detail)
      await writeActionDetailCache(actionId, detail)
      setDetailError('')

      void getOperatorActiveStop({
        ativo_id: detail.ativo?.id || detail.acao.ativo_id,
        acao_id: actionId,
      }).then((stop) => {
        if (isCurrentRequest()) setActiveStop(stop.parada_ativa)
      }).catch(() => {
        // A parada operacional é auxiliar e não invalida o checklist carregado.
      })
    } catch (cause) {
      if (!isCurrentRequest()) return
      const message = cause instanceof Error ? cause.message : 'Falha ao abrir a ação.'
      if (!cached && !hadVisibleDetail && !options.background) {
        setDetailError(message)
      } else if (!options.background) {
        notify('Dados salvos mantidos. Não foi possível atualizar a ação agora.')
      }
    } finally {
      if (isCurrentRequest()) {
        setDetailLoading(false)
        setDetailRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
  if (!operatorSession) return

  const stored =
    initialExecutionContextRef.current ?? readActiveExecutionContext()

  if (!stored) return

  initialExecutionContextRef.current = null
  selectedActionIdRef.current = stored.actionId
  viewRef.current = stored.view

  setSelectedActionId(stored.actionId)
  setVisibleActionDetail(null)
  setActiveStop(null)
  setDetailError('')
  setOperationError('')
  setDetailLoading(true)
  setView(stored.view)

  void loadActionDetail(stored.actionId).then(() => {
    if (selectedActionIdRef.current !== stored.actionId) return

    if (
      stored.view === 'checklist' &&
      !actionDetailRef.current?.execucao?.id
    ) {
      viewRef.current = 'action-detail'
      setView('action-detail')
    }
  })
}, [configurationRevision, loadActionDetail, operatorSession?.token])
  function openActionById(actionId: string) {
    selectedActionIdRef.current = actionId
    setSelectedActionId(actionId)
    setVisibleActionDetail(null)
    setActiveStop(null)
    setDetailError('')
    setOperationError('')
    setDetailLoading(true)
    setView('action-detail')
    saveActiveExecutionContext(actionId, 'action-detail')
    void loadActionDetail(actionId)
  }

  function openAction(action: OperatorAction) {
    openActionById(action.id)
  }

  function closeAction() {
    clearActiveExecutionContext()
    selectedActionIdRef.current = ''
    detailRequestRef.current += 1
    setView('navigation')
    setSelectedActionId('')
    setVisibleActionDetail(null)
    setDetailError('')
    setOperationError('')
    setActiveStop(null)
    void refresh({ silent: true })
  }

  async function reconcileStartedAction(actionId: string): Promise<StartActionData | null> {
    for (const delay of [1200, 2500, 4000]) {
      await wait(delay)
      try {
        const state = await getOperatorActionState(actionId)
        if (state.started && state.execucao_id) {
          return {
            started: true,
            already_started: true,
            acao_id: state.acao_id,
            execucao_id: state.execucao_id,
            status: state.status,
            execucao: state.execucao ?? undefined,
            checklist: state.checklist ?? undefined,
            modo_execucao_manutencao: state.modo_execucao_manutencao === 'SEM_PARADA'
              ? 'SEM_PARADA'
              : 'COM_PARADA',
            decisao_parada_manutencao: state.modo_execucao_manutencao === 'SEM_PARADA'
              ? 'SEM_PARADA'
              : 'PARAR_EQUIPAMENTO',
            parada_operacional: state.parada_operacional,
            parada_manutencao: state.parada_manutencao,
          }
        }
      } catch {
        // Apenas reconciliação de leitura. A gravação nunca é repetida automaticamente.
      }
    }
    return null
  }

  async function startAction(decision: MaintenanceStartDecision) {
    const actionId = selectedActionIdRef.current
    if (!actionId) return

    writeBusyRef.current = true
    setStarting(true)
    setDetailError('')
    setOperationError('')

    try {
      let result: StartActionData
      try {
        result = await startOperatorAction(actionId, decision)
      } catch (cause) {
        if (!(cause instanceof ApiRequestError) || cause.code !== 'API_TIMEOUT') throw cause
        notify('O início demorou mais que o esperado. Confirmando a execução sem repetir a gravação…')
        const reconciled = await reconcileStartedAction(actionId)
        if (!reconciled) {
          throw new Error(
            'Não foi possível confirmar o início. Atualize a ação antes de tentar novamente; o sistema não repetiu a gravação.',
          )
        }
        result = reconciled
      }

      setActiveStop((current) => result.parada_operacional ?? result.parada ?? current)
      await removeActionDetailCache(actionId)

      const current = actionDetailRef.current
      if (current?.acao.id === actionId && result.checklist?.itens?.length) {
        const next = mergeStartedDetail(current, result)
        setVisibleActionDetail(next)
        await writeActionDetailCache(actionId, next)
        saveActiveExecutionContext(actionId, 'checklist')
        setView('checklist')
      } else {
        await loadActionDetail(actionId, { forceNetwork: true })
        if (!actionDetailRef.current?.execucao?.id) {
          throw new Error('A execução foi criada, mas o checklist ainda não ficou disponível. Atualize a ação.')
        }
        saveActiveExecutionContext(actionId, 'checklist')
        setView('checklist')
      }

      notify(
        result.modo_execucao_manutencao === 'SEM_PARADA'
          ? 'Execução iniciada sem parada da máquina.'
          : result.parada_operacional
            ? 'Manutenção iniciada e vinculada à parada operacional existente.'
            : 'Execução iniciada com parada do equipamento.',
      )

      window.setTimeout(() => {
        if (selectedActionIdRef.current !== actionId) return
        void loadActionDetail(actionId, { forceNetwork: true, background: true })
        void refresh({ silent: true })
      }, 800)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao iniciar execução.'
      setOperationError(message)
      notify(message)
    } finally {
      setStarting(false)
      writeBusyRef.current = false
    }
  }

  async function refreshCurrentDetail() {
    const actionId = selectedActionIdRef.current
    if (!actionId) return
    await loadActionDetail(actionId, { forceNetwork: true })
  }

  async function saveChecklistProgress(items: ChecklistBatchItemInput[]) {
    const actionId = selectedActionIdRef.current
    if (!actionId || items.length === 0) return

    writeBusyRef.current = true
    setSavingChecklist(true)
    setOperationError('')
    try {
      const result = await saveOperatorChecklistBatch(actionId, items)
      if (result.error_count > 0) {
        throw new Error(result.erros?.[0]?.message || 'Alguns itens não foram salvos.')
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao salvar o progresso.'
      setOperationError(message)
      notify(message)
      throw cause
    } finally {
      setSavingChecklist(false)
      writeBusyRef.current = false
    }
  }

  async function saveEvidencePhotos(inputs: EvidencePhotoUploadInput[]): Promise<EvidenceSaveData[]> {
    const actionId = selectedActionIdRef.current
    const executionId = actionDetailRef.current?.execucao?.id
    if (!actionId || !executionId) {
      throw new Error('Execução não identificada para registrar evidência.')
    }
    if (!inputs.length) return []

    writeBusyRef.current = true
    setSavingEvidence(true)
    setOperationError('')
    try {
      const saved: EvidenceSaveData[] = []
      let updatedDetail = actionDetailRef.current

      for (const input of inputs) {
        const result = await uploadOperatorEvidencePhoto(actionId, executionId, input)
        saved.push(result)
        if (updatedDetail?.acao.id === actionId) {
          updatedDetail = mergeEvidenceIntoDetail(updatedDetail, result, input)
          setVisibleActionDetail(updatedDetail)
        }
      }

      await removeActionDetailCache(actionId)
      if (updatedDetail) await writeActionDetailCache(actionId, updatedDetail)
      notify(`${saved.length} foto(s) registrada(s)`)

      window.setTimeout(() => {
        if (selectedActionIdRef.current === actionId) {
          void loadActionDetail(actionId, { forceNetwork: true, background: true })
        }
      }, 900)

      return saved
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao registrar evidência.'
      setOperationError(message)
      notify(message)
      throw cause
    } finally {
      setSavingEvidence(false)
      writeBusyRef.current = false
    }
  }

  async function finishOperatorExecution(
    items: ChecklistBatchItemInput[],
    resultado: 'OK' | 'NOK',
    observacao: string,
    resultadoOperacional: OperatorFinalOutcome,
    durationSeconds: number,
  ) {
    const actionId = selectedActionIdRef.current
    if (!actionId) throw new Error('Ação não identificada para finalização.')

    writeBusyRef.current = true
    setFinalizing(true)
    setOperationError('')
    try {
      if (items.length > 0) {
        const saved = await saveOperatorChecklistBatch(actionId, items)
        if (saved.error_count > 0) {
          throw new Error(saved.erros?.[0]?.message || 'Alguns itens não foram salvos.')
        }
      }

      const result = await finalizeOperatorAction(actionId, {
        resultado,
        resultado_operacional: resultadoOperacional,
        observacao,
        duracao_segundos: durationSeconds,
      })

      setActiveStop((current) => result.parada_operacional ?? result.parada ?? current)
      const remainingActions = actionsRef.current.filter((action) => action.id !== actionId)
      actionsRef.current = remainingActions
      setActions(remainingActions)
      await removeActionDetailCache(actionId)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao finalizar a execução.'
      setOperationError(message)
      throw cause
    } finally {
      setFinalizing(false)
      writeBusyRef.current = false
    }
  }

  function returnHomeAfterCompletion() {
    clearActiveExecutionContext()
    selectedActionIdRef.current = ''
    detailRequestRef.current += 1
    setView('navigation')
    setSection('home')
    setSelectedActionId('')
    setVisibleActionDetail(null)
    setDetailError('')
    setOperationError('')
    setActiveStop(null)
    void refresh({ forceHealth: true })
  }

  async function testConnection() {
    try {
      const health = await getSystemHealth()
      apiVersionRef.current = health.version
      lastHealthCheckRef.current = Date.now()
      setApiVersion(health.version)
      setConnectionState('online')
      notify(`API ${health.version} conectada`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao testar a API.'
      setConnectionState('offline')
      notify(message)
      throw cause
    }
  }

  async function configurationSaved() {
    await clearOperatorCache()
    actionsRef.current = []
    selectedActionIdRef.current = ''
    detailRequestRef.current += 1
    apiVersionRef.current = ''
    lastHealthCheckRef.current = 0
    setActions([])
    setSelectedActionId('')
    setVisibleActionDetail(null)
    setActiveStop(null)
    setDetailError('')
    setOperationError('')
    setConfigurationRevision((value) => value + 1)
    setSection('home')
    setView('navigation')
    notify('Configuração salva')
  }

  function expireOperatorSession() {
    markExpiredOperatorSession()
    setOperatorSession(null)
    setSection('home')
    setView('navigation')
  }

  async function logoutOperator() {
    const token = operatorSession?.token ?? ''
    try {
      await revokeOperatorSession(token)
    } catch {
      // O encerramento local prevalece quando a API está indisponível.
    } finally {
      clearOperatorSession()
      clearActiveExecutionContext()
      setOperatorSession(null)
      window.location.reload()
    }
  }

  function changeSection(next: AppSection) {
    setView('navigation')
    setSection(next)
    if (next === 'home') void refresh()
  }

  if (!operatorSession) {
    return (
      <LoginPage
        onAuthenticated={(session) => {
          saveOperatorSession(session)
          setConnectionState('checking')
          setOperatorSession(session)
        }}
      />
    )
  }

  const operationOverlay = showDetailOverlay
    ? {
        visible: true,
        title: 'Carregando ação',
        description: 'Primeiro acesso: consultando análise técnica e checklist.',
      }
    : starting
      ? {
          visible: true,
          title: 'Iniciando execução',
          description: 'Criando a execução e liberando o checklist.',
        }
      : savingChecklist
        ? {
            visible: true,
            title: 'Salvando progresso',
            description: 'Protegendo as respostas já preenchidas.',
          }
        : savingEvidence
          ? {
              visible: true,
              title: 'Enviando evidências',
              description: 'Sincronizando as fotos compactadas com a execução.',
            }
          : {
              visible: false,
              title: '',
              description: '',
            }

  return (
    <div className="app-stage">
      <section className="app-frame">
        <AppHeader
          operatorName={operatorSession.user.nome || 'Operador'}
          shift={`Matrícula ${operatorSession.user.matricula}`}
          connectionState={connectionState}
        />

        <main className="app-content">
          {view === 'action-detail' ? (
            <ActionDetailPage
              detail={actionDetail}
              loading={detailLoading && !actionDetail}
              error={detailError || operationError}
              starting={starting}
              onBack={closeAction}
              onRetry={() => void loadActionDetail(selectedActionIdRef.current, { forceNetwork: true })}
              onStart={startAction}
              activeStop={activeStop}
              onContinue={() => {
                setOperationError('')
                saveActiveExecutionContext(selectedActionIdRef.current, 'checklist')
                setView('checklist')
              }}
            />
          ) : view === 'checklist' ? (
            actionDetail ? (
              <ExecutionErrorBoundary
                key={`${actionDetail.acao.id}:${actionDetail.execucao?.id || 'pending'}`}
                onBack={() => {
                  setOperationError('')
                  saveActiveExecutionContext(selectedActionIdRef.current, 'action-detail')
                  setView('action-detail')
                }}
                onRetry={refreshCurrentDetail}
              >
                <ChecklistExecutionPage
                  detail={actionDetail}
                  evidenceSaving={savingEvidence}
                  finalizing={finalizing}
                  error={operationError}
                  activeStop={activeStop}
                  onBack={() => {
                    setOperationError('')
                    saveActiveExecutionContext(selectedActionIdRef.current, 'action-detail')
                    setView('action-detail')
                  }}
                  onRefresh={refreshCurrentDetail}
                  onSaveProgress={saveChecklistProgress}
                  onRegisterEvidence={saveEvidencePhotos}
                  onFinish={finishOperatorExecution}
                  onReturnHome={returnHomeAfterCompletion}
                />
              </ExecutionErrorBoundary>
            ) : (
              <section className="screen">
                <article
                  className={`state-panel${detailError ? ' state-panel--error' : ''}`}
                  role={detailError ? 'alert' : 'status'}
                >
                  <span className="state-panel__kicker">
                    {detailError ? 'Execução indisponível' : 'Preparando execução'}
                  </span>
                  <h1>
                    {detailError
                      ? 'Não foi possível carregar o checklist'
                      : 'Carregando checklist'}
                  </h1>
                  <p>
                    {detailError
                      ? detailError
                      : 'Sincronizando as etapas e respostas já registradas.'}
                  </p>
                  {detailError ? (
                    <div className="detail-error-actions">
                      <button type="button" className="secondary-button" onClick={closeAction}>
                        Voltar
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadActionDetail(
                          selectedActionIdRef.current,
                          { forceNetwork: true },
                        )}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : null}
                </article>
              </section>
            )
          ) : (
           <>
              {section === 'home' && (
                <OperatorHome
                  actions={actions}
                  loading={loading}
                  error={error}
                  configured={configured}
                  onRetry={() => void refresh({ forceHealth: true })}
                  onOpenSettings={() => setSection('settings')}
                  onOpenAction={openAction}
                  onOpenQr={() => setSection('qr')}
                />
              )}
              {section === 'qr' && <QrPage onNotify={notify} onOpenAction={openActionById} />}
              {section === 'settings' && (
                <SettingsPage
                    apiOnline={connectionState === 'online'}
                    apiVersion={apiVersion}
                    operatorName={operatorSession.user.nome || 'Operador'}
                    operatorRegistration={operatorSession.user.matricula}
                    operatorRole={operatorSession.user.perfil}
                    operatorDepartment="Não sincronizado"
                    operatorShift="Não sincronizado"
                    sessionStartedAt={operatorSession.startedAt}
                    onConfigurationSaved={configurationSaved}
                    onTestConnection={testConnection}
                    onLogout={() => void logoutOperator()}
                  />
              )}
            </>
          )}
        </main>

        {view === 'navigation' && <BottomNavigation active={section} onChange={changeSection} />}

        {detailRefreshing && actionDetail && (
          <div className="background-refresh" role="status">Atualizando dados…</div>
        )}

        <OperationOverlay
          visible={operationOverlay.visible}
          title={operationOverlay.title}
          description={operationOverlay.description}
        />

        <div className={toast ? 'toast toast--visible' : 'toast'} role="status" aria-live="polite">
          {toast}
        </div>
      </section>
    </div>
  )
}
