import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
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
import { CheckIcon, SearchIcon } from './Icons'

interface AdminTechnicalStructureProps {
  onSessionExpired: () => void
  detachedPanel?: 'areas' | 'roles'
  detachedPanels?: Array<'areas' | 'roles'>
  onDetachPanel?: (panel: 'areas' | 'roles') => void
  selectedAreaId?: string
  onSelectedAreaIdChange?: (areaId: string) => void
}

type Editor =
  | { kind: 'area'; value: TechnicalAreaInput }
  | { kind: 'role'; value: TechnicalRoleInput }
  | null

type StatusDrag = {
  kind: 'area' | 'role'
  pointerId: number
  startY: number
  status: AdminUserStatus
  ids: Set<string>
  moved: boolean
}

type PendingStatusBatch = {
  kind: 'area' | 'role'
  ids: string[]
  status: AdminUserStatus
}

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

export function AdminTechnicalStructure({
  onSessionExpired,
  detachedPanel,
  detachedPanels = [],
  onDetachPanel,
  selectedAreaId: selectedAreaIdProp,
  onSelectedAreaIdChange,
}: AdminTechnicalStructureProps) {
  const [areas, setAreas] = useState<TechnicalArea[]>([])
  const [roles, setRoles] = useState<TechnicalRole[]>([])
  const [localSelectedAreaId, setLocalSelectedAreaId] = useState('')
  const selectedAreaId = selectedAreaIdProp ?? localSelectedAreaId
  const selectedAreaIdRef = useRef(selectedAreaId)
  selectedAreaIdRef.current = selectedAreaId
  const setSelectedAreaId = useCallback((areaId: string) => {
    setLocalSelectedAreaId(areaId)
    onSelectedAreaIdChange?.(areaId)
  }, [onSelectedAreaIdChange])
  const [areaSearch, setAreaSearch] = useState('')
  const [roleSearch, setRoleSearch] = useState('')
  const [editor, setEditor] = useState<Editor>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingStatuses, setSavingStatuses] = useState(false)
  const [statusDragActive, setStatusDragActive] = useState(false)
  const [statusPreviewIds, setStatusPreviewIds] = useState<string[]>([])
  const [pendingStatusBatch, setPendingStatusBatch] = useState<PendingStatusBatch | null>(null)
  const [layoutOrientation, setLayoutOrientation] = useState<'side-by-side' | 'stacked'>(() => window.innerWidth >= 900 ? 'side-by-side' : 'stacked')
  const [splitPercent, setSplitPercent] = useState(42)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detachContext, setDetachContext] = useState<{ panel: 'areas' | 'roles'; x: number; y: number } | null>(null)
  const requestSequence = useRef(0)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const splitPointerIdRef = useRef<number | null>(null)
  const statusDragRef = useRef<StatusDrag | null>(null)
  const suppressStatusClickRef = useRef(false)

  const handleFailure = useCallback((cause: unknown, fallback: string) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [onSessionExpired])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current
    try {
      const [nextAreas, nextRoles] = await Promise.all([
        listAllTechnicalAreas(signal),
        listAllTechnicalRoles('', signal),
      ])
      if (signal?.aborted || sequence !== requestSequence.current) return false

      setAreas(nextAreas)
      setRoles(nextRoles)
      const currentSelection = selectedAreaIdRef.current
      const nextSelection = currentSelection && nextAreas.some((area) => area.id === currentSelection) ? currentSelection : (nextAreas[0]?.id ?? '')
      if (currentSelection !== nextSelection) setSelectedAreaId(nextSelection)
      setError('')
      return true
    } catch (cause) {
      if (signal?.aborted || sequence !== requestSequence.current) return false
      throw cause
    }
  }, [setSelectedAreaId])

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
    enabled: !editor && !saving && !savingStatuses && !statusDragActive && !pendingStatusBatch,
    intervalMs: 20_000,
  })

  async function applyStatusChanges(kind: 'area' | 'role', ids: string[], status: AdminUserStatus) {
    const targets = kind === 'area'
      ? areas.filter((area) => ids.includes(area.id) && area.status !== status)
      : roles.filter((role) => ids.includes(role.id) && role.status !== status)
    if (!targets.length) return

    setSavingStatuses(true)
    setError('')
    setNotice('')
    const failures: string[] = []
    let savedCount = 0
    try {
      for (const target of targets) {
        try {
          if (kind === 'area') {
            const area = target as TechnicalArea
            const saved = await saveTechnicalArea({ ...areaInput(area), status })
            setAreas((current) => current.map((item) => item.id === saved.id ? saved : item))
          } else {
            const role = target as TechnicalRole
            const saved = await saveTechnicalRole({ ...roleInput(role.area_id, role), status })
            setRoles((current) => current.map((item) => item.id === saved.id ? saved : item))
          }
          savedCount += 1
        } catch (cause) {
          if (isGestorAuthenticationError(cause)) {
            onSessionExpired()
            break
          }
          failures.push(`${target.nome}: ${cause instanceof Error ? cause.message : 'falha ao salvar'}`)
        }
      }
      if (failures.length) setError(`${savedCount} de ${targets.length} itens alterados. ${failures.join(' · ')}`)
      else if (savedCount) {
        const label = kind === 'area' ? (savedCount === 1 ? 'área' : 'áreas') : (savedCount === 1 ? 'cargo' : 'cargos')
        const verb = kind === 'area'
          ? (status === 'ATIVO' ? 'ativada' : 'desativada')
          : (status === 'ATIVO' ? 'ativado' : 'desativado')
        setNotice(`${savedCount} ${label} ${verb}${savedCount === 1 ? '' : 's'}.`)
      }
    } finally {
      setSavingStatuses(false)
      setStatusPreviewIds([])
    }
  }

  function beginStatusDrag(event: ReactPointerEvent<HTMLButtonElement>, kind: 'area' | 'role', id: string, currentStatus: AdminUserStatus) {
    if (savingStatuses || saving || editor) return
    statusDragRef.current = {
      kind,
      pointerId: event.pointerId,
      startY: event.clientY,
      status: currentStatus === 'ATIVO' ? 'INATIVO' : 'ATIVO',
      ids: new Set([id]),
      moved: false,
    }
    setStatusPreviewIds([id])
    setStatusDragActive(true)
  }

  useEffect(() => {
    if (!statusDragActive) return undefined
    const move = (event: PointerEvent) => {
      const drag = statusDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.moved && Math.abs(event.clientY - drag.startY) >= 7) drag.moved = true
      if (!drag.moved) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-technical-status-kind][data-technical-status-id]')
      if (target?.dataset.technicalStatusKind !== drag.kind) return
      const targetId = target.dataset.technicalStatusId
      const targetItem = drag.kind === 'area'
        ? areas.find((area) => area.id === targetId)
        : roles.find((role) => role.id === targetId)
      if (!targetItem || targetItem.status === drag.status || drag.ids.has(targetItem.id)) return
      drag.ids.add(targetItem.id)
      setStatusPreviewIds([...drag.ids])
    }
    const finish = (event: PointerEvent) => {
      const drag = statusDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      statusDragRef.current = null
      setStatusDragActive(false)
      if (!drag.moved) return
      suppressStatusClickRef.current = true
      const ids = [...drag.ids]
      setStatusPreviewIds(ids)
      if (ids.length > 1) {
        setPendingStatusBatch({ kind: drag.kind, ids, status: drag.status })
        return
      }
      void applyStatusChanges(drag.kind, ids, drag.status)
    }
    const cancel = (event: PointerEvent) => {
      if (statusDragRef.current?.pointerId !== event.pointerId) return
      statusDragRef.current = null
      setStatusDragActive(false)
      setStatusPreviewIds([])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [areas, roles, statusDragActive])

  function toggleStatusClick(kind: 'area' | 'role', id: string, currentStatus: AdminUserStatus) {
    if (suppressStatusClickRef.current) {
      suppressStatusClickRef.current = false
      return
    }
    void applyStatusChanges(kind, [id], currentStatus === 'ATIVO' ? 'INATIVO' : 'ATIVO')
  }

  function startSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    splitPointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resizeSplit(event: ReactPointerEvent<HTMLButtonElement>) {
    if (splitPointerIdRef.current !== event.pointerId) return
    const bounds = splitContainerRef.current?.getBoundingClientRect()
    if (!bounds) return
    const position = layoutOrientation === 'side-by-side'
      ? (event.clientX - bounds.left) / bounds.width
      : (event.clientY - bounds.top) / bounds.height
    setSplitPercent(Math.round(Math.min(75, Math.max(25, position * 100))))
  }

  function finishSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (splitPointerIdRef.current !== event.pointerId) return
    splitPointerIdRef.current = null
  }

  function nudgeSplit(event: React.KeyboardEvent<HTMLButtonElement>) {
    const decrement = ['ArrowLeft', 'ArrowUp'].includes(event.key)
    const increment = ['ArrowRight', 'ArrowDown'].includes(event.key)
    if (!decrement && !increment) return
    event.preventDefault()
    setSplitPercent((current) => Math.min(75, Math.max(25, current + (decrement ? -3 : 3))))
  }

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

  const showAreasPanel = detachedPanel === 'areas' || (!detachedPanel && !detachedPanels.includes('areas'))
  const showRolesPanel = detachedPanel === 'roles' || (!detachedPanel && !detachedPanels.includes('roles'))

  useEffect(() => {
    if (!detachContext) return undefined
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetachContext(null)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [detachContext])

  function showDetachMenu(event: ReactMouseEvent<HTMLElement>, panel: 'areas' | 'roles') {
    if (!onDetachPanel || detachedPanel) return
    event.preventDefault()
    setDetachContext({
      panel,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 205)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 90)),
    })
  }

  if (loading) return <div className="dashboard-loading">Carregando áreas e cargos…</div>

  return (
    <section className="admin-technical-structure">
      {error ? <div className="dashboard-error" role="alert"><strong>Cadastro não concluído.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}
      {pendingStatusBatch ? <section className="admin-technical-batch-confirm" role="alertdialog" aria-label="Confirmar alteração de status"><span>{`Aplicar ${pendingStatusBatch.status === 'ATIVO' ? 'ativação' : 'desativação'} em ${pendingStatusBatch.ids.length} ${pendingStatusBatch.kind === 'area' ? 'áreas' : 'cargos'}?`}</span><div><button type="button" onClick={() => { setPendingStatusBatch(null); setStatusPreviewIds([]) }}>Cancelar</button><button className="primary-button" type="button" onClick={() => { if (!pendingStatusBatch) return; const request = pendingStatusBatch; setPendingStatusBatch(null); void applyStatusChanges(request.kind, request.ids, request.status) }}>Confirmar</button></div></section> : null}

      {!detachedPanel ? <>
        <nav className="admin-technical-tabs" role="tablist" aria-label="Áreas técnicas">
          <button type="button" role="tab" aria-selected={!editor} className={!editor ? 'is-active' : ''} onClick={() => setEditor(null)}>Áreas e cargos</button>
          {editor ? <button type="button" role="tab" aria-selected="true" className="is-active">{editor.value.id ? 'Editar' : 'Novo'} {editor.kind === 'area' ? 'área' : 'cargo'}</button> : null}
        </nav>
        {!editor ? <p className="admin-technical-import-hint" title="A empresa define seus próprios nomes de área e cargo; nada vem pré-cadastrado.">Cada empresa define suas áreas e cargos. Para cadastrar várias pessoas de uma vez, use <strong>Usuários → Importar equipe</strong>.</p> : null}
      </> : null}

      {editor ? <section className="admin-technical-editor" role="tabpanel" aria-labelledby="technical-editor-title">
        <header><h2 id="technical-editor-title">{editor.value.id ? 'Editar' : 'Nova'} {editor.kind === 'area' ? 'área técnica' : 'cargo técnico'}</h2><button type="button" onClick={() => setEditor(null)}>← Voltar</button></header>
        <form onSubmit={(event) => { event.preventDefault(); void saveEditor() }}>
          <div className="admin-technical-form">
            {editor.kind === 'role' ? <label><span>Área técnica *</span><select required value={editor.value.area_id} onChange={(event) => setEditor({ kind: 'role', value: { ...editor.value, area_id: event.target.value } })}><option value="">Selecione…</option>{areas.filter((area) => area.status === 'ATIVO' || area.id === editor.value.area_id).map((area) => <option value={area.id} key={area.id}>{area.codigo} · {area.nome}</option>)}</select></label> : null}
            <label><span>Código *</span><input required value={editor.value.codigo} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, codigo: event.target.value.toUpperCase() } } : { kind: 'role', value: { ...editor.value, codigo: event.target.value.toUpperCase() } })} placeholder={editor.kind === 'area' ? 'QUALIDADE' : 'INSPETOR'} /></label>
            <label><span>Nome *</span><input required value={editor.value.nome} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, nome: event.target.value } } : { kind: 'role', value: { ...editor.value, nome: event.target.value } })} /></label>
            <label><span>Status</span><select value={editor.value.status} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, status: event.target.value as AdminUserStatus } } : { kind: 'role', value: { ...editor.value, status: event.target.value as AdminUserStatus } })}><option value="ATIVO">Ativo</option><option value="INATIVO">Inativo</option></select></label>
            <label><span>{editor.kind === 'area' ? 'Exigir assinatura por padrão' : 'Pode assinar documentos'}</span><select value={editor.kind === 'area' ? editor.value.exige_assinatura_padrao : editor.value.pode_assinar} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, exige_assinatura_padrao: event.target.value } } : { kind: 'role', value: { ...editor.value, pode_assinar: event.target.value } })}>{YES_NO.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <details className="admin-technical-extra"><summary title="Informações opcionais do cadastro">Mais detalhes</summary><label><span>Descrição</span><textarea rows={2} value={editor.value.descricao || ''} onChange={(event) => setEditor(editor.kind === 'area' ? { kind: 'area', value: { ...editor.value, descricao: event.target.value } } : { kind: 'role', value: { ...editor.value, descricao: event.target.value } })} /></label></details>
          </div>
          <footer><button type="button" onClick={() => setEditor(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button></footer>
        </form>
      </section> : <>
      {showAreasPanel && showRolesPanel ? <div className="admin-technical-layout-toolbar">
        <span>Visualização</span>
        <div role="group" aria-label="Orientação das áreas e cargos">
          <button type="button" className={layoutOrientation === 'stacked' ? 'is-active' : ''} aria-pressed={layoutOrientation === 'stacked'} title="Empilhar áreas e cargos" onClick={() => setLayoutOrientation('stacked')}>Empilhado</button>
          <button type="button" className={layoutOrientation === 'side-by-side' ? 'is-active' : ''} aria-pressed={layoutOrientation === 'side-by-side'} title="Exibir áreas e cargos lado a lado" onClick={() => setLayoutOrientation('side-by-side')}>Lado a lado</button>
        </div>
      </div> : null}

      <div
        ref={splitContainerRef}
        className="admin-technical-columns admin-technical-split"
        data-orientation={layoutOrientation}
        data-panel-count={showAreasPanel && showRolesPanel ? '2' : '1'}
        data-detached-panel={detachedPanel ?? ''}
        style={showAreasPanel && showRolesPanel && layoutOrientation === 'side-by-side'
          ? { gridTemplateColumns: `${splitPercent}fr 8px ${100 - splitPercent}fr` }
          : showAreasPanel && showRolesPanel
            ? { gridTemplateRows: `${splitPercent}fr 8px ${100 - splitPercent}fr` }
            : undefined}
      >
        {showAreasPanel ? <section className="admin-technical-panel" onContextMenu={(event) => showDetachMenu(event, 'areas')}>
          <header title={onDetachPanel && !detachedPanel ? 'Clique com o botão direito para desprender este grupo em uma janela.' : undefined}><h2>Áreas</h2><button className="primary-button" title="Cadastrar uma nova área técnica" type="button" onClick={() => setEditor({ kind: 'area', value: areaInput() })}>+ Nova</button></header>
          <label className="admin-technical-search"><SearchIcon /><input value={areaSearch} onChange={(event) => setAreaSearch(event.target.value)} placeholder="Buscar área" /></label>
          <div className="admin-technical-list">
            {visibleAreas.map((area) => (
              <article className={selectedAreaId === area.id ? 'is-active' : ''} key={area.id}>
                <button className="admin-technical-select" title={`${area.codigo} · ${area.descricao || 'Sem descrição'}`} type="button" aria-pressed={selectedAreaId === area.id} onClick={() => setSelectedAreaId(area.id)}><span><b>{area.codigo}</b><strong>{area.nome}</strong></span></button>
                <button className={`admin-user-status-control is-${area.status.toLocaleLowerCase('pt-BR')}${statusPreviewIds.includes(area.id) ? ' is-preview' : ''}`} type="button" data-technical-status-kind="area" data-technical-status-id={area.id} aria-pressed={area.status === 'ATIVO'} aria-label={`${area.status === 'ATIVO' ? 'Desativar' : 'Ativar'} área ${area.nome}`} title="Clique para alterar. Arraste para aplicar a outras áreas." disabled={savingStatuses || Boolean(pendingStatusBatch)} onPointerDown={(event) => beginStatusDrag(event, 'area', area.id, area.status)} onClick={() => toggleStatusClick('area', area.id, area.status)}>{area.status === 'ATIVO' ? 'ON' : 'OFF'}</button>
                <button className="admin-technical-edit" type="button" aria-label={`Editar área ${area.nome}`} onClick={() => setEditor({ kind: 'area', value: areaInput(area) })}>Editar</button>
              </article>
            ))}
            {!visibleAreas.length ? <div className="admin-technical-empty">{areaSearch ? 'Nenhuma área corresponde à busca.' : 'Nenhuma área cadastrada. Crie uma área para começar.'}</div> : null}
          </div>
        </section> : null}

        {showAreasPanel && showRolesPanel ? <button
          className="admin-technical-splitter"
          type="button"
          role="separator"
          aria-label="Redimensionar painéis de áreas e cargos"
          aria-orientation={layoutOrientation === 'side-by-side' ? 'vertical' : 'horizontal'}
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={splitPercent}
          title="Arraste para redimensionar. Use as setas do teclado para ajustar."
          onPointerDown={startSplitResize}
          onPointerMove={resizeSplit}
          onPointerUp={finishSplitResize}
          onPointerCancel={finishSplitResize}
          onKeyDown={nudgeSplit}
        /> : null}

        {showRolesPanel ? <section className="admin-technical-panel" onContextMenu={(event) => showDetachMenu(event, 'roles')}>
          <header title={onDetachPanel && !detachedPanel ? 'Clique com o botão direito para desprender este grupo em uma janela.' : undefined}><h2>{selectedArea ? `Cargos · ${selectedArea.nome}` : 'Cargos'}</h2><button className="primary-button" title="Cadastrar cargo na área selecionada" type="button" disabled={!selectedAreaId || selectedArea?.status !== 'ATIVO'} onClick={() => setEditor({ kind: 'role', value: roleInput(selectedAreaId) })}>+ Novo</button></header>
          <label className="admin-technical-search"><SearchIcon /><input value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} placeholder="Buscar cargo" /></label>
          <div className="admin-technical-role-table">
            <div><span>Código e cargo</span><span>Assinatura</span><span>Status</span><span /></div>
            {visibleRoles.map((role) => <article key={role.id}><span title={`${role.codigo} · ${role.descricao || 'Sem descrição'}`}><b>{role.codigo}</b><strong>{role.nome}</strong></span><span className={String(role.pode_assinar).toUpperCase() === 'SIM' ? 'is-signature' : ''} title="Permissão para assinar documentos">{String(role.pode_assinar).toUpperCase() === 'SIM' ? <><CheckIcon />Assina</> : 'Não assina'}</span><button className={`admin-user-status-control is-${role.status.toLocaleLowerCase('pt-BR')}${statusPreviewIds.includes(role.id) ? ' is-preview' : ''}`} type="button" data-technical-status-kind="role" data-technical-status-id={role.id} aria-pressed={role.status === 'ATIVO'} aria-label={`${role.status === 'ATIVO' ? 'Desativar' : 'Ativar'} cargo ${role.nome}`} title="Clique para alterar. Arraste para aplicar a outros cargos." disabled={savingStatuses || Boolean(pendingStatusBatch)} onPointerDown={(event) => beginStatusDrag(event, 'role', role.id, role.status)} onClick={() => toggleStatusClick('role', role.id, role.status)}>{role.status === 'ATIVO' ? 'ON' : 'OFF'}</button><button title={`Editar ${role.nome}`} type="button" onClick={() => setEditor({ kind: 'role', value: roleInput(role.area_id, role) })}>Editar</button></article>)}
            {!visibleRoles.length ? <div className="admin-technical-empty">{!selectedArea ? 'Cadastre ou selecione uma área para ver os cargos.' : roleSearch ? 'Nenhum cargo corresponde à busca.' : 'Nenhum cargo nesta área. Adicione um cargo quando precisar.'}</div> : null}
          </div>
        </section> : null}
      </div>
      {!detachedPanel && !showAreasPanel && !showRolesPanel ? <p className="admin-technical-detached-empty">Áreas e cargos estão abertos em janelas separadas. Feche uma dessas janelas para reencaixar o grupo aqui.</p> : null}
      </>}
      {detachContext ? (
        <>
          <button className="admin-technical-detach-dismiss" type="button" aria-label="Fechar opções do grupo" onClick={() => setDetachContext(null)} />
          <aside className="admin-technical-detach-menu" style={{ left: detachContext.x, top: detachContext.y }} aria-label={`Opções de ${detachContext.panel === 'areas' ? 'Áreas' : 'Cargos'}`}>
            <strong>{detachContext.panel === 'areas' ? 'Áreas' : 'Cargos'}</strong>
            <button type="button" onClick={() => {
              onDetachPanel?.(detachContext.panel)
              setDetachContext(null)
            }}>Desprender grupo</button>
          </aside>
        </>
      ) : null}
    </section>
  )
}
