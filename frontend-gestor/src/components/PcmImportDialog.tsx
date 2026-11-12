import { useEffect, useRef, useState } from 'react'
import { confirmPcmImport, getPcmImportCatalog, validatePcmImport } from '../services/api/imports'
import { parseAdminWorkbook, downloadAdminImportTemplate } from '../services/spreadsheet/adminWorkbook'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type { AdminImportBatch, AdminImportModel, ParsedAdminWorkbook } from '../types/imports'

interface Props { types: string[]; onClose: () => void; onImported: () => void; onSessionExpired: () => void }

export function PcmImportDialog({ types, onClose, onImported, onSessionExpired }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const [models, setModels] = useState<AdminImportModel[]>([])
  const [type, setType] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedAdminWorkbook | null>(null)
  const [batch, setBatch] = useState<AdminImportBatch | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const generation = useRef(0)
  const model = models.find(item => item.tipo === type)
  const fail = (cause: unknown) => { if (isGestorAuthenticationError(cause)) onSessionExpired(); setError(cause instanceof Error ? cause.message : 'Não foi possível importar.') }
  useEffect(() => {
    const controller = new AbortController()
    getPcmImportCatalog(controller.signal).then(catalog => {
      if (controller.signal.aborted) return
      const available = catalog.modelos.filter(item => types.includes(item.tipo))
      setModels(available); setType(available[0]?.tipo || '')
    }).catch(cause => { if (!controller.signal.aborted) fail(cause) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); generation.current++ }
  }, [])
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])]
        const first = controls[0]; const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); previousFocus?.focus() }
  }, [busy, onClose])
  async function readFile(next: File, sheet?: string) {
    const request = ++generation.current
    setBusy(true); setError(''); setBatch(null); setParsed(null)
    try { const result = await parseAdminWorkbook(next, sheet); if (generation.current === request) { setFile(next); setParsed(result) } }
    catch (cause) { if (generation.current === request) fail(cause) }
    finally { if (generation.current === request) setBusy(false) }
  }
  async function validate() {
    if (!parsed || !model) return
    setBusy(true); setError(''); setBatch(null)
    try { setBatch(await validatePcmImport({ tipo: type, arquivo_nome: parsed.fileName, aba_nome: parsed.selectedSheet, cabecalhos: parsed.headers, linhas: parsed.rows })) }
    catch (cause) { fail(cause) } finally { setBusy(false) }
  }
  async function confirm() {
    if (!batch || batch.status !== 'VALIDADO') return
    setBusy(true); setError('')
    try { const result = await confirmPcmImport(batch.id, batch.validacao_hash); setBatch(result); if (result.status === 'CONCLUIDO') { setCompleted(true); onImported() } else setError('A importação não foi concluída. Confira o resultado antes de tentar novamente.') }
    catch (cause) { fail(cause) } finally { setBusy(false) }
  }
  return <div className="pcm-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><section ref={dialogRef} className="pcm-import-dialog" role="dialog" aria-modal="true" aria-labelledby="pcm-import-title">
    <header><h2 id="pcm-import-title">Importar planilha</h2><button autoFocus type="button" disabled={busy} onClick={onClose}>Fechar</button></header>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Carregando modelos…</p> : !models.length ? !error ? <p>Nenhum cadastro disponível para importação com as permissões desta conta.</p> : null : completed ? <p role="status">Importação concluída: {batch?.resultado.criados || 0} criado(s), {batch?.resultado.atualizados || 0} atualizado(s).</p> : <>
      <label>Cadastro<select disabled={busy} value={type} onChange={event => { setType(event.target.value); setBatch(null) }}>{models.map(item => <option value={item.tipo} key={item.tipo}>{item.nome}</option>)}</select></label>
      {model ? <><p>{model.descricao}</p><p><strong>Colunas obrigatórias:</strong> {model.campos.filter(field => field.obrigatorio).map(field => field.chave).join(', ')}. Até {model.max_linhas} linhas por lote.</p><button type="button" disabled={busy} onClick={() => void downloadAdminImportTemplate(model).catch(fail)}>Baixar modelo de preenchimento</button></> : null}
      <label>Arquivo<input disabled={busy} type="file" accept=".xlsx,.xls,.csv" onChange={event => { const next = event.target.files?.[0]; if (next) void readFile(next) }} /></label>
      {parsed && parsed.sheetNames.length > 1 ? <label>Aba<select disabled={busy} value={parsed.selectedSheet} onChange={event => { if (file) void readFile(file, event.target.value) }}>{parsed.sheetNames.map(sheet => <option key={sheet}>{sheet}</option>)}</select></label> : null}
      {parsed ? <p>{parsed.rows.length} linha(s) encontrada(s) em {parsed.selectedSheet}.</p> : null}
      {batch ? <section className="pcm-import-result" aria-label="Resultado da pré-análise"><p>{batch.linhas_validas} válida(s) · {batch.linhas_invalidas} com erro.</p>{batch.registros.filter(record => record.erros.length).slice(0, 30).map(record => <p key={record.id}>Linha {record.linha_numero}: {record.erros.map(item => item.mensagem).join(' · ')}</p>)}{batch.cabecalhos_ignorados.length ? <p>Colunas ignoradas: {batch.cabecalhos_ignorados.join(', ')}</p> : null}</section> : null}
      <footer><button type="button" disabled={busy || !parsed} onClick={() => void validate()}>{busy ? 'Processando…' : 'Verificar planilha'}</button><button type="button" disabled={busy || batch?.status !== 'VALIDADO'} onClick={() => void confirm()}>Confirmar importação</button></footer>
    </>}
  </section></div>
}
