import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  listTechnicalAreas,
  listTechnicalRoles,
  saveAdminUser,
} from '../services/api/admin'
import type {
  AdminUser,
  AdminUserInput,
  AdminUserProfile,
  AdminUserStatus,
  TechnicalArea,
  TechnicalRole,
} from '../types/admin'

interface UserEditorDialogProps {
  user: AdminUser | null
  currentUserId: string
  onClose: () => void
  onSaved: (message: string) => void
}

function createTemporaryPassword(): string {
  const bytes = new Uint32Array(3)
  crypto.getRandomValues(bytes)
  return `Fab!${bytes[0].toString(36)}A${bytes[1].toString(36)}7${bytes[2].toString(36)}`.slice(0, 22)
}

function passwordMeetsRules(value: string): boolean {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
}

export function UserEditorDialog({
  user,
  currentUserId,
  onClose,
  onSaved,
}: UserEditorDialogProps) {
  const editing = Boolean(user)
  const editingSelf = user?.id === currentUserId
  const [name, setName] = useState(user?.nome ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [registration, setRegistration] = useState(user?.matricula ?? '')
  const [profile, setProfile] = useState<AdminUserProfile>(user?.perfil ?? 'OPERADOR')
  const [status, setStatus] = useState<AdminUserStatus>(user?.status ?? 'ATIVO')
  const [areaId, setAreaId] = useState(user?.area_id ?? '')
  const [roleId, setRoleId] = useState(user?.cargo_id ?? '')
  const [specialties, setSpecialties] = useState<string>(() => {
    try { return JSON.parse(user?.especialidades_json ?? '[]').join(', ') }
    catch { return '' }
  })
  const [scopeIds, setScopeIds] = useState<string>(() => {
    try { return JSON.parse(user?.escopo_ids_json ?? '[]').join(', ') }
    catch { return '' }
  })
  const [areas, setAreas] = useState<TechnicalArea[]>([])
  const [roles, setRoles] = useState<TechnicalRole[]>([])
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const title = useMemo(
    () => (editing ? `Editar ${user?.nome ?? 'usuário'}` : 'Novo usuário'),
    [editing, user?.nome],
  )

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      listTechnicalAreas(controller.signal),
      listTechnicalRoles('', controller.signal),
    ]).then(([areaData, roleData]) => {
      setAreas(areaData)
      setRoles(roleData)
    }).catch(() => {
      // O cadastro continua disponÃ­vel mesmo se o catÃ¡logo tÃ©cnico falhar.
    })
    return () => controller.abort()
  }, [])

  const availableRoles = roles.filter((role) => !areaId || role.area_id === areaId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (name.trim().length < 3) {
      setError('Informe o nome completo do usuário.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(registration.trim())) {
      setError('A matrícula deve ter de 3 a 40 caracteres alfanuméricos.')
      return
    }
    if (!editing && !passwordMeetsRules(temporaryPassword)) {
      setError('A senha temporária precisa ter 8 caracteres, letra maiúscula, minúscula e número.')
      return
    }

    const input: AdminUserInput = {
      id: user?.id,
      nome: name.trim(),
      email: email.trim().toLowerCase(),
      matricula: registration.trim(),
      perfil: profile,
      status,
      senha_temporaria: editing ? undefined : temporaryPassword,
      area_id: profile === 'GESTOR' ? areaId : '',
      cargo_id: profile === 'GESTOR' ? roleId : '',
      especialidades: profile === 'GESTOR'
        ? specialties.split(',').map((value: string) => value.trim()).filter(Boolean)
        : [],
      escopo_ids: profile === 'GESTOR'
        ? scopeIds.split(',').map((value: string) => value.trim()).filter(Boolean)
        : [],
    }

    setSubmitting(true)
    try {
      const result = await saveAdminUser(input)
      const revoked = result.sessoes_revogadas
        ? ` ${result.sessoes_revogadas} sessão(ões) antiga(s) foram encerradas.`
        : ''
      onSaved(
        result.mode === 'insert'
          ? `Usuário criado. A senha temporária deverá ser alterada no primeiro acesso.${revoked}`
          : `Usuário atualizado.${revoked}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o usuário.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="review-overlay" role="presentation">
      <section
        className="identity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-editor-title"
      >
        <header className="identity-dialog__header">
          <div>
            <span className="eyebrow">IDENTIDADE E ACESSO</span>
            <h2 id="user-editor-title">{title}</h2>
            <p>Dados de acesso vinculados à matrícula e ao perfil operacional.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <form className="identity-form" onSubmit={(event) => void submit(event)}>
          {error ? <div className="feedback feedback--error" role="alert">{error}</div> : null}

          <div className="identity-form__grid">
            <label className="identity-form__wide">
              <span>Nome completo</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </label>
            <label>
              <span>Matrícula</span>
              <input value={registration} onChange={(event) => setRegistration(event.target.value)} />
            </label>
            <label>
              <span>E-mail</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>Perfil</span>
              <select
                value={profile}
                disabled={editingSelf}
                onChange={(event) => setProfile(event.target.value as AdminUserProfile)}
              >
                <option value="OPERADOR">Operador</option>
                <option value="GESTOR">Gestor</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={status}
                disabled={editingSelf}
                onChange={(event) => setStatus(event.target.value as AdminUserStatus)}
              >
                <option value="ATIVO">Ativo</option>
                <option value="INATIVO">Inativo</option>
              </select>
            </label>
            {profile === 'GESTOR' ? (
              <>
                <label>
                  <span>Ãrea tÃ©cnica</span>
                  <select
                    value={areaId}
                    onChange={(event) => {
                      setAreaId(event.target.value)
                      setRoleId('')
                    }}
                  >
                    <option value="">Gestor sem Ã¡rea definida</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>{area.nome}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cargo tÃ©cnico</span>
                  <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                    <option value="">Sem cargo especÃ­fico</option>
                    {availableRoles.map((role) => (
                      <option key={role.id} value={role.id}>{role.nome}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Especialidades</span>
                  <input
                    value={specialties}
                    onChange={(event) => setSpecialties(event.target.value)}
                    placeholder="ElÃ©trica, mecÃ¢nica, metrologia"
                  />
                </label>
                <label>
                  <span>Escopo (IDs de setor/linha)</span>
                  <input
                    value={scopeIds}
                    onChange={(event) => setScopeIds(event.target.value)}
                    placeholder="SET-01, LIN-02"
                  />
                </label>
              </>
            ) : null}
          </div>

          {editingSelf ? (
            <p className="identity-note">Seu próprio perfil e status ficam protegidos durante a sessão atual.</p>
          ) : null}

          {!editing ? (
            <section className="temporary-password-panel">
              <div>
                <strong>Senha temporária</strong>
                <small>O usuário será obrigado a criar uma nova senha no primeiro acesso.</small>
              </div>
              <div className="temporary-password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={temporaryPassword}
                  onChange={(event) => setTemporaryPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setTemporaryPassword(createTemporaryPassword())}>
                  Gerar senha
                </button>
              </div>
              <label className="show-password-control">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                />
                Exibir senha temporária
              </label>
            </section>
          ) : null}

          <footer className="identity-dialog__footer">
            <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar usuário'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
