import type { AdminUser, TechnicalRole } from '../types/admin'
import type {
  ValidationRouteDraft,
  ValidationSignaturePolicy,
} from '../types/validation'
import { CheckIcon, ShieldIcon, UsersIcon } from './Icons'

interface ValidationPolicySelectorProps {
  value: ValidationRouteDraft
  users: AdminUser[]
  roles: TechnicalRole[]
  onChange: (value: ValidationRouteDraft) => void
  allowCustom?: boolean
}

const OPTIONS: Array<{
  value: ValidationSignaturePolicy
  title: string
  detail: string
}> = [
  {
    value: 'QUALIDADE_OU_SEGURANCA',
    title: 'Qualidade ou Segurança',
    detail: 'A primeira assinatura válida conclui o filtro.',
  },
  {
    value: 'QUALIDADE',
    title: 'Somente Qualidade',
    detail: 'Exige assinatura de um técnico da Qualidade.',
  },
  {
    value: 'SEGURANCA',
    title: 'Somente Segurança',
    detail: 'Exige assinatura de um técnico de Segurança.',
  },
  {
    value: 'QUALIDADE_E_SEGURANCA',
    title: 'Qualidade e Segurança',
    detail: 'As duas áreas precisam assinar a mesma versão.',
  },
  {
    value: 'PERSONALIZADA',
    title: 'Validador autorizado',
    detail: 'Escolha uma pessoa de confiança com permissão de assinatura.',
  },
]

export function ValidationPolicySelector({
  value,
  users,
  roles,
  onChange,
  allowCustom = true,
}: ValidationPolicySelectorProps) {
  const authorizedRoleIds = new Set(
    roles
      .filter((role) => String(role.pode_assinar).toUpperCase() === 'SIM')
      .map((role) => role.id),
  )
  const validators = users.filter(
    (user) =>
      user.perfil === 'GESTOR' &&
      user.status === 'ATIVO' &&
      Boolean(user.cargo_id && authorizedRoleIds.has(user.cargo_id)),
  )

  function selectPolicy(policy: ValidationSignaturePolicy) {
    onChange({
      ...value,
      politica_assinatura: policy,
      responsavel_atual_id:
        policy === 'PERSONALIZADA' ? value.responsavel_atual_id : '',
      usuarios_validadores:
        policy === 'PERSONALIZADA'
          ? value.usuarios_validadores
          : [],
    })
  }

  return (
    <section className="validation-policy-selector">
      <header>
        <ShieldIcon />
        <span>
          <strong>Quem deve assinar?</strong>
          <small>A assinatura fica registrada nesta versão e não será perdida ao encaminhar.</small>
        </span>
      </header>
      <div className="validation-policy-selector__options">
        {OPTIONS.filter((option) => allowCustom || option.value !== 'PERSONALIZADA').map((option) => {
          const selected = value.politica_assinatura === option.value
          return (
            <button
              className={selected ? 'is-selected' : ''}
              type="button"
              key={option.value}
              onClick={() => selectPolicy(option.value)}
            >
              <span>{option.value === 'PERSONALIZADA' ? <UsersIcon /> : <ShieldIcon />}</span>
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              {selected ? <CheckIcon /> : <i />}
            </button>
          )
        })}
      </div>
      {value.politica_assinatura === 'PERSONALIZADA' ? (
        <label>
          <span>Pessoa autorizada *</span>
          <select
            value={value.responsavel_atual_id || ''}
            onChange={(event) => onChange({
              ...value,
              responsavel_atual_id: event.target.value,
              usuarios_validadores: event.target.value
                ? [event.target.value]
                : [],
            })}
          >
            <option value="">Selecione um validador…</option>
            {validators.map((user) => (
              <option value={user.id} key={user.id}>
                {user.nome} · {user.matricula}
              </option>
            ))}
          </select>
          {!validators.length ? (
            <small>Cadastre um Gestor com cargo autorizado a assinar.</small>
          ) : null}
        </label>
      ) : null}
    </section>
  )
}
