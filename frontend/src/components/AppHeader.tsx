export type ConnectionState = 'checking' | 'online' | 'offline' | 'unconfigured'

export interface AppHeaderProps {
  operatorName: string
  roleLabel: string
  shift: string
  connectionState: ConnectionState
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

const connectionLabels: Record<ConnectionState, string> = {
  checking: 'Verificando',
  online: 'Online',
  offline: 'Offline',
  unconfigured: 'Configurar',
}

export function AppHeader({
  operatorName,
  roleLabel,
  shift,
  connectionState,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <img className="vorqix-logo vorqix-logo--compact" src="/vorqix-logo.png" alt="VORQIX — Unidade Industrial" />
        <strong>Olá, {operatorName}</strong>
        <span>{roleLabel} · {shift}</span>
      </div>
      <div className="app-header__actions">
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}>
          <span className="theme-toggle__icon" aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span><span className="theme-toggle__label">Tema</span>
        </button>
        <div className={`online-badge online-badge--${connectionState}`}>
          <span aria-hidden="true" />
          {connectionLabels[connectionState]}
        </div>
      </div>
    </header>
  )
}
