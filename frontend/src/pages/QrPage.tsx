import { useEffect, useMemo, useRef, useState } from 'react'
import { ActiveStopBanner } from '../components/ActiveStopBanner'
import { ApiRequestError } from '../services/api/client'
import { QrIcon, ScanIcon } from '../components/Icons'
import {
  finishOperatorStop,
  getOperatorActiveStop,
  getOperatorQrContext,
  getOperatorQrHistoryPage,
  registerOperatorOccurrence,
  registerOperatorParameter,
  startOperatorStop,
} from '../services/api/operator'
import { readQrContextCache, writeQrContextCache } from '../services/storage/operatorCache'
import type {
  FinishStopResponseData,
  OperatorQrContextData,
  QrActionData,
  QrHistoryData,
  QrParameterData,
  StartStopResponseData,
} from '../types/api'

type BarcodeDetectorResult = { rawValue?: string }
type BarcodeDetectorInstance = { detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]> }
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance
type OccurrenceTarget = '' | 'EQUIPAMENTO' | 'COMPONENTE'
type ParameterTarget = 'EQUIPAMENTO' | 'COMPONENTE'
type ParameterCode =
  | 'HORIMETRO'
  | 'TEMPERATURA'
  | 'VIBRACAO'
  | 'PRESSAO'
  | 'CORRENTE'
  | 'TENSAO'

const PARAMETER_OPTIONS: Array<{ value: ParameterCode; label: string; unit: string }> = [
  { value: 'HORIMETRO', label: 'Horímetro', unit: 'h' },
  { value: 'TEMPERATURA', label: 'Temperatura', unit: '°C' },
  { value: 'VIBRACAO', label: 'Vibração', unit: 'mm/s' },
  { value: 'PRESSAO', label: 'Pressão', unit: 'bar' },
  { value: 'CORRENTE', label: 'Corrente', unit: 'A' },
  { value: 'TENSAO', label: 'Tensão', unit: 'V' },
]

const PARAMETERS_PAGE_SIZE = 6
const OCCURRENCES_PAGE_SIZE = 3

type StopReasonCode =
  | ''
  | 'FALHA_MECANICA'
  | 'FALHA_ELETRICA_AUTOMACAO'
  | 'FALHA_PNEUMATICA_HIDRAULICA'
  | 'SEGURANCA'
  | 'QUALIDADE'
  | 'AJUSTE_SETUP'
  | 'FALTA_MATERIAL'
  | 'LIMPEZA_INSPECAO'
  | 'OUTRO'

const STOP_REASON_OPTIONS: Array<{ value: Exclude<StopReasonCode, ''>; label: string }> = [
  { value: 'FALHA_MECANICA', label: 'Falha mecânica' },
  { value: 'FALHA_ELETRICA_AUTOMACAO', label: 'Falha elétrica ou automação' },
  { value: 'FALHA_PNEUMATICA_HIDRAULICA', label: 'Falha pneumática ou hidráulica' },
  { value: 'SEGURANCA', label: 'Condição de segurança' },
  { value: 'QUALIDADE', label: 'Desvio de qualidade' },
  { value: 'AJUSTE_SETUP', label: 'Ajuste ou setup' },
  { value: 'FALTA_MATERIAL', label: 'Falta de material ou insumo' },
  { value: 'LIMPEZA_INSPECAO', label: 'Limpeza ou inspeção' },
  { value: 'OUTRO', label: 'Outro' },
]

export interface QrPageProps {
  onNotify: (message: string) => void
  onOpenAction: (actionId: string) => void
}

