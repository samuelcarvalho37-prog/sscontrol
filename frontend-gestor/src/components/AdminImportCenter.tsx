import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  confirmAdminImport,
  getAdminImportCatalog,
  listAdminImportBatches,
  rollbackAdminImport,
  validateAdminImport,
} from '../services/api/imports'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import {
  downloadAdminImportTemplate,
  parseAdminWorkbook,
} from '../services/spreadsheet/adminWorkbook'
import type {
  AdminImportBatch,
  AdminImportCatalog,
  AdminImportModel,
  ParsedAdminWorkbook,
} from '../types/imports'
import { AlertIcon, CheckIcon, SettingsIcon, ShieldIcon } from './Icons'

interface AdminImportCenterProps {
  onSessionExpired: () => void
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function batchStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    VALIDADO: 'Pronto para confirmar',
    COM_ERROS: 'Correção necessária',
    CONCLUIDO: 'Importado',
    REVERTIDO: 'Revertido',
    FALHOU: 'Falhou e foi desfeito',
  }
  return labels[status] ?? status
}

export function AdminImportCenter({ onSessionExpired }: AdminImportCenterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<AdminImportCatalog | null>(null)
  const [batches, setBatches] = useState<AdminImportBatch[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedAdminWorkbook | null>(null)
  const [analysis, setAnalysis] = useState<AdminImportBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    const [nextCatalog, nextBatches] = await Promise.all([
      getAdminImportCatalog(signal),
      listAdminImportBatches(signal),
    ])
    setCatalog(nextCatalog)
    setBatches(nextBatches)
    setSelectedType((current) => current || nextCatalog.modelos[0]?.tipo || '')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadWorkspace(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a Central de Importação.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadWorkspace, onSessionExpired])

  useAutoRefresh(async () => {
    try {
      await loadWorkspace()
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar os lotes.')
    }
  }, {
    enabled: !busy,
    intervalMs: 20_000,
  })

  const selectedModel = useMemo(
    () => catalog?.modelos.find((model) => model.tipo === selectedType) ?? null,
    [catalog, selectedType],
  )

  const groupedModels = useMemo(() => {
    const groups = new Map<string, AdminImportModel[]>()
    catalog?.modelos.forEach((model) => {
      groups.set(model.grupo, [...(groups.get(model.grupo) ?? []), model])
    })
    return [...groups.entries()]
  }, [catalog])

  const previewColumns = useMemo(() => parsed?.headers.slice(0, 8) ?? [], [parsed])

  function resetFile() {
    setSelectedFile(null)
    setParsed(null)
    setAnalysis(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function changeModel(type: string) {
    setSelectedType(type)
    resetFile()
    setError('')
    setNotice('')
  }

  async function readFile(file: File, sheetName?: string) {
    setBusy('reading')
    setError('')
    setNotice('')
    try {
      const nextParsed = await parseAdminWorkbook(file, sheetName)
      const model = catalog?.modelos.find((item) => item.tipo === selectedType)
      if (model && nextParsed.rows.length > model.max_linhas) {
        throw new Error(`O modelo aceita no máximo ${model.max_linhas} linhas por lote.`)
      }
      setSelectedFile(file)
      setParsed(nextParsed)
      setAnalysis(null)
    } catch (cause) {
      resetFile()
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler a planilha.')
    } finally {
      setBusy('')
    }
  }

  async function analyze() {
    if (!selectedModel || !parsed) return
    setBusy('validating')
    setError('')
    setNotice('')
    try {
      const batch = await validateAdminImport({
        tipo: selectedModel.tipo,
        arquivo_nome: parsed.fileName,
        aba_nome: parsed.selectedSheet,
        cabecalhos: parsed.headers,
        linhas: parsed.rows,
      })
      setAnalysis(batch)
      setBatches((current) => [batch, ...current.filter((item) => item.id !== batch.id)])
      if (batch.linhas_invalidas) {
        setNotice('A pré-análise encontrou linhas que precisam ser corrigidas. Nenhum cadastro foi alterado.')
      } else {
        setNotice('Pré-análise concluída. Revise o resumo antes de confirmar a importação.')
      }
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar a importação.')
    } finally {
      setBusy('')
    }
  }

  async function confirm() {
    if (!analysis || analysis.status !== 'VALIDADO') return
    if (!window.confirm(`Confirmar ${analysis.total_linhas} linha(s) do lote ${analysis.id}?`)) return
    setBusy('confirming')
    setError('')
    setNotice('')
    try {
      const confirmed = await confirmAdminImport(analysis.id, analysis.validacao_hash)
      setAnalysis(confirmed)
      setBatches((current) => [confirmed, ...current.filter((item) => item.id !== confirmed.id)])
      setNotice(`Importação concluída: ${confirmed.resultado.criados ?? 0} criado(s) e ${confirmed.resultado.atualizados ?? 0} atualizado(s).`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a importação.')
    } finally {
      setBusy('')
    }
  }

  async function rollback(batch: AdminImportBatch) {
    const reason = window.prompt('Informe o motivo do rollback (mínimo de 8 caracteres):')?.trim() ?? ''
    if (!reason) return
    if (reason.length < 8) {
      setError('O motivo do rollback precisa ter pelo menos 8 caracteres.')
      return
    }
    setBusy(`rollback:${batch.id}`)
    setError('')
    setNotice('')
    try {
      const rolledBack = await rollbackAdminImport(batch.id, reason)
      setBatches((current) => current.map((item) => (item.id === rolledBack.id ? rolledBack : item)))
      if (analysis?.id === rolledBack.id) setAnalysis(rolledBack)
      setNotice(`Lote ${batch.id} revertido com rastreabilidade.`)
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível reverter o lote.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="dashboard-loading">Carregando Central de Importação…</div>

  return (
    <section className="admin-import-center">
      {error ? <div className="dashboard-error" role="alert"><strong>Importação interrompida.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <section className="admin-import-guardrail">
        <div><ShieldIcon /><span><strong>Importação governada</strong><small>A planilha entra em uma área de pré-análise. Nenhum dado operacional muda antes da confirmação.</small></span></div>
        <ol><li><b>1</b>Selecionar modelo</li><li><b>2</b>Validar vínculos</li><li><b>3</b>Confirmar lote</li><li><b>4</b>Auditar ou reverter</li></ol>
      </section>

      <div className="admin-import-layout">
        <aside className="admin-import-models">
          <header><span className="eyebrow">MODELOS CONTROLADOS</span><h2>O que deseja importar?</h2><p>Use um modelo por lote para manter vínculos, validação e rollback previsíveis.</p></header>
          {groupedModels.map(([group, models]) => (
            <div className="admin-import-model-group" key={group}>
              <strong>{group}</strong>
              {models.map((model) => (
                <button key={model.tipo} type="button" className={selectedType === model.tipo ? 'is-active' : ''} onClick={() => changeModel(model.tipo)}>
                  <SettingsIcon /><span><b>{model.nome}</b><small>{model.descricao}</small></span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <section className="admin-import-workbench">
          {selectedModel ? (
            <>
              <header className="admin-import-workbench__header">
                <div><span className="eyebrow">{selectedModel.grupo}</span><h2>{selectedModel.nome}</h2><p>{selectedModel.descricao}</p></div>
                <button type="button" onClick={() => void downloadAdminImportTemplate(selectedModel)}>Baixar modelo .xlsx</button>
              </header>

              <div className="admin-import-required-fields">
                <span>Campos obrigatórios</span>
                {selectedModel.campos.filter((field) => field.obrigatorio).map((field) => <b key={field.chave}>{field.chave}</b>)}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void readFile(file)
                }}
              />

              {!parsed ? (
                <button className="admin-import-dropzone" type="button" disabled={busy === 'reading'} onClick={() => fileInputRef.current?.click()}>
                  <span className="admin-import-dropzone__icon">↑</span>
                  <strong>{busy === 'reading' ? 'Lendo planilha…' : 'Selecionar planilha preenchida'}</strong>
                  <small>.xlsx, .xls ou .csv · até 8 MB · máximo de {selectedModel.max_linhas} linhas</small>
                </button>
              ) : (
                <section className="admin-import-file-card">
                  <header><div><CheckIcon /><span><strong>{parsed.fileName}</strong><small>{parsed.rows.length} linha(s) · {parsed.headers.length} coluna(s)</small></span></div><button type="button" onClick={resetFile}>Trocar arquivo</button></header>
                  {parsed.sheetNames.length > 1 ? (
                    <label><span>Aba a importar</span><select value={parsed.selectedSheet} onChange={(event) => selectedFile && void readFile(selectedFile, event.target.value)}>{parsed.sheetNames.map((name) => <option key={name}>{name}</option>)}</select></label>
                  ) : null}
                  <div className="admin-import-preview-table">
                    <table><thead><tr><th>Linha</th>{previewColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 6).map((row) => <tr key={row.__linha}><td>{row.__linha}</td>{previewColumns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody></table>
                  </div>
                  <footer><span>Prévia das primeiras {Math.min(6, parsed.rows.length)} linhas. Fórmulas são bloqueadas.</span><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void analyze()}>{busy === 'validating' ? 'Validando…' : 'Executar pré-análise'}</button></footer>
                </section>
              )}

              {analysis ? (
                <section className={`admin-import-analysis admin-import-analysis--${analysis.status.toLowerCase()}`}>
                  <header><div>{analysis.linhas_invalidas ? <AlertIcon /> : <CheckIcon />}<span><strong>{batchStatusLabel(analysis.status)}</strong><small>Lote {analysis.id} · nenhum dado oculto na validação</small></span></div>{analysis.status === 'VALIDADO' ? <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void confirm()}>{busy === 'confirming' ? 'Importando…' : 'Confirmar importação'}</button> : null}</header>
                  <div className="admin-import-analysis__metrics"><article><span>Total</span><strong>{analysis.total_linhas}</strong></article><article><span>Válidas</span><strong>{analysis.linhas_validas}</strong></article><article className={analysis.linhas_invalidas ? 'is-danger' : ''}><span>Com erro</span><strong>{analysis.linhas_invalidas}</strong></article><article><span>Ignoradas</span><strong>{analysis.cabecalhos_ignorados.length}</strong></article></div>
                  {analysis.cabecalhos_ignorados.length ? <p className="admin-import-ignored">Colunas não reconhecidas e ignoradas: {analysis.cabecalhos_ignorados.join(', ')}</p> : null}
                  <div className="admin-import-records">{analysis.registros.map((record) => <article key={record.id} className={record.erros.length ? 'has-error' : ''}><span>Linha {record.linha_numero}</span><strong>{record.entidade_id || 'ID não gerado'}</strong><b>{record.operacao}</b>{record.erros.length ? <ul>{record.erros.map((item) => <li key={`${item.codigo}:${item.mensagem}`}>{item.mensagem}</li>)}</ul> : <small>Referências e tipos conferidos.</small>}</article>)}</div>
                </section>
              ) : null}
            </>
          ) : <div className="admin-empty-state">Nenhum modelo de importação disponível.</div>}
        </section>
      </div>

      <section className="admin-import-history">
        <header><div><span className="eyebrow">RASTREABILIDADE</span><h2>Lotes recentes</h2><p>Cada confirmação registra valores anteriores e posteriores por linha.</p></div><span className="manager-live-sync manager-live-sync--compact"><i aria-hidden="true" />Sincronização automática</span></header>
        <div className="admin-import-batch-list">
          {batches.length ? batches.map((batch) => (
            <article key={batch.id}>
              <span className={`admin-import-status admin-import-status--${batch.status.toLowerCase()}`}>{batchStatusLabel(batch.status)}</span>
              <div><strong>{batch.arquivo_nome}</strong><small>{batch.id} · {batch.entidade} · {formatDate(batch.criado_em)}</small></div>
              <span><b>{batch.total_linhas}</b><small>linhas</small></span>
              <span><b>{batch.resultado.criados ?? '—'}</b><small>criados</small></span>
              <span><b>{batch.resultado.atualizados ?? '—'}</b><small>atualizados</small></span>
              {batch.status === 'CONCLUIDO' ? <button type="button" disabled={Boolean(busy)} onClick={() => void rollback(batch)}>{busy === `rollback:${batch.id}` ? 'Revertendo…' : 'Rollback'}</button> : null}
            </article>
          )) : <div className="admin-empty-state">Nenhum lote registrado.</div>}
        </div>
      </section>
    </section>
  )
}
