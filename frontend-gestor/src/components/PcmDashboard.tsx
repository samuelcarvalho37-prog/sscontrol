import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callApi } from '../services/api/client'
import { getGestorToken } from '../services/api/config'
import { isGestorAuthenticationError } from '../services/api/gestor'
import { getAdminIntervention, listAdminInterventions } from '../services/api/interventions'
import type { AdminIntervention } from '../types/interventions'
import './PcmDashboard.css'

interface PcmData {
  atualizado_em: string
  atual: {
    ativos_parados: number
    ordens_abertas: number
    ordens_criticas: number
    ordens_atrasadas: number
    preventivas_proximas: number
    backlog_horas_estimadas: number
    ordens_sem_estimativa: number
    tecnicos_em_atividade: number
  }
  confiabilidade: {
    ativos_considerados: number
    falhas: number
    mttr_segundos: number | null
    mtbf_segundos: number | null
    disponibilidade_percentual: number | null
    reincidencias: number
    ativos_reincidentes: number
  }
  falhas_por_ativo: {
    ativo_id: string
    ativo_tag: string
    ativo_nome: string
    setor_nome: string
    falhas: number
  }[]
  falhas_por_setor: {
    setor_id: string
    setor_nome: string
    falhas: number
  }[]
  preventivas: {
    id: string
    codigo: string
    ativo_tag: string
    programada_para: string
  }[]
  tecnicos: {
    id: string
    nome: string
    execucoes: number
  }[]
}

type MaintenanceStatus = 'NORMAL' | 'ATENCAO' | 'CRITICO'

