import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

export interface ActiveTechnician { id: string; nome: string; matricula: string | null }

function token(): string {
  const value = getGestorToken()
  if (!value) throw new ApiRequestError('Sessão não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
  return value
}

export async function listActiveTechnicians(): Promise<ActiveTechnician[]> {
  const response = await callApi<{ tecnicos?: ActiveTechnician[] }>('maintenance.technicians.list', { token: token() }, undefined, { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true })
  if (!response.data) throw new ApiRequestError('A API não retornou os técnicos ativos.', 'TECHNICIANS_EMPTY')
  return Array.isArray(response.data.tecnicos) ? response.data.tecnicos : []
}

export async function assignMaintenanceAction(actionId: string, technicianId: string, supportTechnicianIds: string[] = []): Promise<void> {
  const response = await callApi('maintenance.actions.assign', { token: token(), acao_id: actionId, responsavel_id: technicianId, tecnicos_apoio_ids: supportTechnicianIds }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  if (!response.data) throw new ApiRequestError('A API não confirmou a atribuição.', 'ACTION_ASSIGNMENT_EMPTY')
}

export async function releaseMaintenanceWorkOrder(workOrderId: string): Promise<void> {
  const response = await callApi('maintenance.work-orders.release', { token: token(), ordem_id: workOrderId }, undefined, { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE })
  if (!response.data) throw new ApiRequestError('A API não confirmou a liberação da OS.', 'WORK_ORDER_RELEASE_EMPTY')
}
