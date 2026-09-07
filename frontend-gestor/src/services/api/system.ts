import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'

export interface SystemHealthData {
  version: string
  release_version?: string
  spreadsheetId?: string
  spreadsheet_id?: string
  environment?: string
}

export interface GestorWarmupData {
  warmed: boolean
  version: string
  perfil: string
  usuario_id: string
  elapsed_internal_ms: number
  loaded?: Record<string, number>
  loaded_tables?: number
}

export async function getSystemHealth(
  signal?: AbortSignal,
): Promise<SystemHealthData> {
  const response = await callApi<SystemHealthData>(
    'sistema.health',
    {},
    signal,
    {
      timeoutMs: API_TIMEOUT_MS.FAST_READ,
      dedupe: true,
    },
  )

  if (!response.data) {
    throw new ApiRequestError(
      'A API não retornou o diagnóstico do sistema.',
      'HEALTH_EMPTY_RESPONSE',
    )
  }

  return response.data
}

export async function warmupGestor(
  token: string,
  signal?: AbortSignal,
): Promise<GestorWarmupData> {
  const response = await callApi<GestorWarmupData>(
    'sistema.warmup',
    { token },
    signal,
    {
      timeoutMs: API_TIMEOUT_MS.DETAIL_READ,
      dedupe: true,
    },
  )

  if (!response.data) {
    throw new ApiRequestError(
      'A API não confirmou a preparação do painel.',
      'WARMUP_EMPTY_RESPONSE',
    )
  }

  return response.data
}
