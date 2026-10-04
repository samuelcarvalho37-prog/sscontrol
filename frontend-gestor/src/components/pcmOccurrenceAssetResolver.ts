import { getGestorOccurrence } from '../services/api/gestor'
import type { GestorNotification, GestorOccurrence } from '../types/gestor'

export interface PcmOccurrenceAssetContext {
  occurrenceId: string
  assetId: string
  assetTag: string
  assetName: string
  occurrenceType: string
}

type OccurrenceLoader = (occurrenceId: string) => Promise<GestorOccurrence>

export type PcmOccurrenceAssetResolution =
  | { status: 'success'; context: PcmOccurrenceAssetContext }
  | { status: 'error'; message: string }
  | { status: 'stale' }

export type PcmOccurrenceNotificationAction =
  | { kind: 'create' }
  | { kind: 'follow'; workOrderId: string; label: string }

export function pcmOccurrenceNotificationAction(
  notification: GestorNotification,
): PcmOccurrenceNotificationAction {
  const workOrderId = text(notification.ordem_servico_id)
  return workOrderId
    ? {
        kind: 'follow',
        workOrderId,
        label: text(notification.ordem_servico_codigo) || 'ordem de serviço',
      }
    : { kind: 'create' }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function canonicalOccurrenceAsset(
  occurrence: GestorOccurrence,
): PcmOccurrenceAssetContext | null {
  const assetId = text(occurrence.ativo_id)
  if (!assetId) return null

  return {
    occurrenceId: occurrence.id,
    assetId,
    assetTag: text(occurrence.ativo_tag),
    assetName: text(occurrence.ativo_nome),
    occurrenceType: text(occurrence.tipo),
  }
}

export function createPcmOccurrenceAssetResolver(
  loadOccurrence: OccurrenceLoader = getGestorOccurrence,
) {
  let activeRequest = 0

  return {
    cancel() {
      activeRequest += 1
    },

    async resolve(occurrenceId: string): Promise<PcmOccurrenceAssetResolution> {
      const requestId = ++activeRequest
      const normalizedId = occurrenceId.trim()
      if (!normalizedId) {
        return {
          status: 'error',
          message: 'A notificação não identifica a ocorrência de origem.',
        }
      }

      try {
        const occurrence = await loadOccurrence(normalizedId)
        if (requestId !== activeRequest) return { status: 'stale' }

        const context = canonicalOccurrenceAsset(occurrence)
        if (!context) {
          return {
            status: 'error',
            message: 'A ocorrência não possui um equipamento válido para criar a ordem de serviço.',
          }
        }

        return { status: 'success', context }
      } catch (cause) {
        if (requestId !== activeRequest) return { status: 'stale' }
        return {
          status: 'error',
          message: cause instanceof Error
            ? `Não foi possível carregar o equipamento da ocorrência. ${cause.message}`
            : 'Não foi possível carregar o equipamento da ocorrência.',
        }
      }
    },
  }
}
