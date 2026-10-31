import { useCallback, useEffect, useState } from 'react'
import {
  confirmAdminBackupRestore,
  chooseAdminBackupSaveLocation,
  createAdminBackup,
  downloadAdminBackup,
  listAdminBackups,
  prepareAdminBackupRestore,
  type AdminBackupFileHandle,
} from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminBackup, AdminBackupRestorePreparation, AdminBackupScopeId } from '../types/governance'
import { ShieldIcon } from './Icons'

interface AdminBackupWorkspaceProps {
  onSessionExpired: () => void
}

type DialogMode = 'backup' | 'restore' | null
type BackupDestination = 'server' | 'server-and-device'

const backupScopeOptions: ReadonlyArray<{ id: AdminBackupScopeId; label: string; description: string }> = [
  { id: 'OPERACIONAL', label: 'Dados operacionais', description: 'Estrutura, ativos, manutenção, almoxarifado e operação da empresa.' },
  { id: 'IMPORTACOES', label: 'Histórico e linhas de importação', description: 'Lotes, dados das linhas lidas e validação; não inclui o arquivo original.' },
  { id: 'ACESSOS', label: 'Permissões dos perfis', description: 'Permissões por perfil e exceções por usuário; contas e senhas ficam intactas.' },
  { id: 'CONFIGURACOES', label: 'Configurações versionadas', description: 'Versões e rascunhos de configuração do ambiente.' },
]

function backupScopesOf(backup?: AdminBackup): AdminBackupScopeId[] {
  return backup?.escopos?.length ? backup.escopos : ['OPERACIONAL', 'IMPORTACOES']
}

function scopeLabel(scope: AdminBackupScopeId): string {
  return backupScopeOptions.find((option) => option.id === scope)?.label ?? scope
}

function backupFileName(): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-').replace('T', '_').replace('Z', '')
  return `VORQIX-backup-${stamp}.json.gz`
}

