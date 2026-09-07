import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listAdminUsers,
  listAdminTechnicalAnalyses,
  listTechnicalRoles,
} from '../services/api/admin'
import { listAdminEntity } from '../services/api/catalog'
import { listAdminInterventions, saveAdminIntervention, sendAdminInterventionForValidation } from '../services/api/interventions'
import { isGestorAuthenticationError } from '../services/api/gestor'
import type {
  AdminNotificationTarget,
  AdminTechnicalAnalysis,
  AdminUser,
  TechnicalRole,
} from '../types/admin'
import type { AdminEntityRecord } from '../types/catalog'
import type { AdminIntervention, AdminInterventionInput } from '../types/interventions'
import type { ValidationRouteDraft } from '../types/validation'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { AssetIcon, CheckIcon, SearchIcon, ShieldIcon, WrenchIcon } from './Icons'
import { AdminCatalogWorkspace } from './AdminCatalogWorkspace'
import { ValidationPolicySelector } from './ValidationPolicySelector'

interface AdminInterventionsWorkspaceProps {
  onSessionExpired: () => void
  focusTarget?: AdminNotificationTarget | null
  onOpenChecklists: () => void
  onOpenImports: () => void
}

function emptyIntervention(): AdminInterventionInput {
  return {
    ativo_id: '', componente_id: '', plano_id: '', tipo: 'CORRETIVA', titulo: '', descricao: '', prioridade: 'MEDIA',
    planejada_para: '', modo_parada_manutencao: 'DECISAO_EXECUTOR',
  }
}

function editable(intervention: AdminIntervention): boolean {
  return ['RASCUNHO', 'DEVOLVIDA_ADMIN'].includes(intervention.status)
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    RASCUNHO: 'Rascunho', AGUARDANDO_VALIDACAO: 'Aguardando validação', DEVOLVIDA_ADMIN: 'Devolvida ao Admin',
    AGUARDANDO_LIBERACAO: 'Aprovada tecnicamente', ABERTA: 'Liberada ao Operador',
    EM_EXECUCAO: 'Em execução', BLOQUEADA: 'Bloqueada', FINALIZADA: 'Finalizada',
    CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada', QUARENTENA: 'Em quarentena',
  }
  return labels[status] ?? status
}

function available(record: AdminEntityRecord, selectedId?: string): boolean {
  return String(record.status ?? '').trim().toUpperCase() !== 'INATIVO' || String(record.id) === String(selectedId ?? '')
}

function operationalPlan(record: AdminEntityRecord): boolean {
  const status = String(record.status ?? '').trim().toUpperCase()
  const workflow = String(record.workflow_status ?? '').trim().toUpperCase()
  const validated = String(record.validado_gestao ?? '').trim().toUpperCase()
  return status === 'ATIVO'
    && ['VALIDADO', 'ATIVO'].includes(workflow)
    && validated !== 'NAO'
}

function formatDate(value?: string): string {
  if (!value) return 'Sem data registrada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function analysisStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    RASCUNHO: 'Rascunho',
    ENVIADA_ADMIN: 'Aguardando tratamento',
    EM_TRATAMENTO_ADMIN: 'Em tratamento',
    CONVERTIDA_CHECKLIST: 'Checklist criado',
    CONVERTIDA_OS: 'Intervenção criada',
    CONCLUIDA: 'Concluída',
  }
  return labels[String(value ?? '').toUpperCase()] ?? value
}

