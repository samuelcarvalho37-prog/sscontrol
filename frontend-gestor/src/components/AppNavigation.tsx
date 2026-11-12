import {
  CameraIcon,
  ChartIcon,
  UsersIcon,
  ValidationIcon,
} from './Icons'

export type GestorSection = 'shared' | 'home' | 'validations' | 'maintenance' | 'tracking' | 'scan' | 'admin' | 'more'

export interface AppNavigationProps {
  active: GestorSection
  validationCount: number
  showAdmin: boolean
  canValidate: boolean
  canShared?: boolean
  canReportOccurrence?: boolean
  isTechnician?: boolean
  canReadAnalytics?: boolean
  canManageMaintenance?: boolean
  compactDevice: boolean
  onNavigate: (section: GestorSection) => void
}

const ITEMS = [
  { id: 'shared' as const, label: 'Solicitar OS', Icon: ChartIcon },
  { id: 'home' as const, label: 'Validar', Icon: ValidationIcon },
  { id: 'validations' as const, label: 'Acompanhar', Icon: ChartIcon },
  { id: 'maintenance' as const, label: 'Manutenção', Icon: ChartIcon },
  { id: 'scan' as const, label: 'Ler QR', Icon: CameraIcon },
  { id: 'admin' as const, label: 'Admin', Icon: UsersIcon },
  { id: 'more' as const, label: 'Conta', Icon: UsersIcon },
]

export function AppNavigation({
  active,
  validationCount,
  showAdmin,
  canValidate,
  canShared = false,
  canReportOccurrence = false,
  isTechnician = false,
  canReadAnalytics = true,
  canManageMaintenance = false,
  compactDevice,
  onNavigate,
}: AppNavigationProps) {
  const visibleItems = ITEMS.filter((item) => {
    if (item.id === 'shared') return canShared
    if (item.id === 'admin') return showAdmin
    if (item.id === 'home') return canValidate || isTechnician || canReportOccurrence
    if (item.id === 'validations') return canReadAnalytics
    if (item.id === 'maintenance') return canManageMaintenance
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
          <span>{id === 'home' && isTechnician ? 'Ordens' : id === 'home' && canReportOccurrence && !canValidate ? 'Ocorrências' : label}</span>
        </button>
      ))}
    </nav>
  )
}