function displayBackupName(name: string): string {
  return name.replace(/^fab-control-/u, 'VORQIX-backup-')
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function formatMonth(value: string): string {
  const date = new Date(`${value}-01T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return `${(value / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function AdminBackupWorkspace({ onSessionExpired }: AdminBackupWorkspaceProps) {
  const [backups, setBackups] = useState<AdminBackup[]>([])
  const [restorePointsByMonth, setRestorePointsByMonth] = useState<Record<string, number>>({})
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [reasonType, setReasonType] = useState('ANTES_DE_CONFIGURACAO')
  const [reasonDetail, setReasonDetail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [backupDestination, setBackupDestination] = useState<BackupDestination>('server')
  const [backupScopes, setBackupScopes] = useState<AdminBackupScopeId[]>(['OPERACIONAL', 'IMPORTACOES'])
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [restoreScopes, setRestoreScopes] = useState<AdminBackupScopeId[]>(['OPERACIONAL', 'IMPORTACOES'])
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
    setRestorePointsByMonth(data.pontos_por_mes)
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
    setBackupDestination('server')
    setBackupScopes(['OPERACIONAL', 'IMPORTACOES'])
  }

  function openRestoreDialog(backupId?: string) {
    setDialogMode('restore')
    const targetId = backupId || backups[0]?.id || ''
    setSelectedBackupId(targetId)
    setRestoreScopes(backupScopesOf(backups.find((backup) => backup.id === targetId)))
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
      setError('Confirme que deseja criar o backup operacional.')
      return
    }
    if (backupScopes.length === 0) {
      setError('Selecione pelo menos um grupo de dados para a cópia.')
      return
    }
    const reason = `${reasonLabels[reasonType]}${reasonDetail.trim() ? `: ${reasonDetail.trim()}` : ''}`
    setCreating(true)
    setError('')
    let saveHandle: AdminBackupFileHandle | null = null
    const suggestedName = backupFileName()
    try {
      if (backupDestination === 'server-and-device') {
        saveHandle = await chooseAdminBackupSaveLocation(suggestedName)
      }
      const result = await createAdminBackup(reason, 'CRIAR BACKUP', backupScopes)
      setDialogMode(null)
      setConfirmed(false)
      setReasonDetail('')
      setBackupDestination('server')
      setNotice(backupDestination === 'server-and-device'
        ? 'Backup criado no servidor. A cópia para mídia física foi iniciada.'
        : 'Backup criado no servidor e registrado na auditoria.')
      await load()
      if (backupDestination === 'server-and-device') {
        try {
          await downloadAdminBackup(result.backup.id, suggestedName, saveHandle)
        } catch (cause) {
          setError(cause instanceof Error
            ? `Backup criado no servidor, mas não foi possível salvar a cópia externa: ${cause.message}`
            : 'Backup criado no servidor, mas não foi possível salvar a cópia externa.')
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
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
    if (restoreScopes.length === 0) {
      setError('Selecione pelo menos um grupo de dados para restaurar.')
      return
    }
    if (restoreReason.trim().length < 8) {
      setError('Informe um motivo detalhado para a restauração.')
      return
    }
    setPreparing(true)
    setError('')
    try {
      setPreparation(await prepareAdminBackupRestore(selectedBackupId, restoreScopes))
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
      setNotice(`${result.escopos_restaurados.map((scope) => scopeLabel(scope)).join(', ')} restaurado(s). Identidades, credenciais, sessões e auditoria foram preservadas.`)
      await load()
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setRestoring(false)
    }
  }

  const backupsByMonth = backups.reduce<Record<string, AdminBackup[]>>((groups, backup) => {
    const month = backup.criado_em.slice(0, 7)
    groups[month] ??= []
    groups[month].push(backup)
    return groups
  }, {})

  if (loading && !backups.length) return <div className="dashboard-loading">Consultando continuidade e backups…</div>

  return (
    <section className="admin-backup-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Backup.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <section className="admin-backup-panel">
        <header className="admin-backup-panel__header">
          <div><h2>Criar uma cópia</h2><p>Proteja os dados antes de importar ou fazer alterações.</p></div>
          <button className="primary-button" type="button" onClick={openBackupDialog}>Criar cópia</button>
        </header>

        <section className="admin-backup-restore">
          <header><div><h3>Restaurar uma cópia</h3><p>Escolha um ponto salvo para recuperar os dados.</p></div></header>
          <div className="admin-backup-list" aria-label="Cópias disponíveis">
          <div className="admin-backup-list__head"><span>Cópia</span><span>Data</span><span>Tamanho</span><span>Conteúdo</span><span>Armazenamento</span><span>Ações</span></div>
          {backups.map((backup) => <article className="admin-backup-row" key={backup.id}>
            <div className="admin-backup-row__name"><strong title={displayBackupName(backup.nome)}>{displayBackupName(backup.nome)}</strong><small title={backup.id}>{backup.id}</small></div>
            <span className="admin-backup-row__date" data-label="Data">{formatDate(backup.criado_em)}</span>
            <strong className="admin-backup-row__size" data-label="Tamanho">{formatBytes(backup.tamanho_bytes)}</strong>
            <span className="admin-backup-row__scopes" data-label="Conteúdo">{backupScopesOf(backup).map(scopeLabel).join(' · ')}</span>
            <span className="admin-backup-row__storage" data-label="Armazenamento">Repositório privado</span>
            <div className="admin-backup-row__actions" data-label="Ações">
              <button type="button" onClick={() => void downloadAdminBackup(backup.id, displayBackupName(backup.nome)).then(() => setNotice('Cópia baixada. O arquivo .json.gz contém os dados em formato JSON compactado.')).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível baixar a cópia.'))}>Baixar</button>
              <button type="button" onClick={() => openRestoreDialog(backup.id)}>Restaurar</button>
            </div>
          </article>)}
          {!backups.length ? <div className="admin-backup-empty"><span>Nenhuma cópia disponível para restauração.</span></div> : null}
          </div>
          <p className="admin-backup-scope">A restauração substitui os grupos selecionados. O ponto pode ser reutilizado.</p>
        </section>
      </section>

      {dialogMode === 'backup' ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Criar uma cópia"><section>
        <header><div><span className="eyebrow">CÓPIA DE SEGURANÇA</span><h2>Criar uma cópia</h2></div><button type="button" onClick={() => setDialogMode(null)}>Fechar</button></header>
        <div className="admin-backup-form">
          <label><span>Motivo *</span><select value={reasonType} onChange={(event) => setReasonType(event.target.value)}><option value="ANTES_DE_CONFIGURACAO">Antes de alteração de configuração</option><option value="ANTES_DE_IMPORTACAO">Antes de importação de dados</option><option value="FECHAMENTO_DE_TURNO">Fechamento de turno</option><option value="MARCO_DE_RELEASE">Marco de release</option><option value="OUTRO">Outro motivo</option></select></label>
          <label><span>Complemento</span><textarea rows={3} value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} placeholder="Informe o contexto para a auditoria" /></label>
          <fieldset className="admin-backup-destinations">
            <legend>Destino da cópia</legend>
            <label><input type="radio" name="backup-destination" checked={backupDestination === 'server'} onChange={() => setBackupDestination('server')} /><span><strong>Servidor</strong><small>Guarda o backup no armazenamento privado do sistema.</small></span></label>
            <label><input type="radio" name="backup-destination" checked={backupDestination === 'server-and-device'} onChange={() => setBackupDestination('server-and-device')} /><span><strong>Servidor e mídia física</strong><small>Guarda no servidor e abre a escolha do local para salvar outra cópia.</small></span></label>
            <p>Nuvem externa não está configurada neste ambiente. O arquivo usa JSON compactado (.json.gz).</p>
          </fieldset>
          <fieldset className="admin-backup-scope-options">
            <legend>Conteúdo da cópia</legend>
            {backupScopeOptions.map((scope) => <label key={scope.id}>
              <input type="checkbox" checked={backupScopes.includes(scope.id)} onChange={(event) => setBackupScopes((current) => event.target.checked ? [...current, scope.id] : current.filter((item) => item !== scope.id))} />
              <span><strong>{scope.label}</strong><small>{scope.description}</small></span>
            </label>)}
            <p>Preferências pessoais e o arquivo original enviado não são armazenados pelo serviço de importação. Os dados das linhas e o histórico ficam em “Histórico e linhas de importação”.</p>
          </fieldset>
          <aside className="admin-backup-dialog-note"><ShieldIcon /><span>Contas, credenciais, sessões, auditoria, plano comercial e janelas de manutenção permanecem protegidos.</span></aside>
          <label className="admin-backup-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>Confirmo a criação do backup</strong><small>A criação não altera os dados da empresa.</small></span></label>
        </div>
        <footer><div><button type="button" onClick={() => setDialogMode(null)}>Cancelar</button><button className="primary-button" type="button" disabled={creating || !confirmed} onClick={() => void createBackup()}>{creating ? 'Criando cópia…' : 'Confirmar backup'}</button></div></footer>
      </section></div> : null}

      {dialogMode === 'restore' ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Restaurar uma cópia"><section>
        <header><div><span className="eyebrow">RESTAURAÇÃO</span><h2>Restaurar uma versão anterior</h2></div><button type="button" onClick={() => setDialogMode(null)}>Fechar</button></header>
        {!preparation ? <div className="admin-backup-form">
          <label><span>Ponto de restauração *</span><select value={selectedBackupId} onChange={(event) => { const id = event.target.value; setSelectedBackupId(id); setRestoreScopes(backupScopesOf(backups.find((backup) => backup.id === id))) }}><option value="">Selecione…</option>{Object.entries(backupsByMonth).map(([month, monthBackups]) => <optgroup key={month} label={`${formatMonth(month)} · ${restorePointsByMonth[month] ?? monthBackups.length} ponto(s)`}>{monthBackups.map((backup) => <option key={backup.id} value={backup.id}>{backup.nome} · {formatDate(backup.criado_em)}</option>)}</optgroup>)}</select></label>
          <fieldset className="admin-backup-scope-options">
            <legend>Grupos a restaurar</legend>
            {backupScopeOptions.filter((scope) => backupScopesOf(backups.find((backup) => backup.id === selectedBackupId)).includes(scope.id)).map((scope) => <label key={scope.id}>
              <input type="checkbox" checked={restoreScopes.includes(scope.id)} onChange={(event) => setRestoreScopes((current) => event.target.checked ? [...current, scope.id] : current.filter((item) => item !== scope.id))} />
              <span><strong>{scope.label}</strong><small>{scope.description}</small></span>
            </label>)}
          </fieldset>
          <label><span>Motivo detalhado *</span><textarea rows={3} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="Explique por que os dados operacionais precisam voltar a este ponto" /></label>
          <aside className="admin-restore-scope"><ShieldIcon /><span><strong>Restauração seletiva</strong><small>Somente os grupos escolhidos serão substituídos. Uma cópia de segurança dos mesmos grupos será criada antes da restauração.</small></span></aside>
        </div> : <div className="admin-restore-confirmation">
          <section><span><small>Ponto selecionado</small><strong>{preparation.backup.nome}</strong></span><span><small>Grupos</small><strong>{preparation.escopos_restaurados.map(scopeLabel).join(', ')}</strong></span><span><small>Registros analisados</small><strong>{preparation.total_celulas.toLocaleString('pt-BR')}</strong></span><span><small>Expira em</small><strong>{formatDate(preparation.expira_em)}</strong></span></section>
          <article><strong>Preservadas</strong><p>{preparation.abas_protegidas.join(', ')}</p><small>{preparation.abas_ausentes.length ? `Ausentes no backup e mantidas como estão: ${preparation.abas_ausentes.join(', ')}` : 'Todas as demais abas declaradas estão presentes.'}</small></article>
          <label><span>1ª confirmação · digite <b>{preparation.desafio}</b></span><input value={challenge} onChange={(event) => setChallenge(event.target.value.toUpperCase())} autoComplete="off" /></label>
          <label className="admin-backup-confirm"><input type="checkbox" checked={finalConfirmed} onChange={(event) => setFinalConfirmed(event.target.checked)} /><span><strong>2ª confirmação · autorizo substituir os grupos selecionados</strong><small>Uma cópia de segurança desses mesmos grupos será criada antes da restauração.</small></span></label>
        </div>}
        <footer><div><button type="button" onClick={() => setDialogMode(null)}>Cancelar</button>{preparation ? <button className="primary-button" type="button" disabled={restoring || !finalConfirmed || challenge.trim().toUpperCase() !== preparation.desafio.toUpperCase()} onClick={() => void restoreBackup()}>{restoring ? 'Restaurando com proteção…' : 'Executar restauração'}</button> : <button className="primary-button" type="button" disabled={preparing || !selectedBackupId || restoreReason.trim().length < 8} onClick={() => void prepareRestore()}>{preparing ? 'Analisando backup…' : 'Analisar e gerar desafio'}</button>}</div></footer>
      </section></div> : null}
    </section>
  )
}