function formatDate(value?: string): string {
  if (!value) return 'Data não informada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function displayName(value?: string): string {
  if (!value) return 'Parâmetro'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function latestParameters(context: OperatorQrContextData): QrParameterData[] {
  if (context.parametros_atuais?.length) return context.parametros_atuais
  if (context.parametros_recentes?.length) {
    const seen = new Set<string>()
    return context.parametros_recentes.filter((item) => {
      const key = `${item.componente_id ?? ''}|${item.parametro ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  if (context.ativo?.horimetro_atual !== undefined && context.ativo.horimetro_atual !== '') {
    return [{
      id: 'HORIMETRO-ATIVO',
      ativo_id: context.ativo.id,
      parametro: 'HORIMETRO',
      valor: context.ativo.horimetro_atual,
      unidade: 'h',
      origem: context.horimetro?.automatico ? 'TELEMETRIA' : 'ATIVO',
      registrado_em: context.horimetro?.atualizado_em,
    }]
  }
  return []
}

function uniqueHistory(current: QrHistoryData[], incoming: QrHistoryData[]): QrHistoryData[] {
  const known = new Set(current.map((item) => item.id))
  return current.concat(incoming.filter((item) => !known.has(item.id)))
}

function uniqueActions(actions: QrActionData[]): QrActionData[] {
  const known = new Set<string>()
  return actions.filter((action) => {
    if (!action.id || known.has(action.id)) return false
    known.add(action.id)
    return true
  })
}

export function QrPage({ onNotify, onOpenAction }: QrPageProps) {
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [context, setContext] = useState<OperatorQrContextData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cameraActive, setCameraActive] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const [historyItems, setHistoryItems] = useState<QrHistoryData[]>([])
  const [historyCursor, setHistoryCursor] = useState('')
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const [parameterOpen, setParameterOpen] = useState(false)
  const [parameterTarget, setParameterTarget] = useState<ParameterTarget>('EQUIPAMENTO')
  const [parameterName, setParameterName] = useState<ParameterCode>('HORIMETRO')
  const [parameterValue, setParameterValue] = useState('')
  const [componentId, setComponentId] = useState('')
  const [savingParameter, setSavingParameter] = useState(false)
  const [parameterError, setParameterError] = useState('')
  const [parameterScope, setParameterScope] = useState('EQUIPAMENTO')
  const [visibleParameterCount, setVisibleParameterCount] = useState(PARAMETERS_PAGE_SIZE)

  const [stopOpen, setStopOpen] = useState(false)
  const [stopReason, setStopReason] = useState<StopReasonCode>('')
  const [stopReasonDetails, setStopReasonDetails] = useState('')
  const [savingStop, setSavingStop] = useState(false)
  const [returnCategory, setReturnCategory] = useState('')
  const [returnJustification, setReturnJustification] = useState('')
  const [returnValidation, setReturnValidation] = useState<FinishStopResponseData | null>(null)

  const [occurrenceOpen, setOccurrenceOpen] = useState(false)
  const [occurrenceTarget, setOccurrenceTarget] = useState<OccurrenceTarget>('')
  const [occurrenceTitle, setOccurrenceTitle] = useState('')
  const [occurrenceDescription, setOccurrenceDescription] = useState('')
  const [occurrenceSeverity, setOccurrenceSeverity] = useState('MEDIA')
  const [occurrenceComponentId, setOccurrenceComponentId] = useState('')
  const [savingOccurrence, setSavingOccurrence] = useState(false)
  const [visibleOccurrenceCount, setVisibleOccurrenceCount] = useState(OCCURRENCES_PAGE_SIZE)
  const [expandedOccurrenceIds, setExpandedOccurrenceIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(
    () => new Set(),
  )

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const lookupRequestRef = useRef(0)
  const actionCarouselRef = useRef<HTMLDivElement | null>(null)
  const parameters = useMemo(() => context ? latestParameters(context) : [], [context])
  const selectedParameter =
    PARAMETER_OPTIONS.find((option) => option.value === parameterName) ?? PARAMETER_OPTIONS[0]
  const selectedLastParameter = useMemo(
    () =>
      parameters.find(
        (parameter) =>
          parameter.parametro === parameterName &&
          (parameter.componente_id ?? '') ===
            (parameterTarget === 'COMPONENTE' ? componentId : ''),
      ) ?? null,
    [componentId, parameterName, parameterTarget, parameters],
  )
  const selectedComponent = useMemo(
    () => (context?.componentes ?? []).find((component) => component.id === componentId) ?? null,
    [componentId, context?.componentes],
  )
  const automaticHourMeter =
    parameterName === 'HORIMETRO' && Boolean(context?.horimetro?.automatico)
  const scannedComponentId = context?.componente?.id ?? ''
  const parameterComponents = useMemo(() => {
    const componentIds = new Set(
      parameters
        .map((parameter) => parameter.componente_id)
        .filter((id): id is string => Boolean(id)),
    )
    return (context?.componentes ?? []).filter((component) => componentIds.has(component.id))
  }, [context?.componentes, parameters])
  const effectiveParameterScope = scannedComponentId || parameterScope
  const filteredParameters = useMemo(
    () =>
      effectiveParameterScope === 'EQUIPAMENTO'
        ? parameters.filter((parameter) => !parameter.componente_id)
        : parameters.filter((parameter) => parameter.componente_id === effectiveParameterScope),
    [effectiveParameterScope, parameters],
  )
  const visibleParameters = filteredParameters.slice(0, visibleParameterCount)
  const hasMoreParameters = visibleParameterCount < filteredParameters.length
  const openOccurrences = context?.ocorrencias_abertas ?? []
  const visibleOccurrences = openOccurrences.slice(0, visibleOccurrenceCount)
  const hasMoreOccurrences = visibleOccurrenceCount < openOccurrences.length

  function occurrenceTreatmentLabel(status?: string, treatmentStatus?: string): string {
    const value = String(treatmentStatus || status || '').trim().toUpperCase()
    const labels: Record<string, string> = {
      AGUARDANDO_ANALISE: 'Enviada para análise',
      EM_ANALISE_TECNICA: 'Em análise técnica',
      AGUARDANDO_ADMIN: 'Em tratamento pelo Admin',
      EM_TRATAMENTO_ADMIN: 'Em tratamento pelo Admin',
      CHECKLIST_EM_PREPARACAO: 'Checklist em preparação',
      EM_PREPARACAO_CHECKLIST: 'Checklist em preparação',
      AGUARDANDO_ASSINATURA: 'Aguardando validação',
      EM_VALIDACAO_TECNICA: 'Aguardando validação',
      LIBERADA_OPERACAO: 'Ação liberada',
      EM_EXECUCAO: 'Execução em andamento',
      FINALIZADA: 'Tratamento concluído',
    }
    return labels[value] || 'Tratamento registrado'
  }
  const availableActions = useMemo(() => {
    const candidates = context?.acoes_pendentes?.length
      ? context.acoes_pendentes
      : context?.proxima_acao
        ? [context.proxima_acao]
        : []
    const normalized = uniqueActions(candidates)
    const scannedComponentId = context?.componente?.id
    if (!scannedComponentId) return normalized
    return normalized.filter((action) => action.componente_id === scannedComponentId)
  }, [context])

  function scrollActionCarousel(direction: 'previous' | 'next') {
    const carousel = actionCarouselRef.current
    if (!carousel) return
    const distance = Math.max(250, Math.floor(carousel.clientWidth * 0.86))
    carousel.scrollBy({
      left: direction === 'next' ? distance : -distance,
      behavior: 'smooth',
    })
  }

  function applyContext(result: OperatorQrContextData) {
    setContext(result)
    setComponentId(result.componente?.id ?? '')
    setParameterTarget(result.componente?.id ? 'COMPONENTE' : 'EQUIPAMENTO')
    setParameterScope(result.componente?.id ?? 'EQUIPAMENTO')
    setVisibleParameterCount(PARAMETERS_PAGE_SIZE)
    setParameterError('')
    setVisibleOccurrenceCount(OCCURRENCES_PAGE_SIZE)
    setExpandedOccurrenceIds(new Set())
    setExpandedHistoryIds(new Set())
    setManualOpen(false)
    setCameraError('')
    setHistoryItems((result.historico_recente ?? []).slice(0, 4))
    setHistoryCursor(result.historico_paginacao?.next_cursor ?? '')
    setHistoryHasMore(Boolean(result.historico_paginacao?.has_more))
  }

  async function lookup(payload = query) {
    const normalized = payload.trim()
    if (!normalized) {
      setError('Informe o QR, a TAG ou o ID do equipamento.')
      return
    }

    const requestId = ++lookupRequestRef.current
    const isCurrentRequest = () => lookupRequestRef.current === requestId
    const cached = await readQrContextCache(normalized)
    if (!isCurrentRequest()) return

    if (cached?.found) {
      applyContext(cached)
      setLastQuery(normalized)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError('')

    try {
      const result = await getOperatorQrContext(normalized)
      await writeQrContextCache(normalized, result)
      if (!isCurrentRequest()) return

      applyContext(result)
      setLastQuery(normalized)
      if (!result.found) setError(result.mensagem_operador || 'Equipamento não encontrado.')
      else onNotify(result.mensagem_operador || 'Equipamento identificado')
    } catch (cause) {
      if (!isCurrentRequest()) return
      if (!cached) {
        setContext(null)
        setHistoryItems([])
        setError(cause instanceof Error ? cause.message : 'Falha ao consultar o QR Code.')
      } else {
        onNotify('Exibindo consulta salva. Atualização online indisponível.')
      }
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }

  async function refreshContextInBackground(payload: string) {
    const normalized = payload.trim()
    if (!normalized) return
    const requestId = lookupRequestRef.current
    try {
      const result = await getOperatorQrContext(normalized)
      await writeQrContextCache(normalized, result)
      if (lookupRequestRef.current === requestId) applyContext(result)
    } catch {
      // O estado confirmado permanece visível; falha secundária não bloqueia a operação.
    }
  }

  async function loadMoreHistory() {
    if (!context?.ativo?.id || historyLoading || !historyHasMore) return
    setHistoryLoading(true)
    try {
      let cursor = historyCursor
      let hasMore: boolean = historyHasMore
      let collected: QrHistoryData[] = []

      // Pode haver muitos eventos de outros ativos entre duas páginas. Avança
      // até três blocos sem carregar a aba inteira nem poluir o cache local.
      for (let attempt = 0; attempt < 3 && hasMore && collected.length === 0; attempt += 1) {
        const page = await getOperatorQrHistoryPage({
          ativo_id: context.ativo.id,
          componente_id: context.componente?.id ?? '',
          cursor,
          limit: 4,
        })
        collected = page.items ?? []
        cursor = page.next_cursor ?? ''
        hasMore = Boolean(page.has_more)
      }

      setHistoryItems((current) => uniqueHistory(current, collected))
      setHistoryCursor(cursor)
      setHistoryHasMore(hasMore)
      if (!collected.length && !hasMore) onNotify('Todo o histórico disponível já foi carregado.')
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : 'Falha ao carregar mais histórico.')
    } finally {
      setHistoryLoading(false)
    }
  }

  function stopCamera(updateState = true) {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (updateState) setCameraActive(false)
  }

  useEffect(() => () => stopCamera(false), [])

  useEffect(() => {
    if (!cameraActive) return
    let cancelled = false

    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
      if (!Detector) {
        setCameraError('Este navegador não possui leitura nativa de QR. Tente novamente ou digite o código.')
        // O modo manual permanece fechado até o operador solicitar.
        setManualOpen(false)
        setCameraActive(false)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) return stream.getTracks().forEach((track) => track.stop())
        streamRef.current = stream
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new Detector({ formats: ['qr_code'] })
        const scan = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const results = await detector.detect(videoRef.current)
            const raw = results.find((item) => item.rawValue)?.rawValue?.trim()
            if (raw) {
              setQuery(raw)
              setManualOpen(false)
              stopCamera()
              await lookup(raw)
              return
            }
          } catch {
            // Quadro sem QR é esperado durante a leitura.
          }
          scanTimerRef.current = window.setTimeout(() => void scan(), 350)
        }
        void scan()
      } catch (cause) {
        setCameraError(cause instanceof Error ? `Não foi possível abrir a câmera: ${cause.message}` : 'Não foi possível abrir a câmera.')
        // Permissão negada ou falha de câmera não deve abrir o teclado automaticamente.
        setManualOpen(false)
        setCameraActive(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      stopCamera(false)
    }
  }, [cameraActive])

  function openParameterModal() {
    const initialComponentId =
      context?.componente?.id ??
      (parameterScope !== 'EQUIPAMENTO' ? parameterScope : '')
    setParameterTarget(initialComponentId ? 'COMPONENTE' : 'EQUIPAMENTO')
    setComponentId(initialComponentId)
    setParameterName('HORIMETRO')
    setParameterValue('')
    setParameterError('')
    setParameterOpen(true)
  }

  function closeParameterModal() {
    if (savingParameter) return
    setParameterOpen(false)
    setParameterValue('')
    setParameterError('')
  }

  function useLastParameterValue() {
    if (selectedLastParameter?.valor === null || selectedLastParameter?.valor === undefined) return
    setParameterValue(String(selectedLastParameter.valor))
  }

  async function saveParameter() {
    if (!context?.ativo?.id) return
    if (parameterTarget === 'COMPONENTE' && !componentId) {
      setParameterError('Selecione o componente.')
      return
    }

    const value = Number(parameterValue.replace(',', '.'))
    if (!Number.isFinite(value)) {
      setParameterError('Informe um valor numérico válido.')
      return
    }
    if (automaticHourMeter) {
      setParameterError('Horímetro atualizado pela telemetria.')
      return
    }

    const savedScope = parameterTarget === 'COMPONENTE' ? componentId : 'EQUIPAMENTO'
    setParameterError('')
    setSavingParameter(true)
    try {
      await registerOperatorParameter({
        ativo_id: context.ativo.id,
        componente_id: parameterTarget === 'COMPONENTE' ? componentId : '',
        parametro: parameterName,
        valor: value,
        unidade: selectedParameter.unit,
      })
      setParameterOpen(false)
      setParameterValue('')
      onNotify('Leitura registrada')
      await lookup(lastQuery || context.ativo.tag || context.ativo.id)
      setParameterScope(savedScope)
      setVisibleParameterCount(PARAMETERS_PAGE_SIZE)
    } catch (cause) {
      setParameterError(cause instanceof Error ? cause.message : 'Falha ao registrar parâmetro')
    } finally {
      setSavingParameter(false)
    }
  }

  async function startStop() {
    if (!context?.ativo?.id) return
    const selectedReason = STOP_REASON_OPTIONS.find((option) => option.value === stopReason)
    if (!selectedReason) return onNotify('Selecione o motivo da parada')
    if (stopReason === 'OUTRO' && stopReasonDetails.trim().length < 5) {
      return onNotify('Descreva o motivo da parada')
    }

    const reasonText = stopReason === 'OUTRO'
      ? `${selectedReason.label}: ${stopReasonDetails.trim()}`
      : selectedReason.label
    const ativoId = context.ativo.id
    const cacheKey = lastQuery || context.ativo.tag || ativoId
    setSavingStop(true)
    try {
      let result: StartStopResponseData
      try {
        result = await startOperatorStop({
          ativo_id: ativoId,
          componente_id: context.componente?.id || '',
          motivo_parada: reasonText,
        })
      } catch (cause) {
        if (!(cause instanceof ApiRequestError) || cause.code !== 'API_TIMEOUT') throw cause
        onNotify('A parada demorou para responder. Confirmando o registro sem repetir a gravação…')
        const state = await getOperatorActiveStop({ ativo_id: ativoId })
        if (!state.parada_ativa) {
          throw new Error('Não foi possível confirmar a parada. Consulte o equipamento novamente antes de tentar outra vez.')
        }
        result = { started: true, already_open: true, parada: state.parada_ativa }
      }

      const nextContext: OperatorQrContextData = {
        ...context,
        ativo: context.ativo ? { ...context.ativo, status: 'PARADO' } : context.ativo,
        parada_ativa: result.parada,
      }
      setContext(nextContext)
      setStopOpen(false)
      void writeQrContextCache(cacheKey, nextContext)
      setStopReason('')
      setStopReasonDetails('')
      onNotify(result.already_open ? 'A parada do equipamento já estava ativa' : 'Equipamento parado. Gestão e administração podem acompanhar o evento.')
      window.setTimeout(() => void refreshContextInBackground(cacheKey), 500)
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : 'Falha ao iniciar a parada')
    } finally {
      setSavingStop(false)
    }
  }

  async function finishStop() {
    if (!context?.parada_ativa?.id || !context.ativo?.id) return
    const ativoId = context.ativo.id
    const cacheKey = lastQuery || context.ativo.tag || ativoId
    setSavingStop(true)
    try {
      let result: FinishStopResponseData
      try {
        result = await finishOperatorStop({
          parada_id: context.parada_ativa.id,
          ativo_id: ativoId,
          categoria_retorno: returnCategory,
          justificativa_divergencia: returnJustification.trim(),
        })
      } catch (cause) {
        if (!(cause instanceof ApiRequestError) || cause.code !== 'API_TIMEOUT') throw cause
        onNotify('O retorno demorou para responder. Confirmando o estado sem repetir a gravação…')
        const state = await getOperatorActiveStop({ ativo_id: ativoId })
        if (state.parada_ativa) {
          throw new Error('A parada ainda aparece ativa. Atualize o equipamento antes de tentar novamente.')
        }
        result = {
          closed: true,
          already_closed: true,
          requires_justification: false,
          parada: context.parada_ativa,
        }
      }

      setReturnValidation(result)
      if (result.requires_justification) {
        onNotify('Justifique o intervalo antes do retorno')
        return
      }

      const nextContext: OperatorQrContextData = {
        ...context,
        ativo: context.ativo ? { ...context.ativo, status: 'OPERANDO' } : context.ativo,
        parada_ativa: null,
      }
      setContext(nextContext)
      setStopOpen(false)
      void writeQrContextCache(cacheKey, nextContext)
      setReturnValidation(null)
      setReturnCategory('')
      setReturnJustification('')
      onNotify('Parada finalizada. Equipamento em operação.')
      window.setTimeout(() => void refreshContextInBackground(cacheKey), 500)
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : 'Falha ao finalizar a parada')
    } finally {
      setSavingStop(false)
    }
  }

  function toggleHistoryDetails(historyId: string) {
    setExpandedHistoryIds((current) => {
      const next = new Set(current)
      if (next.has(historyId)) next.delete(historyId)
      else next.add(historyId)
      return next
    })
  }

  function toggleOccurrenceDetails(occurrenceId: string) {
    setExpandedOccurrenceIds((current) => {
      const next = new Set(current)
      if (next.has(occurrenceId)) next.delete(occurrenceId)
      else next.add(occurrenceId)
      return next
    })
  }

  function closeOccurrence() {
    setOccurrenceOpen(false)
    setOccurrenceTarget('')
    setOccurrenceComponentId('')
    setOccurrenceTitle('')
    setOccurrenceDescription('')
    setOccurrenceSeverity('MEDIA')
  }

  async function saveOccurrence() {
    if (!context?.ativo?.id) return
    if (!occurrenceTarget) return onNotify('Informe onde está o problema.')
    if (occurrenceTarget === 'COMPONENTE' && !occurrenceComponentId) return onNotify('Selecione o componente da ocorrência.')
    if (!occurrenceTitle.trim() || occurrenceDescription.trim().length < 5) return onNotify('Informe título e descrição da ocorrência.')

    setSavingOccurrence(true)
    try {
      const result = await registerOperatorOccurrence({
        ativo_id: context.ativo.id,
        componente_id: occurrenceTarget === 'COMPONENTE' ? occurrenceComponentId : '',
        alvo_ocorrencia: occurrenceTarget,
        titulo: occurrenceTitle.trim(),
        descricao: occurrenceDescription.trim(),
        severidade: occurrenceSeverity,
      })
      setContext((current) => current ? {
        ...current,
        ocorrencias_abertas: [result.occurrence, ...(current.ocorrencias_abertas ?? [])],
      } : current)
      closeOccurrence()
      onNotify('Ocorrência enviada para análise da gestão e administração.')
      window.setTimeout(() => void refreshContextInBackground(lastQuery || context.ativo?.tag || context.ativo?.id || ''), 500)
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : 'Falha ao registrar ocorrência')
    } finally {
      setSavingOccurrence(false)
    }
  }

  function reset() {
    lookupRequestRef.current += 1
    stopCamera()
    setContext(null)
    setHistoryItems([])
    setHistoryCursor('')
    setHistoryHasMore(false)
    setError('')
    setCameraError('')
    setManualOpen(false)
    setQuery('')
    setLastQuery('')
    setLoading(false)
    setParameterOpen(false)
    setParameterName('HORIMETRO')
    setParameterValue('')
    setComponentId('')
    setParameterError('')
    setParameterScope('EQUIPAMENTO')
    setVisibleParameterCount(PARAMETERS_PAGE_SIZE)
    setVisibleOccurrenceCount(OCCURRENCES_PAGE_SIZE)
    setExpandedOccurrenceIds(new Set())
    setExpandedHistoryIds(new Set())
    closeOccurrence()
    setCameraActive(true)
  }

  if (!context?.found) {
    return (
      <section className="screen qr-page-real">
        <header className="screen-heading">
          <span>Consulta técnica</span>
          <h1>Leitura por QR Code</h1>
          <p>A câmera inicia automaticamente. A digitação permanece disponível como alternativa.</p>
        </header>

        <article className="qr-reader-card qr-reader-card--scanner">
          <div className={cameraActive ? 'qr-camera qr-camera--active' : 'qr-camera qr-camera--idle'}>
            {cameraActive ? (
              <>
                <video ref={videoRef} muted playsInline aria-label="Câmera para leitura do QR Code" />
                <div className="qr-camera__frame" aria-hidden="true" />
                <span className="qr-camera__status">Procurando QR Code…</span>
                <button className="qr-camera__cancel" type="button" onClick={() => stopCamera()}>
                  Cancelar câmera
                </button>
              </>
            ) : (
              <span className="qr-reader-card__icon"><QrIcon /></span>
            )}
          </div>

          <div className="qr-reader-copy">
            <h2>{cameraActive ? 'Aponte para o código' : 'Câmera pausada'}</h2>
            <p>Mantenha o QR dentro da moldura. A consulta será aberta automaticamente após a leitura.</p>
          </div>

          {cameraActive ? (
            <button
              className="qr-manual-toggle"
              type="button"
              onClick={() => {
                stopCamera()
                setManualOpen(true)
              }}
            >
              Digitar código
            </button>
          ) : (
            <div className="qr-reader-actions">
              <button
                className="qr-camera-button"
                type="button"
                onClick={() => {
                  setCameraError('')
                  setManualOpen(false)
                  setCameraActive(true)
                }}
              >
                <ScanIcon /> Tentar câmera novamente
              </button>
              <button
                className="qr-manual-toggle"
                type="button"
                onClick={() => setManualOpen((value) => !value)}
              >
                {manualOpen ? 'Ocultar digitação' : 'Digitar código'}
              </button>
            </div>
          )}

          {cameraError && (
            <div className="inline-warning qr-camera-warning">
              <span>{cameraError}</span>
              <button
                type="button"
                onClick={() => {
                  setCameraError('')
                  setManualOpen(false)
                  setCameraActive(true)
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {manualOpen && (
            <form
              className="qr-manual-form qr-manual-form--open"
              onSubmit={(event) => {
                event.preventDefault()
                void lookup()
              }}
            >
              <label>
                <span>QR, TAG ou ID</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ex.: TMP-001"
                  autoCapitalize="characters"
                />
              </label>
              <button type="submit" disabled={loading}>
                {loading ? 'Consultando…' : 'Consultar'}
              </button>
            </form>
          )}
        </article>

        {error && (
          <article className="state-panel state-panel--error qr-error-panel">
            <h2>{error}</h2>
            <button type="button" onClick={() => void lookup(lastQuery || query)}>
              Tentar novamente
            </button>
          </article>
        )}
      </section>
    )
  }

  const asset = context.ativo
  const componentContext = context.componente
  const health = context.saude?.pct ?? asset?.saude_pct
  const occurrenceReady = Boolean(
    occurrenceTarget &&
    (occurrenceTarget !== 'COMPONENTE' || occurrenceComponentId) &&
    occurrenceTitle.trim() &&
    occurrenceDescription.trim().length >= 5,
  )

  return (
    <section className="screen qr-asset-page">
      {availableActions.length > 0 && (
        <section className="qr-action-section" aria-label="Ações disponíveis para o QR identificado">
          <div className="qr-action-section__heading">
            <div>
              <span>Ações disponíveis</span>
              <h2>
                {componentContext
                  ? `Manutenções deste componente`
                  : `Manutenções do equipamento e componentes`}
              </h2>
              <p>Deslize os cartões ou use as setas para escolher a atividade.</p>
            </div>
            <div className="qr-action-carousel-controls">
              <span>{availableActions.length}</span>
              {availableActions.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Ação anterior"
                    onClick={() => scrollActionCarousel('previous')}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="Próxima ação"
                    onClick={() => scrollActionCarousel('next')}
                  >
                    →
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="qr-action-carousel" ref={actionCarouselRef}>
            {availableActions.map((availableAction) => {
              const component = (context.componentes ?? []).find(
                (item) => item.id === availableAction.componente_id,
              )
              const isComponentAction = Boolean(availableAction.componente_id)
              const targetName = isComponentAction
                ? component?.nome ||
                  availableAction.componente_nome ||
                  availableAction.componente_id ||
                  'Componente'
                : asset?.nome || asset?.tag || 'Equipamento'
              const priority = availableAction.prioridade || 'NORMAL'

              return (
                <button
                  className="qr-action-slide"
                  type="button"
                  key={availableAction.id}
                  onClick={() => onOpenAction(availableAction.id)}
                >
                  <div className="qr-action-slide__badges">
                    <span
                      className={
                        isComponentAction
                          ? 'qr-action-target qr-action-target--component'
                          : 'qr-action-target qr-action-target--asset'
                      }
                    >
                      {isComponentAction ? 'COMPONENTE' : 'EQUIPAMENTO'}
                    </span>
                    <span className={`qr-action-priority qr-action-priority--${priority.toLowerCase()}`}>
                      {priority}
                    </span>
                  </div>

                  <strong>
                    {availableAction.titulo ||
                      availableAction.plano?.nome ||
                      'Ação de manutenção'}
                  </strong>
                  <p>{targetName}</p>

                  <div className="qr-action-slide__meta">
                    <span>{displayName(availableAction.tipo || 'MANUTENCAO')}</span>
                    <span>
                      {availableAction.plano?.tempo_estimado_min
                        ? `${availableAction.plano.tempo_estimado_min} min`
                        : 'Tempo não informado'}
                    </span>
                  </div>

                  <b>Abrir atividade →</b>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <article className="asset-hero asset-hero--real">
        <div className="asset-hero__status-line">
          <span className="status-chip status-chip--online">
            {componentContext ? 'Componente identificado' : 'Equipamento identificado'}
          </span>
          <button type="button" onClick={reset}>Ler outro</button>
        </div>
        <h1>{asset?.tag || asset?.id} — {asset?.nome || 'Equipamento'}</h1>
        <p>
          {componentContext
            ? `${componentContext.tag || componentContext.id} — ${componentContext.nome || 'Componente'}`
            : `${asset?.tipo || 'Ativo industrial'} · ${asset?.localizacao_tecnica || 'Localização não informada'}`}
        </p>
        <div className="asset-data-grid">
          <div><span>Status</span><strong>{context.parada_ativa ? 'PARADO' : (asset?.status || 'Não informado')}</strong></div>
          <div><span>Saúde</span><strong>{health !== undefined && health !== '' ? `${health}%` : 'Não informada'}</strong></div>
          <div><span>Criticidade</span><strong>{asset?.criticidade || 'Não informada'}</strong></div>
          <div><span>Horímetro total</span><strong>{asset?.horimetro_atual !== undefined && asset?.horimetro_atual !== '' ? `${asset.horimetro_atual} h` : 'Não informado'}</strong></div>
          <div><span>Desde último serviço</span><strong>{context.horimetro?.contador_servico_horas === null || context.horimetro?.contador_servico_horas === undefined ? 'Não iniciado' : `${context.horimetro.contador_servico_horas} h`}</strong></div>
          <div><span>Leitura</span><strong>{context.horimetro?.automatico ? 'Automática' : 'Manual'}</strong></div>
        </div>
      </article>

      {context.parada_ativa && <ActiveStopBanner stop={context.parada_ativa} />}

      {/* FAB_CONTROL_PARAMETERS_V2 */}
      <section className="content-section parameter-v2">
        <div className="parameter-v2__heading">
          <div>
            <h2>Parâmetros</h2>
            <p>Últimos valores registrados</p>
          </div>
          <button type="button" className="parameter-v2__new" onClick={openParameterModal}>
            Nova leitura
          </button>
        </div>

        {/* FAB_CONTROL_PARAMETER_COMPACT_BLOCK_1 */}
        <div className="parameter-v2__scope-row">
          <label className="parameter-v2__scope">
            <span>Exibindo</span>
            {scannedComponentId ? (
              <strong>
                {context.componente?.tag || context.componente?.nome || scannedComponentId}
              </strong>
            ) : (
              <select
                value={parameterScope}
                onChange={(event) => {
                  setParameterScope(event.target.value)
                  setVisibleParameterCount(PARAMETERS_PAGE_SIZE)
                }}
              >
                <option value="EQUIPAMENTO">Equipamento</option>
                {parameterComponents.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.tag || component.id} — {component.nome}
                  </option>
                ))}
              </select>
            )}
          </label>
          <span className="parameter-v2__scope-count">
            {filteredParameters.length}
          </span>
        </div>

        {filteredParameters.length > 0 ? (
          <>
            <div className="parameter-v2__grid">
              {visibleParameters.map((parameter) => {
                const linkedComponent = (context.componentes ?? []).find(
                  (component) => component.id === parameter.componente_id,
                )
                const isComponent = Boolean(parameter.componente_id)
                const targetLabel = isComponent
                  ? linkedComponent?.tag || linkedComponent?.nome || parameter.componente_id || 'Componente'
                  : 'Equipamento'

                return (
                  <article className="parameter-v2__card" key={parameter.id}>
                    <span className={isComponent ? 'parameter-v2__tag parameter-v2__tag--component' : 'parameter-v2__tag parameter-v2__tag--asset'}>
                      {isComponent ? 'COMP' : 'EQUIP'}
                    </span>
                    <strong className="parameter-v2__name">{displayName(parameter.parametro)}</strong>
                    <span className="parameter-v2__target" title={targetLabel}>{targetLabel}</span>
                    <div className="parameter-v2__value">
                      {parameter.valor ?? '—'} <small>{parameter.unidade || ''}</small>
                    </div>
                    <div className="parameter-v2__date" title="Último registro">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 9A8 8 0 0 1 19 7M18.5 15A8 8 0 0 1 5 17" />
                      </svg>
                      <span>{formatDate(parameter.registrado_em || parameter.criado_em)}</span>
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="parameter-v2__progress">
              <span>{visibleParameters.length} de {filteredParameters.length}</span>
              {filteredParameters.length > PARAMETERS_PAGE_SIZE && (
                <button
                  type="button"
                  aria-expanded={!hasMoreParameters}
                  onClick={() =>
                    setVisibleParameterCount((current) =>
                      hasMoreParameters
                        ? Math.min(current + PARAMETERS_PAGE_SIZE, filteredParameters.length)
                        : PARAMETERS_PAGE_SIZE,
                    )
                  }
                >
                  {hasMoreParameters ? 'Ver mais' : 'Ver menos'}
                </button>
              )}
            </div>
          </>
        ) : (
          <article className="empty-panel qr-empty-panel parameter-v2__empty">
            <strong>Nenhuma leitura neste contexto</strong>
            <p>
              {scannedComponentId
                ? 'Este componente ainda não possui parâmetros registrados.'
                : parameterScope === 'EQUIPAMENTO'
                  ? 'Selecione um componente ou registre uma leitura do equipamento.'
                  : 'Este componente ainda não possui parâmetros registrados.'}
            </p>
          </article>
        )}

        {parameterOpen && (
          <div className="parameter-v2__backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeParameterModal()
          }}>
            <form className="parameter-v2__modal" onSubmit={(event) => {
              event.preventDefault()
              void saveParameter()
            }}>
              <div className="parameter-v2__modal-header">
                <h2>Nova leitura</h2>
                <button type="button" onClick={closeParameterModal} aria-label="Fechar">×</button>
              </div>

              <fieldset className="parameter-v2__target-choice">
                <legend>Aplicar em</legend>
                <div>
                  <button type="button" className={parameterTarget === 'EQUIPAMENTO' ? 'is-selected' : ''} onClick={() => {
                    setParameterTarget('EQUIPAMENTO')
                    setComponentId('')
                  }}>Equipamento</button>
                  <button type="button" className={parameterTarget === 'COMPONENTE' ? 'is-selected' : ''} onClick={() => setParameterTarget('COMPONENTE')}>
                    Componente
                  </button>
                </div>
              </fieldset>

              {parameterTarget === 'COMPONENTE' && (
                <label className="parameter-v2__field">
                  <span>Componente</span>
                  <select value={componentId} onChange={(event) => setComponentId(event.target.value)}>
                    <option value="">Selecione</option>
                    {(context.componentes ?? []).map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.tag || component.id} — {component.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="parameter-v2__field">
                <span>Parâmetro</span>
                <select value={parameterName} onChange={(event) => {
                  setParameterName(event.target.value as ParameterCode)
                  setParameterValue('')
                }}>
                  {PARAMETER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {selectedLastParameter && (
                <div className="parameter-v2__last">
                  <div className="parameter-v2__last-meta" title="Último registro">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 9A8 8 0 0 1 19 7M18.5 15A8 8 0 0 1 5 17" />
                    </svg>
                    <span>{formatDate(selectedLastParameter.registrado_em || selectedLastParameter.criado_em)}</span>
                  </div>
                  <strong>{selectedLastParameter.valor ?? '—'} {selectedLastParameter.unidade || selectedParameter.unit}</strong>
                  {!automaticHourMeter && <button type="button" onClick={useLastParameterValue}>Usar último valor</button>}
                </div>
              )}

              <label className="parameter-v2__field">
                <span>Novo valor</span>
                <div className="parameter-v2__input-unit">
                  <input
                    inputMode="decimal"
                    value={automaticHourMeter ? String(context.horimetro?.total_horas ?? context.ativo?.horimetro_atual ?? '') : parameterValue}
                    readOnly={automaticHourMeter}
                    onChange={(event) => setParameterValue(event.target.value)}
                    placeholder="0,00"
                  />
                  <b>{selectedParameter.unit}</b>
                </div>
                {automaticHourMeter && <small>Atualizado pela telemetria.</small>}
                {parameterTarget === 'COMPONENTE' && selectedComponent && (
                  <small>Leitura vinculada a {selectedComponent.tag || selectedComponent.nome}.</small>
                )}
              </label>

              {parameterError && (
                <div className="parameter-v2__error" role="alert">
                  {parameterError}
                </div>
              )}

              <div className="parameter-v2__actions">
                <button type="button" onClick={closeParameterModal}>Cancelar</button>
                <button type="submit" disabled={savingParameter || automaticHourMeter || (parameterTarget === 'COMPONENTE' && !componentId)}>
                  {savingParameter ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      {/* FAB_CONTROL_OCCURRENCE_COMPACT_BLOCK_2 */}
      {openOccurrences.length > 0 && (
        <section className="content-section occurrence-compact">
          <div className="section-heading occurrence-compact__heading">
            <div>
              <h2>Ocorrências registradas</h2>
              <p>Acompanhe o tratamento sem precisar registrar novamente.</p>
            </div>
            <span>{openOccurrences.length}</span>
          </div>

          <div className="occurrence-compact__list">
            {visibleOccurrences.map((item) => {
              const expanded = expandedOccurrenceIds.has(item.id)
              const description = item.descricao || 'Sem descrição informada.'
              const canExpand = description.length > 64
              const visibleDescription =
                canExpand && !expanded
                  ? `${description.slice(0, 64).trimEnd()}…`
                  : description

              return (
                /* FAB_CONTROL_OCCURRENCE_DETAILS_FIX_V3 */
                <article className="occurrence-compact__card" key={item.id}>
                  <div className="occurrence-compact__top">
                    <strong>{item.titulo}</strong>
                    <div>
                      <span className="occurrence-compact__treatment">
                        {occurrenceTreatmentLabel(item.status, item.tratamento_status)}
                      </span>
                      <span className={`occurrence-compact__severity occurrence-compact__severity--${String(item.severidade || 'MEDIA').toLowerCase()}`}>
                        {displayName(item.severidade || 'MEDIA')}
                      </span>
                    </div>
                  </div>

                  <p className={expanded ? 'occurrence-compact__description is-expanded' : 'occurrence-compact__description'}>
                    {visibleDescription}
                  </p>

                  <div className="occurrence-compact__footer">
                    <small>
                      {item.tipo === 'COMPONENTE' ? 'Componente' : 'Equipamento'}
                      {' · '}
                      {formatDate(item.criado_em)}
                    </small>
                    {canExpand && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleOccurrenceDetails(item.id)}
                      >
                        {expanded ? 'Resumir' : 'Ver detalhes'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          <div className="occurrence-compact__progress">
            <span>{visibleOccurrences.length} de {openOccurrences.length}</span>
            {openOccurrences.length > OCCURRENCES_PAGE_SIZE && (
              <button
                type="button"
                aria-expanded={!hasMoreOccurrences}
                onClick={() =>
                  setVisibleOccurrenceCount((current) =>
                    hasMoreOccurrences
                      ? Math.min(current + OCCURRENCES_PAGE_SIZE, openOccurrences.length)
                      : OCCURRENCES_PAGE_SIZE,
                  )
                }
              >
                {hasMoreOccurrences ? 'Ver mais' : 'Ver menos'}
              </button>
            )}
          </div>
        </section>
      )}

      {/* FAB_CONTROL_HISTORY_COMPACT_BLOCK_3 */}
      <section className="content-section history-compact">
        <div className="section-heading history-compact__heading">
          <div>
            <h2>Histórico do equipamento</h2>
            <p>Eventos técnicos mais recentes.</p>
          </div>
          <span>{historyItems.length}</span>
        </div>

        {historyItems.length > 0 ? (
          <div className="history-compact__list">
            {historyItems.map((item) => {
              const expanded = expandedHistoryIds.has(item.id)
              const description = item.descricao || 'Sem descrição.'
              const canExpand = description.length > 68
              const visibleDescription =
                canExpand && !expanded
                  ? `${description.slice(0, 68).trimEnd()}…`
                  : description

              return (
                <article className="history-compact__card" key={item.id}>
                  <div className="history-compact__top">
                    <strong>{displayName(item.evento || 'Evento técnico')}</strong>
                    <span className="history-compact__profile">
                      {displayName(item.perfil || 'SISTEMA')}
                    </span>
                  </div>

                  <p className={expanded ? 'history-compact__description is-expanded' : 'history-compact__description'}>
                    {visibleDescription}
                  </p>

                  <div className="history-compact__footer">
                    <small>{formatDate(item.criado_em)}</small>
                    {canExpand && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleHistoryDetails(item.id)}
                      >
                        {expanded ? 'Resumir' : 'Detalhes'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <article className="empty-panel qr-empty-panel history-compact__empty">
            <strong>Sem eventos registrados</strong>
            <p>O histórico aparecerá conforme o equipamento for utilizado.</p>
          </article>
        )}

        {historyHasMore && (
          <button
            type="button"
            className="history-compact__load-more"
            disabled={historyLoading}
            onClick={() => void loadMoreHistory()}
          >
            {historyLoading ? 'Carregando eventos…' : 'Carregar mais eventos'}
          </button>
        )}
      </section>

      {/* FAB_CONTROL_QR_FINAL_REFINEMENT_BLOCK_4 */}
      <div className="qr-next-actions qr-final-actions" aria-label="Ações operacionais">
        <button
          type="button"
          className="secondary-action qr-final-action qr-final-action--occurrence"
          onClick={() => {
            closeOccurrence()
            setOccurrenceOpen(true)
          }}
        >
          <span className="qr-final-action__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.8 2.4 17.5A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.5L13.7 3.8a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <span className="qr-final-action__copy">
            <strong>Registrar ocorrência</strong>
            <small>Informar uma condição</small>
          </span>
        </button>

        <button
          type="button"
          className={
            context.parada_ativa
              ? 'danger-action danger-action--finish qr-final-action qr-final-action--stop qr-final-action--return'
              : 'danger-action qr-final-action qr-final-action--stop'
          }
          onClick={() => {
            setReturnValidation(null)
            setStopReason('')
            setStopReasonDetails('')
            setStopOpen(true)
          }}
        >
          <span className="qr-final-action__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {context.parada_ativa ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
              ) : (
                <rect x="6" y="6" width="12" height="12" rx="2" />
              )}
            </svg>
          </span>
          <span className="qr-final-action__copy">
            <strong>{context.parada_ativa ? 'Finalizar parada' : 'Iniciar parada'}</strong>
            <small>{context.parada_ativa ? 'Retomar operação' : 'Parar equipamento'}</small>
          </span>
        </button>
      </div>

      {occurrenceOpen && (
        <div className="evidence-modal-backdrop">
          <form className="evidence-modal operational-modal occurrence-modal" onSubmit={(event) => { event.preventDefault(); void saveOccurrence() }}>
            <div><span>Ocorrência operacional</span><h2>Onde está o problema?</h2><p>Defina primeiro se a condição é geral ou está em um componente.</p></div>

            <div className="occurrence-target-grid" role="radiogroup" aria-label="Local da ocorrência">
              <button type="button" className={occurrenceTarget === 'EQUIPAMENTO' ? 'occurrence-target occurrence-target--selected' : 'occurrence-target'} onClick={() => { setOccurrenceTarget('EQUIPAMENTO'); setOccurrenceComponentId('') }}>
                <strong>Equipamento em geral</strong><span>Falha ou condição que afeta a máquina como um todo.</span>
              </button>
              <button type="button" className={occurrenceTarget === 'COMPONENTE' ? 'occurrence-target occurrence-target--selected' : 'occurrence-target'} onClick={() => { setOccurrenceTarget('COMPONENTE'); setOccurrenceComponentId(context.componente?.id ?? '') }}>
                <strong>Componente</strong><span>Problema localizado em uma peça ou conjunto cadastrado.</span>
              </button>
            </div>

            {occurrenceTarget === 'COMPONENTE' && (
              <label><span>Componente afetado</span><select value={occurrenceComponentId} onChange={(event) => setOccurrenceComponentId(event.target.value)}><option value="">Selecione o componente</option>{(context.componentes ?? []).map((component) => <option key={component.id} value={component.id}>{component.tag || component.id} — {component.nome}</option>)}</select></label>
            )}

            {occurrenceTarget && (
              <div className="occurrence-details-fields">
                <label><span>Título da ocorrência</span><input value={occurrenceTitle} onChange={(event) => setOccurrenceTitle(event.target.value)} placeholder="Resuma o problema" /></label>
                <label><span>Descrição</span><textarea value={occurrenceDescription} onChange={(event) => setOccurrenceDescription(event.target.value)} placeholder="Descreva os sinais, ruídos ou condições observadas" /></label>
                <label><span>Severidade</span><select value={occurrenceSeverity} onChange={(event) => setOccurrenceSeverity(event.target.value)}><option value="BAIXA">Baixa</option><option value="MEDIA">Média</option><option value="ALTA">Alta</option><option value="CRITICA">Crítica</option></select></label>
              </div>
            )}

            <div className="evidence-modal__actions"><button type="button" className="secondary-button" onClick={closeOccurrence}>Cancelar</button><button type="submit" disabled={savingOccurrence || !occurrenceReady}>{savingOccurrence ? 'Enviando…' : 'Registrar ocorrência'}</button></div>
          </form>
        </div>
      )}

      {stopOpen && (
        <div className="evidence-modal-backdrop">
          <form className="evidence-modal operational-modal" onSubmit={(event) => { event.preventDefault(); if (context.parada_ativa) void finishStop(); else void startStop() }}>
            <div><span>Parada do equipamento</span><h2>{context.parada_ativa ? 'Confirmar retorno à operação' : 'Parar equipamento agora'}</h2><p>{context.parada_ativa ? 'A produção voltará a considerar o equipamento disponível.' : 'A gestão e a administração poderão acompanhar esta parada e suas ocorrências.'}</p></div>
            {!context.parada_ativa ? (
              <>
                <label>
                  <span>Motivo da parada</span>
                  <select
                    value={stopReason}
                    onChange={(event) => {
                      const value = event.target.value as StopReasonCode
                      setStopReason(value)
                      if (value !== 'OUTRO') setStopReasonDetails('')
                    }}
                  >
                    <option value="">Selecione o motivo</option>
                    {STOP_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {stopReason === 'OUTRO' && (
                  <label>
                    <span>Descreva o motivo</span>
                    <textarea
                      value={stopReasonDetails}
                      onChange={(event) => setStopReasonDetails(event.target.value)}
                      placeholder="Informe o motivo observado"
                    />
                    <small>Mínimo de 5 caracteres.</small>
                  </label>
                )}
              </>
            ) : (
              <>
                <ActiveStopBanner stop={context.parada_ativa} compact />
                {returnValidation?.requires_justification && (
                  <>
                    <label><span>Motivo do intervalo</span><select value={returnCategory} onChange={(event) => setReturnCategory(event.target.value)}><option value="">Selecione</option>{(returnValidation.categories ?? []).map((category) => <option key={category} value={category}>{displayName(category)}</option>)}</select></label>
                    <label><span>Justificativa</span><textarea value={returnJustification} onChange={(event) => setReturnJustification(event.target.value)} /></label>
                  </>
                )}
              </>
            )}
            <div className="evidence-modal__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setStopOpen(false)
                  setStopReason('')
                  setStopReasonDetails('')
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={context.parada_ativa ? 'primary-button' : 'primary-button danger-confirm-button'}
                disabled={
                  savingStop ||
                  (!context.parada_ativa && (
                    !stopReason ||
                    (stopReason === 'OUTRO' && stopReasonDetails.trim().length < 5)
                  ))
                }
              >
                {savingStop ? 'Processando…' : context.parada_ativa ? 'Confirmar retorno' : 'Parar equipamento'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
