import type {
  AdminEntity,
  AdminEntityActionInput,
  AdminEntityActionResult,
  AdminEntityList,
  AdminEntityRecord,
  AdminEntitySaveResult,
} from '../../types/catalog'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError('Sessão administrativa não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
}

export async function listAdminEntity(
  entity: AdminEntity,
  signal?: AbortSignal,
): Promise<AdminEntityList> {
  const response = await callApi<AdminEntityList>(
    'admin.listar',
    { token: adminToken(), entidade: entity, limite: 500 },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError(`A API não retornou ${entity}.`, 'ADMIN_ENTITY_EMPTY')
  return response.data
}

export async function saveAdminEntity(
  entity: AdminEntity,
  data: AdminEntityRecord,
): Promise<AdminEntitySaveResult> {
  const response = await callApi<AdminEntitySaveResult>(
    'admin.salvar',
    {
      token: adminToken(),
      entidade: entity,
      dados: data,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError(`A API não confirmou o cadastro de ${entity}.`, 'ADMIN_ENTITY_EMPTY')
  return response.data
}

export async function actionAdminEntity(
  input: AdminEntityActionInput,
): Promise<AdminEntityActionResult> {
  const response = await callApi<AdminEntityActionResult>(
    'admin.entidade.acao',
    {
      token: adminToken(),
      ...input,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError(`A API não confirmou a ação em ${input.entidade}.`, 'ADMIN_ENTITY_EMPTY')
  return response.data
}