export function AdminInterventionsWorkspace({
  onSessionExpired,
  focusTarget,
  onOpenChecklists,
  onOpenImports,
}: AdminInterventionsWorkspaceProps) {
  const handledFocusRef = useRef(0)
  const [interventions, setInterventions] = useState<AdminIntervention[]>([])
  const [analyses, setAnalyses] = useState<AdminTechnicalAnalysis[]>([])
  const [assets, setAssets] = useState<AdminEntityRecord[]>([])
  const [components, setComponents] = useState<AdminEntityRecord[]>([])
  const [plans, setPlans] = useState<AdminEntityRecord[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<TechnicalRole[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [scheduleFilter, setScheduleFilter] = useState('')
  const [activeArea, setActiveArea] =
    useState<'planning' | 'interventions' | 'analyses'>('interventions')
  const [editor, setEditor] = useState<AdminInterventionInput | null>(null)
  const [routing, setRouting] = useState<AdminIntervention | null>(null)
  const [viewing, setViewing] = useState<AdminIntervention | null>(null)
  const [viewingAnalysis, setViewingAnalysis] = useState<AdminTechnicalAnalysis | null>(null)
  const [routeDraft, setRouteDraft] = useState<ValidationRouteDraft>({
    politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
    comentario: '',
    exige_segregacao: 'SIM',
    responsavel_atual_id: '',
    usuarios_validadores: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  const handleFailure = useCallback((cause: unknown, fallback: string) => {
    if (isGestorAuthenticationError(cause)) {
      onSessionExpired()
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [onSessionExpired])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [
      nextInterventions,
      nextAnalyses,
      assetList,
      componentList,
      planList,
      nextUsers,
      nextRoles,
    ] = await Promise.all([
      listAdminInterventions(signal),
      listAdminTechnicalAnalyses(signal),
      listAdminEntity('ativos', signal),
      listAdminEntity('componentes', signal),
      listAdminEntity('planos', signal),
      listAdminUsers({ perfil: 'GESTOR', status: 'ATIVO' }, signal),
      listTechnicalRoles('', signal),
    ])
    setInterventions(nextInterventions)
    setAnalyses(nextAnalyses)
    setAssets(assetList.rows)
    setComponents(componentList.rows)
    setPlans(planList.rows)
    setUsers(nextUsers)
    setRoles(nextRoles)
    setLastSyncedAt(new Date())
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadData(controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleFailure(cause, 'Não foi possível carregar as intervenções.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [handleFailure, loadData])

  useAutoRefresh(
    () => refresh(true),
    {
      enabled: !editor && !routing && !viewing && !viewingAnalysis,
      intervalMs: 15_000,
    },
  )

  const visibleInterventions = useMemo(() => {
    const term = search.trim().toLowerCase()
    return interventions.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false
      const planned = Boolean(item.planejada_para)
        || ['PREVENTIVA', 'PREDITIVA', 'INSPECAO'].includes(String(item.tipo).toUpperCase())
      if (scheduleFilter === 'PLANEJADA' && !planned) return false
      if (scheduleFilter === 'NAO_PLANEJADA' && planned) return false
      return !term || [item.codigo, item.titulo, item.ativo_tag, item.ativo_nome, item.componente_nome, item.status]
        .some((value) => String(value ?? '').toLowerCase().includes(term))
    })
  }, [interventions, scheduleFilter, search, statusFilter])
  const visibleAnalyses = useMemo(() => {
    const term = search.trim().toLowerCase()
    return analyses.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false
      return !term || [
        item.id,
        item.titulo,
        item.diagnostico,
        item.causa_provavel,
        item.recomendacao,
        item.ativo_id,
        item.status,
      ].some((value) => String(value ?? '').toLowerCase().includes(term))
    })
  }, [analyses, search, statusFilter])

  const editorComponents = useMemo(
    () => components.filter((component) => (
      String(component.ativo_id) === String(editor?.ativo_id)
      && available(component, editor?.componente_id)
    )),
    [components, editor?.ativo_id, editor?.componente_id],
  )
  const activePlanItemCounts = useMemo(() => {
    const counts = new Map<string, number>()
    plans.forEach((plan) => {
      counts.set(String(plan.id), Number(plan.plano_itens_count ?? 0))
    })
    return counts
  }, [plans])
  const editorPlans = useMemo(
    () => plans.filter((plan) => {
      if (!operationalPlan(plan)) return false
      if (!activePlanItemCounts.get(String(plan.id))) return false
      if (String(plan.ativo_id) !== String(editor?.ativo_id)) return false
      const planComponentId = String(plan.componente_id ?? '')
      return !planComponentId
        || planComponentId === String(editor?.componente_id ?? '')
    }),
    [
      activePlanItemCounts,
      editor?.ativo_id,
      editor?.componente_id,
      plans,
    ],
  )
  const metrics = useMemo(() => ({
    drafts: interventions.filter((item) => item.status === 'RASCUNHO' || item.status === 'DEVOLVIDA_ADMIN').length,
    validation: interventions.filter((item) => item.status === 'AGUARDANDO_VALIDACAO').length,
    released: interventions.filter((item) => item.status === 'ABERTA' || item.status === 'EM_EXECUCAO').length,
    completed: interventions.filter((item) => ['FINALIZADA', 'CONCLUIDA'].includes(item.status)).length,
    analyses: analyses.filter((item) => (
      ['ENVIADA_ADMIN', 'EM_TRATAMENTO_ADMIN'].includes(String(item.status).toUpperCase())
    )).length,
  }), [analyses, interventions])

  useEffect(() => {
    if (
      loading ||
      !focusTarget?.entityId ||
      handledFocusRef.current === focusTarget.nonce
    ) {
      return
    }

    const entityType = String(focusTarget.entityType).toUpperCase()
    if (entityType === 'ANALISES_TECNICAS') {
      const analysis = analyses.find((item) => String(item.id) === focusTarget.entityId)
      handledFocusRef.current = focusTarget.nonce
      setActiveArea('analyses')
      setSearch('')
      setStatusFilter('')
      if (analysis) {
        setViewingAnalysis(analysis)
        setError('')
      } else {
        setError('A análise vinculada à notificação não foi encontrada. Ela pode ter sido removida ou migrada.')
      }
      return
    }

    if (['ORDEM_SERVICO_RASCUNHO', 'ORDENS_SERVICO', 'OS_ACOES'].includes(entityType)) {
      const intervention = interventions.find((item) => (
        String(item.id) === focusTarget.entityId ||
        String(item.acao_id ?? '') === focusTarget.entityId ||
        String(item.demanda?.id ?? '') === focusTarget.entityId
      ))
      handledFocusRef.current = focusTarget.nonce
      setActiveArea('interventions')
      setSearch('')
      setStatusFilter('')
      if (intervention) {
        setViewing(intervention)
        setError('')
      } else {
        setError('A intervenção vinculada à notificação não foi encontrada no histórico administrativo.')
      }
    }
  }, [
    analyses,
    focusTarget?.entityId,
    focusTarget?.entityType,
    focusTarget?.nonce,
    interventions,
    loading,
  ])

  function openEditor(intervention?: AdminIntervention) {
    setEditor(intervention ? {
      id: intervention.id, ativo_id: intervention.ativo_id, componente_id: intervention.componente_id,
      plano_id: intervention.plano_id || '', plano_versao_id: intervention.plano_versao_id || '',
      tipo: intervention.tipo, titulo: intervention.titulo, descricao: intervention.descricao,
      prioridade: intervention.prioridade, planejada_para: intervention.planejada_para,
      modo_parada_manutencao: intervention.modo_parada_manutencao || 'DECISAO_EXECUTOR',
    } : emptyIntervention())
    setError('')
    setNotice('')
  }

  function createInterventionFromAnalysis(analysis: AdminTechnicalAnalysis) {
    setEditor({
      ativo_id: analysis.ativo_id || '',
      componente_id: analysis.componente_id || '',
      plano_id: '',
      tipo: 'CORRETIVA',
      titulo: analysis.titulo || 'Intervenção originada por análise técnica',
      descricao: [
        analysis.diagnostico,
        analysis.causa_provavel ? `Causa provável: ${analysis.causa_provavel}` : '',
        analysis.recomendacao ? `Recomendação: ${analysis.recomendacao}` : '',
      ].filter(Boolean).join('\n\n'),
      prioridade: String(analysis.prioridade || 'MEDIA').toUpperCase(),
      planejada_para: '',
      modo_parada_manutencao: 'DECISAO_EXECUTOR',
    })
    setViewingAnalysis(null)
    setActiveArea('interventions')
    setError('')
    setNotice('Rascunho preenchido com a análise técnica. Vincule um checklist validado antes de salvar.')
  }

  function openRouting(intervention: AdminIntervention) {
    setRouting(intervention)
    setRouteDraft({
      politica_assinatura: 'QUALIDADE_OU_SEGURANCA',
      comentario: intervention.descricao,
      exige_segregacao: 'SIM',
      responsavel_atual_id: '',
      usuarios_validadores: [],
    })
    setError('')
  }

  async function save() {
    if (!editor) return
    if (!editor.ativo_id || !editor.plano_id || !editor.titulo.trim() || editor.descricao.trim().length < 5) {
      setError('Selecione o ativo, vincule um checklist validado e informe título e descrição da intervenção.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await saveAdminIntervention(editor)
      setInterventions((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? { ...item, ...saved } : item)
        : [saved, ...current])
      setEditor(null)
      setNotice('Intervenção salva em rascunho. Nenhuma ação foi enviada ao Operador.')
    } catch (cause) {
      handleFailure(cause, 'Não foi possível salvar a intervenção.')
    } finally {
      setSaving(false)
    }
  }

  async function send() {
    if (!routing) return
    if (
      routeDraft.comentario.trim().length < 5 ||
      (
        routeDraft.politica_assinatura === 'PERSONALIZADA' &&
        !routeDraft.responsavel_atual_id
      )
    ) {
      setError('Defina o validador e informe a orientação para validação.')
      return
    }
    setSending(true)
    setError('')
    try {
      await sendAdminInterventionForValidation({ intervencao_id: routing.id, ...routeDraft })
      await loadData()
      setRouting(null)
      setNotice('Intervenção enviada para assinatura técnica. A ação aparecerá ao Operador após todas as assinaturas exigidas.')
    } catch (cause) {
      handleFailure(cause, 'Não foi possível enviar a intervenção.')
    } finally {
      setSending(false)
    }
  }

  async function refresh(background = false) {
    if (!background) setLoading(true)
    setError('')
    try {
      await loadData()
      if (!background) setNotice('Intervenções atualizadas.')
    } catch (cause) {
      handleFailure(cause, 'Não foi possível atualizar as intervenções.')
    } finally {
      if (!background) setLoading(false)
    }
  }

  if (loading) return <div className="dashboard-loading">Carregando intervenções…</div>

  return (
    <section className="admin-interventions-workspace">
      {error ? <div className="dashboard-error" role="alert"><strong>Ação não concluída.</strong><span>{error}</span></div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}
      <section className="admin-intervention-metrics">
        <article><AssetIcon /><span><strong>{metrics.drafts}</strong><small>rascunhos ou devolvidas</small></span></article>
        <article><ShieldIcon /><span><strong>{metrics.validation}</strong><small>no filtro técnico</small></span></article>
        <article><WrenchIcon /><span><strong>{metrics.released}</strong><small>liberadas ou em execução</small></span></article>
        <article><CheckIcon /><span><strong>{metrics.completed}</strong><small>intervenções finalizadas</small></span></article>
        <article className={metrics.analyses ? 'is-attention' : ''}><ShieldIcon /><span><strong>{metrics.analyses}</strong><small>análises para tratar</small></span></article>
      </section>
      <nav className="admin-operation-tabs" aria-label="Áreas do fluxo técnico">
        <button
          type="button"
          className={activeArea === 'planning' ? 'is-active' : ''}
          onClick={() => {
            setActiveArea('planning')
            setSearch('')
            setStatusFilter('')
            setScheduleFilter('')
          }}
        >
          <AssetIcon />
          <span><strong>Programação</strong><small>Planos, gatilhos e recorrências</small></span>
          <b>{plans.length}</b>
        </button>
        <button
          type="button"
          className={activeArea === 'interventions' ? 'is-active' : ''}
          onClick={() => {
            setActiveArea('interventions')
            setSearch('')
            setStatusFilter('')
            setScheduleFilter('')
          }}
        >
          <WrenchIcon />
          <span><strong>Intervenções e OS</strong><small>Planejadas e não planejadas</small></span>
          <b>{interventions.length}</b>
        </button>
        <button
          type="button"
          className={activeArea === 'analyses' ? 'is-active' : ''}
          onClick={() => {
            setActiveArea('analyses')
            setSearch('')
            setStatusFilter('')
            setScheduleFilter('')
          }}
        >
          <ShieldIcon />
          <span><strong>Análises recebidas</strong><small>Diagnósticos enviados pelo Gestor</small></span>
          <b>{metrics.analyses}</b>
        </button>
      </nav>
      <section hidden={activeArea !== 'planning'}>
        <AdminCatalogWorkspace
          scope="maintenance"
          onSessionExpired={onSessionExpired}
          onOpenImports={onOpenImports}
        />
      </section>
      <section className="admin-intervention-panel" hidden={activeArea !== 'interventions'}>
        <header><div><span className="eyebrow">ORDEM CONTROLADA</span><h2>Intervenções administrativas</h2><p>Crie, classifique e acompanhe intervenções planejadas ou não planejadas até a liberação ao chão de fábrica.</p></div><div><span className="manager-live-sync manager-live-sync--compact" title={lastSyncedAt ? `Sincronizado às ${lastSyncedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando sincronização'}><i aria-hidden="true" />Ao vivo</span><button className="primary-button" type="button" onClick={() => openEditor()}>Nova intervenção</button></div></header>
        <div className="admin-intervention-filters"><label><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, título ou equipamento" /></label><select value={scheduleFilter} onChange={(event) => setScheduleFilter(event.target.value)}><option value="">Planejadas e não planejadas</option><option value="PLANEJADA">Somente planejadas</option><option value="NAO_PLANEJADA">Somente não planejadas</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos os status</option><option value="RASCUNHO">Rascunhos</option><option value="DEVOLVIDA_ADMIN">Devolvidas</option><option value="AGUARDANDO_VALIDACAO">Em validação</option><option value="ABERTA">Liberadas</option><option value="EM_EXECUCAO">Em execução</option><option value="FINALIZADA">Finalizadas</option><option value="CONCLUIDA">Concluídas</option></select></div>
        <div className="admin-intervention-table">
          <div><span>Intervenção</span><span>Equipamento</span><span>Prioridade</span><span>Filtro técnico</span><span>Status</span><span>Ações</span></div>
          {visibleInterventions.map((item) => <article key={item.id}><span><b>{item.codigo}</b><strong>{item.titulo}</strong><small>{item.tipo} · {item.plano_nome ? `${item.plano_nome} · ${item.plano_itens_count || 0} etapas` : 'Checklist pendente'}</small></span><span><strong>{item.ativo_tag || item.ativo_nome || item.ativo_id}</strong><small>{item.componente_nome || 'Ativo completo'}</small></span><i className={`is-${item.prioridade.toLowerCase()}`}>{item.prioridade}</i><span><strong>{item.demanda?.area_atual_nome || '—'}</strong><small>{item.demanda?.cargo_atual_nome || 'Sem cargo específico'}</small></span><em className={`is-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</em><span className="admin-intervention-actions">{editable(item) ? (item.plano_id ? <><button type="button" onClick={() => openEditor(item)}>Editar</button><button className="primary-button" type="button" onClick={() => openRouting(item)}>{item.status === 'DEVOLVIDA_ADMIN' ? 'Reenviar' : 'Enviar'}</button></> : <button className="primary-button" type="button" onClick={() => openEditor(item)}>Vincular checklist</button>) : <button type="button" onClick={() => setViewing(item)}>Acompanhar</button>}</span></article>)}
          {!visibleInterventions.length ? <div className="admin-empty-state admin-intervention-empty"><WrenchIcon /><strong>Nenhuma intervenção encontrada</strong><span>Depois do primeiro rascunho, a área Ações exibirá Editar e Enviar. Após a validação, exibirá Acompanhar sem permitir alterações no documento liberado.</span></div> : null}
        </div>
      </section>
      <section className="admin-intervention-panel admin-analysis-inbox" hidden={activeArea !== 'analyses'}>
        <header>
          <div>
            <span className="eyebrow">ENTRADA TÉCNICA</span>
            <h2>Análises recebidas do Gestor</h2>
            <p>Abra o diagnóstico exato, confira a recomendação e transforme-o em uma intervenção ou checklist.</p>
          </div>
          <div><span className="manager-live-sync manager-live-sync--compact" title={lastSyncedAt ? `Sincronizado às ${lastSyncedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando sincronização'}><i aria-hidden="true" />Ao vivo</span></div>
        </header>
        <div className="admin-intervention-filters">
          <label><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar análise, ativo, causa ou recomendação" /></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos os status</option>
            <option value="ENVIADA_ADMIN">Aguardando tratamento</option>
            <option value="EM_TRATAMENTO_ADMIN">Em tratamento</option>
            <option value="CONVERTIDA_CHECKLIST">Checklist criado</option>
            <option value="CONVERTIDA_OS">Intervenção criada</option>
            <option value="CONCLUIDA">Concluídas</option>
          </select>
        </div>
        <div className="admin-analysis-list">
          {visibleAnalyses.map((analysis) => (
            <article key={analysis.id}>
              <header>
                <span className={`is-${String(analysis.prioridade || 'media').toLowerCase()}`}>
                  {String(analysis.prioridade || 'MÉDIA').replaceAll('_', ' ')}
                </span>
                <em>{analysisStatusLabel(analysis.status)}</em>
              </header>
              <strong>{analysis.titulo}</strong>
              <p>{analysis.diagnostico || 'Diagnóstico técnico não registrado.'}</p>
              <div>
                <span><small>Ativo</small><b>{analysis.ativo_id || 'Escopo geral'}</b></span>
                <span><small>Recebida em</small><b>{formatDate(analysis.enviado_admin_em || analysis.atualizado_em)}</b></span>
                <span><small>Recomendação</small><b>{analysis.recomenda_checklist === 'SIM' ? 'Checklist' : analysis.recomenda_os === 'SIM' ? 'Intervenção' : 'Avaliação administrativa'}</b></span>
              </div>
              <button type="button" onClick={() => setViewingAnalysis(analysis)}>Abrir análise completa</button>
            </article>
          ))}
          {!visibleAnalyses.length ? (
            <div className="admin-empty-state admin-intervention-empty">
              <ShieldIcon />
              <strong>Nenhuma análise encontrada</strong>
              <span>As análises enviadas pelo Gestor aparecerão aqui com diagnóstico, risco e recomendação.</span>
            </div>
          ) : null}
        </div>
      </section>

      {editor ? <div className="admin-catalog-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null) }}><section role="dialog" aria-modal="true" aria-labelledby="intervention-editor-title"><header><div><span className="eyebrow">PLANEJAMENTO ASSISTIDO</span><h2 id="intervention-editor-title">{editor.id ? 'Editar intervenção' : 'Nova intervenção'}</h2></div><button type="button" onClick={() => setEditor(null)}>×</button></header><div className="admin-catalog-form">
        <label><span>Ativo *</span><select value={editor.ativo_id} onChange={(event) => setEditor((current) => current ? { ...current, ativo_id: event.target.value, componente_id: '', plano_id: '', plano_versao_id: '' } : current)}><option value="">Selecione…</option>{assets.filter((asset) => available(asset, editor.ativo_id)).map((asset) => <option value={asset.id} key={asset.id}>{String(asset.tag || asset.id)} · {String(asset.nome)}</option>)}</select></label>
        <label><span>Componente</span><select value={editor.componente_id || ''} onChange={(event) => setEditor((current) => current ? { ...current, componente_id: event.target.value, plano_id: '', plano_versao_id: '' } : current)}><option value="">Ativo completo</option>{editorComponents.map((component) => <option value={component.id} key={component.id}>{String(component.tag || component.id)} · {String(component.nome)}</option>)}</select></label>
        <label className="is-wide"><span>Plano e checklist de execução *</span><select value={editor.plano_versao_id || editor.plano_id} onChange={(event) => { const selected = plans.find((plan) => String(plan.versao_id) === event.target.value); setEditor((current) => current ? { ...current, plano_id: String(selected?.id ?? ''), plano_versao_id: event.target.value } : current) }}><option value="">{editor.ativo_id ? 'Selecione um plano publicado…' : 'Selecione primeiro o ativo…'}</option>{editorPlans.map((plan) => <option value={String(plan.versao_id)} key={String(plan.versao_id)}>{String(plan.nome)} · R{String(plan.revisao || 1)} · {activePlanItemCounts.get(String(plan.id))} etapas</option>)}</select><small>{editor.ativo_id && !editorPlans.length ? 'Nenhum plano publicado com checklist executável está disponível para este escopo.' : 'A OS herda as etapas do checklist publicado vinculado ao plano.'}</small></label>
        <label><span>Tipo</span><select value={editor.tipo} onChange={(event) => setEditor((current) => current ? { ...current, tipo: event.target.value } : current)}><option value="CORRETIVA">Corretiva</option><option value="PREVENTIVA">Preventiva</option><option value="PREDITIVA">Preditiva</option><option value="INSPECAO">Inspeção</option><option value="QUALIDADE">Qualidade</option><option value="SEGURANCA">Segurança</option></select></label>
        <label><span>Prioridade</span><select value={editor.prioridade} onChange={(event) => setEditor((current) => current ? { ...current, prioridade: event.target.value } : current)}><option value="BAIXA">Baixa</option><option value="MEDIA">Média</option><option value="ALTA">Alta</option><option value="CRITICA">Crítica</option></select></label>
        <label><span>Planejada para</span><input type="datetime-local" value={editor.planejada_para || ''} onChange={(event) => setEditor((current) => current ? { ...current, planejada_para: event.target.value } : current)} /></label>
        <label><span>Modo de parada</span><select value={editor.modo_parada_manutencao} onChange={(event) => setEditor((current) => current ? { ...current, modo_parada_manutencao: event.target.value } : current)}><option value="DECISAO_EXECUTOR">Decisão do executor</option><option value="OBRIGATORIA">Parada obrigatória</option><option value="SEM_PARADA">Executar sem parada</option></select></label>
        <label style={{ gridColumn: '1 / -1' }}><span>Título *</span><input value={editor.titulo} onChange={(event) => setEditor((current) => current ? { ...current, titulo: event.target.value } : current)} /></label>
        <label style={{ gridColumn: '1 / -1' }}><span>Descrição do serviço *</span><textarea rows={5} value={editor.descricao} onChange={(event) => setEditor((current) => current ? { ...current, descricao: event.target.value } : current)} /></label>
      </div><footer><span>Salvar não cria ação operacional.</span><div><button type="button" disabled={saving} onClick={() => setEditor(null)}>Cancelar</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar rascunho'}</button></div></footer></section></div> : null}

      {routing ? <div className="admin-catalog-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) setRouting(null) }}><section role="dialog" aria-modal="true" aria-labelledby="intervention-route-title"><header><div><span className="eyebrow">FILTRO TÉCNICO</span><h2 id="intervention-route-title">Enviar {routing.codigo}</h2></div><button type="button" onClick={() => setRouting(null)}>×</button></header><div className="admin-catalog-form">
        <ValidationPolicySelector
          value={routeDraft}
          users={users}
          roles={roles}
          onChange={setRouteDraft}
          allowCustom={false}
        />
        <label><span>Segregar criador e aprovador</span><select value={routeDraft.exige_segregacao} onChange={(event) => setRouteDraft((current) => ({ ...current, exige_segregacao: event.target.value }))}><option value="SIM">Sim</option><option value="NAO">Não</option></select></label>
        <label style={{ gridColumn: '1 / -1' }}><span>Orientação ao Gestor *</span><textarea rows={4} value={routeDraft.comentario} onChange={(event) => setRouteDraft((current) => ({ ...current, comentario: event.target.value }))} /></label>
      </div><footer><span>A ação operacional só será criada depois das assinaturas técnicas.</span><div><button type="button" disabled={sending} onClick={() => setRouting(null)}>Cancelar</button><button className="primary-button" type="button" disabled={sending} onClick={() => void send()}>{sending ? 'Enviando…' : 'Enviar para assinatura'}</button></div></footer></section></div> : null}

      {viewingAnalysis ? (
        <div className="admin-catalog-dialog" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewingAnalysis(null)
        }}>
          <section className="admin-analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-view-title">
            <header>
              <div>
                <span className="eyebrow">ANÁLISE TÉCNICA · {viewingAnalysis.id}</span>
                <h2 id="analysis-view-title">{viewingAnalysis.titulo}</h2>
              </div>
              <button type="button" aria-label="Fechar análise" onClick={() => setViewingAnalysis(null)}>×</button>
            </header>
            <div className="admin-analysis-detail">
              <section className="admin-analysis-detail__summary">
                <article><small>Status</small><strong>{analysisStatusLabel(viewingAnalysis.status)}</strong></article>
                <article><small>Prioridade</small><strong>{viewingAnalysis.prioridade || 'MÉDIA'}</strong></article>
                <article><small>Ativo</small><strong>{viewingAnalysis.ativo_id || 'Escopo geral'}</strong></article>
                <article><small>Ocorrência de origem</small><strong>{viewingAnalysis.ocorrencia_id}</strong></article>
              </section>
              <section>
                <span>DIAGNÓSTICO CONFIRMADO</span>
                <p>{viewingAnalysis.diagnostico || 'Sem diagnóstico registrado.'}</p>
              </section>
              <div className="admin-analysis-detail__grid">
                <section>
                  <span>CAUSA PROVÁVEL</span>
                  <p>{viewingAnalysis.causa_provavel || 'A confirmar durante a inspeção.'}</p>
                </section>
                <section>
                  <span>RISCO TÉCNICO</span>
                  <p>{viewingAnalysis.risco || 'Nenhum risco adicional registrado.'}</p>
                </section>
              </div>
              <section className="is-recommendation">
                <span>RECOMENDAÇÃO DO GESTOR</span>
                <p>{viewingAnalysis.recomendacao || 'Avaliação administrativa necessária.'}</p>
                <div>
                  {viewingAnalysis.recomenda_checklist === 'SIM' ? <b>Recomenda criar checklist</b> : null}
                  {viewingAnalysis.recomenda_os === 'SIM' ? <b>Recomenda criar intervenção</b> : null}
                </div>
              </section>
              <small>Recebida em {formatDate(viewingAnalysis.enviado_admin_em || viewingAnalysis.atualizado_em)}</small>
            </div>
            <footer>
              <span>O registro original permanece preservado para auditoria.</span>
              <div>
                <button type="button" onClick={() => setViewingAnalysis(null)}>Fechar</button>
                <button type="button" onClick={() => {
                  setViewingAnalysis(null)
                  onOpenChecklists()
                }}>Abrir construtor</button>
                <button className="primary-button" type="button" onClick={() => createInterventionFromAnalysis(viewingAnalysis)}>Preparar intervenção</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {viewing ? <div className="admin-catalog-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null) }}><section role="dialog" aria-modal="true" aria-labelledby="intervention-view-title">
        <header><div><span className="eyebrow">ACOMPANHAMENTO</span><h2 id="intervention-view-title">{viewing.codigo} · {viewing.titulo}</h2></div><button type="button" onClick={() => setViewing(null)}>×</button></header>
        <div className="admin-intervention-detail">
          <article><small>Status</small><strong>{statusLabel(viewing.status)}</strong></article>
          <article><small>Equipamento</small><strong>{viewing.ativo_tag || viewing.ativo_nome || viewing.ativo_id}</strong></article>
          <article><small>Componente</small><strong>{viewing.componente_nome || 'Ativo completo'}</strong></article>
          <article><small>Checklist de execução</small><strong>{viewing.plano_nome ? `${viewing.plano_nome} · R${viewing.plano_revisao || 1} · ${viewing.plano_itens_count || 0} etapas` : 'Vínculo pendente'}</strong></article>
          <article><small>Prioridade</small><strong>{viewing.prioridade}</strong></article>
          <article><small>Área atual</small><strong>{viewing.demanda?.area_atual_nome || 'Fluxo operacional'}</strong></article>
          <article><small>Responsável técnico</small><strong>{viewing.demanda?.cargo_atual_nome || 'Sem cargo específico'}</strong></article>
          <article className="is-wide"><small>Descrição</small><strong>{viewing.descricao}</strong></article>
        </div>
        <footer><span>O registro liberado permanece imutável e rastreável.</span><div><button type="button" onClick={() => setViewing(null)}>Concluir acompanhamento</button></div></footer>
      </section></div> : null}
    </section>
  )
}
