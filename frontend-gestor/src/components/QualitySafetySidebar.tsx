import type { GestorSection } from './AppNavigation'
import './QualitySafetySidebar.css'

type Props = {
  area: 'QUALIDADE' | 'SEGURANCA'
  active: GestorSection
  canRequest: boolean
  canScan: boolean
  onNavigate: (section: GestorSection) => void
  onOpenValidations: () => void
}

export function QualitySafetySidebar({ area, active, canRequest, canScan, onNavigate, onOpenValidations }: Props) {
  const label = area === 'QUALIDADE' ? 'Qualidade' : 'Segurança'
  return <aside className="quality-safety-sidebar" aria-label={`Navegação de ${label}`}>
    <span className="quality-safety-sidebar__label">ÁREA DE {label.toUpperCase()}</span>
    <nav>
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}><b aria-hidden="true">⌂</b> Painel</button>
      {canRequest ? <button type="button" aria-current={active === 'shared' ? 'page' : undefined} onClick={() => onNavigate('shared')}><b aria-hidden="true">＋</b> Solicitar OS</button> : null}
      <button type="button" onClick={onOpenValidations}><b aria-hidden="true">✓</b> Validações</button>
      {canScan ? <button type="button" aria-current={active === 'scan' ? 'page' : undefined} onClick={() => onNavigate('scan')}><b aria-hidden="true">⌁</b> Ler QR Code</button> : null}
    </nav>
    <div className="quality-safety-sidebar__footer">
      <button type="button" aria-current={active === 'more' ? 'page' : undefined} onClick={() => onNavigate('more')}><b aria-hidden="true">◌</b> Minha conta</button>
    </div>
  </aside>
}
