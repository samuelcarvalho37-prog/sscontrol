import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  confirmAdminImport,
  dismissAdminImportBatch,
  getAdminImportCatalog,
  getAdminImportBatch,
  listAdminImportBatches,
  rollbackAdminImport,
  validateAdminImport,
} from '../services/api/imports'
import { createAdminBackup } from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { ApiRequestError } from '../services/api/client'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import {
  downloadAdminImportMasterTemplate,
  downloadAdminImportTemplate,
  parseAdminWorkbook,
} from '../services/spreadsheet/adminWorkbook'
import { exportAdminCurrentData, exportAdminImportBatch, exportableEntityForImportType, type AdminImportExportFormat } from '../services/spreadsheet/adminImportExport'
import type {
  AdminImportBatch,
  AdminImportCatalog,
  AdminImportModel,
  AdminImportRetryRequest,
  ParsedAdminWorkbook,
} from '../types/imports'
import { AlertIcon, CheckIcon } from './Icons'

interface AdminImportCenterProps {
  onSessionExpired: () => void
  mode?: 'hub' | 'import-zone' | 'export-zone' | 'prepare' | 'master' | 'history' | 'export' | 'export-master'
  category?: string
  onOpenSection?: (section: 'structure' | 'technical' | 'stock' | 'master', operation: 'import' | 'export') => void
  onDetachZone?: (operation: 'import' | 'export') => void
  onRestoreZone?: (operation: 'import' | 'export') => void
  onOpenHistory?: () => void
  onOpenReimport?: (request: AdminImportRetryRequest, file: File) => void
  reimportRequest?: (AdminImportRetryRequest & { requestId: number; file: File }) | null
  exportRequestId?: number
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function estimateCompletion(createdAt: string, completed: number, total: number): string {
  if (!total || completed <= 0 || completed >= total) return 'Estimativa indisponível'
  const started = new Date(createdAt).getTime()
  const elapsed = Date.now() - started
  if (!Number.isFinite(started) || elapsed <= 0) return 'Estimativa indisponível'
  const remainingMs = (elapsed / completed) * (total - completed)
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  return remainingMinutes < 60 ? `Previsão: ~${remainingMinutes} min` : `Previsão: ~${Math.ceil(remainingMinutes / 60)} h`
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function batchStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PROCESSANDO: 'Importando',
    CORRIGINDO: 'Corrigindo',
    ATUALIZANDO: 'Atualizando',
    VALIDADO: 'Pronto para confirmar',
    COM_ERROS: 'Correção necessária',
    CONCLUIDO: 'Importado',
    REVERTIDO: 'Revertido',
    FALHOU: 'Falhou e foi desfeito',
  }
  return labels[status] ?? status
}

function batchActorAndDate(batch: AdminImportBatch, status = batch.status): string {
  const completed = status === 'CONCLUIDO'
  const actor = completed ? batch.confirmado_por || batch.criado_por : batch.criado_por
  const date = completed ? batch.confirmado_em || batch.criado_em : batch.criado_em
  return `${formatDate(date)} · ${completed ? 'Importado por' : 'Enviado por'} ${actor || 'usuário não identificado'}`
}

function batchMetricTooltip(batch: AdminImportBatch, metric: 'read' | 'created' | 'updated'): string {
  const records = batch.registros ?? []
  const label = metric === 'read' ? 'Lidas' : metric === 'created' ? 'Criadas' : 'Atualizadas'
  const selected = metric === 'read'
    ? records
    : records.filter((record) => record.operacao.toLocaleUpperCase('pt-BR') === (metric === 'created' ? 'CRIAR' : 'ATUALIZAR'))
  const identifiers = selected.slice(0, 8).map((record) => {
    const fields = record.normalizado ?? {}
    const code = ['tag', 'sku', 'codigo', 'codigo_ativo', 'nome'].map((key) => fields[key]).find((value) => value !== undefined && value !== null && value !== '')
    return `Linha ${record.linha_numero}: ${record.entidade_id || displayValue(code)}`
  })
  const total = metric === 'read'
    ? batch.total_linhas
    : metric === 'created'
      ? batch.resultado.criados ?? selected.length
      : batch.resultado.atualizados ?? selected.length
  if (!records.length) return `${label}: ${total} linha(s) no lote.`
  if (!selected.length) return `${label}: ${total} registro(s) neste lote.`
  const sample = identifiers.slice(0, 3).join(' · ')
  const remainder = selected.length > 3 ? ` +${selected.length - 3}` : ''
  return `${label}: ${sample}${remainder}`
}

function normalizedHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '')
}

function modelForHeaders(
  models: AdminImportModel[],
  headers: string[],
): AdminImportModel | null {
  const available = new Set(headers.map(normalizedHeader))
  const candidates = models
    .map((model) => {
      const fields = model.campos.filter((field) =>
        available.has(normalizedHeader(field.chave)) ||
        available.has(normalizedHeader(field.rotulo)) ||
        field.aliases.some((alias) => available.has(normalizedHeader(alias))),
      )
      return {
        model,
        matchesRequired: model.campos
          .filter((field) => field.obrigatorio)
          .every((field) => fields.includes(field)),
        score: fields.length,
      }
    })
    .filter((candidate) => candidate.matchesRequired)
    .sort((left, right) => right.score - left.score)
  return candidates[0]?.model ?? null
}

const IMPORT_ORDER = [
  'plantas',
  'setores',
  'linhas',
  'ativos',
  'componentes',
  'materiais',
  'valores_componentes',
  'fontes_valores',
]

const DEMO_IMPORT_BATCHES: AdminImportBatch[] = [
  {
    id: 'DEMO-IMP-1042', tipo: 'ativos', entidade: 'ativos', arquivo_nome: 'ativos_unidade_norte.xlsx', aba_nome: 'Equipamentos e ativos',
    status: 'CONCLUIDO', total_linhas: 42, linhas_validas: 42, linhas_invalidas: 0, validacao_hash: '', cabecalhos: ['tag', 'nome', 'linha_id'], cabecalhos_ignorados: [],
    resultado: { criados: 36, atualizados: 6 }, criado_por: 'Demonstração', criado_em: '2026-10-27T14:20:00.000Z', confirmado_por: 'Demonstração', confirmado_em: '2026-10-27T14:21:00.000Z', rollback_por: '', rollback_em: '',
    registros: [{ id: 'demo-record-1', linha_numero: 2, entidade: 'ativos', entidade_id: 'EQ-DEMO-001', operacao: 'CRIAR', status: 'APLICADO', normalizado: { tag: 'EQ-DEMO-001', nome: 'Bomba de processo', linha_id: 'L01' }, erros: [] }],
  },
  {
    id: 'DEMO-IMP-1043', tipo: 'materiais', entidade: 'materiais', arquivo_nome: 'materiais_almoxarifado.csv', aba_nome: 'Materiais e peças',
    status: 'COM_ERROS', total_linhas: 18, linhas_validas: 16, linhas_invalidas: 2, validacao_hash: '', cabecalhos: ['sku', 'nome', 'unidade'], cabecalhos_ignorados: [],
    resultado: {}, criado_por: 'Demonstração', criado_em: '2026-10-27T15:05:00.000Z', confirmado_por: '', confirmado_em: '', rollback_por: '', rollback_em: '',
    registros: [
      { id: 'demo-record-2', linha_numero: 9, entidade: 'materiais', entidade_id: '', operacao: 'CRIAR', status: 'INVALIDO', normalizado: {}, erros: [{ codigo: 'DEMO_REQUIRED', mensagem: 'Preencha o SKU da linha 9 antes de reimportar.' }] },
      { id: 'demo-record-3', linha_numero: 14, entidade: 'materiais', entidade_id: '', operacao: 'CRIAR', status: 'INVALIDO', normalizado: {}, erros: [{ codigo: 'DEMO_REFERENCE', mensagem: 'A unidade de medida da linha 14 não foi reconhecida.' }] },
    ],
  },
  {
    id: 'DEMO-IMP-1046', tipo: 'materiais', entidade: 'materiais', arquivo_nome: 'materiais_almoxarifado_corrigido.csv', aba_nome: 'Materiais e peças',
    status: 'CONCLUIDO', total_linhas: 18, linhas_validas: 18, linhas_invalidas: 0, validacao_hash: '', cabecalhos: ['sku', 'nome', 'unidade'], cabecalhos_ignorados: [],
    resultado: { criados: 2, atualizados: 16 }, criado_por: 'Demonstração', criado_em: '2026-10-27T15:16:00.000Z', confirmado_por: 'Demonstração', confirmado_em: '2026-10-27T15:17:00.000Z', rollback_por: '', rollback_em: '',
    registros: [],
  },
  {
    id: 'DEMO-IMP-1044', tipo: 'materiais', entidade: 'materiais', arquivo_nome: 'materiais_almoxarifado_corrigido.csv', aba_nome: 'Materiais e peças',
    status: 'CORRIGINDO', total_linhas: 18, linhas_validas: 13, linhas_invalidas: 0, validacao_hash: '', cabecalhos: ['sku', 'nome', 'unidade'], cabecalhos_ignorados: [],
    resultado: {}, criado_por: 'Demonstração', criado_em: '2026-10-27T15:18:00.000Z', confirmado_por: '', confirmado_em: '', rollback_por: '', rollback_em: '',
    registros: [],
  },
  {
    id: 'DEMO-IMP-1045', tipo: 'ativos', entidade: 'ativos', arquivo_nome: 'ativos_unidade_norte.xlsx', aba_nome: 'Equipamentos e ativos',
    status: 'ATUALIZANDO', total_linhas: 42, linhas_validas: 27, linhas_invalidas: 0, validacao_hash: '', cabecalhos: ['tag', 'nome', 'linha_id'], cabecalhos_ignorados: [],
    resultado: {}, criado_por: 'Demonstração', criado_em: '2026-10-27T15:22:00.000Z', confirmado_por: '', confirmado_em: '', rollback_por: '', rollback_em: '',
    registros: [],
  },
]

