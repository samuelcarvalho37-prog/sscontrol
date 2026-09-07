import { useState, type FormEvent } from 'react'
import { resetAdminUserPassword } from '../services/api/admin'
import type { AdminUser } from '../types/admin'

interface PasswordResetDialogProps {
  user: AdminUser
  onClose: () => void
  onReset: (message: string) => void
}

function passwordMeetsRules(value: string): boolean {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
}

export function PasswordResetDialog({ user, onClose, onReset }: PasswordResetDialogProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!passwordMeetsRules(password)) {
      setError('A senha precisa ter 8 caracteres, letra maiúscula, minúscula e número.')
      return
    }
    if (password !== confirmation) {
      setError('A confirmação da senha não corresponde.')
      return
    }

    setSubmitting(true)
    try {
      const result = await resetAdminUserPassword(user.id, password)
      onReset(
        `Senha temporária definida. ${result.sessoes_revogadas} sessão(ões) foram encerradas e o primeiro acesso será exigido.`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível redefinir a senha.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="review-overlay" role="presentation">
      <section className="identity-dialog identity-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
        <header className="identity-dialog__header">
          <div>
            <span className="eyebrow">RECUPERAÇÃO ADMINISTRATIVA</span>
            <h2 id="password-reset-title">Redefinir senha</h2>
            <p>{user.nome} · {user.matricula}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <form className="identity-form" onSubmit={(event) => void submit(event)}>
          <p className="identity-note">Todas as sessões atuais serão revogadas. A nova senha será temporária e deverá ser substituída no próximo acesso.</p>
          {error ? <div className="feedback feedback--error" role="alert">{error}</div> : null}
          <label>
            <span>Nova senha temporária</span>
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" autoFocus />
          </label>
          <label>
            <span>Confirmar senha</span>
            <input type={showPassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" />
          </label>
          <label className="show-password-control">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            Exibir senha
          </label>
          <footer className="identity-dialog__footer">
            <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Redefinindo…' : 'Redefinir senha'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
