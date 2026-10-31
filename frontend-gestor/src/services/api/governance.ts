import type {
  AdminAuditListData,
  AdminBackupCreateData,
  AdminBackupListData,
  AdminBackupRestorePreparation,
  AdminBackupRestoreResult,
  AdminDocumentDetailData,
  AdminDocumentFileInput,
  AdminDocumentListData,
  AdminDocumentMetadataInput,
  AdminDocumentStatus,
  AdminDocumentType,
  AdminMonitoringState,
} from '../../types/governance'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getApiUrl, getGestorToken, usesNodeApi } from './config'

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError('Sessão administrativa não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
}

async function readGovernance<T>(
  action: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await callApi<T>(
    action,
    { token: adminToken(), ...payload },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: !signal },
  )
  if (!response.data) throw new ApiRequestError(`A API não retornou dados para ${action}.`, 'ADMIN_GOVERNANCE_EMPTY')
  return response.data
}

async function writeGovernance<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const response = await callApi<T>(
    action,
    { token: adminToken(), user_agent: navigator.userAgent, ...payload },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError(`A API não confirmou ${action}.`, 'ADMIN_GOVERNANCE_EMPTY')
  return response.data
}

export function listAdminDocuments(
  filters: { busca?: string; status?: AdminDocumentStatus | ''; tipo?: AdminDocumentType | '' } = {},
  signal?: AbortSignal,
): Promise<AdminDocumentListData> {
  return readGovernance('admin.documentos.listar', { ...filters, limite: 500 }, signal)
}

export function getAdminDocument(documentId: string): Promise<AdminDocumentDetailData> {
  return readGovernance('admin.documentos.detalhe', { documento_id: documentId })
}

export async function openAdminDocumentFile(detail: AdminDocumentDetailData): Promise<void> {
  if (!detail.arquivo_url) {
    throw new ApiRequestError('O arquivo desta revisão não está disponível.', 'DOCUMENT_FILE_MISSING')
  }
  if (!usesNodeApi()) {
    window.open(detail.arquivo_url, '_blank', 'noopener,noreferrer')
    return
  }

  const baseUrl = getApiUrl().replace(/\/+$/u, '').replace(/\/v1$/u, '')
  const path = detail.arquivo_url.startsWith('/') ? detail.arquivo_url : `/${detail.arquivo_url}`
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  if (!response.ok) {
    let message = `Não foi possível abrir o arquivo (HTTP ${response.status}).`
    try {
      const envelope = await response.json() as { error?: { message?: string } }
      message = envelope.error?.message ?? message
    } catch {
      // A mensagem HTTP preserva um retorno seguro quando a resposta não é JSON.
    }
    throw new ApiRequestError(message, 'DOCUMENT_FILE_DOWNLOAD_FAILED', { status: response.status })
  }
  const objectUrl = URL.createObjectURL(await response.blob())
  const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  if (!opened) {
    URL.revokeObjectURL(objectUrl)
    throw new ApiRequestError(
      'O navegador bloqueou a abertura do arquivo. Permita pop-ups para este endereço.',
      'DOCUMENT_FILE_POPUP_BLOCKED',
    )
  }
}

export function uploadAdminDocument(
  metadata: AdminDocumentMetadataInput,
  file: AdminDocumentFileInput,
): Promise<{ saved: boolean; documento: AdminDocumentDetailData['documento'] }> {
  return writeGovernance('admin.documentos.upload', { dados: metadata, arquivo: file })
}

export function updateAdminDocument(
  metadata: AdminDocumentMetadataInput,
): Promise<{ saved: boolean; documento: AdminDocumentDetailData['documento'] }> {
  return writeGovernance('admin.documentos.atualizar', { dados: metadata })
}

export function listAdminAudit(
  filters: { busca?: string; acao?: string; entidade?: string; usuario_id?: string; responsavel_id?: string; limite?: number; deslocamento?: number } = {},
  signal?: AbortSignal,
): Promise<AdminAuditListData> {
  const requestedLimit = Number.isFinite(filters.limite) ? Math.floor(filters.limite ?? 200) : 200
  const limite = Math.min(500, Math.max(1, requestedLimit))
  return readGovernance('admin.auditoria.listar', {
    busca: filters.busca,
    grupo_acao: filters.acao,
    entidade: filters.entidade,
    responsavel_id: filters.responsavel_id ?? filters.usuario_id,
    limite,
    deslocamento: filters.deslocamento ? filters.deslocamento : undefined,
  }, signal)
}

export function getAdminMonitoring(signal?: AbortSignal): Promise<AdminMonitoringState> {
  return readGovernance('admin.monitoramento.estado', {}, signal)
}

export function listAdminBackups(signal?: AbortSignal): Promise<AdminBackupListData> {
  return readGovernance('admin.backups.listar', { limite: 200 }, signal)
}

export interface AdminBackupFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<AdminBackupFileHandle>
}

export async function chooseAdminBackupSaveLocation(fileName: string): Promise<AdminBackupFileHandle | null> {
  const picker = (window as SavePickerWindow).showSaveFilePicker
  if (!picker) return null
  return picker.call(window, {
    suggestedName: fileName,
    types: [{ description: 'Backup VORQIX · JSON compactado', accept: { 'application/gzip': ['.gz'] } }],
  })
}

export async function downloadAdminBackup(
  backupId: string,
  fileName: string,
  selectedHandle?: AdminBackupFileHandle | null,
): Promise<void> {
  let fileHandle = selectedHandle
  if (selectedHandle === undefined) {
    try {
      fileHandle = await chooseAdminBackupSaveLocation(fileName || `VORQIX-backup-${backupId}.json.gz`)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      throw cause
    }
  }

  const baseUrl = getApiUrl().replace(/\/+$/u, '').replace(/\/v1$/u, '')
  const response = await fetch(
    `${baseUrl}/v1/admin/backups/${encodeURIComponent(backupId)}/file`,
    { headers: { Authorization: `Bearer ${adminToken()}` } },
  )
  if (!response.ok) {
    throw new ApiRequestError(
      `Não foi possível baixar o backup (HTTP ${response.status}).`,
      'BACKUP_DOWNLOAD_FAILED',
    )
  }
  const backupFile = await response.blob()
  if (fileHandle) {
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(backupFile)
      await writable.close()
    } catch (cause) {
      await writable.abort().catch(() => undefined)
      throw cause
    }
    return
  }

  const url = URL.createObjectURL(backupFile)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName || `VORQIX-backup-${backupId}.json.gz`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function createAdminBackup(reason: string, confirmation: string, scopes: readonly string[] = ['OPERACIONAL', 'IMPORTACOES']): Promise<AdminBackupCreateData> {
  return writeGovernance('admin.backups.criar', { motivo: reason, confirmacao: confirmation, escopos: [...scopes] })
}

export function prepareAdminBackupRestore(backupId: string, scopes?: readonly string[]): Promise<AdminBackupRestorePreparation> {
  return writeGovernance('admin.backups.preparar_restauracao', { backup_id: backupId, ...(scopes ? { escopos: [...scopes] } : {}) })
}

export function confirmAdminBackupRestore(input: {
  token: string
  backupId: string
  challenge: string
  finalConfirmation: string
  reason: string
}): Promise<AdminBackupRestoreResult> {
  return writeGovernance('admin.backups.confirmar_restauracao', {
    token: input.token,
    backup_id: input.backupId,
    confirmacao: input.challenge,
    confirmacao_final: input.finalConfirmation,
    motivo: input.reason,
    criar_backup_seguranca: true,
  })
}
