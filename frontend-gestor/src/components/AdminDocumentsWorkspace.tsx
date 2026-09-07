import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAdminUsers } from '../services/api/admin'
import { listAdminEntity } from '../services/api/catalog'
import {
  getAdminDocument,
  listAdminDocuments,
  openAdminDocumentFile,
  updateAdminDocument,
  uploadAdminDocument,
} from '../services/api/governance'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type { AdminUser } from '../types/admin'
import type { AdminEntityRecord } from '../types/catalog'
import type {
  AdminDocument,
  AdminDocumentEntityType,
  AdminDocumentFileInput,
  AdminDocumentMetadataInput,
  AdminDocumentStatus,
  AdminDocumentType,
} from '../types/governance'
import { SearchIcon, ShieldIcon } from './Icons'

interface AdminDocumentsWorkspaceProps {
  onSessionExpired: () => void
}

type EditorMode = 'create' | 'edit' | 'revision'

const DOCUMENT_TYPES: Array<{ value: AdminDocumentType; label: string }> = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'DIAGRAMA', label: 'Diagrama' },
  { value: 'CERTIFICADO', label: 'Certificado' },
  { value: 'LAUDO', label: 'Laudo técnico' },
  { value: 'PROCEDIMENTO', label: 'Procedimento' },
  { value: 'FICHA_TECNICA', label: 'Ficha técnica' },
  { value: 'OUTRO', label: 'Outro' },
]

const DOCUMENT_STATUSES: Array<{ value: AdminDocumentStatus; label: string }> = [
  { value: 'RASCUNHO', label: 'Rascunho' },
  { value: 'EM_REVISAO', label: 'Em revisão' },
  { value: 'VIGENTE', label: 'Vigente' },
  { value: 'OBSOLETO', label: 'Obsoleto' },
]

const ENTITY_TYPES: Array<{ value: AdminDocumentEntityType; label: string }> = [
  { value: 'EMPRESA', label: 'Toda a empresa' },
  { value: 'PLANTA', label: 'Planta' },
  { value: 'SETOR', label: 'Setor' },
  { value: 'LINHA', label: 'Linha' },
  { value: 'ATIVO', label: 'Ativo' },
  { value: 'COMPONENTE', label: 'Componente' },
]

const EMPTY_FORM: AdminDocumentMetadataInput = {
  titulo: '',
  tipo: 'PROCEDIMENTO',
  entidade_tipo: 'EMPRESA',
  entidade_id: '',
  status: 'RASCUNHO',
  validade_em: '',
  responsavel_id: '',
  descricao: '',
  revisao: 'R1',
  observacao: '',
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
}

function formatBytes(value: number | string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

function entityLabel(item: AdminEntityRecord): string {
  const identity = String(item.tag || item.codigo || item.id)
  const name = String(item.nome || item.descricao || '')
  return name ? `${identity} · ${name}` : identity
}

function mimeFromFile(file: File): string {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  const byExtension: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
  }
  return extension ? byExtension[extension] || '' : ''
}

async function filePayload(file: File): Promise<AdminDocumentFileInput> {
  if (file.size > 6 * 1024 * 1024) throw new Error('O arquivo excede o limite de 6 MB.')
  const mimeType = mimeFromFile(file)
  if (!mimeType) throw new Error('Formato não reconhecido. Use PDF, imagem, Word, Excel ou CSV.')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
  return { nome: file.name, mime_type: mimeType, base64 }
}

