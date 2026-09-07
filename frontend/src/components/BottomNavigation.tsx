import { HomeIcon, QrIcon, SettingsIcon } from './Icons'

export type AppSection = 'home' | 'qr' | 'settings'

export interface BottomNavigationProps {
  active: AppSection
  onChange: (section: AppSection) => void
}

const items = [
  { id: 'home' as const, label: 'Início', Icon: HomeIcon },
  { id: 'qr' as const, label: 'QR Code', Icon: QrIcon },
  { id: 'settings' as const, label: 'Configurações', Icon: SettingsIcon },
]

export function BottomNavigation({ active, onChange }: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="Navegação principal">
      {items.map(({ id, label, Icon }) => (
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
