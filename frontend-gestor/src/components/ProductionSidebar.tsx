import type { GestorSection } from './AppNavigation'
import { CameraIcon, ChecklistIcon, HomeIcon, PlusIcon, SettingsIcon } from './Icons'
import './ProductionSidebar.css'

type Props = { active: GestorSection; canRequest: boolean; canScan: boolean; onNavigate: (section: GestorSection) => void }

export function ProductionSidebar({ active, canRequest, canScan, onNavigate }: Props) {
  return <aside className="production-sidebar" aria-label="Navegação da produção">
    <span className="production-sidebar__label">ÁREA DA PRODUÇÃO</span>
    <nav>
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}><HomeIcon />Painel da Produção</button>
      {canRequest ? <button type="button" aria-current={active === 'shared' ? 'page' : undefined} onClick={() => onNavigate('shared')}><PlusIcon />Solicitar OS</button> : null}
      <button type="button" aria-current={active === 'home' ? 'page' : undefined} onClick={() => { onNavigate('home'); window.setTimeout(() => document.querySelector('.production-overview__requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }}><ChecklistIcon />Minhas solicitações</button>
      {canScan ? <button type="button" aria-current={active === 'scan' ? 'page' : undefined} onClick={() => onNavigate('scan')}><CameraIcon />Ler QR Code</button> : null}
    </nav>
    <div className="production-sidebar__footer"><button type="button" aria-current={active === 'more' ? 'page' : undefined} onClick={() => onNavigate('more')}><SettingsIcon />Minha conta</button><small>VORQIX · operação</small></div>
  </aside>
}
