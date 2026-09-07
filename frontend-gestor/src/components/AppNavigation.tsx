import {
  CameraIcon,
  ChartIcon,
  UsersIcon,
  ValidationIcon,
} from './Icons'

export type GestorSection = 'home' | 'validations' | 'scan' | 'admin' | 'more'

export interface AppNavigationProps {
  active: GestorSection
  validationCount: number
  showAdmin: boolean
  canValidate: boolean
  compactDevice: boolean
  onNavigate: (section: GestorSection) => void
}

const ITEMS = [
  { id: 'home' as const, label: 'Validar', Icon: ValidationIcon },
  { id: 'validations' as const, label: 'Acompanhar', Icon: ChartIcon },
  { id: 'scan' as const, label: 'Ler QR', Icon: CameraIcon },
  { id: 'admin' as const, label: 'Admin', Icon: UsersIcon },
  { id: 'more' as const, label: 'Conta', Icon: UsersIcon },
]

export function AppNavigation({
  active,
  validationCount,
  showAdmin,
  canValidate,
  compactDevice,
  onNavigate,
}: AppNavigationProps) {
  const visibleItems = ITEMS.filter((item) => {
    if (item.id === 'admin') return showAdmin
    if (item.id === 'home') return canValidate
    if (item.id === 'scan') return compactDevice
    return true
  })
  return (
    <nav className={`app-navigation app-navigation--${visibleItems.length}`} aria-label="Navegação principal do gestor">
      {visibleItems.map(({ id, label, Icon }) => (
        <button
          className={active === id ? 'app-navigation__item is-active' : 'app-navigation__item'}
          type="button"
          key={id}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}
        >
          <span className="app-navigation__icon">
            <Icon />
            {id === 'home' && validationCount > 0 ? (
              <span className="app-navigation__badge">
                {validationCount > 99 ? '99+' : validationCount}
              </span>
            ) : null}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
