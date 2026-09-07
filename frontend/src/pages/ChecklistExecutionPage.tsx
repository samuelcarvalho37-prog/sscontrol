import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChecklistBatchItemInput,
  EvidencePhotoUploadInput,
  EvidenceSaveData,
  OperatorActionDetailData,
  OperatorFinalOutcome,
  OperatorStopData,
  RawChecklistItem,
} from '../types/api'
import { ActiveStopBanner } from '../components/ActiveStopBanner'
import { EvidenceFileLink } from '../components/EvidenceFileLink'
import { prepareEvidencePhoto } from '../services/media/imageEvidence'

interface ChecklistExecutionPageProps {
  detail: OperatorActionDetailData
  evidenceSaving: boolean
  finalizing: boolean
  error: string
  activeStop: OperatorStopData | null
  onBack: () => void
  onRefresh: () => Promise<void>
  onSaveProgress: (items: ChecklistBatchItemInput[]) => Promise<void>
  onRegisterEvidence: (inputs: EvidencePhotoUploadInput[]) => Promise<EvidenceSaveData[]>
  onFinish: (
    items: ChecklistBatchItemInput[],
    resultado: 'OK' | 'NOK',
    observacao: string,
    resultadoOperacional: OperatorFinalOutcome,
    durationSeconds: number,
  ) => Promise<void>
  onReturnHome: () => void
}

type DraftAnswer = {
  answer: string
  observation: string
}

type SelectedEvidence = { file: File; previewUrl: string }

type CompletionPhase = 'idle' | 'syncing' | 'success'

type CompletionSummary = {
  durationSeconds: number
  comparison: string
  checklistTotal: number
  evidenceCount: number
  outcomeLabel: string
  qualityScore: number
}

type FinalOutcome = '' | OperatorFinalOutcome

const FINAL_OUTCOME_OPTIONS: Array<{
  value: Exclude<FinalOutcome, ''>
  label: string
}> = [
  { value: 'CONFORME', label: 'Executado conforme o checklist' },
  { value: 'DIFERENCAS_JUSTIFICADAS', label: 'Executado com diferenças justificadas' },
  { value: 'PARCIAL', label: 'Executado parcialmente' },
  { value: 'NAO_EXECUTADO', label: 'Não foi possível executar' },
  { value: 'OUTRO', label: 'Outro' },
]

function typeOf(item: RawChecklistItem): string {
  return String(
    item.input?.tipo_resposta || item.tipo_resposta || 'TEXTO',
  ).toUpperCase()
}

function optionsOf(item: RawChecklistItem): string[] {
  const options = item.input?.opcoes?.length ? item.input.opcoes : item.opcoes
  if (Array.isArray(options) && options.length) {
    return options
      .map((option) => String(option ?? '').trim())
      .filter(Boolean)
  }
  if (typeOf(item) === 'OK_NOK') return ['OK', 'NOK', 'N/A']
  if (typeOf(item) === 'CONFIRMACAO') return ['SIM']
  return []
}


function evidenceMinimum(item: RawChecklistItem): number {
  const configured = Number(item.evidencia_min_fotos ?? 0)
  if (Number.isFinite(configured) && configured > 0) return Math.min(10, Math.floor(configured))
  return typeOf(item) === 'EVIDENCIA' || item.evidencia_obrigatoria ? 1 : 0
}

