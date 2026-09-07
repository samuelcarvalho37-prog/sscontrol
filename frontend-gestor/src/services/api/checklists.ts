import type {
  AdminChecklistDetail,
  AdminChecklistItem,
  AdminChecklistPlan,
  AdminChecklistRevisionResult,
  AdminChecklistSaveResult,
  AdminChecklistSendInput,
  AdminChecklistSendResult,
} from '../../types/checklists'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError('Sessão administrativa não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
}

export async function listAdminChecklistModels(signal?: AbortSignal): Promise<AdminChecklistPlan[]> {
  const response = await callApi<{ total: number; modelos: AdminChecklistPlan[] }>(
    'admin.listar_modelos_checklist',
    { token: adminToken(), limite: 300 },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou os modelos de checklist.', 'ADMIN_CHECKLIST_EMPTY')
  return Array.isArray(response.data.modelos) ? response.data.modelos : []
}

export async function getAdminChecklistDetail(
  planId: string,
  signal?: AbortSignal,
): Promise<AdminChecklistDetail> {
  const response = await callApi<AdminChecklistDetail>(
    'admin.detalhe_modelo_checklist',
    { token: adminToken(), plano_id: planId },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou o checklist.', 'ADMIN_CHECKLIST_EMPTY')
  return response.data
}

export async function saveAdminChecklistModel(
  plan: AdminChecklistPlan,
  items: AdminChecklistItem[],
): Promise<AdminChecklistSaveResult> {
  const response = await callApi<AdminChecklistSaveResult>(
    'admin.salvar_modelo_checklist',
    { token: adminToken(), plano: plan, itens: items, user_agent: navigator.userAgent },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError('A API não confirmou o checklist.', 'ADMIN_CHECKLIST_EMPTY')
  return response.data
}

export async function convertAdminTechnicalAnalysisToChecklist(
  analysisId: string,
  plan: AdminChecklistPlan,
  items: AdminChecklistItem[],
): Promise<AdminChecklistSaveResult> {
  const response = await callApi<AdminChecklistSaveResult>(
    'admin.analises_tecnicas.converter',
    {
      token: adminToken(),
      analise_id: analysisId,
      plano: plan,
      itens: items,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) {
    throw new ApiRequestError(
      'A API não confirmou a conversão da análise técnica.',
      'ADMIN_CHECKLIST_CONVERSION_EMPTY',
    )
  }
  return response.data
}

export async function sendAdminChecklistForValidation(
  input: AdminChecklistSendInput,
): Promise<AdminChecklistSendResult> {
  const response = await callApi<AdminChecklistSendResult>(
    'admin.enviar_modelo_checklist_validacao',
    { token: adminToken(), ...input, user_agent: navigator.userAgent },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError('A API não confirmou o envio para validação.', 'ADMIN_CHECKLIST_EMPTY')
  return response.data
}

export async function createAdminChecklistRevision(
  planId: string,
): Promise<AdminChecklistRevisionResult> {
  const response = await callApi<AdminChecklistRevisionResult>(
    'admin.criar_revisao_modelo_checklist',
    {
      token: adminToken(),
      plano_id: planId,
      justificativa: 'Nova revisão criada pelo Command Workspace.',
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError('A API não confirmou a nova revisão.', 'ADMIN_CHECKLIST_EMPTY')
  return response.data
}

export async function deleteAdminChecklistDraft(planId: string): Promise<void> {
  const response = await callApi<{ deleted: boolean; plano_id: string }>(
    'admin.excluir_modelo_checklist',
    {
      token: adminToken(),
      plano_id: planId,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data?.deleted) {
    throw new ApiRequestError(
      'O servidor protegeu o modelo porque ele já possui validação, publicação ou vínculo operacional.',
      'ADMIN_CHECKLIST_DELETE_REJECTED',
    )
  }
}
