import { HomeIcon, QrIcon, SettingsIcon } from './Icons'

export type AppSection = 'shared' | 'home' | 'qr' | 'settings' | 'tools'

export interface BottomNavigationProps {
  canTools?: boolean
  canScan?: boolean
  canShared?: boolean
  active: AppSection
  onChange: (section: AppSection) => void
}

const items = [
  { id: 'shared' as const, label: 'Solicitar OS', Icon: HomeIcon },
  { id: 'home' as const, label: 'Início', Icon: HomeIcon },
  { id: 'tools' as const, label: 'Ferramentas', Icon: SettingsIcon },
  { id: 'qr' as const, label: 'QR Code', Icon: QrIcon },
  { id: 'settings' as const, label: 'Configurações', Icon: SettingsIcon },
]

export function BottomNavigation({ active, onChange, canShared = false, canTools = false, canScan = true }: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="Navegação principal">
      {items.filter(item => (item.id !== 'shared' || canShared) && (item.id !== 'tools' || canTools) && (item.id !== 'qr' || canScan)).map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={active === id ? 'nav-item nav-item--active' : 'nav-item'}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
