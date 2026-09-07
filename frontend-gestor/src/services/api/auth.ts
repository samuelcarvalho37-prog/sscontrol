import { APP_RELEASE_VERSION, isCompatibleRelease } from '../../release'
import { API_TIMEOUT_MS, ApiRequestError, callApi } from './client'

export interface AuthenticatedGestor {
  id: string
  nome: string
  email: string
  matricula: string
  perfil: string
}

export interface GestorSession {
  token: string
  startedAt: string
  expiresAt: number
  user: AuthenticatedGestor
}

export interface LoginResponseData {
  requires_password_change: boolean
  first_access?: boolean
  change_token?: string
  token?: string
  expira_em?: string
  expira_ms?: number
  usuario: AuthenticatedGestor
  release_version?: string
  api_version?: string
  schema_version?: string
  contract_version?: string
  frontend_version?: string
  warmup_required?: boolean
  warmup_action?: string
}

export interface FirstAccessResponseData {
  password_changed: boolean
  usuario: AuthenticatedGestor
  release_version?: string
}

export interface RecoveryResponseData {
  accepted: boolean
  request_id: string
  message?: string
  release_version?: string
}

export interface MaintenanceAccessResponseData extends LoginResponseData {
  acesso_integral: boolean
  manutencao: {
    aberta: boolean
    estado: 'ABERTA' | 'FECHADA' | 'BLOQUEADA'
    motivo: string
    expira_em: string
    janela_id?: string
    operador_nome?: string
    ambiente?: string
  }
}

function assertReleaseVersion(receivedVersion?: string): void {
  if (isCompatibleRelease(receivedVersion)) return
  throw new ApiRequestError(
    `Versão incompatível. Aplicativo ${APP_RELEASE_VERSION}; API ${receivedVersion || 'não identificada'}.`,
    'VERSION_MISMATCH',
    { expected: APP_RELEASE_VERSION, received: receivedVersion },
  )
}

export async function loginGestor(
  matricula: string,
  senha: string,
  signal?: AbortSignal,
): Promise<LoginResponseData> {
  const response = await callApi<LoginResponseData>(
    'auth.login',
    {
      matricula,
      senha,
      user_agent: navigator.userAgent,
    },
    signal,
    { timeoutMs: API_TIMEOUT_MS.DETAIL_READ },
  )

  if (!response.data) {
    throw new ApiRequestError('A API não retornou os dados de autenticação.', 'AUTH_EMPTY_RESPONSE')
  }

  assertReleaseVersion(response.data.release_version)

  const profile = response.data.usuario.perfil.trim().toUpperCase()
  if (!['GESTOR', 'ADMIN'].includes(profile)) {
    throw new ApiRequestError(
      'Este aplicativo permite acesso apenas aos perfis GESTOR ou ADMIN.',
      'ROLE_NOT_ALLOWED',
      { received: profile },
    )
  }

  return response.data
}

export async function exchangeMaintenanceAccess(
  code: string,
  signal?: AbortSignal,
): Promise<MaintenanceAccessResponseData> {
  const response = await callApi<MaintenanceAccessResponseData>(
    'auth.maintenance.exchange',
    {
      codigo: code,
      user_agent: navigator.userAgent,
    },
    signal,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )

  if (!response.data) {
    throw new ApiRequestError(
      'A API não retornou a sessão interna.',
      'AUTH_EMPTY_RESPONSE',
    )
  }

  assertReleaseVersion(response.data.release_version)
  const profile = response.data.usuario.perfil.trim().toUpperCase()
  if (profile !== 'SISTEMA' || !response.data.acesso_integral) {
    throw new ApiRequestError(
      'A autorização recebida não possui escopo interno.',
      'MAINTENANCE_SCOPE_INVALID',
    )
  }

  return response.data
}

export async function completeFirstAccess(
  changeToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<FirstAccessResponseData> {
  const response = await callApi<FirstAccessResponseData>(
    'auth.first_access.complete',
    {
      change_token: changeToken,
      senha_atual: currentPassword,
      nova_senha: newPassword,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.CRITICAL_WRITE },
  )

  if (!response.data) {
    throw new ApiRequestError('A API não confirmou a alteração da senha.', 'AUTH_EMPTY_RESPONSE')
  }

  assertReleaseVersion(response.data.release_version)
  return response.data
}

export async function requestPasswordRecovery(
  matricula: string,
): Promise<RecoveryResponseData> {
  const response = await callApi<RecoveryResponseData>(
    'auth.recovery.request',
    {
      matricula,
      user_agent: navigator.userAgent,
    },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  )

  if (!response.data) {
    throw new ApiRequestError('A API não confirmou a solicitação.', 'AUTH_EMPTY_RESPONSE')
  }

  assertReleaseVersion(response.data.release_version)
  return response.data
}

export async function revokeGestorSession(token: string): Promise<void> {
  if (!token) return
  await callApi(
    'auth.logout',
    { token },
    undefined,
    { timeoutMs: API_TIMEOUT_MS.SAVE },
  )
}
