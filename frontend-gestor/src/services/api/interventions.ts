import type { AdminIntervention, AdminInterventionInput, AdminInterventionRoute } from '../../types/interventions'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError('Sessão administrativa não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
}

export async function listAdminInterventions(signal?: AbortSignal): Promise<AdminIntervention[]> {
  const response = await callApi<{ total: number; intervencoes: AdminIntervention[] }>(
    'admin.intervencoes.listar',
    { token: adminToken(), limite: 500 },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou as intervenções.', 'ADMIN_INTERVENTIONS_EMPTY')
  return Array.isArray(response.data.intervencoes) ? response.data.intervencoes : []
}

export async function saveAdminIntervention(input: AdminInterventionInput): Promise<AdminIntervention> {
  const response = await callApi<{ saved: boolean; intervencao: AdminIntervention }>(
    'admin.intervencoes.salvar',
    { token: adminToken(), dados: input, user_agent: navigator.userAgent },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data) throw new ApiRequestError('A API não confirmou a intervenção.', 'ADMIN_INTERVENTIONS_EMPTY')
  return response.data.intervencao
}

export async function sendAdminInterventionForValidation(input: AdminInterventionRoute): Promise<void> {
  const response = await callApi<{ sent: boolean }>(
    'admin.intervencoes.enviar_validacao',
    { token: adminToken(), ...input, user_agent: navigator.userAgent },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data?.sent) throw new ApiRequestError('A API não confirmou o envio da intervenção.', 'ADMIN_INTERVENTIONS_EMPTY')
}
