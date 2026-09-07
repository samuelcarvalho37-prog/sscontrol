import type { GestorTechnicalKpis } from '../../types/gestor'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'
import { getGestorToken } from './config'

export interface AdminKpiFilters {
  ativo_id?: string
  inicio_em?: string
  fim_em?: string
}

function adminToken(): string {
  const token = getGestorToken()
  if (token) return token
  throw new ApiRequestError('Sessão administrativa não encontrada. Entre novamente.', 'GESTOR_SESSION_MISSING')
}

export async function getAdminTechnicalKpis(
  filters: AdminKpiFilters = {},
  signal?: AbortSignal,
): Promise<GestorTechnicalKpis> {
  const response = await callApi<GestorTechnicalKpis>(
    'cmms.kpis_tecnicos',
    { token: adminToken(), ...filters },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ, dedupe: true },
  )
  if (!response.data) throw new ApiRequestError('A API não retornou os indicadores técnicos.', 'ADMIN_KPI_EMPTY')
  return response.data
}
