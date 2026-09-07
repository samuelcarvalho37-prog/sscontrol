import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listAllTechnicalAreas,
  listAllTechnicalRoles,
  saveTechnicalArea,
  saveTechnicalRole,
} from '../services/api/admin'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import type {
  AdminUserStatus,
  TechnicalArea,
  TechnicalAreaInput,
  TechnicalRole,
  TechnicalRoleInput,
} from '../types/admin'
import { CheckIcon, SearchIcon, ShieldIcon, UsersIcon } from './Icons'

interface AdminTechnicalStructureProps {
  onSessionExpired: () => void
}

type Editor =
  | { kind: 'area'; value: TechnicalAreaInput }
  | { kind: 'role'; value: TechnicalRoleInput }
  | null

const YES_NO = [{ value: 'SIM', label: 'Sim' }, { value: 'NAO', label: 'Não' }]

function areaInput(area?: TechnicalArea): TechnicalAreaInput {
  return {
    id: area?.id,
    codigo: area?.codigo ?? '',
    nome: area?.nome ?? '',
    descricao: area?.descricao ?? '',
    status: area?.status ?? 'ATIVO',
    exige_assinatura_padrao: String(area?.exige_assinatura_padrao ?? 'NAO').toUpperCase() === 'SIM' ? 'SIM' : 'NAO',
  }
}

function roleInput(areaId: string, role?: TechnicalRole): TechnicalRoleInput {
  return {
    id: role?.id,
    area_id: role?.area_id ?? areaId,
    codigo: role?.codigo ?? '',
    nome: role?.nome ?? '',
    descricao: role?.descricao ?? '',
    status: role?.status ?? 'ATIVO',
    pode_assinar: String(role?.pode_assinar ?? 'NAO').toUpperCase() === 'SIM' ? 'SIM' : 'NAO',
  }
}