function number(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function duration(seconds: number | null) {
  if (seconds === null) return 'Sem amostra'
  return seconds >= 3600 ? `${number(seconds / 3600)} h` : `${number(seconds / 60)} min`
}

function statusFrom(data: PcmData): MaintenanceStatus {
  const current = data.atual

  if (current.ordens_criticas > 0 || current.ativos_parados >= 2 || current.ordens_atrasadas >= 3) {
    return 'CRITICO'
  }

  if (
    current.ativos_parados > 0 ||
    current.ordens_atrasadas > 0 ||
    current.preventivas_proximas >= 5 ||
    current.ordens_sem_estimativa > 0
  ) {
    return 'ATENCAO'
  }

  return 'NORMAL'
}

function Metric({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string
  value: string | number
  note: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
}) {
  return (
    <article className={`pcm-metric pcm-metric--${tone}`}>
      <span className="pcm-metric__label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function EmptyState({ children }: { children: string }) {
  return <p className="pcm-empty">{children}</p>
}


interface OperationalOrder {
  id: string
  code: string
  equipment: string
  sector: string
  type: string
  priority: string
  responsible: string
  status: string
  deadline: string
  openedAt: string
  raw: AdminIntervention
}

function formatDateTime(value: string) {
  if (!value) return 'Não informado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function elapsed(value: string) {
  if (!value) return 'Não informado'
  const start = new Date(value).getTime()
  if (!Number.isFinite(start)) return 'Não informado'
  const diff = Math.max(0, Date.now() - start)
  const hours = diff / 3600000
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))} min`
  if (hours < 24) return `${number(hours)} h`
  return `${number(hours / 24)} d`
}

function normalize(value: string) {
  return value.trim().toLocaleUpperCase('pt-BR')
}

function humanStatus(value: string) {
  const source = value.trim().replaceAll('_', ' ').toLocaleLowerCase('pt-BR')
  return source ? source.charAt(0).toLocaleUpperCase('pt-BR') + source.slice(1) : 'Não informado'
}

function humanPriority(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    CRITICAL: 'Crítica',
    CRITICA: 'Crítica',
    HIGH: 'Alta',
    ALTA: 'Alta',
    MEDIUM: 'Média',
    MEDIA: 'Média',
    LOW: 'Baixa',
    BAIXA: 'Baixa',
  }
  return labels[source] ?? humanStatus(value)
}

function humanWorkType(value: string) {
  const source = normalize(value)
  const labels: Record<string, string> = {
    CORRECTIVE: 'Corretiva',
    CORRETIVA: 'Corretiva',
    PREVENTIVE: 'Preventiva',
    PREVENTIVA: 'Preventiva',
  }
  return labels[source] ?? humanStatus(value)
}

function maintenanceStatusLabel(value: MaintenanceStatus) {
  return value === 'ATENCAO' ? 'ATENÇÃO' : value === 'CRITICO' ? 'CRÍTICO' : 'NORMAL'
}

function toOperationalOrder(action: AdminIntervention): OperationalOrder {
  const code =
    action.codigo ||
    action.id.slice(0, 8).toLocaleUpperCase('pt-BR')

  const equipment =
    [action.ativo_tag, action.ativo_nome].filter(Boolean).join(' · ') ||
    'Não informado'

  return {
    id: action.id,
    code,
    equipment,
    sector: action.setor_nome || 'Não informado',
    type: action.tipo || 'Não informado',
    priority: action.prioridade || 'NORMAL',
    responsible: action.responsavel_nome || 'Não atribuído',
    status: action.status || 'Não informado',
    deadline: action.planejada_para || '',
    openedAt: action.criado_em || action.atualizado_em || '',
    raw: action,
  }
}

function SelectFilter({
  label,
  value,
  values,
  onChange,
}: {
  label: string
  value: string
  values: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="pcm-order-filter">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">Todos</option>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}

export function PcmDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [days, setDays] = useState('30')
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<PcmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [orders, setOrders] = useState<AdminIntervention[]>([])
  const [orderLoading, setOrderLoading] = useState(true)
  const [orderError, setOrderError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminIntervention | null>(null)
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false)
  const [selectedOrderError, setSelectedOrderError] = useState('')
  const detailRequestRef = useRef(0)
  const [orderStatus, setOrderStatus] = useState('')
  const [orderPriority, setOrderPriority] = useState('')
  const [orderSector, setOrderSector] = useState('')
  const [orderResponsible, setOrderResponsible] = useState('')
  const [orderType, setOrderType] = useState('')

  const reload = useCallback(() => setRefresh(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const end = new Date()

    setLoading(true)
    setError('')

    void callApi<PcmData>(
      'cmms.pcm_dashboard',
      {
        token: getGestorToken(),
        inicio_em: new Date(end.getTime() - Number(days) * 86400000).toISOString(),
        fim_em: end.toISOString(),
      },
      controller.signal,
    )
      .then(response => {
        if (!response.data) throw new Error('A API não retornou os indicadores do PCM.')
        if (!controller.signal.aborted) setData(response.data)
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) onSessionExpired()
        else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os indicadores.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [days, refresh, onSessionExpired])


  useEffect(() => {
    const controller = new AbortController()
    setOrderLoading(true)
    setOrderError('')

    void listAdminInterventions(controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setOrders(result)
      })
      .catch(cause => {
        if (controller.signal.aborted) return
        if (isGestorAuthenticationError(cause)) onSessionExpired()
        else setOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar as ordens.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrderLoading(false)
      })

    return () => controller.abort()
  }, [refresh, onSessionExpired])

  const operationalOrders = useMemo(
    () => orders.map(toOperationalOrder),
    [orders],
  )

  const orderFilterOptions = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return {
      status: unique(operationalOrders.map(item => humanStatus(item.status))),
      priority: unique(operationalOrders.map(item => humanPriority(item.priority))),
      sector: unique(operationalOrders.map(item => item.sector)),
      responsible: unique(operationalOrders.map(item => item.responsible)),
      type: unique(operationalOrders.map(item => humanWorkType(item.type))),
    }
  }, [operationalOrders])

  const filteredOperationalOrders = useMemo(
    () => operationalOrders.filter(item => {
      if (orderStatus && humanStatus(item.status) !== orderStatus) return false
      if (orderPriority && humanPriority(item.priority) !== orderPriority) return false
      if (orderSector && item.sector !== orderSector) return false
      if (orderResponsible && item.responsible !== orderResponsible) return false
      if (orderType && humanWorkType(item.type) !== orderType) return false
      return true
    }),
    [operationalOrders, orderStatus, orderPriority, orderSector, orderResponsible, orderType],
  )

  const current = data?.atual
  const reliability = data?.confiabilidade
  const maintenanceStatus = useMemo(() => (data ? statusFrom(data) : null), [data])

  const alerts = useMemo(() => {
    if (!data) return []

    const items: { level: 'danger' | 'warning' | 'info'; title: string; detail: string }[] = []

    if (data.atual.ordens_criticas > 0) {
      items.push({
        level: 'danger',
        title: 'Ordens críticas abertas',
        detail: `${data.atual.ordens_criticas} ordem(ns) exigem priorização imediata.`,
      })
    }

    if (data.atual.ativos_parados > 0) {
      items.push({
        level: 'danger',
        title: 'Equipamentos parados',
        detail: `${data.atual.ativos_parados} ativo(s) estão com parada aberta.`,
      })
    }

    if (data.atual.ordens_atrasadas > 0) {
      items.push({
        level: 'warning',
        title: 'Ordens atrasadas',
        detail: `${data.atual.ordens_atrasadas} ordem(ns) ultrapassaram a programação.`,
      })
    }

    if (data.atual.ordens_sem_estimativa > 0) {
      items.push({
        level: 'warning',
        title: 'Backlog sem estimativa',
        detail: `${data.atual.ordens_sem_estimativa} ordem(ns) abertas ainda não possuem estimativa.`,
      })
    }

    if (data.confiabilidade.ativos_reincidentes > 0) {
      items.push({
        level: 'warning',
        title: 'Reincidência de falhas',
        detail: `${data.confiabilidade.ativos_reincidentes} equipamento(s) apresentaram nova falha no período.`,
      })
    }

    if (items.length === 0) {
      items.push({
        level: 'info',
        title: 'Nenhum alerta prioritário',
        detail: 'Os indicadores disponíveis não apontam condição crítica neste momento.',
      })
    }

    return items.slice(0, 5)
  }, [data])

  async function openOperationalOrder(order: OperationalOrder) {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setSelectedOrderLoading(true)
    setSelectedOrderError('')
    setSelectedOrder(null)
    try {
      const detail = await getAdminIntervention(order.raw.id)
      if (detailRequestRef.current === requestId) setSelectedOrder(detail)
    } catch (cause) {
      if (detailRequestRef.current !== requestId) return
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setSelectedOrderError(cause instanceof Error ? cause.message : 'Não foi possível carregar a ordem de serviço.')
    } finally {
      if (detailRequestRef.current === requestId) setSelectedOrderLoading(false)
    }
  }

  function closeOperationalOrder() {
    detailRequestRef.current += 1
    setSelectedOrder(null)
    setSelectedOrderError('')
    setSelectedOrderLoading(false)
  }

  return (
    <section className="pcm-dashboard" aria-label="Dashboard do PCM" aria-busy={loading}>
      <header className="pcm-heading">
        <div>
          <span className="eyebrow">PLANEJAMENTO E CONTROLE DA MANUTENÇÃO</span>
          <h1>Central PCM</h1>
          <p>Prioridades, equipe, backlog e confiabilidade em uma única visão.</p>
        </div>

        <div className="pcm-controls">
          <label>
            Histórico
            <select value={days} onChange={event => setDays(event.target.value)}>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Últimos 12 meses</option>
            </select>
          </label>
          <button type="button" disabled={loading} onClick={reload}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </header>

      {error && (
        <div className="dashboard-error" role="alert">
          {error}
          {data && ' Os dados abaixo são da última atualização bem-sucedida.'}
        </div>
      )}

      {!data && loading && (
        <div className="pcm-loading" role="status">
          <span className="pcm-loading__dot" />
          Consultando ordens, paradas e execuções…
        </div>
      )}

      {data && current && reliability && maintenanceStatus && (
        <>
          <section className={`pcm-status pcm-status--${maintenanceStatus.toLowerCase()}`}>
            <div className="pcm-status__main">
              <span className="pcm-status__eyebrow">SITUAÇÃO DA MANUTENÇÃO AGORA</span>
              <div className="pcm-status__line">
                <span className="pcm-status__pulse" aria-hidden="true" />
                <strong>{maintenanceStatusLabel(maintenanceStatus)}</strong>
              </div>
              <p>
                {maintenanceStatus === 'CRITICO'
                  ? 'Existem condições que exigem decisão imediata do PCM.'
                  : maintenanceStatus === 'ATENCAO'
                    ? 'Existem pendências que merecem acompanhamento e priorização.'
                    : 'Nenhuma condição crítica foi identificada nos dados disponíveis.'}
              </p>
            </div>
            <div className="pcm-status__meta">
              <span>Última atualização</span>
              <strong>{new Date(data.atualizado_em).toLocaleString('pt-BR')}</strong>
            </div>
          </section>

          <div className="pcm-section-heading">
            <div>
              <span className="pcm-section-kicker">VISÃO DO DIA</span>
              <h2>O que precisa de atenção</h2>
            </div>
          </div>

          <div className="pcm-metrics pcm-metrics--current">
            <Metric
              label="Ativos parados"
              value={current.ativos_parados}
              note="Equipamentos ativos com parada aberta"
              tone={current.ativos_parados > 0 ? 'danger' : 'success'}
            />
            <Metric
              label="Ordens abertas"
              value={current.ordens_abertas}
              note="Todas as ordens ainda não encerradas"
            />
            <Metric
              label="Ordens críticas"
              value={current.ordens_criticas}
              note="Prioridade crítica ainda em aberto"
              tone={current.ordens_criticas > 0 ? 'danger' : 'success'}
            />
            <Metric
              label="Ordens atrasadas"
              value={current.ordens_atrasadas}
              note="Programação vencida"
              tone={current.ordens_atrasadas > 0 ? 'warning' : 'success'}
            />
            <Metric
              label="Preventivas próximas"
              value={current.preventivas_proximas}
              note="Programadas para os próximos 7 dias"
            />
            <Metric
              label="Técnicos em atividade"
              value={current.tecnicos_em_atividade}
              note="Pessoas distintas com execução ativa"
            />
          </div>

          <div className="pcm-section-heading">
            <div>
              <span className="pcm-section-kicker">INDICADORES</span>
              <h2>Confiabilidade · últimos {days} dias</h2>
            </div>
          </div>

          <div className="pcm-metrics">
            <Metric
              label="MTTR"
              value={duration(reliability.mttr_segundos)}
              note="Tempo médio até restaurar falhas concluídas"
            />
            <Metric
              label="MTBF"
              value={duration(reliability.mtbf_segundos)}
              note="Tempo médio entre falhas no período"
            />
            <Metric
              label="Disponibilidade"
              value={
                reliability.disponibilidade_percentual === null
                  ? 'Sem amostra'
                  : `${number(reliability.disponibilidade_percentual)}%`
              }
              note={`${reliability.ativos_considerados} ativos considerados`}
              tone={
                reliability.disponibilidade_percentual !== null &&
                reliability.disponibilidade_percentual < 90
                  ? 'warning'
                  : 'default'
              }
            />
            <Metric
              label="Backlog estimado"
              value={`${number(current.backlog_horas_estimadas)} h`}
              note={`${current.ordens_abertas} ordens · ${current.ordens_sem_estimativa} sem estimativa`}
            />
            <Metric
              label="Falhas"
              value={reliability.falhas}
              note="Falhas consideradas no período selecionado"
            />
            <Metric
              label="Reincidências"
              value={reliability.reincidencias}
              note={`Em ${reliability.ativos_reincidentes} equipamento(s)`}
              tone={reliability.reincidencias > 0 ? 'warning' : 'success'}
            />
          </div>


          <section className="pcm-panel pcm-orders">
            <div className="pcm-panel__heading pcm-orders__heading">
              <div>
                <span className="pcm-section-kicker">ORDENS DE SERVIÇO</span>
                <h2>Fila operacional</h2>
              </div>
              <span className="pcm-orders__count">
                {filteredOperationalOrders.length} de {operationalOrders.length}
              </span>
            </div>

            <div className="pcm-order-filters" aria-label="Filtros das ordens de serviço">
              <SelectFilter label="Status" value={orderStatus} values={orderFilterOptions.status} onChange={setOrderStatus} />
              <SelectFilter label="Prioridade" value={orderPriority} values={orderFilterOptions.priority} onChange={setOrderPriority} />
              <SelectFilter label="Setor" value={orderSector} values={orderFilterOptions.sector} onChange={setOrderSector} />
              <SelectFilter label="Responsável" value={orderResponsible} values={orderFilterOptions.responsible} onChange={setOrderResponsible} />
              <SelectFilter label="Tipo" value={orderType} values={orderFilterOptions.type} onChange={setOrderType} />
              {(orderStatus || orderPriority || orderSector || orderResponsible || orderType) && (
                <button
                  className="pcm-order-filters__clear"
                  type="button"
                  onClick={() => {
                    setOrderStatus('')
                    setOrderPriority('')
                    setOrderSector('')
                    setOrderResponsible('')
                    setOrderType('')
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {orderError && <div className="dashboard-error" role="alert">{orderError}</div>}

            {orderLoading ? (
              <div className="pcm-loading" role="status">
                <span className="pcm-loading__dot" />
                Carregando ordens de serviço…
              </div>
            ) : operationalOrders.length === 0 ? (
              <EmptyState>Nenhuma ordem aberta encontrada.</EmptyState>
            ) : filteredOperationalOrders.length === 0 ? (
              <EmptyState>Nenhuma ordem corresponde aos filtros selecionados.</EmptyState>
            ) : (
              <div className="pcm-orders__table-wrap">
                <table className="pcm-orders__table">
                  <thead>
                    <tr>
                      <th>OS</th>
                      <th>Equipamento</th>
                      <th>Setor</th>
                      <th>Tipo</th>
                      <th>Prioridade</th>
                      <th>Responsável</th>
                      <th>Status</th>
                      <th>Prazo</th>
                      <th>Tempo em aberto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOperationalOrders.map(item => (
                      <tr key={item.id}>
                        <td><button type="button" className="pcm-order-link" onClick={() => void openOperationalOrder(item)}>{item.code}</button></td>
                        <td>{item.equipment}</td>
                        <td>{item.sector}</td>
                        <td>{humanWorkType(item.type)}</td>
                        <td>
                          <span className={`pcm-order-badge pcm-order-badge--priority-${normalize(item.priority).replaceAll(' ', '-')} `}>
                            {humanPriority(item.priority)}
                          </span>
                        </td>
                        <td>{item.responsible}</td>
                        <td>
                          <span className="pcm-order-badge">
                            {humanStatus(item.status)}
                          </span>
                        </td>
                        <td>{item.deadline ? formatDateTime(item.deadline) : 'Não informado'}</td>
                        <td>{elapsed(item.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {(selectedOrderLoading || selectedOrderError || selectedOrder) && (
            <section className="pcm-panel pcm-order-detail" aria-busy={selectedOrderLoading} aria-live="polite">
              <div className="pcm-panel__heading pcm-order-detail__heading">
                <div>
                  <span className="pcm-section-kicker">ORDEM DE SERVIÇO</span>
                  <h2>{selectedOrder?.codigo || 'Detalhes da ordem'}</h2>
                </div>
                <button type="button" className="pcm-order-detail__close" onClick={closeOperationalOrder}>
                  Fechar
                </button>
              </div>
              {selectedOrderLoading ? (
                <div className="pcm-order-detail__loading" role="status">
                  <span className="pcm-loading__dot" />
                  Carregando ordem de serviço…
                </div>
              ) : selectedOrderError ? (
                <p className="pcm-order-detail__error" role="alert">{selectedOrderError}</p>
              ) : selectedOrder ? (
                <>
                  <dl className="pcm-order-detail__facts">
                    <div className="pcm-order-detail__fact">
                      <dt>Status</dt>
                      <dd>{humanStatus(selectedOrder.status)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Prioridade</dt>
                      <dd>{humanPriority(selectedOrder.prioridade)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Tipo</dt>
                      <dd>{humanWorkType(selectedOrder.tipo)}</dd>
                    </div>
                    <div className="pcm-order-detail__fact pcm-order-detail__fact--wide">
                      <dt>Equipamento</dt>
                      <dd>{[selectedOrder.ativo_tag, selectedOrder.ativo_nome].filter(Boolean).join(' · ') || 'Não informado'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Setor</dt>
                      <dd>{selectedOrder.setor_nome || 'Não informado'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Responsável</dt>
                      <dd>{selectedOrder.responsavel_nome || 'Não atribuído'}</dd>
                    </div>
                    <div className="pcm-order-detail__fact">
                      <dt>Programada para</dt>
                      <dd>{selectedOrder.planejada_para ? formatDateTime(selectedOrder.planejada_para) : 'Não informado'}</dd>
                    </div>
                  </dl>
                  <div className="pcm-order-detail__content">
                    <section>
                      <h3>Título</h3>
                      <p>{selectedOrder.titulo || 'Não informado'}</p>
                    </section>
                    <section>
                      <h3>Descrição</h3>
                      <p>{selectedOrder.descricao || 'Sem descrição.'}</p>
                    </section>
                  </div>
                </>
              ) : null}
            </section>
          )}

      <div className="pcm-grid-main">
            <section className="pcm-panel pcm-alerts">
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ALERTAS</span>
                  <h2>Prioridades operacionais</h2>
                </div>
              </div>
              <div className="pcm-alert-list">
                {alerts.map((alert, index) => (
                  <article className={`pcm-alert pcm-alert--${alert.level}`} key={`${alert.title}-${index}`}>
                    <span className="pcm-alert__marker" aria-hidden="true" />
                    <div>
                      <strong>{alert.title}</strong>
                      <p>{alert.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="pcm-panel pcm-actions">
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ATALHOS</span>
                  <h2>Ações rápidas</h2>
                </div>
              </div>
              <div className="pcm-action-grid">
                {[
                  'Criar OS',
                  'Programar preventiva',
                  'Atribuir técnico',
                  'Reprogramar atividade',
                  'Abrir ocorrência',
                  'Cadastrar ativo',
                  'Cadastrar material',
                ].map(label => (
                  <button
                    type="button"
                    key={label}
                    disabled
                    title="Atalho visual preparado; fluxo será ligado na próxima etapa."
                  >
                    <span>{label}</span>
                    <small>Integração pendente</small>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="pcm-tables">
            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">SETOR</span>
                  <h2>Falhas por setor</h2>
                </div>
              </div>
              {data.falhas_por_setor.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Setor</th>
                      <th>Falhas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.falhas_por_setor.map(row => (
                      <tr key={row.setor_id}>
                        <td>{row.setor_nome}</td>
                        <td><strong>{row.falhas}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>Nenhuma falha registrada no período.</EmptyState>
              )}
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">ATIVOS</span>
                  <h2>Falhas por equipamento</h2>
                </div>
              </div>
              {data.falhas_por_ativo.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Equipamento / setor</th>
                      <th>Falhas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.falhas_por_ativo.map(row => (
                      <tr key={row.ativo_id}>
                        <td>
                          <strong>{row.ativo_tag} · {row.ativo_nome}</strong>
                          <small>{row.setor_nome}</small>
                        </td>
                        <td><strong>{row.falhas}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>Nenhuma falha registrada no período.</EmptyState>
              )}
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">PLANEJAMENTO</span>
                  <h2>Próximas preventivas</h2>
                </div>
              </div>
              {data.preventivas.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Ordem / equipamento</th>
                      <th>Programação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.preventivas.map(row => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.codigo}</strong>
                          <small>{row.ativo_tag}</small>
                        </td>
                        <td>{new Date(row.programada_para).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>Nenhuma preventiva programada para os próximos 7 dias.</EmptyState>
              )}
            </section>

            <section>
              <div className="pcm-panel__heading">
                <div>
                  <span className="pcm-section-kicker">EQUIPE</span>
                  <h2>Técnicos em execução</h2>
                </div>
              </div>
              {data.tecnicos.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Técnico</th>
                      <th>Execuções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tecnicos.map(row => (
                      <tr key={row.id}>
                        <td>{row.nome}</td>
                        <td><strong>{row.execucoes}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>Nenhum técnico com execução em andamento.</EmptyState>
              )}
            </section>
          </div>

          <details className="pcm-method">
            <summary>Como os indicadores são calculados</summary>
            <p>
              Os totais atuais incluem todos os registros abertos dos ativos ativos. O período selecionado
              filtra somente a confiabilidade e as falhas. As listas mostram até 10 registros; os totais não
              são limitados.
            </p>
            <p>
              Falhas são paradas não planejadas ou originadas por alerta técnico que começaram no período.
              Reincidência significa uma nova falha no mesmo equipamento, sem afirmar que a causa é a mesma.
            </p>
            <p>
              A disponibilidade desconta todas as paradas registradas, unindo intervalos sobrepostos. A base
              é o calendário contínuo dos ativos atualmente ativos, sem calendário de turnos. MTTR usa falhas
              concluídas até o fim do período; MTBF divide o tempo disponível acumulado pelo número de falhas.
              Sem falhas, os tempos ficam sem amostra.
            </p>
            <p>
              O backlog soma a duração estimada dos planos de todas as ordens abertas. Não desconta avanço
              parcial e não representa horas-homem.
            </p>
          </details>
        </>
      )}
    </section>
  )
}