export function AdminImportCenter({ onSessionExpired, mode = 'hub', category, onOpenSection, onDetachZone, onRestoreZone, onOpenHistory, onOpenReimport, reimportRequest, exportRequestId }: AdminImportCenterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const historyFileInputRef = useRef<HTMLInputElement>(null)
  const pendingRetryRef = useRef<AdminImportRetryRequest | null>(null)
  const draftsByTypeRef = useRef<Record<string, { file: File | null; parsed: ParsedAdminWorkbook | null; analysis: AdminImportBatch | null }>>({})
  const [catalog, setCatalog] = useState<AdminImportCatalog | null>(null)
  const [batches, setBatches] = useState<AdminImportBatch[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [activeGroup, setActiveGroup] = useState(category ?? '')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedAdminWorkbook | null>(null)
  const [analysis, setAnalysis] = useState<AdminImportBatch | null>(null)
  const [duplicateBatch, setDuplicateBatch] = useState<AdminImportBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const [showDemoLots, setShowDemoLots] = useState(false)
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(() => new Set())
  const [hubZoneOrder, setHubZoneOrder] = useState<Array<'import' | 'export'>>(['import', 'export'])
  const [hubVisibleZones, setHubVisibleZones] = useState<Array<'import' | 'export'>>(['import', 'export'])
  const [hubOrientation, setHubOrientation] = useState<'vertical' | 'horizontal'>('vertical')
  const [draggedHubZone, setDraggedHubZone] = useState<'import' | 'export' | null>(null)
  const [dragOverHubZone, setDragOverHubZone] = useState<'import' | 'export' | null>(null)
  const hubZonePointerRef = useRef<{ zone: 'import' | 'export'; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const hubSplitRef = useRef<HTMLDivElement>(null)
  const [exportFormat, setExportFormat] = useState<AdminImportExportFormat>('xlsx')
  const [exportBatchTarget, setExportBatchTarget] = useState<AdminImportBatch | null>(null)
  const [exportError, setExportError] = useState('')
  const [retryContext, setRetryContext] = useState<AdminImportRetryRequest | null>(null)
  const [batchStatusOverrides, setBatchStatusOverrides] = useState<Record<string, string>>({})

  function requestBatchFile(batch: AdminImportBatch, intent: AdminImportRetryRequest['intent']) {
    if (batch.id.startsWith('DEMO-') || !onOpenReimport) return
    pendingRetryRef.current = {
      batchId: batch.id,
      type: batch.tipo,
      fileName: batch.arquivo_nome,
      sheetName: batch.aba_nome || undefined,
      intent,
    }
    setError('')
    setNotice(intent === 'correct'
      ? `Selecione a planilha corrigida para “${batch.arquivo_nome}”. O tipo de cadastro será conferido automaticamente.`
      : `Selecione a versão atualizada de “${batch.arquivo_nome}”. O tipo de cadastro será conferido automaticamente.`)
    if (historyFileInputRef.current) {
      historyFileInputRef.current.value = ''
      historyFileInputRef.current.click()
    }
  }

  useEffect(() => {
    if (!selectedType) return
    draftsByTypeRef.current[selectedType] = { file: selectedFile, parsed, analysis }
  }, [analysis, parsed, selectedFile, selectedType])

  useEffect(() => {
    if (!reimportRequest || !catalog || mode !== 'prepare') return
    const model = catalog.modelos.find((item) => item.tipo === reimportRequest.type)
    if (!model || (category && model.grupo !== category)) return
    setRetryContext(reimportRequest)
    setSelectedType(model.tipo)
    setActiveGroup(model.grupo)
    setSelectedFile(null)
    setParsed(null)
    setAnalysis(null)
    setError('')
    setNotice(`${reimportRequest.intent === 'update' ? 'Atualização' : 'Correção'} preparada para “${model.nome}”. Arquivo: ${reimportRequest.fileName}.`)
    if (fileInputRef.current) fileInputRef.current.value = ''
    void readFile(reimportRequest.file, reimportRequest.sheetName, reimportRequest)
  }, [catalog, category, mode, reimportRequest])

  useEffect(() => {
    if (!exportRequestId) return
    setError('')
    setNotice('')
    setExportFormat('xlsx')
  }, [exportRequestId])

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const [nextCatalog, nextBatches] = await Promise.all([
      getAdminImportCatalog(signal),
      listAdminImportBatches(signal),
    ])
    setCatalog(nextCatalog)
    setBatches(nextBatches)
    setSelectedType((current) => current || nextCatalog.modelos.find((model) => model.grupo === category)?.tipo || nextCatalog.modelos[0]?.tipo || '')
    setActiveGroup((current) => current || category || nextCatalog.modelos[0]?.grupo || '')
  }, [category])

  useEffect(() => {
    if (mode !== 'history') return
    const onRetryStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId: string; status?: string; complete?: boolean }>).detail
      if (!detail?.batchId) return
      if (detail.complete) {
        setBatchStatusOverrides((current) => {
          const next = { ...current }
          delete next[detail.batchId]
          return next
        })
        void loadWorkspace().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o histórico.'))
        return
      }
      if (detail.status) setBatchStatusOverrides((current) => ({ ...current, [detail.batchId]: detail.status as string }))
    }
    window.addEventListener('vorqix:admin-import-retry-status', onRetryStatus)
    return () => window.removeEventListener('vorqix:admin-import-retry-status', onRetryStatus)
  }, [loadWorkspace, mode])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadWorkspace(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a Central de Importação.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadWorkspace, onSessionExpired])

  useAutoRefresh(async () => {
    try {
      await loadWorkspace()
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar os lotes.')
    }
  }, {
    enabled: !busy,
    intervalMs: 20_000,
  })

  const selectedModel = useMemo(
    () => catalog?.modelos.find((model) => model.tipo === selectedType) ?? null,
    [catalog, selectedType],
  )

  const groupedModels = useMemo(() => {
    const groups = new Map<string, AdminImportModel[]>()
    catalog?.modelos.forEach((model) => {
      groups.set(model.grupo, [...(groups.get(model.grupo) ?? []), model])
    })
    return [...groups.entries()]
  }, [catalog])

  const exportGroups = useMemo(() => groupedModels
    .map(([group, models]) => [group, models.filter((model) => exportableEntityForImportType(model.tipo) !== null)] as const)
    .filter(([, models]) => models.length > 0), [groupedModels])

  const visibleModels = useMemo(
    () => groupedModels.find(([group]) => group === (category ?? activeGroup))?.[1] ?? [],
    [activeGroup, category, groupedModels],
  )

  const importingMaster = mode === 'master'
  const exportingMaster = mode === 'export-master'
  const hubImportOnly = mode === 'import-zone'
  const hubExportOnly = mode === 'export-zone'
  const isHubMode = mode === 'hub' || hubImportOnly || hubExportOnly
  const canMoveHubZones = mode === 'hub'
  const exporting = mode === 'export' || exportingMaster
  const exportModels = useMemo(
    () => {
      const candidates = (exportingMaster ? catalog?.modelos ?? [] : visibleModels).filter((model) => exportableEntityForImportType(model.tipo) !== null)
      return candidates.filter((model, index) => candidates.findIndex((item) => item.entidade === model.entidade) === index)
    },
    [catalog, exportingMaster, visibleModels],
  )
  const visibleStatuses = new Set(['COM_ERROS', 'FALHOU', 'PROCESSANDO', 'CORRIGINDO', 'ATUALIZANDO'])
  const latestImportedFileNames = new Set<string>()
  const visibleBatches = batches.filter((batch) => {
    const status = batchStatusOverrides[batch.id] ?? batch.status
    if (visibleStatuses.has(status)) return true
    if (status !== 'CONCLUIDO' || latestImportedFileNames.has(batch.arquivo_nome)) return false
    latestImportedFileNames.add(batch.arquivo_nome)
    return true
  })
  const displayedBatches = showDemoLots ? [...visibleBatches, ...DEMO_IMPORT_BATCHES] : visibleBatches

  const previewColumns = useMemo(() => parsed?.headers.slice(0, 8) ?? [], [parsed])

  function beginHubZoneMove(event: ReactPointerEvent<HTMLButtonElement>, zone: 'import' | 'export') {
    if (!canMoveHubZones || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    hubZonePointerRef.current = { zone, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveHubZone(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = hubZonePointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return
    drag.moved = true
    setDraggedHubZone(drag.zone)
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.admin-import-zone')
    const targetZone = target?.dataset.zone as 'import' | 'export' | undefined
    setDragOverHubZone(targetZone && targetZone !== drag.zone ? targetZone : null)
  }

  function finishHubZoneMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = hubZonePointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const bounds = hubSplitRef.current?.getBoundingClientRect()
    const outside = Boolean(drag.moved && bounds && (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    ))
    if (outside) {
      setHubVisibleZones((current) => current.filter((zone) => zone !== drag.zone))
      onDetachZone?.(drag.zone)
    } else if (drag.moved && bounds) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.admin-import-zone')
      const targetZone = target?.dataset.zone as 'import' | 'export' | undefined
      const otherZone = drag.zone === 'import' ? 'export' : 'import'
      if (target && targetZone && targetZone !== drag.zone) {
        const targetBounds = target.getBoundingClientRect()
        const distances = [
          { edge: 'left', distance: Math.abs(event.clientX - targetBounds.left) / Math.max(targetBounds.width, 1) },
          { edge: 'right', distance: Math.abs(targetBounds.right - event.clientX) / Math.max(targetBounds.width, 1) },
          { edge: 'top', distance: Math.abs(event.clientY - targetBounds.top) / Math.max(targetBounds.height, 1) },
          { edge: 'bottom', distance: Math.abs(targetBounds.bottom - event.clientY) / Math.max(targetBounds.height, 1) },
        ]
        const edge = distances.sort((left, right) => left.distance - right.distance)[0]?.edge
        const horizontal = edge === 'left' || edge === 'right'
        const sourceFirst = edge === 'left' || edge === 'top'
        setHubOrientation(horizontal ? 'horizontal' : 'vertical')
        setHubZoneOrder(sourceFirst ? [drag.zone, targetZone] : [targetZone, drag.zone])
      } else {
        const horizontal = bounds.width >= bounds.height && event.clientX > bounds.left + bounds.width / 2
        const sourceFirst = horizontal
          ? event.clientX < bounds.left + bounds.width / 2
          : event.clientY < bounds.top + bounds.height / 2
        setHubOrientation(horizontal ? 'horizontal' : 'vertical')
        setHubZoneOrder(sourceFirst ? [drag.zone, otherZone] : [otherZone, drag.zone])
      }
    }
    hubZonePointerRef.current = null
    setDraggedHubZone(null)
    setDragOverHubZone(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function attachHubZone(zone: 'import' | 'export', targetZone?: 'import' | 'export', targetBounds?: DOMRect, clientX?: number, clientY?: number) {
    onRestoreZone?.(zone)
    if (targetZone && targetZone !== zone && targetBounds && clientX !== undefined && clientY !== undefined) {
      const distances = [
        { edge: 'left', distance: Math.abs(clientX - targetBounds.left) / Math.max(targetBounds.width, 1) },
        { edge: 'right', distance: Math.abs(targetBounds.right - clientX) / Math.max(targetBounds.width, 1) },
        { edge: 'top', distance: Math.abs(clientY - targetBounds.top) / Math.max(targetBounds.height, 1) },
        { edge: 'bottom', distance: Math.abs(targetBounds.bottom - clientY) / Math.max(targetBounds.height, 1) },
      ]
      const edge = distances.sort((left, right) => left.distance - right.distance)[0]?.edge
      const horizontal = edge === 'left' || edge === 'right'
      const sourceFirst = edge === 'left' || edge === 'top'
      setHubOrientation(horizontal ? 'horizontal' : 'vertical')
      setHubZoneOrder(sourceFirst ? [zone, targetZone] : [targetZone, zone])
    } else {
      setHubZoneOrder((current) => current.includes(zone) ? current : zone === 'import' ? [zone, ...current] : [...current, zone])
    }
    setHubVisibleZones((current) => current.includes(zone) ? current : [...current, zone])
  }

  function importExportZoneFromDraggedTab(dataTransfer: DataTransfer): 'import' | 'export' | null {
    const module = dataTransfer.getData('text/plain')
    if (module === 'imports-zone') return 'import'
    if (module === 'exports-zone') return 'export'
    return null
  }

  function cancelHubZoneMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = hubZonePointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    hubZonePointerRef.current = null
    setDraggedHubZone(null)
    setDragOverHubZone(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resetFile(preserveRetryContext = false) {
    setSelectedFile(null)
    setParsed(null)
    setAnalysis(null)
    setDuplicateBatch(null)
    if (!preserveRetryContext) setRetryContext(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function changeModel(type: string) {
    if (retryContext && type !== retryContext.type) {
      setError('Este lote só pode ser corrigido ou atualizado com o mesmo tipo de cadastro.')
      return
    }
    if (selectedType) {
      draftsByTypeRef.current[selectedType] = { file: selectedFile, parsed, analysis }
    }
    const nextDraft = draftsByTypeRef.current[type]
    setSelectedType(type)
    setSelectedFile(nextDraft?.file ?? null)
    setParsed(nextDraft?.parsed ?? null)
    setAnalysis(nextDraft?.analysis ?? null)
    setDuplicateBatch(null)
    setError('')
    setNotice('')
  }

  async function downloadMasterTemplate() {
    if (!catalog) return
    setBusy('template')
    setError('')
    try {
      await downloadAdminImportMasterTemplate(catalog.modelos)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o modelo mestre.')
    } finally {
      setBusy('')
    }
  }

  async function exportBatch(batch: AdminImportBatch, format: AdminImportExportFormat) {
    setBusy(`export:${batch.id}`)
    setExportError('')
    setNotice('')
    try {
      await exportAdminImportBatch(batch, format)
      setNotice(`Lote ${batch.id} exportado em ${format.toUpperCase()}.`)
      setExportBatchTarget(null)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setExportError(cause instanceof Error ? cause.message : 'Não foi possível exportar este lote.')
    } finally {
      setBusy('')
    }
  }

  async function exportCurrentData() {
    const models = exportingMaster ? exportModels : selectedModel ? [selectedModel] : []
    const sources = models.flatMap((model) => {
      const entity = exportableEntityForImportType(model.tipo)
      return entity ? [{ entity, name: model.nome, sheetName: model.nome }] : []
    })
    setBusy('export-current')
    setError('')
    setNotice('')
    try {
      await exportAdminCurrentData(sources, exportFormat)
      setNotice(`${sources.length} cadastro(s) atual(is) exportado(s) em ${exportFormat.toUpperCase()}.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível exportar os dados atuais.')
    } finally {
      setBusy('')
    }
  }

  async function readFile(file: File, sheetName?: string, retryOverride: AdminImportRetryRequest | null = retryContext) {
    setBusy('reading')
    setError('')
    setNotice('')
    setDuplicateBatch(null)
    try {
      let nextParsed = await parseAdminWorkbook(file, sheetName)
      const eligibleModels = category
        ? catalog?.modelos.filter((model) => model.grupo === category) ?? []
        : catalog?.modelos ?? []
      let detectedModel = modelForHeaders(eligibleModels, nextParsed.headers)
      if (retryOverride && detectedModel?.tipo !== retryOverride.type && nextParsed.sheetNames.length > 1) {
        for (const candidateSheetName of nextParsed.sheetNames) {
          const candidate = await parseAdminWorkbook(file, candidateSheetName)
          const candidateModel = modelForHeaders(eligibleModels, candidate.headers)
          if (candidateModel?.tipo === retryOverride.type) {
            nextParsed = candidate
            detectedModel = candidateModel
            break
          }
        }
      }
      const model = detectedModel ?? catalog?.modelos.find((item) => item.tipo === selectedType)
      if (retryOverride && model?.tipo !== retryOverride.type) {
        throw new Error('O arquivo selecionado não corresponde ao tipo de cadastro deste lote.')
      }
      if (model && nextParsed.rows.length > model.max_linhas) {
        throw new Error(`O modelo aceita no máximo ${model.max_linhas} linhas por lote.`)
      }
      if (detectedModel) {
        setSelectedType(detectedModel.tipo)
        setActiveGroup(detectedModel.grupo)
        setNotice(`Aba “${nextParsed.selectedSheet}” reconhecida como “${detectedModel.nome}”.`)
      }
      setSelectedFile(file)
      setParsed(nextParsed)
      setAnalysis(null)
      if (retryOverride) setRetryContext(retryOverride)
      setNotice(retryOverride?.intent === 'update'
        ? 'Planilha reconhecida. Revise os dados para atualizar os registros existentes.'
        : retryOverride?.intent === 'correct'
          ? 'Planilha reconhecida. Revise as correções antes de enviar novamente.'
          : '')
    } catch (cause) {
      resetFile(Boolean(retryOverride))
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler a planilha.')
    } finally {
      setBusy('')
    }
  }

  async function analyze() {
    if (!selectedModel || !parsed) return
    setBusy('validating')
    setError('')
    setNotice('')
    setDuplicateBatch(null)
    try {
      const batch = await validateAdminImport({
        tipo: selectedModel.tipo,
        arquivo_nome: retryContext?.fileName ?? parsed.fileName,
        aba_nome: parsed.selectedSheet,
        cabecalhos: parsed.headers,
        linhas: parsed.rows,
      })
      setAnalysis(batch)
      setBatches((current) => [batch, ...current.filter((item) => item.id !== batch.id)])
      if (batch.linhas_invalidas) {
        setNotice('A pré-análise encontrou linhas que precisam ser corrigidas. Nenhum cadastro foi alterado.')
      } else {
        setNotice('Pré-análise concluída. Revise o resumo antes de confirmar a importação.')
      }
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      if (cause instanceof ApiRequestError && cause.code === 'IMPORT_DUPLICATE_BATCH') {
        const details = cause.details && typeof cause.details === 'object'
          ? cause.details as Record<string, unknown>
          : {}
        const existingBatchId = typeof details.lote_existente === 'string'
          ? details.lote_existente
          : ''
        if (existingBatchId) {
          try {
            const existing = await getAdminImportBatch(existingBatchId)
            setDuplicateBatch(existing)
            setAnalysis(null)
            setBatches((current) => [existing, ...current.filter((item) => item.id !== existing.id)] )
            if (retryContext?.intent === 'correct') {
              try {
                await dismissAdminImportBatch(retryContext.batchId)
                setBatches((current) => current.filter((item) => item.id !== retryContext.batchId))
                setRetryContext(null)
                setNotice(`Conteúdo já importado em “${existing.arquivo_nome}”. Não há correções pendentes nesta planilha; o lote anterior foi encerrado.`)
              } catch {
                setNotice(`Conteúdo já importado em “${existing.arquivo_nome}”. Não há campos para corrigir neste arquivo; o lote anterior ainda precisa ser encerrado no histórico.`)
              }
            } else {
              setNotice(`Este conteúdo já foi importado em “${existing.arquivo_nome}”. Confira abaixo os registros do lote existente; não é necessária uma nova importação.`)
            }
            return
          } catch {
            // Mantém a mensagem original se o lote apontado não puder ser carregado.
          }
        }
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar a importação.')
    } finally {
      setBusy('')
    }
  }

  async function confirm() {
    if (!analysis || analysis.status !== 'VALIDADO') return
    const isUpdating = retryContext?.intent === 'update'
    const operationLabel = isUpdating ? 'atualizar' : 'importar'
    if (!window.confirm(
      `Antes de ${operationLabel} ${analysis.total_linhas} linha(s), será criada uma cópia de segurança dos dados operacionais. Continuar?`,
    )) return
    if (retryContext) {
      window.dispatchEvent(new CustomEvent('vorqix:admin-import-retry-status', {
        detail: { batchId: retryContext.batchId, status: isUpdating ? 'ATUALIZANDO' : 'CORRIGINDO' },
      }))
    }
    setBusy('backup-before-import')
    setError('')
    setNotice(`Criando backup preventivo antes de ${operationLabel} os dados…`)
    let backupCreated = false
    let previousBatchArchived = true
    try {
      const backup = await createAdminBackup(`Antes de ${isUpdating ? 'atualizar' : 'importar'}: ${analysis.arquivo_nome}`, 'CRIAR BACKUP')
      backupCreated = true
      setNotice(`Backup criado. ${isUpdating ? 'Atualizando' : 'Importando'} ${analysis.arquivo_nome}…`)
      setBusy('confirming')
      const confirmed = await confirmAdminImport(analysis.id, analysis.validacao_hash)
      setAnalysis(confirmed)
      if (retryContext?.intent === 'correct') {
        try {
          await dismissAdminImportBatch(retryContext.batchId)
          setBatches((current) => [confirmed, ...current.filter((item) => item.id !== confirmed.id && item.id !== retryContext.batchId)])
        } catch {
          previousBatchArchived = false
          setBatches((current) => [confirmed, ...current.filter((item) => item.id !== confirmed.id)])
        }
      } else {
        setBatches((current) => [confirmed, ...current.filter((item) => item.id !== confirmed.id)])
      }
      setNotice(`${isUpdating ? 'Atualização' : 'Importação'} concluída: ${confirmed.resultado.criados ?? 0} criado(s), ${confirmed.resultado.atualizados ?? 0} atualizado(s). Backup: ${backup.backup.nome}.${!previousBatchArchived ? ' O lote anterior ainda aparece como pendente; atualize o registro para tentar arquivá-lo.' : ''}`)
      setRetryContext(null)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error
        ? backupCreated
          ? `O backup preventivo foi criado, mas não foi possível concluir a ${isUpdating ? 'atualização' : 'importação'}: ${cause.message}`
          : `A ${isUpdating ? 'atualização' : 'importação'} não foi iniciada porque o backup preventivo falhou: ${cause.message}`
        : backupCreated
          ? `O backup preventivo foi criado, mas não foi possível concluir a ${isUpdating ? 'atualização' : 'importação'}.`
          : `A ${isUpdating ? 'atualização' : 'importação'} não foi iniciada porque não foi possível criar o backup preventivo.`)
    } finally {
      setBusy('')
      if (retryContext) {
        window.dispatchEvent(new CustomEvent('vorqix:admin-import-retry-status', {
          detail: { batchId: retryContext.batchId, complete: true },
        }))
      }
    }
  }

  async function importAllSheets() {
    if (!selectedFile || !parsed || !catalog) return

    const candidates: Array<{ parsed: ParsedAdminWorkbook; model: AdminImportModel }> = []
    try {
      for (const sheetName of parsed.sheetNames) {
        const sheet = await parseAdminWorkbook(selectedFile, sheetName)
        const model = modelForHeaders(catalog.modelos, sheet.headers)
        if (model && sheet.rows.length > model.max_linhas) {
          setError(`A aba “${sheet.selectedSheet}” excede o limite de ${model.max_linhas} linhas do modelo “${model.nome}”.`)
          return
        }
        if (model) candidates.push({ parsed: sheet, model })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler todas as abas da planilha mestre.')
      return
    }
    candidates.sort(
      (left, right) =>
        IMPORT_ORDER.indexOf(left.model.tipo) - IMPORT_ORDER.indexOf(right.model.tipo),
    )
    if (!candidates.length) {
      setError('Nenhuma aba compatível com os modelos controlados foi encontrada.')
      return
    }
    const summary = candidates.map((item) => item.parsed.selectedSheet).join(', ')
    if (!window.confirm(
      `Antes de importar as abas ${summary}, será criada uma cópia de segurança dos dados operacionais. Continuar?`,
    )) return

    setBusy('bulk-import')
    setError('')
    setNotice('Criando backup preventivo antes de validar e importar as abas…')
    const confirmedBatches: AdminImportBatch[] = []
    let backupCreated = false
    try {
      const backup = await createAdminBackup(`Antes da importação mestre: ${selectedFile.name}`, 'CRIAR BACKUP')
      backupCreated = true
      setNotice(`Backup de segurança criado: ${backup.backup.nome}. Validando as abas…`)
      let completed = 0
      for (const candidate of candidates) {
        setProgress({ current: completed + 1, total: candidates.length, label: candidate.model.nome })
        setSelectedType(candidate.model.tipo)
        setActiveGroup(candidate.model.grupo)
        setParsed(candidate.parsed)
        const batch = await validateAdminImport({
          tipo: candidate.model.tipo,
          arquivo_nome: candidate.parsed.fileName,
          aba_nome: candidate.parsed.selectedSheet,
          cabecalhos: candidate.parsed.headers,
          linhas: candidate.parsed.rows,
        })
        setAnalysis(batch)
        setBatches((current) => [batch, ...current.filter((item) => item.id !== batch.id)])
        if (batch.status !== 'VALIDADO') {
          throw new Error(
            `A aba “${candidate.parsed.selectedSheet}” não passou na pré-análise. Corrija as linhas indicadas antes de continuar.`,
          )
        }
        const confirmed = await confirmAdminImport(batch.id, batch.validacao_hash)
        setAnalysis(confirmed)
        setBatches((current) => [confirmed, ...current.filter((item) => item.id !== confirmed.id)])
        confirmedBatches.push(confirmed)
        completed += 1
      }
      await loadWorkspace()
      const ignored = parsed.sheetNames.filter(
        (sheetName) => !candidates.some((candidate) => candidate.parsed.selectedSheet === sheetName),
      )
      setNotice(`${completed} aba(s) importada(s) com sucesso. Backup: ${backup.backup.nome}.${ignored.length ? ` Aba(s) de referência não importadas: ${ignored.join(', ')}.` : ''}`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      const originalMessage = cause instanceof Error
        ? backupCreated
          ? cause.message
          : `Nenhuma aba foi importada porque o backup preventivo falhou: ${cause.message}`
        : backupCreated
          ? 'Não foi possível concluir a importação completa.'
          : 'Nenhuma aba foi importada porque não foi possível criar o backup preventivo.'
      const rolledBack: string[] = []
      const rollbackErrors: string[] = []
      for (const batch of [...confirmedBatches].reverse()) {
        try {
          const reverted = await rollbackAdminImport(
            batch.id,
            'Importação completa interrompida por erro em uma aba posterior.',
          )
          rolledBack.push(batch.aba_nome)
          setBatches((current) => [reverted, ...current.filter((item) => item.id !== reverted.id)])
          if (analysis?.id === reverted.id) setAnalysis(reverted)
        } catch {
          rollbackErrors.push(batch.aba_nome)
        }
      }
      setError(`${originalMessage}${rolledBack.length ? ` As abas já importadas foram revertidas: ${rolledBack.join(', ')}.` : ''}${rollbackErrors.length ? ` Não foi possível reverter automaticamente: ${rollbackErrors.join(', ')}.` : ''}`)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  async function dismissBatch(batch: AdminImportBatch) {
    const confirmed = window.confirm(
      `Remover “${batch.arquivo_nome}” do histórico de importações?\n\n` +
        'Apenas o registro do lote será removido desta lista. Os dados importados permanecem no sistema. ' +
        'A exclusão de dados operacionais deve ser feita pelo PCM.',
    )
    if (!confirmed) return
    setBusy(`dismiss:${batch.id}`)
    setError('')
    setNotice('')
    try {
      await dismissAdminImportBatch(batch.id)
      setBatches((current) => current.filter((item) => item.id !== batch.id))
      setNotice(`“${batch.arquivo_nome}” foi removida do histórico. Os dados da empresa foram preservados.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover o lote do histórico.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="dashboard-loading">Carregando Central de Importação…</div>

  return (
    <section className="admin-import-center">
      {error ? <div className="dashboard-error" role="alert"><strong>Importação interrompida.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      {isHubMode ? (
        <section className={`admin-import-hub${mode === 'hub' ? ' is-double' : ' is-detached'}`}>
          <header><h2>{mode === 'hub' ? 'Importar e exportar dados' : hubImportOnly ? 'Importar dados' : 'Exportar dados'}</h2></header>
          <div ref={hubSplitRef} className="admin-import-hub__split" data-orientation={hubOrientation} data-count={mode === 'hub' ? hubVisibleZones.length : 1} aria-label="Áreas de importação e exportação">
            {(mode === 'hub' ? hubZoneOrder.filter((zone) => hubVisibleZones.includes(zone)) : [hubImportOnly ? 'import' : 'export'] as const).map((zone) => {
              const importing = zone === 'import'
              const groups = importing ? groupedModels : exportGroups
              const groupDescription = (group: string) => ({
                Estrutura: 'Plantas, setores e linhas da empresa.',
                'Cadastro técnico': 'Equipamentos, ativos e componentes.',
                Almoxarifado: 'Materiais, peças e valores de referência.',
              }[group] ?? group)
              return (
                <section
                  key={zone}
                  className={`admin-import-zone admin-import-zone--${zone}${dragOverHubZone === zone ? ' is-drop-target' : ''}${draggedHubZone === zone ? ' is-dragging' : ''}`}
                  data-zone={zone}
                  aria-label={importing ? 'Zona de importação' : 'Zona de exportação'}
                  onDragOver={(event) => {
                    if (mode !== 'hub' || hubVisibleZones.length > 1 || !Array.from(event.dataTransfer.types).includes('text/plain')) return
                    event.preventDefault()
                    event.stopPropagation()
                    setDragOverHubZone(zone)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDragOverHubZone(null)
                  }}
                  onDrop={(event) => {
                    if (mode !== 'hub' || hubVisibleZones.length > 1) return
                    const detachedZone = importExportZoneFromDraggedTab(event.dataTransfer)
                    if (!detachedZone || hubVisibleZones.includes(detachedZone)) return
                    event.preventDefault()
                    event.stopPropagation()
                    attachHubZone(detachedZone, zone, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
                    setDragOverHubZone(null)
                  }}
                >
                  <header className="admin-import-zone__header">
                    <div><h3>{importing ? 'Importar' : 'Exportar'}</h3><span>{importing ? `${catalog?.modelos.length ?? 0} modelos disponíveis` : 'Dados atuais da empresa · XLSX, CSV, JSON e XML'}</span></div>
                    {canMoveHubZones ? <button
                      className="admin-import-zone__move-corner"
                      type="button"
                      aria-label={`Mover zona ${importing ? 'Importar' : 'Exportar'}`}
                      title="Arraste pela quina para reorganizar ou solte fora da aba para destacar esta zona."
                      onPointerDown={(event) => beginHubZoneMove(event, zone)}
                      onPointerMove={moveHubZone}
                      onPointerUp={finishHubZoneMove}
                      onPointerCancel={cancelHubZoneMove}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setHubZoneOrder(importing ? ['export', 'import'] : ['import', 'export'])
                      }}
                    /> : null}
                    <button className="admin-import-zone__master" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onOpenSection?.('master', importing ? 'import' : 'export')}>
                      {importing ? 'Importar planilha mestre' : 'Exportar planilha mestre'}
                    </button>
                  </header>
                  <nav className="admin-import-hub__tabs" aria-label={`${importing ? 'Importar' : 'Exportar'} por grupo de dados`}>
                    {groups.map(([group]) => {
                      const label = group === 'Cadastro técnico' ? `${importing ? 'Importar' : 'Exportar'} ativos` : `${importing ? 'Importar' : 'Exportar'} ${group.toLocaleLowerCase('pt-BR')}`
                      const description = groupDescription(group)
                      return (
                      <button key={group} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onOpenSection?.(group === 'Estrutura' ? 'structure' : group === 'Cadastro técnico' ? 'technical' : 'stock', importing ? 'import' : 'export')} aria-label={`${label}. ${description}`}>
                        <strong title={description} className="admin-import-hub__label">{label}</strong>
                      </button>
                    )})}
                  </nav>
                  {importing ? <footer className="admin-import-zone__footer"><span>{batches.length} lote(s) registrado(s)</span><button className="admin-import-hub__history" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onOpenHistory}>Abrir lotes importados</button></footer> : <footer className="admin-import-zone__footer"><span>{exportGroups.reduce((count, [, models]) => count + models.length, 0)} cadastros legíveis pela sessão</span><span>Arraste a zona para fora para destacá-la.</span></footer>}
                </section>
              )
            })}
            {mode === 'hub' && hubVisibleZones.length === 0 ? <div
              className={`admin-import-zone-empty${dragOverHubZone ? ' is-drop-target' : ''}`}
              onDragOver={(event) => {
                if (!Array.from(event.dataTransfer.types).includes('text/plain')) return
                event.preventDefault()
                event.stopPropagation()
                setDragOverHubZone('import')
              }}
              onDragLeave={() => setDragOverHubZone(null)}
              onDrop={(event) => {
                const detachedZone = importExportZoneFromDraggedTab(event.dataTransfer)
                if (!detachedZone) return
                event.preventDefault()
                event.stopPropagation()
                attachHubZone(detachedZone)
                setDragOverHubZone(null)
              }}
            ><strong>As zonas foram destacadas</strong><span>Arraste uma janela destacada para cá ou use os botões para recolocá-la.</span><div><button type="button" onClick={() => attachHubZone('import')}>Recolocar Importar</button><button type="button" onClick={() => attachHubZone('export')}>Recolocar Exportar</button></div></div> : null}
          </div>
        </section>
      ) : null}

      {mode === 'prepare' || mode === 'export' ? (
        <nav className="admin-import-model-tabs" role="tablist" aria-label={exporting ? 'Cadastros para exportar' : 'Modelos para importar'}>
          {(exporting ? exportModels : visibleModels).map((model) => (
            <button key={model.tipo} id={`import-model-${model.tipo}`} type="button" role="tab" aria-controls="import-workbench" aria-selected={selectedType === model.tipo} className={selectedType === model.tipo ? 'is-active' : ''} onClick={() => changeModel(model.tipo)}>
              <span>{model.nome}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {mode === 'master' ? <div className="admin-import-master-note" title="Aceita XLSX, XLS, CSV ou JSON. Para vários cadastros, use uma aba por modelo no Excel ou listas nomeadas no JSON. Cada cadastro é validado antes de confirmar.">Importar vários cadastros ou exportar um modelo mestre para preenchimento</div> : null}
      {exporting ? <div className="admin-import-master-note" title="O arquivo contém os cadastros atuais disponíveis para a empresa da sessão. A exportação é interrompida se a leitura indicar que algum registro ficou de fora.">{exportingMaster ? 'Exportar os cadastros atuais da empresa em um arquivo.' : 'Exportar os dados atuais deste cadastro.'} CSV · JSON · XML · XLSX</div> : null}
      {exporting && category === 'Almoxarifado' ? <div className="admin-import-export-limit">A exportação atual inclui materiais. Valores por componente e fontes de referência ainda não têm leitura disponível.</div> : null}

      {!isHubMode ? <div className="admin-import-layout">
        {mode === 'prepare' || mode === 'master' || mode === 'export' || exportingMaster ? <section id="import-workbench" className="admin-import-workbench" role="tabpanel" aria-labelledby={importingMaster || exportingMaster ? undefined : `import-model-${selectedType}`}>
          {selectedModel ? (
            <>
              <header className="admin-import-workbench__header">
                <div title={importingMaster ? 'Carregue um arquivo com abas ou listas de diferentes cadastros compatíveis.' : exporting ? 'Exporta os registros atuais vinculados à empresa selecionada.' : selectedModel.descricao}>
                  <span className="eyebrow">{importingMaster ? 'IMPORTAÇÃO GERAL' : exportingMaster ? 'EXPORTAÇÃO GERAL' : selectedModel.grupo}</span>
                  <h2>{importingMaster || exportingMaster ? 'Planilha mestre' : selectedModel.nome}</h2>
                </div>
                <div className="admin-import-workbench__actions">
                  {importingMaster ? <button type="button" disabled={Boolean(busy)} onClick={() => void downloadMasterTemplate()}>{busy === 'template' ? 'Gerando…' : 'Baixar modelo mestre'}</button> : exporting ? <><select aria-label="Formato de exportação" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as AdminImportExportFormat)}><option value="xlsx">XLSX</option><option value="csv">CSV</option><option value="json">JSON</option><option value="xml">XML</option></select><button type="button" disabled={Boolean(busy)} onClick={() => void exportCurrentData()}>{busy === 'export-current' ? 'Exportando…' : exportingMaster ? 'Exportar cadastros' : 'Exportar dados atuais'}</button></> : <button type="button" disabled={Boolean(busy)} onClick={() => void downloadAdminImportTemplate(selectedModel)}>Baixar modelo</button>}
                </div>
              </header>

              {!importingMaster && !exporting ? <div className="admin-import-required-fields">
                <span>Campos obrigatórios</span>
                {selectedModel.campos.filter((field) => field.obrigatorio).map((field) => <b key={field.chave} title={`Coluna: ${field.chave}`}>{field.rotulo}</b>)}
              </div> : null}

              {!importingMaster && !exporting ? <details className="admin-import-fill-tips">
                <summary>Como preencher</summary>
                <ul>{selectedModel.campos.map((field) => (
                  <li key={field.chave}><strong>{field.rotulo}</strong><span>{field.obrigatorio ? 'Obrigatório' : 'Opcional'}</span>{field.exemplo !== '' ? <small>Ex.: {displayValue(field.exemplo)}</small> : null}{field.aliases.length ? <small>Também aceito: {field.aliases.join(', ')}</small> : null}</li>
                ))}</ul>
                <p>CSV e Excel: use os cabeçalhos do modelo. JSON individual: envie uma lista de objetos com esses mesmos campos. Não use fórmulas nem objetos/listas dentro de um campo. Campos opcionais podem ficar vazios; referências de planta, setor, linha ou ativo precisam existir.</p>
              </details> : null}

              {exporting ? <div className="admin-import-export-summary"><span>{exportingMaster ? `${exportModels.length} cadastros atuais para exportar` : `${selectedModel.nome} · dados atuais da empresa`}</span><small>{exportingMaster ? 'A planilha mestre terá uma aba por cadastro.' : 'Escolha o formato e exporte a base vinculada à sessão.'}</small></div> : null}

              {!exporting ? <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void readFile(file)
                }}
              /> : null}

              {!exporting && !parsed ? (
                <button
                  className={`admin-import-dropzone${isDraggingFile ? ' is-dragging' : ''}`}
                  type="button"
                  disabled={busy === 'reading'}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false) }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDraggingFile(false)
                    const file = event.dataTransfer.files[0]
                    if (file) void readFile(file)
                  }}
                >
                  <span className="admin-import-dropzone__icon">↑</span>
                  <strong>{busy === 'reading' ? 'Lendo arquivo…' : 'Selecionar arquivo de dados'}</strong>
                  <small title={`Formatos aceitos: XLSX, XLS, CSV ou JSON. Limite do arquivo: 8 MB.${importingMaster ? ' O limite de linhas é validado separadamente para cada cadastro.' : ` Máximo de ${selectedModel.max_linhas} linhas por modelo.`}`}>XLSX, XLS, CSV ou JSON · {importingMaster ? 'limite por cadastro' : `até ${selectedModel.max_linhas} linhas`}</small>
                </button>
              ) : !exporting && parsed ? (
                <section className="admin-import-file-card">
                  <header><div><CheckIcon /><span><strong>{parsed.fileName}</strong><small>{parsed.rows.length} linha(s) · {parsed.headers.length} coluna(s){importingMaster ? ` · ${parsed.sheetNames.length} aba(s)/lista(s)` : ''}</small></span></div><div>{importingMaster ? <button type="button" disabled={Boolean(busy)} onClick={() => void importAllSheets()}>{busy === 'bulk-import' ? 'Importando…' : 'Importar planilha mestre'}</button> : null}<button type="button" disabled={Boolean(busy)} onClick={() => resetFile(Boolean(retryContext))}>Trocar arquivo</button></div></header>
                  {parsed.sheetNames.length > 1 ? (
                    <label><span>Aba a importar</span><select value={parsed.selectedSheet} onChange={(event) => selectedFile && void readFile(selectedFile, event.target.value)}>{parsed.sheetNames.map((name) => <option key={name}>{name}</option>)}</select></label>
                  ) : null}
                  <div className="admin-import-preview-table">
                    <table><thead><tr><th>Linha</th>{previewColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 6).map((row) => <tr key={row.__linha}><td>{row.__linha}</td>{previewColumns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody></table>
                  </div>
                  <footer><span>Prévia das primeiras {Math.min(6, parsed.rows.length)} linhas. Fórmulas são bloqueadas.</span><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void analyze()}>{busy === 'validating' ? 'Validando…' : 'Executar pré-análise'}</button></footer>
                </section>
              ) : null}

              {progress ? <div className="admin-import-progress" role="status"><span>Importando {progress.current} de {progress.total}: {progress.label}</span><i /></div> : busy === 'validating' ? <div className="admin-import-progress" role="status"><span>Validando dados e referências…</span><i /></div> : busy === 'confirming' ? <div className="admin-import-progress" role="status"><span>{retryContext?.intent === 'update' ? 'Atualizando planilha e aplicando os registros…' : 'Gravando o lote validado…'}</span><i /></div> : null}

              {duplicateBatch ? <section className="admin-import-analysis admin-import-analysis--concluido" aria-live="polite">
                <header><div><CheckIcon /><span><strong>Conteúdo já importado</strong><small>Lote existente {duplicateBatch.id} · {formatDate(duplicateBatch.confirmado_em || duplicateBatch.criado_em)}</small></span></div></header>
                <p className="admin-import-ignored">Esta planilha não tem correções pendentes: o conteúdo já foi aceito no lote abaixo. A mensagem de duplicidade não indica erro nos campos; ela impede gravar os mesmos dados duas vezes.</p>
                <div className="admin-import-analysis__metrics"><article><span>Total importado</span><strong>{duplicateBatch.total_linhas}</strong></article><article><span>Criados</span><strong>{duplicateBatch.resultado.criados ?? duplicateBatch.linhas_validas}</strong></article><article><span>Atualizados</span><strong>{duplicateBatch.resultado.atualizados ?? 0}</strong></article><article><span>Com erro</span><strong>{duplicateBatch.linhas_invalidas}</strong></article></div>
                <div className="admin-import-records">{duplicateBatch.registros.map((record) => <article key={record.id} className={record.erros.length ? 'has-error' : ''}><span>Linha {record.linha_numero}</span><strong>{record.entidade_id || 'ID não gerado'}</strong><b>{record.operacao}</b>{record.erros.length ? <ul>{record.erros.map((item) => <li key={`${item.codigo}:${item.mensagem}`}>{item.mensagem}</li>)}</ul> : <small>{record.status === 'APLICADO' ? 'Já importado com sucesso.' : `Status: ${record.status}`}</small>}</article>)}</div>
              </section> : null}
              {analysis ? (
                <section className={`admin-import-analysis admin-import-analysis--${analysis.status.toLowerCase()}`}>
                  <header><div>{analysis.linhas_invalidas ? <AlertIcon /> : <CheckIcon />}<span><strong>{batchStatusLabel(analysis.status)}</strong><small>Lote {analysis.id} · nenhum dado oculto na validação</small></span></div>{analysis.status === 'VALIDADO' ? <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void confirm()}>{busy === 'confirming' ? 'Importando…' : 'Confirmar importação'}</button> : null}</header>
                  <div className="admin-import-analysis__metrics"><article><span>Total</span><strong>{analysis.total_linhas}</strong></article><article><span>Válidas</span><strong>{analysis.linhas_validas}</strong></article><article className={analysis.linhas_invalidas ? 'is-danger' : ''}><span>Com erro</span><strong>{analysis.linhas_invalidas}</strong></article><article><span>Ignoradas</span><strong>{analysis.cabecalhos_ignorados.length}</strong></article></div>
                  {analysis.cabecalhos_ignorados.length ? <p className="admin-import-ignored">Colunas não reconhecidas e ignoradas: {analysis.cabecalhos_ignorados.join(', ')}</p> : null}
                  <div className="admin-import-records">{analysis.registros.map((record) => <article key={record.id} className={record.erros.length ? 'has-error' : ''}><span>Linha {record.linha_numero}</span><strong>{record.entidade_id || 'ID não gerado'}</strong><b>{record.operacao}</b>{record.erros.length ? <ul>{record.erros.map((item) => <li key={`${item.codigo}:${item.campo ?? ''}:${item.mensagem}`}>{item.campo ? <><b>Campo {item.campo}:</b> {item.mensagem}</> : item.mensagem}</li>)}</ul> : <small>Referências e tipos conferidos.</small>}</article>)}</div>
                </section>
              ) : null}
            </>
          ) : <div className="admin-empty-state">Nenhum modelo de importação disponível.</div>}
        </section> : mode === 'history' ? <section id="import-workbench" className="admin-import-history" role="tabpanel">
        <header><div><h2>Registro de importações</h2><p>Arquivos, resultados e correções de cada importação.</p></div><button className="admin-import-history__demo-toggle" type="button" aria-expanded={showDemoLots} onClick={() => setShowDemoLots((current) => !current)}>{showDemoLots ? 'Fechar exemplos' : 'Ver exemplos'}</button></header>
        {showDemoLots ? <p className="admin-import-demo-note" role="note">Exemplos fictícios · estas linhas não foram gravadas na empresa.</p> : null}
        <input
          ref={historyFileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            const request = pendingRetryRef.current
            pendingRetryRef.current = null
            if (!file || !request) return
            onOpenReimport?.(request, file)
          }}
        />
        <div className="admin-import-batch-list">
          {displayedBatches.length ? displayedBatches.map((batch) => {
            const isDemo = batch.id.startsWith('DEMO-')
            const batchModel = catalog?.modelos.find((model) => model.tipo === batch.tipo)
            const batchTypeLabel = batchModel?.nome ?? (batch.tipo === 'usuarios' ? 'Usuários' : batch.entidade.replaceAll('_', ' '))
            const status = batchStatusOverrides[batch.id] ?? batch.status
            const isProcessing = status === 'PROCESSANDO' || status === 'CORRIGINDO' || status === 'ATUALIZANDO'
            const canReimport = status === 'COM_ERROS' || status === 'FALHOU'
            const canDismiss = status === 'CONCLUIDO'
            const isExpanded = expandedBatchIds.has(batch.id)
            const invalidRecords = batch.registros.filter((record) => record.erros.length > 0 || record.status === 'INVALIDO')
            const canExpand = !isProcessing
            const rowAction = canReimport ? 'correct' : status === 'CONCLUIDO' ? 'update' : null
            const canRunRowAction = rowAction && catalog?.modelos.some((model) => model.tipo === batch.tipo)
            return <article key={batch.id} className={`${isDemo ? 'is-demo ' : ''}${isExpanded ? 'is-expanded' : ''}`}>
              <button
                className="admin-import-batch-trigger"
                type="button"
                disabled={!canExpand}
                aria-expanded={isExpanded}
                aria-label={`${batch.arquivo_nome}. ${!canExpand ? `${batchStatusLabel(status)} em andamento` : isExpanded ? 'Recolher resultados' : 'Mostrar resultados'}`}
                onClick={() => setExpandedBatchIds((current) => {
                  const next = new Set(current)
                  if (next.has(batch.id)) next.delete(batch.id)
                  else next.add(batch.id)
                  return next
                })}
              >
                <span className={`admin-import-status admin-import-status--${status.toLowerCase()} ${isProcessing ? 'admin-import-help-cursor' : ''}`} title={isProcessing ? 'A operação está em andamento.' : undefined}>{batchStatusLabel(status)}</span>
                <span className="admin-import-batch-list__file"><strong>{batch.arquivo_nome}</strong><small>Tipo de cadastro: {batchTypeLabel}</small><small>{batchActorAndDate(batch, status)}</small>{isProcessing ? <><span className="admin-import-batch-progress"><i className={status !== 'PROCESSANDO' ? 'is-indeterminate' : ''} style={status === 'PROCESSANDO' ? { width: `${Math.round((batch.linhas_validas / Math.max(batch.total_linhas, 1)) * 100)}%` } : undefined} /></span><small>{status === 'PROCESSANDO' ? `${batch.linhas_validas} de ${batch.total_linhas} linhas · ${estimateCompletion(batch.criado_em, batch.linhas_validas, batch.total_linhas)}` : status === 'ATUALIZANDO' ? 'Aplicando os dados da planilha…' : 'Validando e aplicando as correções…'}</small></> : null}{status === 'COM_ERROS' ? <small className="has-error">{batch.linhas_invalidas} linha(s) com erro · abra para corrigir</small> : null}{status !== 'COM_ERROS' && batch.linhas_invalidas > 0 ? <small className="has-error">{batch.linhas_invalidas} linha(s) com erro</small> : null}{batch.resultado.motivo ? <small className={status === 'FALHOU' ? 'has-error' : ''}>{batch.resultado.motivo}</small> : null}</span>
              </button>
              {canRunRowAction ? <button
                className="admin-import-batch-corner-action"
                type="button"
                disabled={Boolean(busy) || !onOpenReimport}
                aria-label={`${rowAction === 'correct' ? 'Corrigir' : 'Atualizar'} ${batch.arquivo_nome}`}
                onClick={() => {
                  if (isDemo) {
                    setNotice('Este lote é apenas uma demonstração. A ação fica disponível em lotes reais.')
                    return
                  }
                  if (rowAction) requestBatchFile(batch, rowAction)
                }}
              >{rowAction === 'correct' ? 'Corrigir' : 'Atualizar'}</button> : null}
              {isExpanded && (status === 'COM_ERROS' || status === 'FALHOU') ? <section className="admin-import-batch-errors" aria-label="Erros que precisam de correção">
                <h3>Linhas que precisam de correção</h3>
                <p>Corrija a planilha e envie novamente um arquivo do mesmo tipo de cadastro. O nome do arquivo pode ser diferente.</p>
                {invalidRecords.map((record) => <div key={record.id}><strong>Linha {record.linha_numero}</strong><ul>{record.erros.length ? record.erros.map((item) => <li key={`${item.codigo}:${item.campo ?? ''}:${item.mensagem}`}>{item.campo ? <><b>Campo {item.campo}:</b> {item.mensagem}</> : item.mensagem}</li>) : <li>Registro inválido. Confira os campos obrigatórios e as referências.</li>}</ul></div>)}
              </section> : null}
              {isExpanded && status !== 'COM_ERROS' ? <div className="admin-import-batch-expanded">
                <div className="admin-import-batch-result-rows" aria-label="Resultados do processamento">
                  <div className="admin-import-help-cursor" title={batchMetricTooltip(batch, 'read')}><strong>Lidas</strong><b>{batch.total_linhas}</b></div>
                  <div className="admin-import-help-cursor" title={batchMetricTooltip(batch, 'created')}><strong>Criadas</strong><b>{batch.resultado.criados ?? '—'}</b></div>
                  <div className="admin-import-help-cursor" title={batchMetricTooltip(batch, 'updated')}><strong>Atualizadas</strong><b>{batch.resultado.atualizados ?? '—'}</b></div>
                </div>
                {status === 'REVERTIDO' ? <p className="admin-import-batch-details__empty">Lote revertido{batch.rollback_em ? ` em ${formatDate(batch.rollback_em)}` : ''}.</p> : null}
              </div> : null}
              {isExpanded && !isDemo ? <div className="admin-import-batch-actions" aria-label="Ações do lote">
                {!isDemo ? <button className="admin-import-batch-action admin-import-help-cursor" type="button" disabled={Boolean(busy)} title="Escolha um formato para baixar os dados deste lote." onClick={() => { setExportError(''); setExportBatchTarget(batch) }}>Exportar dados</button> : null}
                {canDismiss ? <button className="admin-import-batch-action admin-import-help-cursor" type="button" disabled={isDemo || Boolean(busy)} title="Remove só o registro do histórico. Os dados importados ficam no sistema." onClick={() => !isDemo && void dismissBatch(batch)}>{busy === `dismiss:${batch.id}` ? 'Removendo…' : 'Remover do histórico'}</button> : null}
              </div> : null}
            </article>
          }) : <div className="admin-empty-state">Nenhum lote registrado.</div>}
        </div>
        {exportBatchTarget ? createPortal(<div className="admin-catalog-dialog admin-import-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setExportBatchTarget(null) }}>
          <section className="admin-import-export-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-import-export-title" aria-describedby="admin-import-export-description">
            <header><div><span className="eyebrow">EXPORTAÇÃO DO LOTE</span><h2 id="admin-import-export-title">Escolha o formato do arquivo</h2><p id="admin-import-export-description">Os dados serão baixados para o seu computador.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => setExportBatchTarget(null)}>Fechar</button></header>
            <div className="admin-import-export-options">
              <button type="button" disabled={Boolean(busy)} onClick={() => void exportBatch(exportBatchTarget, 'xlsx')}><strong>Excel (.xlsx)</strong><small>Planilha pronta para abrir no Excel.</small></button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void exportBatch(exportBatchTarget, 'csv')}><strong>CSV (.csv)</strong><small>Dados em texto separados por vírgulas.</small></button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void exportBatch(exportBatchTarget, 'json')}><strong>JSON (.json)</strong><small>Dados estruturados para integração.</small></button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void exportBatch(exportBatchTarget, 'xml')}><strong>XML (.xml)</strong><small>Dados estruturados em etiquetas.</small></button>
            </div>
            {exportError ? <p className="admin-import-export-error" role="alert">{exportError}</p> : null}
            {busy.startsWith('export:') ? <p className="admin-import-export-progress" role="status">Preparando o arquivo para download…</p> : null}
          </section>
        </div>, document.body) : null}
        </section> : null}
      </div> : null}
    </section>
  )
}
