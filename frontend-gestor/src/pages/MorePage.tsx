import { ApiConnectionPanel } from '../components/ApiConnectionPanel'
import { API_COMPATIBLE_RELEASE, APP_RELEASE_VERSION } from '../release'
import type { GestorSession } from '../services/api/auth'

export interface MorePageProps {
  session: GestorSession
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function MorePage({ session }: MorePageProps) {
  return (
    <main className="content more-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">CONTA E SESSÃO</span>
          <h1>Minha conta</h1>
          <p>Identidade autenticada, validade da sessão e conexão do aplicativo.</p>
        </div>
      </section>

      <section className="more-layout">
        <ApiConnectionPanel />

        <section className="session-panel">
          <div className="connection-panel__heading">
            <div><span className="eyebrow">SESSÃO ATUAL</span><h2>Identidade autenticada</h2></div>
            <span className="status-chip status-chip--success">Ativa</span>
          </div>
          <dl>
            <div><dt>Nome</dt><dd>{session.user.nome}</dd></div>
            <div><dt>Matrícula</dt><dd>{session.user.matricula}</dd></div>
            <div><dt>Perfil</dt><dd>{session.user.perfil}</dd></div>
            <div><dt>Início</dt><dd>{formatDate(session.startedAt)}</dd></div>
            <div><dt>Expiração</dt><dd>{formatDate(new Date(session.expiresAt).toISOString())}</dd></div>
            <div><dt>Aplicativo</dt><dd>{APP_RELEASE_VERSION}</dd></div>
            <div><dt>Contrato da API</dt><dd>{API_COMPATIBLE_RELEASE}</dd></div>
          </dl>
        </section>
      </section>
    </main>
  )
}
