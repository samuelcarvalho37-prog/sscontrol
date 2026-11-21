import { callApi } from './client'
import { getGestorToken } from './config'

export interface PcmMonthlyOrders { month: string; preventive: number; corrective: number }

export function pcmMonthlyWindows(now: Date) {
  return Array.from({ length: 6 }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - 4 + index, 1)
    return { month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, start: start.toISOString(), end: new Date(Math.min(now.getTime(), end.getTime() - 1)).toISOString() }
  })
}

export async function getPcmMonthlyOrders(assetId: string, signal: AbortSignal, now = new Date()): Promise<PcmMonthlyOrders[]> {
  const windows = pcmMonthlyWindows(now)
  const result: PcmMonthlyOrders[] = new Array(windows.length)
  let next = 0
  // Reuse the existing read endpoint with at most two requests in flight.
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < windows.length && !signal.aborted) {
      const index = next++
      const window = windows[index]
      const response = await callApi<{ relatorios?: { ordens?: { por_tipo?: { tipo: string; quantidade: number }[] } } }>('cmms.pcm_dashboard', {
        token: getGestorToken(), ativo_id: assetId || undefined, inicio_em: window.start, fim_em: window.end,
      }, signal)
      const types = response.data?.relatorios?.ordens?.por_tipo
      if (!Array.isArray(types)) throw new Error('O histórico mensal não está disponível nesta resposta.')
      result[index] = { month: window.month, preventive: Number(types.find(item => item.tipo === 'PREVENTIVE')?.quantidade ?? 0), corrective: Number(types.find(item => item.tipo === 'CORRECTIVE')?.quantidade ?? 0) }
    }
  }))
  if (signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
  return result
}
