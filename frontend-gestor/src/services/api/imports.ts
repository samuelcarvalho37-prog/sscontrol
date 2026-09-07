import type {
  AdminImportBatch,
  AdminImportCatalog,
  AdminImportRow,
} from '../../types/imports'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError(
    'Sessão administrativa não encontrada. Entre novamente.',
    'GESTOR_SESSION_MISSING',
  )
}

async function readImportData<T>(
  action: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await callApi<T>(
    action,
    { token: adminToken(), ...payload },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou os dados da importação.', 'IMPORT_EMPTY_RESPONSE')
  return response.data
}

async function writeImportData<T>(
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await callApi<T>(
    action,
    { token: adminToken(), user_agent: navigator.userAgent, ...payload },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError('A API não confirmou a importação.', 'IMPORT_EMPTY_RESPONSE')
  return response.data
}

export function getAdminImportCatalog(signal?: AbortSignal): Promise<AdminImportCatalog> {
  return readImportData<AdminImportCatalog>('admin.importacao.modelos', {}, signal)
}

export async function listAdminImportBatches(
  signal?: AbortSignal,
): Promise<AdminImportBatch[]> {
  const data = await readImportData<{ total: number; lotes: AdminImportBatch[] }>(
    'admin.importacao.lotes',
    { limite: 50 },
    signal,
  )
  return Array.isArray(data.lotes) ? data.lotes : []
}

export function getAdminImportBatch(
  batchId: string,
  signal?: AbortSignal,
): Promise<AdminImportBatch> {
  return readImportData<AdminImportBatch>('admin.importacao.detalhe', { lote_id: batchId }, signal)
}

export function validateAdminImport(input: {
  tipo: string
  arquivo_nome: string
  aba_nome: string
  cabecalhos: string[]
  linhas: AdminImportRow[]
}): Promise<AdminImportBatch> {
  return writeImportData<AdminImportBatch>('admin.importacao.validar', input)
}

export function confirmAdminImport(
  batchId: string,
  validationHash: string,
): Promise<AdminImportBatch> {
  return writeImportData<AdminImportBatch>('admin.importacao.confirmar', {
    lote_id: batchId,
    validacao_hash: validationHash,
  })
}

export function rollbackAdminImport(
  batchId: string,
  reason: string,
): Promise<AdminImportBatch> {
  return writeImportData<AdminImportBatch>('admin.importacao.rollback', {
    lote_id: batchId,
    motivo: reason,
  })
}
