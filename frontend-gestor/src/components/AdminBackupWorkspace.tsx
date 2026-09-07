import { useCallback, useEffect, useState } from 'react'
import {
  confirmAdminBackupRestore,
  createAdminBackup,
  downloadAdminBackup,
  listAdminBackups,
  prepareAdminBackupRestore,
} from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminBackup, AdminBackupRestorePreparation } from '../types/governance'
import { ShieldIcon } from './Icons'

interface AdminBackupWorkspaceProps {
  onSessionExpired: () => void
}

type DialogMode = 'backup' | 'restore' | null

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return `${(value / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function AdminBackupWorkspace({ onSessionExpired }: AdminBackupWorkspaceProps) {
  const [backups, setBackups] = useState<AdminBackup[]>([])
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [reasonType, setReasonType] = useState('ANTES_DE_CONFIGURACAO')
  const [reasonDetail, setReasonDetail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [restoreReason, setRestoreReason] = useState('')
  const [preparation, setPreparation] = useState<AdminBackupRestorePreparation | null>(null)
  const [challenge, setChallenge] = useState('')
  const [finalConfirmed, setFinalConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleFailure = useCallback((cause: unknown) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os backups.')
  }, [onSessionExpired])

  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await listAdminBackups(signal)
    setBackups(data.backups)
    setSelectedBackupId((current) => current || data.backups[0]?.id || '')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      handleFailure(cause)
    }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [handleFailure, load])

  useAutoRefresh(async () => {
    try {
      await load()
    } catch (cause) {
      handleFailure(cause)
    }
  }, {
    enabled: !dialogMode && !creating && !preparing && !restoring,
    intervalMs: 30_000,
  })

  function openBackupDialog() {
    setDialogMode('backup')
    setError('')
    setNotice('')
    setConfirmed(false)
  }

  function openRestoreDialog(backupId?: string) {
    setDialogMode('restore')
    setSelectedBackupId(backupId || backups[0]?.id || '')
    setRestoreReason('')
    setPreparation(null)
    setChallenge('')
    setFinalConfirmed(false)
    setError('')
    setNotice('')
  }

  async function createBackup() {
    const reasonLabels: Record<string, string> = {
      ANTES_DE_CONFIGURACAO: 'Antes de alteração de configuração',
      ANTES_DE_IMPORTACAO: 'Antes de importação de dados',
      FECHAMENTO_DE_TURNO: 'Fechamento de turno',
      MARCO_DE_RELEASE: 'Marco de release',
      OUTRO: 'Outro motivo',
    }
    if (!confirmed) {
      setError('Confirme que deseja criar uma cópia integral da base.')
      return
    }
    const reason = `${reasonLabels[reasonType]}${reasonDetail.trim() ? `: ${reasonDetail.trim()}` : ''}`
    setCreating(true)
    setError('')
    try {
      await createAdminBackup(reason, 'CRIAR BACKUP')
      setDialogMode(null)
      setConfirmed(false)
      setReasonDetail('')
      setNotice('Backup integral criado e registrado na auditoria.')
      await load()
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setCreating(false)
    }
  }

  async function prepareRestore() {
    if (!selectedBackupId) {
      setError('Selecione um ponto de backup.')
      return
    }
    if (restoreReason.trim().length < 8) {
      setError('Informe um motivo detalhado para a restauração.')
      return
    }
    setPreparing(true)
    setError('')
    try {
      setPreparation(await prepareAdminBackupRestore(selectedBackupId))
      setChallenge('')
      setFinalConfirmed(false)
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setPreparing(false)
    }
  }

  async function restoreBackup() {
    if (!preparation) return
    if (challenge.trim().toUpperCase() !== preparation.desafio.toUpperCase() || !finalConfirmed) {
      setError('Conclua as duas confirmações exatamente como apresentado.')
      return
    }
    setRestoring(true)
    setError('')
    try {
      const result = await confirmAdminBackupRestore({
        token: preparation.token,
        backupId: preparation.backup.id,
        challenge,
        finalConfirmation: preparation.confirmacao_final,
        reason: restoreReason.trim(),
      })
      setDialogMode(null)
      setPreparation(null)
      setNotice(`${result.abas_restauradas.length} abas operacionais restauradas. Identidades, sessões, configuração e auditoria foram preservadas.`)
      await load()
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setRestoring(false)
    }
  }

  if (loading && !backups.length) return <div className="dashboard-loading">Consultando continuidade e backups…</div>

  return (
    <section className="admin-backup-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Continuidade.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <section className="admin-continuity-summary">
        <article><ShieldIcon /><span><small>Política atual</small><strong>Cópia integral privada</strong><i>planilha e estrutura operacional</i></span></article>
        <article><ShieldIcon /><span><small>Backups disponíveis</small><strong>{backups.length}</strong><i>armazenados em repositório privado</i></span></article>
        <article><ShieldIcon /><span><small>Última cópia</small><strong>{backups[0] ? formatDate(backups[0].criado_em) : 'Ainda não criada'}</strong><i>{backups[0]?.nome || 'Crie o primeiro ponto de restauração'}</i></span></article>
      </section>

      <section className="admin-continuity-warning"><ShieldIcon /><span><strong>Restauração operacional protegida</strong><small>Substitui somente dados operacionais. Configuração, usuários, sessões, auditoria e locks permanecem intactos. Antes da troca, o sistema cria outro backup integral automaticamente.</small></span><button type="button" disabled={!backups.length} onClick={() => openRestoreDialog()}>{backups.length ? 'Preparar restauração' : 'Sem backup disponível'}</button></section>

      <section className="admin-governance-table-card">
        <header><div><span className="eyebrow">CONTINUIDADE OPERACIONAL</span><h2>Pontos de backup</h2></div><div className="admin-backup-header-actions"><span className="manager-live-sync manager-live-sync--compact"><i aria-hidden="true" />Sincronização automática</span><button className="primary-button" type="button" onClick={openBackupDialog}>Criar backup</button></div></header>
        <div className="admin-governance-table-wrap"><table className="admin-governance-table"><thead><tr><th>Arquivo</th><th>Data de criação</th><th>Tamanho</th><th>Armazenamento</th><th>Ação segura</th></tr></thead><tbody>
          {backups.map((backup) => <tr key={backup.id}><td><strong>{backup.nome}</strong><small>{backup.id}</small></td><td><strong>{formatDate(backup.criado_em)}</strong><small>cópia imutável</small></td><td><strong>{formatBytes(backup.tamanho_bytes)}</strong><small>base integral</small></td><td><strong>Armazenamento privado</strong><small>download autenticado e checksum verificado</small></td><td><div className="admin-governance-actions"><button type="button" onClick={() => void downloadAdminBackup(backup.id, backup.nome).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível baixar o backup.'))}>Baixar</button><button type="button" onClick={() => openRestoreDialog(backup.id)}>Restaurar</button></div></td></tr>)}
          {!backups.length ? <tr><td colSpan={5}><div className="admin-empty-state">Nenhum backup administrativo foi criado.</div></td></tr> : null}
        </tbody></table></div>
      </section>

      {dialogMode === 'backup' ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Criar backup"><section>
        <header><div><span className="eyebrow">OPERAÇÃO AUDITADA</span><h2>Criar ponto de backup</h2></div><button type="button" onClick={() => setDialogMode(null)}>Fechar</button></header>
        <div className="admin-backup-form">
          <label><span>Motivo *</span><select value={reasonType} onChange={(event) => setReasonType(event.target.value)}><option value="ANTES_DE_CONFIGURACAO">Antes de alteração de configuração</option><option value="ANTES_DE_IMPORTACAO">Antes de importação de dados</option><option value="FECHAMENTO_DE_TURNO">Fechamento de turno</option><option value="MARCO_DE_RELEASE">Marco de release</option><option value="OUTRO">Outro motivo</option></select></label>
          <label><span>Complemento</span><textarea rows={3} value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} placeholder="Informe o contexto para a auditoria" /></label>
          <label className="admin-backup-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>Confirmo a criação da cópia integral</strong><small>Esta operação não altera nem interrompe a produção.</small></span></label>
        </div>
        <footer><div><button type="button" onClick={() => setDialogMode(null)}>Cancelar</button><button className="primary-button" type="button" disabled={creating || !confirmed} onClick={() => void createBackup()}>{creating ? 'Criando cópia…' : 'Confirmar backup'}</button></div></footer>
      </section></div> : null}

      {dialogMode === 'restore' ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Restaurar backup"><section>
        <header><div><span className="eyebrow">DUPLA CONFIRMAÇÃO</span><h2>Restauração operacional segura</h2></div><button type="button" onClick={() => setDialogMode(null)}>Fechar</button></header>
        {!preparation ? <div className="admin-backup-form">
          <label><span>Ponto de backup *</span><select value={selectedBackupId} onChange={(event) => setSelectedBackupId(event.target.value)}><option value="">Selecione…</option>{backups.map((backup) => <option key={backup.id} value={backup.id}>{backup.nome} · {formatDate(backup.criado_em)}</option>)}</select></label>
          <label><span>Motivo detalhado *</span><textarea rows={3} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="Explique por que os dados operacionais precisam voltar a este ponto" /></label>
          <aside className="admin-restore-scope"><ShieldIcon /><span><strong>Escopo operacional seguro</strong><small>Usuários, senhas, sessões, configuração versionada, auditoria e locks não serão substituídos.</small></span></aside>
        </div> : <div className="admin-restore-confirmation">
          <section><span><small>Backup selecionado</small><strong>{preparation.backup.nome}</strong></span><span><small>Abas operacionais</small><strong>{preparation.abas_restauradas.length}</strong></span><span><small>Células analisadas</small><strong>{preparation.total_celulas.toLocaleString('pt-BR')}</strong></span><span><small>Expira em</small><strong>{formatDate(preparation.expira_em)}</strong></span></section>
          <article><strong>Preservadas</strong><p>{preparation.abas_protegidas.join(', ')}</p><small>{preparation.abas_ausentes.length ? `Ausentes no backup e mantidas como estão: ${preparation.abas_ausentes.join(', ')}` : 'Todas as demais abas declaradas estão presentes.'}</small></article>
          <label><span>1ª confirmação · digite <b>{preparation.desafio}</b></span><input value={challenge} onChange={(event) => setChallenge(event.target.value.toUpperCase())} autoComplete="off" /></label>
          <label className="admin-backup-confirm"><input type="checkbox" checked={finalConfirmed} onChange={(event) => setFinalConfirmed(event.target.checked)} /><span><strong>2ª confirmação · autorizo substituir os dados operacionais</strong><small>Uma cópia integral de segurança será criada automaticamente antes da primeira alteração.</small></span></label>
        </div>}
        <footer><div><button type="button" onClick={() => setDialogMode(null)}>Cancelar</button>{preparation ? <button className="primary-button" type="button" disabled={restoring || !finalConfirmed || challenge.trim().toUpperCase() !== preparation.desafio.toUpperCase()} onClick={() => void restoreBackup()}>{restoring ? 'Restaurando com proteção…' : 'Executar restauração'}</button> : <button className="primary-button" type="button" disabled={preparing || !selectedBackupId || restoreReason.trim().length < 8} onClick={() => void prepareRestore()}>{preparing ? 'Analisando backup…' : 'Analisar e gerar desafio'}</button>}</div></footer>
      </section></div> : null}
    </section>
  )
}
