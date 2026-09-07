import { useEffect, useMemo, useState } from 'react'

export interface CountdownProps {
  target: string
}

function formatRemaining(milliseconds: number) {
  if (milliseconds <= 0) {
    return 'Disponível agora'
  }

  const total = Math.floor(milliseconds / 1000)
  const hours = String(Math.floor(total / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

export function Countdown({ target }: CountdownProps) {
  const timestamp = useMemo(() => new Date(target).getTime(), [target])
  const [remaining, setRemaining] = useState(() => timestamp - Date.now())

  useEffect(() => {
    const update = () => setRemaining(timestamp - Date.now())
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [timestamp])

  return <strong>{formatRemaining(remaining)}</strong>
}
