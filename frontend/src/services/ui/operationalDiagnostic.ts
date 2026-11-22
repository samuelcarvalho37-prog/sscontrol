import { ApiRequestError } from '../api/client'

export type OperationalDiagnosticKind = 'offline' | 'permission' | 'session' | 'timeout' | 'service'

export interface OperationalDiagnostic {
  kind: OperationalDiagnosticKind
  title: string
  message: string
}

export function describeOperationalFailure(cause: unknown): OperationalDiagnostic {
  const raw = cause instanceof Error ? cause.message : ''
  const normalized = raw.toUpperCase()

  if (!navigator.onLine || cause instanceof ApiRequestError && cause.code === 'NETWORK_ERROR') {
    return {
      kind: 'offline',
      title: 'Sem conexão com o VORQIX',
      message: 'Verifique a rede deste aparelho e tente novamente. Os dados já salvos não foram alterados.',
    }
  }

  if (cause instanceof ApiRequestError && cause.code === 'API_TIMEOUT') {
    return {
      kind: 'timeout',
      title: 'A consulta demorou mais que o esperado',
      message: 'A API ainda não respondeu. Aguarde alguns segundos e toque em “Tentar novamente”; nenhuma operação será repetida automaticamente.',
    }
  }

  if (normalized.includes('FORBIDDEN') || normalized.includes('PERMISS') || normalized.includes('HTTP 403')) {
    return {
      kind: 'permission',
      title: 'Acesso não liberado para este perfil',
      message: 'Seu perfil pode continuar consultando as áreas permitidas, mas não possui autorização para esta operação. Solicite a liberação ao PCM ou TI.',
    }
  }

  if (normalized.includes('UNAUTHORIZED') || normalized.includes('HTTP 401') || normalized.includes('SESSÃO')) {
    return {
      kind: 'session',
      title: 'Sessão expirada',
      message: 'Entre novamente com sua matrícula para atualizar as permissões e continuar o trabalho.',
    }
  }

  return {
    kind: 'service',
    title: 'Atualização indisponível',
    message: raw || 'Não foi possível obter os dados agora. Tente novamente em instantes.',
  }
}