function normalizeTechnicalText(value?: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function isHourMeterItem(item: RawChecklistItem): boolean {
  return normalizeTechnicalText(item.parametro_nome) === 'HORIMETRO' ||
    normalizeTechnicalText(item.titulo).includes('HORIMETRO')
}

function isRedundantFinalObservation(item: RawChecklistItem): boolean {
  return (
    item.obrigatorio === false &&
    normalizeTechnicalText(item.titulo) === 'OBSERVACAO COMPLEMENTAR'
  )
}

function existingAnswer(item: RawChecklistItem): string {
  const type = typeOf(item)
  if (['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].includes(type)) {
    const raw = item.valor_numero ?? item.resposta ?? ''
    return raw === null || raw === undefined ? '' : String(raw)
  }
  return String(item.resposta ?? '')
}

function answered(item: RawChecklistItem, draft: DraftAnswer): boolean {
  if (typeOf(item) === 'INSTRUCAO') return Boolean(draft.answer || item.respondido)
  if (typeOf(item) === 'EVIDENCIA') return (item.evidencias_count ?? 0) >= evidenceMinimum(item)
  return draft.answer.trim().length > 0
}

function required(item: RawChecklistItem): boolean {
  return item.obrigatorio !== false && typeOf(item) !== 'INSTRUCAO'
}

function normalizedChecklistAnswer(value: string): string {
  return normalizeTechnicalText(value).replace(/[^A-Z0-9]/g, '')
}

function justificationRequired(item: RawChecklistItem, draft: DraftAnswer): boolean {
  if (typeOf(item) !== 'OK_NOK') return false
  const answer = normalizedChecklistAnswer(draft.answer)
  return answer === 'NOK' || answer === 'NA' || answer === 'NAOAPLICAVEL'
}

type EvidenceMode = 'required' | 'optional' | 'none'

function evidenceMode(item: RawChecklistItem): EvidenceMode {
  if (evidenceMinimum(item) > 0) return 'required'
  if (item.input?.suporta_evidencia) return 'optional'
  return 'none'
}

function evidenceMaximum(item: RawChecklistItem): number {
  const minimum = evidenceMinimum(item)
  return minimum > 0 ? minimum : 3
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function comparisonLabel(elapsedSeconds: number, plannedMinutes?: number): string {
  const plannedSeconds = Math.max(0, Number(plannedMinutes || 0) * 60)
  if (!plannedSeconds) return 'Tempo registrado'
  const difference = Math.floor(elapsedSeconds - plannedSeconds)
  if (difference <= 0) return 'Dentro do tempo previsto'
  return `${formatElapsed(difference)} acima do previsto`
}

export function ChecklistExecutionPage({
  detail,
  evidenceSaving,
  finalizing,
  error,
  activeStop,
  onBack,
  onRefresh,
  onSaveProgress,
  onRegisterEvidence,
  onFinish,
  onReturnHome,
}: ChecklistExecutionPageProps) {
  const items = useMemo(
    () =>
      [...(detail.checklist?.itens ?? [])]
        .filter((item) => !isRedundantFinalObservation(item))
        .sort((a, b) => a.ordem - b.ordem),
    [detail.checklist?.itens],
  )
  const checklistPositionKey = `fab-control:checklist-position:${detail.execucao?.id || detail.acao.id}`
  const [index, setIndex] = useState(() => {
    try {
      const savedIndex = Number(window.localStorage.getItem(checklistPositionKey))
      return Number.isInteger(savedIndex) && savedIndex >= 0
        ? Math.min(savedIndex, Math.max(0, items.length - 1))
        : 0
    } catch {
      return 0
    }
  })
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({})
  const [message, setMessage] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [selectedEvidence, setSelectedEvidence] = useState<SelectedEvidence[]>([])
  const [evidenceObservation, setEvidenceObservation] = useState('')
  const [evidenceSelectionWarning, setEvidenceSelectionWarning] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>('idle')
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null)
  const [finalizationOpen, setFinalizationOpen] = useState(false)
  const [finalOutcome, setFinalOutcome] = useState<FinalOutcome>('')
  const [finalObservation, setFinalObservation] = useState('')
  const [finalizationError, setFinalizationError] = useState('')
  const initializedDraftKeyRef = useRef('')
  const selectedEvidenceRef = useRef<SelectedEvidence[]>([])
  const draftStorageKey = `fab-control:checklist-draft:${detail.execucao?.id || detail.acao.id}`

  useEffect(() => {
    const serverDrafts: Record<string, DraftAnswer> = {}
    for (const item of items) {
      const serverAnswer = existingAnswer(item)
      const automaticHourMeterValue =
        isHourMeterItem(item) && detail.horimetro?.automatico
          ? String(detail.horimetro.total_horas ?? detail.ativo?.horimetro_atual ?? '')
          : ''
      serverDrafts[item.id] = {
        answer: serverAnswer || automaticHourMeterValue,
        observation: String(item.observacao ?? ''),
      }
    }

    if (initializedDraftKeyRef.current !== draftStorageKey) {
      let cached: Record<string, DraftAnswer> = {}
      try {
        const stored = window.localStorage.getItem(draftStorageKey)
        cached = stored ? JSON.parse(stored) as Record<string, DraftAnswer> : {}
      } catch {
        cached = {}
      }

      setDrafts({ ...serverDrafts, ...cached })
      initializedDraftKeyRef.current = draftStorageKey
      setIndex((current) => Math.min(current, Math.max(0, items.length - 1)))
      return
    }

    // Atualizações do back-end, como evidências, não podem apagar respostas locais.
    setDrafts((currentDrafts) => {
      const next = { ...currentDrafts }
      for (const item of items) {
        const server = serverDrafts[item.id]
        const local = next[item.id]
        if (!local) {
          next[item.id] = server
          continue
        }
        next[item.id] = {
          answer: local.answer || server.answer,
          observation: local.observation || server.observation,
        }
      }
      return next
    })
  }, [draftStorageKey, items])

  useEffect(() => {
    if (initializedDraftKeyRef.current !== draftStorageKey) return
    if (!Object.keys(drafts).length) return
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(drafts))
    } catch {
      // Armazenamento local indisponível: a execução continua usando memória.
    }
  }, [draftStorageKey, drafts])

  useEffect(() => {
    if (!items.length) return
    try {
      window.localStorage.setItem(checklistPositionKey, String(index))
    } catch {
      // A posição é auxiliar; o checklist continua normalmente.
    }
  }, [checklistPositionKey, index, items.length])

  useEffect(() => {
    selectedEvidenceRef.current = selectedEvidence
  }, [selectedEvidence])

  useEffect(() => () => {
    selectedEvidenceRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
  }, [])

  useEffect(() => {
    const startValue =
      detail.execucao?.iniciou_em ||
      detail.acao.iniciado_em ||
      detail.execucao?.abriu_em
    const start = startValue ? new Date(startValue).getTime() : Date.now()
    const tick = () => setElapsed(Math.max(0, (Date.now() - start) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [detail.acao.iniciado_em, detail.execucao?.abriu_em, detail.execucao?.iniciou_em])

  useEffect(() => {
    if (completionPhase !== 'success') return
    const timer = window.setTimeout(onReturnHome, 2000)
    return () => window.clearTimeout(timer)
  }, [completionPhase, onReturnHome])

  const current = items[index]
  const currentDraft = current
    ? drafts[current.id] ?? { answer: '', observation: '' }
    : null
  const answeredCount = items.filter((item) =>
    answered(item, drafts[item.id] ?? { answer: '', observation: '' }),
  ).length
  const percentage = items.length
    ? Math.round((answeredCount / items.length) * 100)
    : 0
  const isLast = index === items.length - 1
  const currentAnswered = current && currentDraft
    ? answered(current, currentDraft)
    : false

  function updateDraft(patch: Partial<DraftAnswer>) {
    if (!current) return
    setDrafts((value) => ({
      ...value,
      [current.id]: {
        ...(value[current.id] ?? { answer: '', observation: '' }),
        ...patch,
      },
    }))
    setMessage('')
  }

  function goNext() {
    if (!current || !currentDraft) return
    if (required(current) && !currentAnswered) {
      setMessage('Responda este item antes de continuar.')
      return
    }
    if (isHourMeterItem(current)) {
      const reading = Number(currentDraft.answer.replace(',', '.'))
      const currentTotal = Number(detail.horimetro?.total_horas ?? detail.ativo?.horimetro_atual ?? 0)
      if (!Number.isFinite(reading) || reading < currentTotal) {
        setMessage(`O horímetro total não pode ser menor que ${currentTotal} h.`)
        return
      }
    }
    if (
      justificationRequired(current, currentDraft) &&
      currentDraft.observation.trim().length < 5
    ) {
      setMessage('Resposta NOK ou N/A exige justificativa técnica com pelo menos 5 caracteres.')
      return
    }
    setMessage('')
    setIndex((value) => Math.min(items.length - 1, value + 1))
  }

  function buildPayload(): ChecklistBatchItemInput[] {
    const payload: ChecklistBatchItemInput[] = []

    for (const item of items) {
      const draft = drafts[item.id] ?? { answer: '', observation: '' }
      const type = typeOf(item)
      if (type === 'EVIDENCIA') continue
      if (!draft.answer.trim() && !required(item)) continue
      if (!draft.answer.trim()) continue

      const base = {
        id: item.id,
        checklist_execucao_id: item.id,
        ordem: item.ordem,
        observacao: draft.observation.trim(),
      }

      if (['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].includes(type)) {
        payload.push({ ...base, valor: Number(draft.answer.replace(',', '.')) })
      } else {
        payload.push({ ...base, resposta: draft.answer })
      }
    }

    return payload
  }

  function missingRequiredItems(): RawChecklistItem[] {
    return items.filter(
      (item) =>
        required(item) &&
        !answered(item, drafts[item.id] ?? { answer: '', observation: '' }),
    )
  }

  function missingRequiredEvidence(): RawChecklistItem[] {
    return items.filter(
      (item) => evidenceMinimum(item) > (item.evidencias_count ?? 0),
    )
  }

  function nonConformityCount(): number {
    return items.filter((item) => {
      const draft = drafts[item.id] ?? { answer: '', observation: '' }
      return typeOf(item) === 'OK_NOK' && normalizedChecklistAnswer(draft.answer) === 'NOK'
    }).length
  }

  function notApplicableCount(): number {
    return items.filter((item) => {
      const draft = drafts[item.id] ?? { answer: '', observation: '' }
      const answer = normalizedChecklistAnswer(draft.answer)
      return typeOf(item) === 'OK_NOK' && (answer === 'NA' || answer === 'NAOAPLICAVEL')
    }).length
  }

  function finalOutcomeLabel(outcome: FinalOutcome): string {
    return FINAL_OUTCOME_OPTIONS.find((option) => option.value === outcome)?.label ?? ''
  }

  function finalOutcomeRequiresObservation(outcome: FinalOutcome): boolean {
    return outcome === 'PARCIAL' || outcome === 'NAO_EXECUTADO' || outcome === 'OUTRO'
  }

  function calculateQualityScore(outcome: FinalOutcome): number {
    let score = 5
    if (missingRequiredItems().length > 0) score -= 2
    if (missingRequiredEvidence().length > 0) score -= 1
    if (nonConformityCount() > 0) score -= 1

    if (outcome === 'PARCIAL') score = Math.min(score, 3)
    if (outcome === 'NAO_EXECUTADO') score = 1
    if (outcome === 'OUTRO') score = Math.min(score, 3)

    return Math.max(1, Math.min(5, score))
  }

  function validateAnsweredTechnicalItems(): boolean {
    const invalidHourMeter = items.find((item) => {
      if (!isHourMeterItem(item)) return false
      const draft = drafts[item.id] ?? { answer: '', observation: '' }
      if (!draft.answer.trim()) return false
      const reading = Number(draft.answer.replace(',', '.'))
      const currentTotal = Number(detail.horimetro?.total_horas ?? detail.ativo?.horimetro_atual ?? 0)
      return !Number.isFinite(reading) || reading < currentTotal
    })
    if (invalidHourMeter) {
      setFinalizationOpen(false)
      setIndex(items.findIndex((item) => item.id === invalidHourMeter.id))
      setMessage('O horímetro total não pode diminuir.')
      return false
    }

    const invalidJustification = items.find((item) => {
      const draft = drafts[item.id] ?? { answer: '', observation: '' }
      return justificationRequired(item, draft) && draft.observation.trim().length < 5
    })
    if (invalidJustification) {
      setFinalizationOpen(false)
      setIndex(items.findIndex((item) => item.id === invalidJustification.id))
      setMessage('Resposta NOK ou N/A exige justificativa técnica com pelo menos 5 caracteres.')
      return false
    }

    return true
  }

  function openFinalizationReview() {
    if (!validateAnsweredTechnicalItems()) return
    setMessage('')
    setFinalizationError('')
    setFinalizationOpen(true)
  }

  function resolveExecutionResult(
    outcome: Exclude<FinalOutcome, ''>,
    qualityScore: number,
  ): {
    resultado: 'OK' | 'NOK'
    observacao: string
  } {
    const observations = items
      .map((item) => {
        const draft = drafts[item.id] ?? { answer: '', observation: '' }
        return draft.observation.trim()
      })
      .filter(Boolean)

    const parts = [
      `Resultado operacional: ${finalOutcomeLabel(outcome)}.`,
      `Qualidade automática da execução: ${qualityScore}/5.`,
    ]

    if (finalObservation.trim()) {
      parts.push(`Observação final: ${finalObservation.trim()}`)
    }
    if (observations.length) {
      parts.push(`Justificativas do checklist: ${observations.join(' | ')}`)
    }

    return {
      resultado: outcome === 'CONFORME' ? 'OK' : 'NOK',
      observacao: parts.join(' '),
    }
  }

  async function confirmFinalization() {
    if (!finalOutcome) {
      setFinalizationError('Selecione o resultado da execução.')
      return
    }
    if (!validateAnsweredTechnicalItems()) return

    const missing = missingRequiredItems()
    const evidenceMissing = missingRequiredEvidence()
    const nokCount = nonConformityCount()

    if (finalOutcome === 'CONFORME') {
      if (missing.length || evidenceMissing.length || nokCount) {
        setFinalizationError(
          'O resultado conforme exige checklist completo, evidências obrigatórias atendidas e nenhuma resposta NOK.',
        )
        return
      }
    }

    if (finalOutcome === 'DIFERENCAS_JUSTIFICADAS' && (missing.length || evidenceMissing.length)) {
      setFinalizationError(
        'Diferenças justificadas exigem todos os itens obrigatórios e evidências obrigatórias concluídos.',
      )
      return
    }

    if (
      finalOutcomeRequiresObservation(finalOutcome) &&
      finalObservation.trim().length < 5
    ) {
      setFinalizationError('Este resultado exige uma observação final com pelo menos 5 caracteres.')
      return
    }

    const durationSeconds = Math.floor(elapsed)
    const evidenceCount = items.reduce(
      (sum, item) => sum + (item.evidencias_count ?? 0),
      0,
    )
    const qualityScore = calculateQualityScore(finalOutcome)
    const result = resolveExecutionResult(finalOutcome, qualityScore)

    setFinalizationError('')
    setFinalizationOpen(false)
    setMessage('')
    setCompletionSummary({
      durationSeconds,
      comparison: comparisonLabel(
        durationSeconds,
        detail.plano?.tempo_estimado_min,
      ),
      checklistTotal: items.length,
      evidenceCount,
      outcomeLabel: finalOutcomeLabel(finalOutcome),
      qualityScore,
    })
    setCompletionPhase('syncing')

    try {
      await onFinish(
        buildPayload(),
        result.resultado,
        result.observacao,
        finalOutcome,
        durationSeconds,
      )
      try {
        window.sessionStorage.removeItem(draftStorageKey)
        window.localStorage.removeItem(checklistPositionKey)
      } catch {
        // Sem impacto na conclusão.
      }
      setCompletionPhase('success')
    } catch (cause) {
      const failureMessage =
        cause instanceof Error
          ? cause.message
          : 'Não foi possível finalizar a execução.'
      setCompletionPhase('idle')
      setFinalizationOpen(true)
      setFinalizationError(failureMessage)
      setMessage(failureMessage)
    }
  }

  async function submitEvidence() {
    if (!current) return
    if (!selectedEvidence.length) {
      setMessage('Tire ou selecione pelo menos uma foto.')
      return
    }

    const currentCount = current.evidencias_count ?? 0
    const configuredQuantity = evidenceMinimum(current)
    const maximumQuantity = evidenceMaximum(current)
    const remainingQuantity = Math.max(0, maximumQuantity - currentCount)

    if (remainingQuantity <= 0) {
      setMessage(
        configuredQuantity > 0
          ? 'A quantidade de fotos configurada para este item já foi atendida.'
          : 'O limite de evidências opcionais deste item já foi atendido.',
      )
      return
    }

    if (selectedEvidence.length > remainingQuantity) {
      setMessage(
        `Este item aceita somente mais ${remainingQuantity} foto(s). Remova o excesso antes de enviar.`,
      )
      return
    }

    const progressPayload = buildPayload()
    const preparePromise = Promise.all(
      selectedEvidence.map((selected) =>
        prepareEvidencePhoto(
          selected.file,
          current.id,
          evidenceObservation.trim(),
        ),
      ),
    )
    const savePromise = progressPayload.length
      ? onSaveProgress(progressPayload)
      : Promise.resolve()

    const [prepared] = await Promise.all([preparePromise, savePromise])
    const saved = await onRegisterEvidence(prepared)
    selectedEvidence.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    setSelectedEvidence([])
    setEvidenceSelectionWarning('')
    setShowEvidence(false)
    setEvidenceObservation('')
    const confirmedCounts = saved
      .map((item) => Number(item.evidencias_count ?? item.fotos_registradas ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0)
    const total = confirmedCounts.length
      ? Math.max(...confirmedCounts)
      : currentCount + prepared.length
    setMessage(
      configuredQuantity <= 0
        ? `Evidência opcional registrada. Total neste item: ${total}.`
        : total >= configuredQuantity
          ? 'Quantidade de evidências configurada foi atendida.'
          : `Evidências registradas: ${total} de ${configuredQuantity}.`,
    )
  }

  if (!items.length || !current || !currentDraft) {
    return (
      <section className="screen">
        <article className="state-panel state-panel--error">
          <span className="state-panel__kicker">Checklist indisponível</span>
          <h1>Nenhum item foi retornado</h1>
          <p>A execução precisa possuir um checklist gerado pelo back-end.</p>
          <div className="detail-error-actions">
            <button type="button" className="secondary-button" onClick={onBack}>
              Voltar
            </button>
            <button type="button" onClick={() => void onRefresh()}>
              Atualizar
            </button>
          </div>
        </article>
      </section>
    )
  }

  const currentType = typeOf(current)
  const options = optionsOf(current)
  const choice = ['OK_NOK', 'CONFIRMACAO', 'SELECAO'].includes(currentType)
  const numeric = ['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].includes(currentType)
  const evidenceOnly = currentType === 'EVIDENCIA'
  const instruction = currentType === 'INSTRUCAO'
  const min = current.input?.limite_min ?? current.limite_min
  const max = current.input?.limite_max ?? current.limite_max
  const unit = current.input?.unidade ?? current.unidade ?? ''
  const hourMeter = isHourMeterItem(current)
  const currentHourMeter = Number(detail.horimetro?.total_horas ?? detail.ativo?.horimetro_atual ?? 0)
  const serviceHours = detail.horimetro?.contador_servico_horas
  const currentEvidenceMode = evidenceMode(current)
  const evidenceEnabled = currentEvidenceMode !== 'none'
  const evidenceMin = evidenceMinimum(current)
  const evidenceMax = evidenceMaximum(current)
  const evidenceCount = current.evidencias_count ?? 0
  const evidenceRemaining = Math.max(0, evidenceMax - evidenceCount)
  const currentJustificationRequired = justificationRequired(current, currentDraft)
  const currentItemTitleId = `checklist-item-title-${String(current.id || index + 1)}`

  return (
    <section className="screen checklist-screen">
      {activeStop && <ActiveStopBanner stop={activeStop} compact />}

      <article
        className={
          detail.execucao?.modo_execucao_manutencao === 'SEM_PARADA'
            ? 'maintenance-mode-banner maintenance-mode-banner--running'
            : 'maintenance-mode-banner maintenance-mode-banner--stopped'
        }
      >
        <span>Condição da manutenção</span>
        <strong>
          {detail.execucao?.modo_execucao_manutencao === 'SEM_PARADA'
            ? 'Execução sem parada do equipamento'
            : 'Parada do equipamento vinculada à execução'}
        </strong>
        <small>
          {activeStop
            ? 'A produção já registrou a parada operacional; a manutenção foi vinculada sem duplicar o evento.'
            : detail.execucao?.modo_execucao_manutencao === 'SEM_PARADA'
              ? 'A máquina permanece em operação durante o serviço.'
              : 'Esta parada termina junto com a execução técnica.'}
        </small>
      </article>

      <article className="execution-header-card">
        <div>
          <span>Execução em andamento</span>
          <h1>{detail.acao.titulo || detail.os?.titulo}</h1>
          <p>
            {detail.componente?.tag || detail.componente?.id} —{' '}
            {detail.componente?.nome}
          </p>
        </div>
        <div className="execution-time">
          <span>Tempo de execução</span>
          <strong>{formatElapsed(elapsed)}</strong>
        </div>
        <div className="execution-progress">
          <span style={{ width: `${percentage}%` }} />
        </div>
        <small>
          Item {index + 1} de {items.length} · {answeredCount}/{items.length}{' '}
          concluídos
        </small>
      </article>

      {(message || error) && (
        <div className="checklist-alert">{error || message}</div>
      )}

      <article className="checklist-item-card" aria-labelledby={currentItemTitleId}>
        <div className="checklist-item-card__top">
          <span>Checklist dinâmico</span>
          <em>{current.obrigatorio === false ? 'Opcional' : 'Obrigatório'}</em>
        </div>
        <h2 id={currentItemTitleId}>{current.titulo}</h2>
        <p>{current.instrucao || 'Registre a condição observada.'}</p>

        {numeric && (
          <div className="numeric-answer">
            <input
              type="number"
              inputMode="decimal"
              step={hourMeter ? '0.1' : 'any'}
              min={hourMeter ? currentHourMeter : undefined}
              aria-label={`Valor de ${current.titulo}`}
              readOnly={hourMeter && Boolean(detail.horimetro?.automatico)}
              value={currentDraft.answer}
              onChange={(event) => updateDraft({ answer: event.target.value })}
              placeholder="Digite o valor"
            />
            {unit && <span>{unit}</span>}
            {(min !== undefined || max !== undefined) && !hourMeter && (
              <small>
                Faixa: {min ?? '—'} a {max ?? '—'} {unit}
              </small>
            )}
            {hourMeter && (
              <div className="horimeter-guidance">
                <strong>Horímetro total acumulado</strong>
                <span>Último valor: {currentHourMeter} h · não pode ser zerado ou reduzido.</span>
                <span>
                  {detail.horimetro?.automatico
                    ? 'Leitura automática por telemetria. Confirme o valor exibido.'
                    : 'Leitura manual: informe o valor mostrado no equipamento.'}
                </span>
                <span>
                  {serviceHours === null || serviceHours === undefined
                    ? 'Contador desde o último serviço ainda não foi reiniciado.'
                    : `${serviceHours} h desde o último serviço.`}
                </span>
                {!detail.horimetro?.automatico && !currentDraft.answer && (
                  <button type="button" onClick={() => updateDraft({ answer: String(currentHourMeter) })}>
                    Usar {currentHourMeter} h
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {choice && options.length > 0 && (
          <div className="answer-options" role="group" aria-label={`Resposta para ${current.titulo}`}>
            {options.map((option) => (
              <button
                type="button"
                className={
                  currentDraft.answer === option
                    ? 'answer-option answer-option--selected'
                    : 'answer-option'
                }
                key={option}
                aria-pressed={currentDraft.answer === option}
                onClick={() => updateDraft({ answer: option })}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {choice && options.length === 0 && (
          <div className="checklist-alert" role="alert">
            Este item não possui opções configuradas. Solicite a correção do modelo ao responsável.
          </div>
        )}

        {!numeric && !evidenceOnly && !instruction && !choice && (
          <textarea
            className="text-answer"
            aria-label={`Resposta para ${current.titulo}`}
            value={currentDraft.answer}
            onChange={(event) => updateDraft({ answer: event.target.value })}
            placeholder={current.input?.placeholder || 'Digite a resposta'}
          />
        )}

        {instruction && (
          <button
            type="button"
            className={
              currentDraft.answer
                ? 'instruction-check instruction-check--done'
                : 'instruction-check'
            }
            aria-pressed={Boolean(currentDraft.answer)}
            onClick={() =>
              updateDraft({ answer: currentDraft.answer ? '' : 'LIDO' })
            }
          >
            {currentDraft.answer
              ? '✓ Instrução confirmada'
              : 'Confirmar leitura da instrução'}
          </button>
        )}

        {evidenceEnabled && (
          <div className="evidence-answer">
            <span
              className={
                currentEvidenceMode === 'required'
                  ? 'evidence-mode-label evidence-mode-label--required'
                  : 'evidence-mode-label evidence-mode-label--optional'
              }
            >
              {currentEvidenceMode === 'required' ? 'Evidência obrigatória' : 'Evidência opcional'}
            </span>
            <div
              aria-live="polite"
              className={
                currentEvidenceMode === 'required'
                  ? evidenceCount >= evidenceMin
                    ? 'evidence-status evidence-status--done'
                    : 'evidence-status'
                  : evidenceCount > 0
                    ? 'evidence-status evidence-status--done'
                    : 'evidence-status evidence-status--optional'
              }
            >
              <strong>
                {currentEvidenceMode === 'required'
                  ? evidenceCount >= evidenceMin
                    ? 'Evidência validada'
                    : 'Evidência necessária'
                  : evidenceCount > 0
                    ? 'Evidência opcional registrada'
                    : 'Foto disponível para este item'}
              </strong>
              <span>
                {currentEvidenceMode === 'required'
                  ? `${evidenceCount} de ${evidenceMin} foto(s) obrigatória(s)`
                  : `${evidenceCount} foto(s) registrada(s) · limite ${evidenceMax}`}
              </span>
            </div>
            {(current.evidencias?.length ?? 0) > 0 && (
              <div className="evidence-gallery">
                {current.evidencias?.map((photo, photoIndex) => (
                  <EvidenceFileLink
                    evidence={photo}
                    index={photoIndex}
                    key={photo.id || `${photo.nome_arquivo}-${photoIndex}`}
                    className="evidence-thumbnail"
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={evidenceRemaining <= 0}
              onClick={() => setShowEvidence(true)}
            >
              {evidenceRemaining <= 0
                ? 'Limite de fotos atendido'
                : currentEvidenceMode === 'optional'
                  ? evidenceCount
                    ? 'Adicionar outra foto'
                    : 'Adicionar foto opcional'
                  : evidenceCount
                    ? `Adicionar ${evidenceRemaining} foto(s)`
                    : evidenceRemaining > 1
                      ? `Tirar ${evidenceRemaining} fotos`
                      : 'Tirar foto'}
            </button>
          </div>
        )}

        {/* Justificativa exibida somente para NOK ou N/A */}

        {!evidenceOnly && !instruction && currentJustificationRequired && (

          <label className="observation-field observation-field--required">

            <span>Justificativa técnica obrigatória</span>

            <textarea

              value={currentDraft.observation}

              aria-invalid={currentDraft.observation.trim().length < 5}

              onChange={(event) =>

                updateDraft({ observation: event.target.value })

              }

              placeholder="Explique o motivo da resposta NOK ou N/A."

            />

            <small>

              Preencha pelo menos 5 caracteres. Após preencher, o avanço é liberado sem confirmação adicional.

            </small>

          </label>

        )}
      </article>

      {showEvidence && (
        <div className="evidence-modal-backdrop">
          <form
            className="evidence-modal"
            onSubmit={(event) => {
              event.preventDefault()
              void submitEvidence()
            }}
          >
            <div>
              <span>Evidência do checklist</span>
              <h2>{current.titulo}</h2>
            </div>
            <label className="evidence-file-picker">
              <span>Fotos da evidência</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple={evidenceRemaining > 1}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  const available = Math.max(
                    0,
                    evidenceRemaining - selectedEvidence.length,
                  )
                  const accepted = files.slice(0, available)
                  if (files.length > accepted.length) {
                    setEvidenceSelectionWarning(
                      `Limite de evidências deste item: ${evidenceMax} foto(s). Apenas ${available} nova(s) foto(s) foram aceita(s).`,
                    )
                  } else {
                    setEvidenceSelectionWarning('')
                  }
                  setSelectedEvidence((currentFiles) => [
                    ...currentFiles,
                    ...accepted.map((file) => ({
                      file,
                      previewUrl: URL.createObjectURL(file),
                    })),
                  ])
                  event.currentTarget.value = ''
                }}
              />
              <b>Abrir câmera ou galeria</b>
            </label>
            {evidenceSelectionWarning && (
              <div className="evidence-selection-warning">{evidenceSelectionWarning}</div>
            )}
            {selectedEvidence.length > 0 && (
              <div className="evidence-preview-grid">
                {selectedEvidence.map((selected, photoIndex) => (
                  <figure key={`${selected.file.name}-${photoIndex}`}>
                    <img src={selected.previewUrl} alt={`Prévia ${photoIndex + 1}`} />
                    <figcaption>
                      <span>{selected.file.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(selected.previewUrl)
                          setSelectedEvidence((itemsValue) => itemsValue.filter((_, indexValue) => indexValue !== photoIndex))
                        }}
                      >
                        Remover
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <label>
              <span>Observação</span>
              <textarea
                value={evidenceObservation}
                onChange={(event) => setEvidenceObservation(event.target.value)}
                placeholder="Descreva o que as fotos comprovam."
              />
            </label>
            <small>
              {currentEvidenceMode === 'required'
                ? `Quantidade obrigatória: ${evidenceMin} foto(s). Já registradas: ${evidenceCount}. Restantes: ${evidenceRemaining}.`
                : `Evidência opcional. Já registradas: ${evidenceCount}. Limite disponível: ${evidenceMax}.`}
            </small>
            <div className="evidence-modal__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  selectedEvidence.forEach((item) => URL.revokeObjectURL(item.previewUrl))
                  setSelectedEvidence([])
                  setEvidenceSelectionWarning('')
                  setShowEvidence(false)
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={evidenceSaving || selectedEvidence.length === 0}
              >
                {evidenceSaving
                  ? 'Enviando…'
                  : selectedEvidence.length === 1
                    ? 'Enviar 1 foto'
                    : `Enviar ${selectedEvidence.length} fotos`}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="checklist-footer">
        <button
          type="button"
          className="secondary-button"
          disabled={index === 0 || finalizing}
          onClick={() => {
            setMessage('')
            setIndex((value) => Math.max(0, value - 1))
          }}
        >
          Anterior
        </button>
        {!isLast ? (
          <button
            type="button"
            className="primary-button"
            disabled={finalizing}
            onClick={goNext}
          >
            Próximo item
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={finalizing}
            onClick={openFinalizationReview}
          >
            Revisar conclusão
          </button>
        )}
      </div>

      {finalizationOpen && completionPhase === 'idle' && (
        <div className="finalization-review-backdrop" role="dialog" aria-modal="true">
          <article className="finalization-review-card">
            <header>
              <span>Revisão final</span>
              <h2>Concluir execução</h2>
              <p>
                Revise o resultado antes de sincronizar. Nenhuma avaliação manual por estrelas é solicitada.
              </p>
            </header>

            <div className="finalization-review-summary">
              <div>
                <span>Checklist respondido</span>
                <strong>{answeredCount}/{items.length}</strong>
              </div>
              <div>
                <span>Itens obrigatórios pendentes</span>
                <strong>{missingRequiredItems().length}</strong>
              </div>
              <div>
                <span>Respostas NOK</span>
                <strong>{nonConformityCount()}</strong>
              </div>
              <div>
                <span>Respostas N/A</span>
                <strong>{notApplicableCount()}</strong>
              </div>
            </div>

            <label className="finalization-review-field">
              <span>Resultado da execução</span>
              <select
                value={finalOutcome}
                onChange={(event) => {
                  const nextOutcome = event.target.value as FinalOutcome
                  setFinalOutcome(nextOutcome)
                  setFinalizationError('')
                  if (!finalOutcomeRequiresObservation(nextOutcome)) {
                    setFinalObservation('')
                  }
                }}
              >
                <option value="">Selecione o resultado</option>
                {FINAL_OUTCOME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="finalization-quality">
              <span>Qualidade automática da execução</span>
              <strong>
                {'★'.repeat(calculateQualityScore(finalOutcome))}
                {'☆'.repeat(5 - calculateQualityScore(finalOutcome))}
              </strong>
              <small>
                Nota calculada pela conclusão dos itens, evidências e respostas registradas. Não é uma autoavaliação.
              </small>
            </div>

            {finalOutcomeRequiresObservation(finalOutcome) && (
              <label className="finalization-review-field">
                <span>Observação final obrigatória</span>
                <textarea
                  value={finalObservation}
                  onChange={(event) => {
                    setFinalObservation(event.target.value)
                    setFinalizationError('')
                  }}
                  placeholder="Explique a execução parcial, o impedimento ou o resultado informado."
                />
              </label>
            )}

            {finalizationError && (
              <div className="finalization-review-error" role="alert">
                {finalizationError}
              </div>
            )}

            <div className="finalization-review-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={finalizing}
                onClick={() => {
                  setFinalizationOpen(false)
                  setFinalizationError('')
                }}
              >
                Voltar ao checklist
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={finalizing || !finalOutcome}
                onClick={() => void confirmFinalization()}
              >
                {finalizing ? 'Sincronizando…' : 'Confirmar e sincronizar'}
              </button>
            </div>
          </article>
        </div>
      )}

      {completionPhase !== 'idle' && completionSummary && (
        <div className="execution-completion-overlay" role="dialog" aria-modal="true">
          <article className="execution-completion-card">
            {completionPhase === 'syncing' ? (
              <div className="execution-completion-center">
                <div className="execution-sync-spinner" aria-hidden="true" />
                <h2>Sincronizando dados</h2>
                <p>
                  Enviando checklist, parâmetros, evidências e tempo total.
                </p>
              </div>
            ) : (
              <div className="execution-completion-center">
                <div className="execution-success-check" aria-hidden="true">✓</div>
                <h2>Execução concluída</h2>
                <p>Dados sincronizados com sucesso.</p>
                <div className="execution-result-grid">
                  <div>
                    <span>Tempo de execução</span>
                    <strong>{formatElapsed(completionSummary.durationSeconds)}</strong>
                  </div>
                  <div>
                    <span>Comparação</span>
                    <strong>{completionSummary.comparison}</strong>
                  </div>
                  <div>
                    <span>Checklist</span>
                    <strong>
                      {completionSummary.checklistTotal}/
                      {completionSummary.checklistTotal}
                    </strong>
                  </div>
                  <div>
                    <span>Evidências</span>
                    <strong>{completionSummary.evidenceCount} foto(s)</strong>
                  </div>
                  <div>
                    <span>Resultado</span>
                    <strong>{completionSummary.outcomeLabel}</strong>
                  </div>
                  <div>
                    <span>Qualidade automática</span>
                    <strong>
                      {completionSummary.qualityScore}/5 ·{' '}
                      {'★'.repeat(completionSummary.qualityScore)}
                      {'☆'.repeat(5 - completionSummary.qualityScore)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
