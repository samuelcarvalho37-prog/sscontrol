import { useCallback, useEffect, useState } from 'react'
import { listAdminUsers } from '../services/api/admin'
import { getAdminMonitoring, listAdminAudit } from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminUser } from '../types/admin'
import type { AdminAuditEvent, AdminMonitoringState } from '../types/governance'
import { SearchIcon, ShieldIcon } from './Icons'

interface AdminGovernanceWorkspaceProps {
  onSessionExpired: () => void
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function safePretty(value?: string): string {
  if (!value) return 'Sem estado registrado.'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

export function AdminGovernanceWorkspace({ onSessionExpired }: AdminGovernanceWorkspaceProps) {
  const [monitoring, setMonitoring] = useState<AdminMonitoringState | null>(null)
  const [events, setEvents] = useState<AdminAuditEvent[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [userId, setUserId] = useState('')
  const [selected, setSelected] = useState<AdminAuditEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const handleFailure = useCallback((cause: unknown) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a governança.')
  }, [onSessionExpired])

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    const [monitor, audit, nextUsers] = await Promise.all([
      getAdminMonitoring(signal),
      listAdminAudit({ busca: search, acao: action, entidade: entity, usuario_id: userId }, signal),
      listAdminUsers({}, signal),
    ])
    setMonitoring(monitor)
    setEvents(audit.eventos)
    setUsers(nextUsers)
  }, [action, entity, search, userId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void loadAll(controller.signal).catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause)
      }).finally(() => setLoading(false))
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [handleFailure, loadAll])

  useAutoRefresh(async () => {
    try {
      await loadAll()
    } catch (cause) {
      handleFailure(cause)
    }
  }, {
    enabled: !selected,
    intervalMs: 15_000,
  })

  const userNames = new Map(users.map((user) => [user.id, user.nome]))
  const issueCount = monitoring?.diagnostico.total_issues ?? 0
  const healthOk = monitoring?.health.ok === true

  if (loading && !monitoring) return <div className="dashboard-loading">Verificando integridade e auditoria…</div>

  return (
    <section className="admin-governance-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Governança indisponível.</strong><span>{error}</span></div> : null}

      <section className="admin-monitoring-grid">
        <article className={healthOk ? 'is-ok' : 'is-warning'}><ShieldIcon /><span><small>API e ambiente</small><strong>{healthOk ? 'Operacional' : 'Requer atenção'}</strong><i>v{monitoring?.health.version || '—'} · {formatDate(monitoring?.health.serverTime)}</i></span></article>
        <article className={issueCount ? 'is-warning' : 'is-ok'}><ShieldIcon /><span><small>Integridade CMMS</small><strong>{issueCount ? `${issueCount} ocorrência(s)` : 'Base consistente'}</strong><i>diagnóstico somente leitura</i></span></article>
        <article><ShieldIcon /><span><small>Auditoria</small><strong>{monitoring?.auditoria.eventos_24h ?? 0} evento(s)</strong><i>nas últimas 24 horas</i></span></article>
        <article><ShieldIcon /><span><small>Estrutura declarada</small><strong>{monitoring?.tabelas_declaradas ?? 0} tabelas</strong><i>checadas pelo servidor</i></span></article>
      </section>

      {issueCount ? <section className="admin-monitoring-alert"><strong>Diagnóstico de integridade</strong><span>{Object.entries(monitoring?.diagnostico.by_code || {}).map(([code, total]) => `${code}: ${total}`).join(' · ')}</span><small>Nenhuma correção automática é executada por esta tela.</small></section> : null}

      <section className="admin-governance-toolbar">
        <label className="search-field"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ação, entidade ou registro" /></label>
        <label><span>Grupo de ação</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="">Todos</option><option value="DOCUMENT">Documentos</option><option value="BACKUP">Backups</option><option value="CONFIG">Configuração</option><option value="ADMIN_ENTITY">Cadastros</option><option value="INTERVENTION">Intervenções</option><option value="USER">Usuários</option><option value="PERMISSION">Permissões</option></select></label>
        <label><span>Entidade</span><select value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">Todas</option><option value="documentos_tecnicos">Documentos</option><option value="spreadsheet">Planilha principal</option><option value="usuarios">Usuários</option><option value="ordens_servico">Ordens de serviço</option><option value="configuracao_versoes">Configuração</option><option value="ativos">Ativos</option><option value="planos_manutencao">Planos</option></select></label>
        <label><span>Responsável</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Todos</option>{users.map((user) => <option value={user.id} key={user.id}>{user.nome} · {user.perfil}</option>)}</select></label>
        <span className="manager-live-sync manager-live-sync--compact"><i aria-hidden="true" />Auditoria ao vivo</span>
      </section>

      <section className="admin-governance-table-card">
        <header><div><span className="eyebrow">TRILHA IMUTÁVEL</span><h2>Eventos administrativos</h2></div><strong>{events.length} evento(s)</strong></header>
        <div className="admin-governance-table-wrap"><table className="admin-governance-table"><thead><tr><th>Data e hora</th><th>Responsável</th><th>Ação</th><th>Registro</th><th>Inspeção</th></tr></thead><tbody>
          {events.map((event) => <tr key={event.id}><td><strong>{formatDate(event.criado_em)}</strong><small>{event.id}</small></td><td><strong>{userNames.get(event.usuario_id) || event.usuario_id}</strong><small>{event.perfil}</small></td><td><strong>{event.acao.replaceAll('_', ' ')}</strong><small>operação auditada</small></td><td><strong>{event.entidade}</strong><small>{event.entidade_id}</small></td><td><button className="admin-audit-inspect-button" type="button" onClick={() => setSelected(event)}>Ver alteração</button></td></tr>)}
          {!events.length ? <tr><td colSpan={5}><div className="admin-empty-state">Nenhum evento corresponde aos filtros.</div></td></tr> : null}
        </tbody></table></div>
      </section>

      {selected ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Detalhe de auditoria"><section>
        <header><div><span className="eyebrow">EVENTO {selected.id}</span><h2>{selected.acao.replaceAll('_', ' ')}</h2></div><button className="admin-audit-dialog__close" type="button" title="Fechar" aria-label="Fechar detalhe da auditoria" onClick={() => setSelected(null)}>×</button></header>
        <div className="admin-audit-detail"><article><strong>Antes</strong><pre>{safePretty(selected.antes_json)}</pre></article><article><strong>Depois</strong><pre>{safePretty(selected.depois_json)}</pre></article><aside><ShieldIcon /><span><strong>Dados sensíveis protegidos</strong><small>Senhas, PINs, tokens, segredos e hashes são ocultados pelo servidor antes da resposta.</small></span></aside></div>
        <footer className="admin-audit-dialog__footer"><span>Consulta concluída sem alterar o registro.</span><div><button className="admin-audit-dialog__done" type="button" onClick={() => setSelected(null)}><ShieldIcon />Concluir inspeção</button></div></footer>
      </section></div> : null}
    </section>
  )
}
