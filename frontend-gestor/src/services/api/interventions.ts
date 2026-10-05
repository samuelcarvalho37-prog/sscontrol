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

export async function getAdminIntervention(id: string, signal?: AbortSignal): Promise<AdminIntervention> {
  const response = await callApi<AdminIntervention>(
    'admin.intervencoes.detalhe',
    { token: adminToken(), intervencao_id: id },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou a intervenção.', 'ADMIN_INTERVENTION_EMPTY')
  return response.data
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

export async function createExternalService(workOrderId: string, input: {
  provider: string
  description: string
  amount: number | null
  serviceDate: string | null
  notes: string | null
}): Promise<void> {
  const response = await callApi<{ servico?: { id: string } }>(
    'work-orders.external-services.create',
    { token: adminToken(), ordem_id: workOrderId, prestador: input.provider, descricao: input.description, valor: input.amount, data_servico: input.serviceDate, observacao: input.notes },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data?.servico) throw new ApiRequestError('A API não confirmou o serviço externo.', 'EXTERNAL_SERVICE_EMPTY')
}

export interface ImprovementRequestSummary {
  id: string
  categoria: 'MODIFICATION' | 'MANUFACTURE' | 'INSTALLATION' | 'ADEQUACY' | 'OTHER'
  sugestao: string
  motivo: string
  status: 'OPEN' | 'CONVERTED' | 'REJECTED'
  ativo_id: string
  ativo_tag: string
  ativo_nome: string
  solicitante_nome: string
  solicitante_matricula: string
  ordem_id: string | null
  ordem_codigo: string | null
}

export async function listImprovementRequests(signal?: AbortSignal): Promise<ImprovementRequestSummary[]> {
  const response = await callApi<{ solicitacoes?: ImprovementRequestSummary[] }>(
    'improvement-requests.list',
    { token: adminToken() },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  return response.data?.solicitacoes ?? []
}

export async function updateMaterialUsageCost(materialUsageId: string, unitCost: number): Promise<void> {
  const response = await callApi<{ consumo?: { id: string } }>(
    'material-usage.cost.update',
    { token: adminToken(), material_usage_id: materialUsageId, valor_unitario: unitCost },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )
  if (!response.data?.consumo) throw new ApiRequestError('A API não confirmou o custo do material.', 'MATERIAL_COST_EMPTY')
}
