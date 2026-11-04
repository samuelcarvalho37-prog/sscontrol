import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePcmChartPresentation } from './PcmChartPresentation'

export function PcmPointAppearanceEditor({ id, label, color, onClose }: { id: string; label: string; color: string; onClose: () => void }) {
  const presentation = usePcmChartPresentation()
  const [primary, setPrimary] = useState(color.slice(0, 7))
  const [secondary, setSecondary] = useState(presentation.pointGradientEnds?.[id]?.slice(0, 7) ?? '#63a2df')
  const [gradient, setGradient] = useState(Boolean(presentation.pointGradientEnds?.[id]))
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [position, setPosition] = useState({ top: 190, left: 20, background: '#fff', color: '#183b56' })
  useLayoutEffect(() => {
    const update = () => {
      const card = anchor.current?.closest('.pcm-canvas__widget')
      if (!card) return
      const rect = card.getBoundingClientRect()
      const colors = getComputedStyle(card)
      const surface = colors.getPropertyValue('--pcm-widget-background').trim()
      const background = !surface || surface === 'transparent' ? card.getAttribute('data-card-tone') === 'dark' ? '#183b56' : '#ffffff' : surface
      const width = Math.min(320, window.innerWidth - 24)
      const height = panel.current?.getBoundingClientRect().height ?? 260
      setPosition({ left: Math.max(12, Math.min(rect.right - width - 12, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.top + 35, window.innerHeight - height - 12)), background, color: colors.getPropertyValue('--pcm-widget-content').trim() || '#183b56' })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !(event.target instanceof Element && event.target.closest('.pcm-canvas__widget') === anchor.current?.closest('.pcm-canvas__widget'))) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [onClose])
  if (!presentation.onPointAppearanceChange) return null
  return <><span ref={anchor} hidden />{createPortal(<section ref={panel} role="dialog" className="pcm-point-appearance" style={{ position: 'fixed', top: position.top, left: position.left, background: position.background === 'transparent' ? '#183b56' : position.background, color: position.color, zIndex: 2147483647 }} aria-label={`Personalizar cor de ${label}`} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <header><div><small>COR DO ELEMENTO</small><strong>{label}</strong></div><button type="button" onClick={onClose} aria-label="Fechar editor de cor">×</button></header>
    <div className="pcm-point-appearance__modes"><button type="button" aria-pressed={!gradient} onClick={() => setGradient(false)}>Cor sólida</button><button type="button" aria-pressed={gradient} onClick={() => setGradient(true)}>Degradê</button></div>
    <div className="pcm-point-appearance__preview" style={{ background: gradient ? `linear-gradient(90deg, ${primary}, ${secondary})` : primary }} />
    <div className="pcm-point-appearance__colors"><label>Cor primária<input type="color" value={primary} onChange={event => setPrimary(event.target.value)} /></label>{gradient ? <label>Cor secundária<input type="color" value={secondary} onChange={event => setSecondary(event.target.value)} /></label> : null}</div>
    <footer><button type="button" onClick={() => { presentation.onPointAppearanceChange?.(id); onClose() }}>Restaurar</button><button type="button" onClick={() => { presentation.onPointAppearanceChange?.(id, primary, gradient ? secondary : undefined); onClose() }}>Confirmar cor</button></footer>
  </section>, document.body)}</>
}
