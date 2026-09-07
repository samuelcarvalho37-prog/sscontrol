import { useEffect, useState } from 'react'
import type { OperatorStopData } from '../types/api'

interface ActiveStopBannerProps {
  stop: OperatorStopData
  compact?: boolean
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PARADA_ABERTA: 'Aguardando manutenção',
    MANUTENCAO_EM_EXECUCAO: 'Manutenção em execução',
    AGUARDANDO_RETORNO_OPERACIONAL: 'Aguardando retorno da produção',
    FINALIZADA: 'Parada finalizada',
  }
  return labels[status] ?? status.replaceAll('_', ' ')
}

export function ActiveStopBanner({ stop, compact = false }: ActiveStopBannerProps) {
  const [elapsed, setElapsed] = useState(stop.elapsed_seconds ?? 0)

  useEffect(() => {
    const start = new Date(stop.iniciada_em).getTime()
    const tick = () => {
      if (Number.isNaN(start)) {
        setElapsed(stop.elapsed_seconds ?? 0)
        return
      }
      setElapsed(Math.max(stop.elapsed_seconds ?? 0, (Date.now() - start) / 1000))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [stop.elapsed_seconds, stop.iniciada_em])

  return (
    <article className={compact ? 'active-stop-banner active-stop-banner--compact' : 'active-stop-banner'}>
      <div>
        <span>Equipamento parado</span>
        <strong>{statusLabel(stop.status)}</strong>
        {!compact && <small>{stop.motivo_parada || 'Parada operacional em andamento.'}</small>}
      </div>
      <div className="active-stop-banner__timer">
        <span>Tempo parado</span>
        <strong>{formatDuration(elapsed)}</strong>
      </div>
    </article>
  )
}
