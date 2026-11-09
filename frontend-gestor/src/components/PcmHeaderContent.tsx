import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PcmHeaderContent({ slot, children, tools = false }: { slot: string; children: ReactNode; tools?: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setHost(document.getElementById(slot)) }, [slot])
  if (!host) return <>{children}</>
  return createPortal(<div className={tools ? 'pcm-canvas pcm-header-tools' : 'pcm-header-content'}>{children}</div>, host)
}
