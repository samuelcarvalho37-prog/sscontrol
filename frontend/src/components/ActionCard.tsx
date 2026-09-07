import type {
  ActionAvailabilityState,
  OperatorAction,
} from '../types/operator'

export interface ActionCardProps {
  action: OperatorAction
  compact?: boolean
  nowMs?: number
  onOpen: (action: OperatorAction) => void
}

const priorityLabels = {
  BAIXA: 'Prioridade baixa',
  NORMAL: 'Prioridade normal',
  MEDIA: 'Prioridade média',
  ALTA: 'Prioridade alta',
  CRITICA: 'Prioridade crítica',
} as const

export interface ResolvedAvailability {
  state: ActionAvailabilityState
  canStart: boolean
  plannedAt?: string
  secondsUntil: number
  secondsOverdue: number
}

function parseDate(value?: string): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function formatDate(value?: string): string {
  const parsed = parseDate(value)
  if (parsed === null) return 'Data não informada'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function formatDuration(totalSeconds: number, includeSeconds = false): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (includeSeconds) {
    return [hours, minutes, remainingSeconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':')
  }
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min`
  return 'menos de 1 min'
}

export function resolveActionAvailability(
  action: OperatorAction,
  nowMs = Date.now(),
): ResolvedAvailability {
  const plannedAt = action.plannedAt || action.availability?.plannedAt
  const plannedMs = parseDate(plannedAt)
  if (plannedMs === null) {
    return {
      state: 'SEM_AGENDAMENTO',
      canStart: true,
      secondsUntil: 0,
      secondsOverdue: 0,
    }
  }

  const alertMinutes = action.availability?.alertMinutes ?? 60
  const overdueGraceMinutes = action.availability?.overdueGraceMinutes ?? 15
  const differenceSeconds = Math.ceil((plannedMs - nowMs) / 1000)

  if (differenceSeconds > alertMinutes * 60) {
    return {
      state: 'AGENDADA',
      canStart: false,
      plannedAt,
      secondsUntil: differenceSeconds,
      secondsOverdue: 0,
    }
  }

  if (differenceSeconds > 0) {
    return {
      state: 'EM_ALERTA',
      canStart: false,
      plannedAt,
      secondsUntil: differenceSeconds,
      secondsOverdue: 0,
    }
  }

  const secondsOverdue = Math.max(0, Math.floor((nowMs - plannedMs) / 1000))
  return {
    state: secondsOverdue > overdueGraceMinutes * 60 ? 'ATRASADA' : 'DISPONIVEL',
    canStart: true,
    plannedAt,
    secondsUntil: 0,
    secondsOverdue,
  }
}

function scheduleLabel(availability: ResolvedAvailability): {
  title: string
  value: string
  tone: string
} {
  if (availability.state === 'AGENDADA') {
    return {
      title: `Programada para ${formatDate(availability.plannedAt)}`,
      value: `Libera em ${formatDuration(availability.secondsUntil)}`,
      tone: 'scheduled',
    }
  }
  if (availability.state === 'EM_ALERTA') {
    return {
      title: 'Liberação próxima',
      value: formatDuration(availability.secondsUntil, true),
      tone: 'alert',
    }
  }
  if (availability.state === 'ATRASADA') {
    return {
      title: `Programada para ${formatDate(availability.plannedAt)}`,
      value: `Atrasada há ${formatDuration(availability.secondsOverdue)}`,
      tone: 'overdue',
    }
  }
  if (availability.state === 'DISPONIVEL') {
    return {
      title: `Programada para ${formatDate(availability.plannedAt)}`,
      value: 'Disponível agora',
      tone: 'available',
    }
  }
  return {
    title: 'Sem horário restritivo',
    value: 'Disponível agora',
    tone: 'available',
  }
}

export function ActionCard({ action, compact = false, nowMs = Date.now(), onOpen }: ActionCardProps) {
  const availability = resolveActionAvailability(action, nowMs)
  const schedule = scheduleLabel(availability)
  const priorityClass = action.priority.toLowerCase()

  if (compact) {
    return (
      <button
        className={`emergency-row emergency-row--${priorityClass}`}
        type="button"
        onClick={() => onOpen(action)}
      >
        <span className="emergency-row__content">
          <span className={`priority-chip priority-chip--${priorityClass}`}>
            {priorityLabels[action.priority]}
          </span>
          <strong>{action.title}</strong>
          <small>{action.assetTag} — {action.assetName}</small>
          <small>{action.componentTag} · {action.componentName}</small>
          <small className="emergency-row__waiting">
            Aguardando há {formatDuration(Math.max(0, (nowMs - (parseDate(action.generatedAt || action.startAt) ?? nowMs)) / 1000))}
          </small>
        </span>
        <span className="emergency-row__cta">
          {action.status === 'EM_EXECUCAO' ? 'Continuar' : 'Iniciar agora'}
        </span>
      </button>
    )
  }

  return (
    <button
      className={`action-card action-card--${schedule.tone}`}
      type="button"
      onClick={() => onOpen(action)}
    >
      <div className="action-card__heading">
        <div>
          <strong>{action.title}</strong>
          <span>{action.assetTag} — {action.assetName}</span>
          <span>{action.componentTag} — {action.componentName}</span>
        </div>
        <span className="type-chip">{action.type}</span>
      </div>

      <p>{action.description}</p>

      <div className="chip-list">
        <span className={`priority-chip priority-chip--${priorityClass}`}>
          {priorityLabels[action.priority]}
        </span>
        <span className={`availability-chip availability-chip--${schedule.tone}`}>
          {availability.state === 'AGENDADA' && 'Agendada'}
          {availability.state === 'EM_ALERTA' && 'Em alerta'}
          {availability.state === 'DISPONIVEL' && 'Disponível'}
          {availability.state === 'ATRASADA' && 'Atrasada'}
          {availability.state === 'SEM_AGENDAMENTO' && 'Disponível'}
        </span>
        {action.crew.map((crew) => (
          <span className="neutral-chip" key={crew}>{crew}</span>
        ))}
        {action.progress && action.progress.total > 0 && (
          <span className="neutral-chip">
            {action.progress.answered}/{action.progress.total} respondidos
          </span>
        )}
      </div>

      <div className={`countdown-box countdown-box--${schedule.tone}`}>
        <span>{schedule.title}</span>
        <strong>{schedule.value}</strong>
      </div>

      <footer>
        <span>
          {action.durationMinutes
            ? `Duração prevista: ${action.durationMinutes} min`
            : `Status: ${action.status.replaceAll('_', ' ')}`}
        </span>
        <strong>{availability.canStart ? 'Abrir atividade →' : 'Ver agendamento →'}</strong>
      </footer>
    </button>
  )
}