export function AdminDocumentsWorkspace({ onSessionExpired }: AdminDocumentsWorkspaceProps) {
  const [documents, setDocuments] = useState<AdminDocument[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [catalogs, setCatalogs] = useState<Record<AdminDocumentEntityType, AdminEntityRecord[]>>({
    EMPRESA: [], PLANTA: [], SETOR: [], LINHA: [], ATIVO: [], COMPONENTE: [],
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdminDocumentStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<AdminDocumentType | ''>('')
  const [editor, setEditor] = useState<{ mode: EditorMode; document?: AdminDocument } | null>(null)
  const [form, setForm] = useState<AdminDocumentMetadataInput>(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleFailure = useCallback((cause: unknown) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os documentos.')
  }, [onSessionExpired])

  const load = useCallback(async (signal?: AbortSignal) => {
    const [documentData, nextUsers, plants, sectors, lines, assets, components] = await Promise.all([
      listAdminDocuments({ busca: search, status: statusFilter, tipo: typeFilter }, signal),
      listAdminUsers({ status: 'ATIVO' }, signal),
      listAdminEntity('plantas', signal), listAdminEntity('setores', signal), listAdminEntity('linhas', signal),
      listAdminEntity('ativos', signal), listAdminEntity('componentes', signal),
    ])
    setDocuments(documentData.documentos)
    setUsers(nextUsers)
    setCatalogs({
      EMPRESA: [], PLANTA: plants.rows, SETOR: sectors.rows, LINHA: lines.rows,
      ATIVO: assets.rows, COMPONENTE: components.rows,
    })
  }, [search, statusFilter, typeFilter])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void load(controller.signal).catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause)
      }).finally(() => setLoading(false))
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [handleFailure, load])

  useAutoRefresh(async () => {
    try {
      await load()
    } catch (cause) {
      handleFailure(cause)
    }
  }, {
    enabled: !editor && !saving,
    intervalMs: 20_000,
  })

  const targetOptions = useMemo(() => catalogs[form.entidade_tipo] || [], [catalogs, form.entidade_tipo])
  const userNames = useMemo(() => new Map(users.map((user) => [user.id, user.nome])), [users])

  function openEditor(mode: EditorMode, document?: AdminDocument) {
    setError('')
    setNotice('')
    setFile(null)
    setEditor({ mode, document })
    if (!document) {
      setForm(EMPTY_FORM)
      return
    }
    setForm({
      id: mode === 'edit' ? document.id : undefined,
      documento_id: mode === 'revision' ? document.id : undefined,
      codigo: document.codigo,
      titulo: document.titulo,
      tipo: document.tipo,
      entidade_tipo: document.entidade_tipo,
      entidade_id: document.entidade_id || '',
      status: document.status,
      validade_em: document.validade_em ? document.validade_em.slice(0, 10) : '',
      responsavel_id: document.responsavel_id || '',
      descricao: document.descricao || '',
      revisao: mode === 'revision' ? '' : document.revisao_atual,
      observacao: '',
    })
  }

  async function save() {
    if (!editor) return
    if (!form.titulo.trim()) {
      setError('Informe o título do documento.')
      return
    }
    if (form.entidade_tipo !== 'EMPRESA' && !form.entidade_id) {
      setError('Selecione o cadastro vinculado.')
      return
    }
    if (editor.mode !== 'edit' && !file) {
      setError('Selecione o arquivo da revisão.')
      return
    }
    if (editor.mode === 'revision' && !form.revisao?.trim()) {
      setError('Informe a identificação da nova revisão.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editor.mode === 'edit') {
        await updateAdminDocument(form)
      } else {
        await uploadAdminDocument(form, await filePayload(file as File))
      }
      const message = editor.mode === 'create' ? 'Documento cadastrado.' : editor.mode === 'revision' ? 'Nova revisão registrada.' : 'Metadados atualizados.'
      setEditor(null)
      setNotice(message)
      await load()
    } catch (cause) {
      handleFailure(cause)
    } finally {
      setSaving(false)
    }
  }

  async function openFile(document: AdminDocument) {
    setError('')
    try {
      const detail = await getAdminDocument(document.id)
      await openAdminDocumentFile(detail)
    } catch (cause) {
      handleFailure(cause)
    }
  }

  if (loading && !documents.length) return <div className="dashboard-loading">Carregando documentos técnicos…</div>

  return (
    <section className="admin-documents-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Central documental.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <section className="admin-governance-toolbar">
        <label className="search-field"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, título ou arquivo" /></label>
        <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AdminDocumentType | '')}><option value="">Todos</option>{DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AdminDocumentStatus | '')}><option value="">Todos</option>{DOCUMENT_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <span className="manager-live-sync manager-live-sync--compact"><i aria-hidden="true" />Biblioteca ao vivo</span>
        <button className="primary-button" type="button" onClick={() => openEditor('create')}>Novo documento</button>
      </section>

      <section className="admin-governance-table-card">
        <header><div><span className="eyebrow">BIBLIOTECA CONTROLADA</span><h2>Documentos e revisões</h2></div><strong>{documents.length} registro(s)</strong></header>
        <div className="admin-governance-table-wrap"><table className="admin-governance-table"><thead><tr><th>Documento</th><th>Vínculo</th><th>Revisão</th><th>Validade</th><th>Responsável</th><th>Ações</th></tr></thead><tbody>
          {documents.map((document) => <tr key={document.id}>
            <td><strong>{document.codigo} · {document.titulo}</strong><small>{DOCUMENT_TYPES.find((item) => item.value === document.tipo)?.label} · {document.arquivo_nome} · {formatBytes(document.tamanho_bytes)}</small></td>
            <td><strong>{ENTITY_TYPES.find((item) => item.value === document.entidade_tipo)?.label}</strong><small>{document.entidade_id ? entityLabel(catalogs[document.entidade_tipo].find((item) => item.id === document.entidade_id) || { id: document.entidade_id }) : 'Escopo corporativo'}</small></td>
            <td><strong>{document.revisao_atual}</strong><span className={`admin-catalog-chip admin-catalog-chip--${document.status_exibicao.toLowerCase()}`}>{document.status_exibicao.replaceAll('_', ' ')}</span></td>
            <td><strong>{formatDate(document.validade_em)}</strong><small>{document.vencido ? 'Documento vencido' : 'Controle de validade'}</small></td>
            <td><strong>{document.responsavel_id ? userNames.get(document.responsavel_id) || document.responsavel_id : 'Não definido'}</strong><small>proprietário interno</small></td>
            <td><div className="admin-governance-actions"><button type="button" onClick={() => void openFile(document)}>Abrir</button><button type="button" onClick={() => openEditor('edit', document)}>Editar</button><button type="button" onClick={() => openEditor('revision', document)}>Nova revisão</button></div></td>
          </tr>)}
          {!documents.length ? <tr><td colSpan={6}><div className="admin-empty-state">Nenhum documento corresponde aos filtros.</div></td></tr> : null}
        </tbody></table></div>
      </section>

      {editor ? <div className="admin-catalog-dialog" role="dialog" aria-modal="true" aria-label="Editor de documento"><section>
        <header><div><span className="eyebrow">{editor.mode === 'create' ? 'NOVO DOCUMENTO' : editor.mode === 'revision' ? 'CONTROLE DE REVISÃO' : 'METADADOS'}</span><h2>{editor.mode === 'create' ? 'Cadastrar documento' : editor.document?.titulo}</h2></div><button type="button" onClick={() => setEditor(null)}>Fechar</button></header>
        <div className="admin-document-form">
          <label className="is-wide"><span>Título *</span><input value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} /></label>
          <label><span>Tipo *</span><select value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value as AdminDocumentType })}>{DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Status *</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as AdminDocumentStatus })}>{DOCUMENT_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Escopo *</span><select value={form.entidade_tipo} onChange={(event) => setForm({ ...form, entidade_tipo: event.target.value as AdminDocumentEntityType, entidade_id: '' })}>{ENTITY_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Cadastro vinculado</span><select value={form.entidade_id} disabled={form.entidade_tipo === 'EMPRESA'} onChange={(event) => setForm({ ...form, entidade_id: event.target.value })}><option value="">{form.entidade_tipo === 'EMPRESA' ? 'Escopo corporativo' : 'Selecione…'}</option>{targetOptions.map((item) => <option key={item.id} value={item.id}>{entityLabel(item)}</option>)}</select></label>
          <label><span>Responsável</span><select value={form.responsavel_id} onChange={(event) => setForm({ ...form, responsavel_id: event.target.value })}><option value="">Sem responsável definido</option>{users.map((user) => <option key={user.id} value={user.id}>{user.nome} · {user.perfil}</option>)}</select></label>
          <label><span>Validade</span><input type="date" value={form.validade_em} onChange={(event) => setForm({ ...form, validade_em: event.target.value })} /></label>
          {editor.mode !== 'edit' ? <><label><span>Revisão *</span><input value={form.revisao} placeholder="Ex.: R1 ou REV-A" onChange={(event) => setForm({ ...form, revisao: event.target.value.toUpperCase() })} /></label><label className="is-wide"><span>Arquivo * · até 6 MB</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>Armazenamento privado no Drive; o acesso exige sessão autorizada.</small></label><label className="is-wide"><span>Observação da revisão</span><input value={form.observacao} onChange={(event) => setForm({ ...form, observacao: event.target.value })} /></label></> : null}
          <label className="is-wide"><span>Descrição</span><textarea rows={3} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} /></label>
          <aside><ShieldIcon /><span><strong>Documento governado</strong><small>Cada arquivo gera uma revisão imutável e uma entrada na auditoria.</small></span></aside>
        </div>
        <footer><div><button type="button" onClick={() => setEditor(null)}>Cancelar</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : editor.mode === 'revision' ? 'Registrar revisão' : 'Salvar documento'}</button></div></footer>
      </section></div> : null}
    </section>
  )
}