export function AdminTechnicalStructure({ onSessionExpired }: AdminTechnicalStructureProps) {
  const [areas, setAreas] = useState<TechnicalArea[]>([])
  const [roles, setRoles] = useState<TechnicalRole[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [areaSearch, setAreaSearch] = useState('')
  const [roleSearch, setRoleSearch] = useState('')
  const [editor, setEditor] = useState<Editor>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleFailure = useCallback((cause: unknown, fallback: string) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [onSessionExpired])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [nextAreas, nextRoles] = await Promise.all([
      listAllTechnicalAreas(signal),
      listAllTechnicalRoles('', signal),
    ])
    setAreas(nextAreas)
    setRoles(nextRoles)
    setSelectedAreaId((current) => current && nextAreas.some((area) => area.id === current) ? current : (nextAreas[0]?.id ?? ''))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadData(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause, 'Não foi possível carregar as áreas e cargos.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [handleFailure, loadData])

  useAutoRefresh(async () => {
    try {
      await loadData()
    } catch (cause) {
      handleFailure(cause, 'Não foi possível sincronizar as áreas e cargos.')
    }
  }, {
    enabled: !editor && !saving,
    intervalMs: 20_000,
  })

  const visibleAreas = useMemo(() => {
    const term = areaSearch.trim().toLowerCase()
    return areas.filter((area) => !term || [area.codigo, area.nome, area.descricao]
      .some((value) => String(value ?? '').toLowerCase().includes(term)))
  }, [areaSearch, areas])

  const visibleRoles = useMemo(() => {
    const term = roleSearch.trim().toLowerCase()
    return roles.filter((role) => role.area_id === selectedAreaId && (!term || [role.codigo, role.nome, role.descricao]
      .some((value) => String(value ?? '').toLowerCase().includes(term))))
  }, [roleSearch, roles, selectedAreaId])

  const selectedArea = areas.find((area) => area.id === selectedAreaId)
  const signatureRoles = roles.filter((role) => role.status === 'ATIVO' && String(role.pode_assinar).toUpperCase() === 'SIM').length

  async function saveEditor() {
    if (!editor) return
    if (!editor.value.nome.trim() || !editor.value.codigo.trim()) {
      setError('Informe o código e o nome do cadastro.')
      return
    }
    if (editor.kind === 'role' && !editor.value.area_id) {
      setError('Selecione a área técnica do cargo.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editor.kind === 'area') {
        const saved = await saveTechnicalArea(editor.value)
        setAreas((current) => current.some((area) => area.id === saved.id)
          ? current.map((area) => area.id === saved.id ? saved : area)
          : [...current, saved].sort((left, right) => left.nome.localeCompare(right.nome)))
        setSelectedAreaId(saved.id)
        setNotice(`Área ${saved.nome} salva com auditoria.`)
      } else {
        const saved = await saveTechnicalRole(editor.value)
        setRoles((current) => current.some((role) => role.id === saved.id)
          ? current.map((role) => role.id === saved.id ? saved : role)
          : [...current, saved].sort((left, right) => left.nome.localeCompare(right.nome)))
        setSelectedAreaId(saved.area_id)
        setNotice(`Cargo ${saved.nome} salvo com auditoria.`)
      }
      setEditor(null)
    } catch (cause) {
      handleFailure(cause, 'Não foi possível salvar o cadastro técnico.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="dashboard-loading">Carregando áreas e cargos…</div>

  return (
    <section className="admin-technical-structure">
      {error ? <div className="dashboard-error" role="alert"><strong>Cadastro não concluído.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      <section className="admin-technical-metrics">
        <article><UsersIcon /><span><strong>{areas.filter((area) => area.status === 'ATIVO').length}</strong><small>áreas técnicas ativas</small></span></article>
        <article><UsersIcon /><span><strong>{roles.filter((role) => role.status === 'ATIVO').length}</strong><small>cargos técnicos ativos</small></span></article>
        <article><ShieldIcon /><span><strong>{signatureRoles}</strong><small>cargos autorizados a assinar</small></span></article>
        <span className="manager-live-sync manager-live-sync--compact"><i aria-hidden="true" />Sincronização automática</span>
      </section>

      <div className="admin-technical-columns">
        <section className="admin-technical-panel">
          <header><div><span className="eyebrow">DESTINOS DO FLUXO</span><h2>Áreas técnicas</h2><p>Qualidade, manutenção, segurança e demais filtros definidos pela empresa.</p></div><button className="primary-button" type="button" onClick={() => setEditor({ kind: 'area', value: areaInput() })}>Nova área</button></header>
          <label className="admin-technical-search"><SearchIcon /><input value={areaSearch} onChange={(event) => setAreaSearch(event.target.value)} placeholder="Buscar área" /></label>
          <div className="admin-technical-list">
            {visibleAreas.map((area) => (
              <article className={selectedAreaId === area.id ? 'is-active' : ''} key={area.id} onClick={() => setSelectedAreaId(area.id)}>
                <button className="admin-technical-select" type="button"><span><b>{area.codigo}</b><strong>{area.nome}</strong><small>{area.descricao || 'Sem descrição'}</small></span><i className={area.status === 'ATIVO' ? 'is-ok' : ''}>{area.status}</i></button>
                <button type="button" onClick={(event) => { event.stopPropagation(); setEditor({ kind: 'area', value: areaInput(area) }) }}>Editar</button>
              </article>
            ))}
            {!visibleAreas.length ? <div className="admin-empty-state">Nenhuma área encontrada.</div> : null}
          </div>
        </section>

        <section className="admin-technical-panel">
          <header><div><span className="eyebrow">PERFIS ESPECIALISTAS</span><h2>Cargos de {selectedArea?.nome || 'uma área'}</h2><p>O cargo define a especialidade e se o profissional pode assinar uma liberação.</p></div><button className="primary-button" type="button" disabled={!selectedAreaId} onClick={() => setEditor({ kind: 'role', value: roleInput(selectedAreaId) })}>Novo cargo</button></header>
          <label className="admin-technical-search"><SearchIcon /><input value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder="Buscar cargo" /></label>
          <div className="admin-technical-role-table">
            <div><span>Código e cargo</span><span>Assinatura</span><span>Status</span><span>Ação</span></div>
            {visibleRoles.map((role) => <article key={role.id}><span><b>{role.codigo}</b><strong>{role.nome}</strong><small>{role.descricao || 'Sem descrição'}</small></span><span className={String(role.pode_assinar).toUpperCase() === 'SIM' ? 'is-signature' : ''}>{String(role.pode_assinar).toUpperCase() === 'SIM' ? <><CheckIcon />Pode assinar</> : 'Sem assinatura'}</span><i className={role.status === 'ATIVO' ? 'is-ok' : ''}>{role.status}</i><button type="button" onClick={() => setEditor({ kind: 'role', value: roleInput(role.area_id, role) })}>Editar</button></article>)}
            {!visibleRoles.length ? <div className="admin-empty-state">Nenhum cargo cadastrado nesta área.</div> : null}
          </div>
        </section>
      </div>

      {editor ? <div className="admin-catalog-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="technical-editor-title">
          <header><div><span className="eyebrow">CADASTRO ASSISTIDO</span><h2 id="technical-editor-title">{editor.value.id ? 'Editar' : 'Novo'} {editor.kind === 'area' ? 'área técnica' : 'cargo técnico'}</h2></div><button type="button" disabled={saving} onClick={() => setEditor(null)}>×</button></header>
          <div className="admin-catalog-form">
            {editor.kind === 'role' ? <label><span>Área técnica *</span><select value={editor.value.area_id} onChange={(event) => setEditor({ kind: 'role', value: { ...editor.value, area_id: event.target.value } })}><option value="">Selecione…</option>{areas.filter((area) => area.status === 'ATIVO' || area.id === editor.value.area_id).map((area) => <option value={area.id} key={area.id}>{area.codigo} · {area.nome}</option>)}</select></label> : null}
            <label><span>Código *</span><input value={editor.value.codigo} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, codigo: event.target.value.toUpperCase() } } : { kind: 'role', value: { ...editor.value, codigo: event.target.value.toUpperCase() } })} placeholder={editor.kind === 'area' ? 'QUALIDADE' : 'INSPETOR'} /></label>
            <label><span>Nome *</span><input value={editor.value.nome} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, nome: event.target.value } } : { kind: 'role', value: { ...editor.value, nome: event.target.value } })} /></label>
            <label><span>Status</span><select value={editor.value.status} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, status: event.target.value as AdminUserStatus } } : { kind: 'role', value: { ...editor.value, status: event.target.value as AdminUserStatus } })}><option value="ATIVO">Ativo</option><option value="INATIVO">Inativo</option></select></label>
            <label><span>{editor.kind === 'area' ? 'Exigir assinatura por padrão' : 'Pode assinar documentos'}</span><select value={editor.kind === 'area' ? editor.value.exige_assinatura_padrao : editor.value.pode_assinar} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, exige_assinatura_padrao: event.target.value } } : { kind: 'role', value: { ...editor.value, pode_assinar: event.target.value } })}>{YES_NO.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label style={{ gridColumn: '1 / -1' }}><span>Descrição</span><textarea rows={4} value={editor.value.descricao || ''} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, descricao: event.target.value } } : { kind: 'role', value: { ...editor.value, descricao: event.target.value } })} /></label>
          </div>
          <footer><span>A alteração será aplicada aos dropdowns de usuários e roteamento.</span><div><button type="button" disabled={saving} onClick={() => setEditor(null)}>Cancelar</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveEditor()}>{saving ? 'Salvando…' : 'Salvar cadastro'}</button></div></footer>
        </section>
      </div> : null}
    </section>
  )
}
