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
  filters: { busca?: string; acao?: string; entidade?: string; usuario_id?: string } = {},
  signal?: AbortSignal,
): Promise<AdminAuditListData> {
  return readGovernance('admin.auditoria.listar', { ...filters, limite: 500 }, signal)
}

export function getAdminMonitoring(signal?: AbortSignal): Promise<AdminMonitoringState> {
  return readGovernance('admin.monitoramento.estado', {}, signal)
}

export function listAdminBackups(signal?: AbortSignal): Promise<AdminBackupListData> {
  return readGovernance('admin.backups.listar', { limite: 200 }, signal)
}

export async function downloadAdminBackup(backupId: string, fileName: string): Promise<void> {
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
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName || `backup-${backupId}.json.gz`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function createAdminBackup(reason: string, confirmation: string): Promise<AdminBackupCreateData> {
  return writeGovernance('admin.backups.criar', { motivo: reason, confirmacao: confirmation })
}

export function prepareAdminBackupRestore(backupId: string): Promise<AdminBackupRestorePreparation> {
  return writeGovernance('admin.backups.preparar_restauracao', { backup_id: backupId })
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
