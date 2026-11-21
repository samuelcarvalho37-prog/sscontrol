import type { GestorSection } from './AppNavigation'
import {
  CameraIcon,
  ChecklistIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
  WrenchIcon,
} from './Icons'
import './TechnicianWorkspace.css'

type Props = {
  active: GestorSection
  canRequest: boolean
  canScan: boolean
  onNavigate: (section: GestorSection) => void
}

export function TechnicianSidebar({ active, canRequest, canScan, onNavigate }: Props) {
  return <aside className="technician-sidebar" aria-label="Navegação do técnico">
    <span className="technician-sidebar__label">ÁREA DO TÉCNICO</span>
    <nav>
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}><HomeIcon />Painel técnico</button>
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => { onNavigate('home'); window.setTimeout(() => document.querySelector('#technician-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}><ChecklistIcon />Minhas OS</button>
      {canRequest ? <button type="button" aria-current={active === 'shared' ? 'page' : undefined} onClick={() => onNavigate('shared')}><PlusIcon />Solicitar OS</button> : null}
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => { onNavigate('home'); window.setTimeout(() => document.querySelector('#technician-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}><WrenchIcon />Histórico</button>
      {canScan ? <button type="button" aria-current={active === 'scan' ? 'page' : undefined} onClick={() => onNavigate('scan')}><CameraIcon />Ler QR Code</button> : null}
    </nav>
    <div className="technician-sidebar__footer">
      <button type="button" aria-current={active === 'more' ? 'page' : undefined} onClick={() => onNavigate('more')}><SettingsIcon />Minha conta</button>
      <small>VORQIX · manutenção</small>
    </div>
  </aside>
}
