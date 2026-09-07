export type ConnectionState = 'checking' | 'online' | 'offline' | 'unconfigured'

export interface AppHeaderProps {
  operatorName: string
  shift: string
  connectionState: ConnectionState
}

const connectionLabels: Record<ConnectionState, string> = {
  checking: 'Verificando',
  online: 'Online',
  offline: 'Offline',
  unconfigured: 'Configurar',
}

export function AppHeader({
  operatorName,
  shift,
  connectionState,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <strong>Olá, {operatorName}</strong>
        <span>Operador · {shift}</span>
      </div>
      <div className={`online-badge online-badge--${connectionState}`}>
        <span aria-hidden="true" />
        {connectionLabels[connectionState]}
      </div>
    </header>
  )
}
