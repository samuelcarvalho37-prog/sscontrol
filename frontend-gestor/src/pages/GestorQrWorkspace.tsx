import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertIcon,
  AssetIcon,
  CameraIcon,
  ChartIcon,
  CheckIcon,
  ChecklistIcon,
  DocumentIcon,
  SearchIcon,
  ShieldIcon,
  WrenchIcon,
} from '../components/Icons'
import {
  getGestorAssetJourney,
  isGestorAuthenticationError,
  registerGestorParameter,
  requestGestorParameterAction,
} from '../services/api/gestor'
import type {
  GestorAssetJourney,
  GestorAssetParameterSummary,
  GestorParameterRequestType,
  GestorParameterStatus,
} from '../types/gestor'

type BarcodeDetectorResult = { rawValue?: string }
type BarcodeDetectorInstance = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>
}
type BarcodeDetectorConstructor = new (options: {
  formats: string[]
}) => BarcodeDetectorInstance
type DossierTab = 'overview' | 'parameters' | 'history'

const FALLBACK_PARAMETERS = [
  { value: 'HORIMETRO', label: 'Horímetro', unit: 'h' },
  { value: 'TEMPERATURA', label: 'Temperatura', unit: '°C' },
  { value: 'VIBRACAO', label: 'Vibração', unit: 'mm/s' },
  { value: 'PRESSAO', label: 'Pressão', unit: 'bar' },
  { value: 'CORRENTE', label: 'Corrente', unit: 'A' },
  { value: 'TENSAO', label: 'Tensão', unit: 'V' },
] as const

const STATUS_CONTENT: Record<
  GestorParameterStatus,
  { label: string; detail: string; tone: string }
> = {
  NORMAL: {
    label: 'Normal',
    detail: 'Leitura dentro da faixa configurada',
    tone: 'normal',
  },
  ACIMA_LIMITE: {
    label: 'Acima do limite',
    detail: 'A leitura exige avaliação técnica',
    tone: 'critical',
  },
  ABAIXO_LIMITE: {
    label: 'Abaixo do limite',
    detail: 'A leitura exige avaliação técnica',
    tone: 'critical',
  },
  SEM_LEITURA: {
    label: 'Sem leitura',
    detail: 'Parâmetro configurado aguardando medição',
    tone: 'attention',
  },
  SEM_LIMITE: {
    label: 'Sem faixa',
    detail: 'Há leitura, mas os limites ainda não foram definidos',
    tone: 'neutral',
  },
}

interface GestorQrWorkspaceProps {
  onOpenAsset: (assetId: string) => void
  onSessionExpired: () => void
}

function formatDate(value?: string): string {
  if (!value) return 'Sem data'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function formatDuration(seconds?: number): string {
  const value = Math.max(0, Number(seconds ?? 0))
  if (!value) return 'Sem duração'
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (hours) return `${hours} h ${minutes} min`
  return `${Math.max(1, minutes)} min`
}

function humanize(value: unknown): string {
  const text = String(value ?? '').trim().replaceAll('_', ' ').toLocaleLowerCase('pt-BR')
  return text
    ? text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)
    : 'Sem registro'
}

function numericValue(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

export function GestorQrWorkspace({
  onOpenAsset,
  onSessionExpired,
}: GestorQrWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [journey, setJourney] = useState<GestorAssetJourney | null>(null)
  const [activeTab, setActiveTab] = useState<DossierTab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraActive, setCameraActive] = useState(true)
  const [cameraError, setCameraError] = useState('')
  const [parameterOpen, setParameterOpen] = useState(false)
  const [parameterTarget, setParameterTarget] =
    useState<GestorAssetParameterSummary | null>(null)
  const [parameterName, setParameterName] = useState('HORIMETRO')
  const [parameterValue, setParameterValue] = useState('')
  const [componentId, setComponentId] = useState('')
  const [actionTarget, setActionTarget] =
    useState<GestorAssetParameterSummary | null>(null)
  const [requestType, setRequestType] =
    useState<GestorParameterRequestType>('INSPECAO')
  const [requestPriority, setRequestPriority] = useState('MEDIA')
  const [requestNote, setRequestNote] = useState('')
  const [proposedMin, setProposedMin] = useState('')
  const [proposedMax, setProposedMax] = useState('')
  const [saving, setSaving] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)

  const parameterOptions = useMemo(() => {
    const configured = (journey?.parametros_analisados ?? []).map((item) => ({
      value: item.parametro,
      label: humanize(item.parametro),
      unit: item.unidade ?? '',
      componentId: item.componente_id ?? '',
      summary: item,
    }))
    const keys = new Set(configured.map((item) => `${item.componentId}|${item.value}`))
    const fallback = FALLBACK_PARAMETERS
      .filter((item) => !keys.has(`${componentId}|${item.value}`))
      .map((item) => ({
        ...item,
        componentId,
        summary: undefined,
      }))
    return [...configured, ...fallback]
  }, [componentId, journey?.parametros_analisados])

  const parameterDefinition = useMemo(
    () => parameterOptions.find((item) => (
      item.value === parameterName &&
      (item.componentId === componentId || !item.componentId)
    )) ?? parameterOptions.find((item) => item.value === parameterName) ??
      parameterOptions[0],
    [componentId, parameterName, parameterOptions],
  )

  const abnormalParameters = useMemo(
    () => (journey?.parametros_analisados ?? []).filter((parameter) =>
      ['ACIMA_LIMITE', 'ABAIXO_LIMITE', 'SEM_LEITURA'].includes(parameter.status),
    ),
    [journey?.parametros_analisados],
  )

  const stopCamera = useCallback((updateState = true) => {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (updateState) setCameraActive(false)
  }, [])

  const lookup = useCallback(async (rawValue: string) => {
    const payload = rawValue.trim()
    if (!payload || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const data = await getGestorAssetJourney(payload)
      if (!data.found || !data.ativo) {
        setJourney(null)
        setError('Nenhum equipamento ou componente foi encontrado para este código.')
        return
      }
      setJourney(data)
      setActiveTab('overview')
      setQuery(payload)
      setComponentId(data.componente?.id ?? '')
      setParameterName(data.parametros_analisados[0]?.parametro ?? 'HORIMETRO')
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setJourney(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível consultar o código informado.',
      )
    } finally {
      setLoading(false)
    }
  }, [loading, onSessionExpired])

  useEffect(() => () => stopCamera(false), [stopCamera])

  useEffect(() => {
    if (!cameraActive || journey) return
    let cancelled = false

    async function startCamera() {
      const Detector = (
        window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
      ).BarcodeDetector
      if (!Detector) {
        setCameraError('A leitura nativa não está disponível neste navegador. Digite a TAG abaixo.')
        setCameraActive(false)
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new Detector({ formats: ['qr_code'] })

        const scan = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const results = await detector.detect(videoRef.current)
            const rawValue = results.find((item) => item.rawValue)?.rawValue?.trim()
            if (rawValue) {
              stopCamera()
              await lookup(rawValue)
              return
            }
          } catch {
            // Um quadro sem QR é esperado durante a leitura contínua.
          }
          scanTimerRef.current = window.setTimeout(() => void scan(), 350)
        }
        void scan()
      } catch (cause) {
        setCameraError(
          cause instanceof Error
            ? `Não foi possível abrir a câmera: ${cause.message}`
            : 'Não foi possível abrir a câmera.',
        )
        setCameraActive(false)
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopCamera(false)
    }
  }, [cameraActive, journey, lookup, stopCamera])

  function openParameter(summary?: GestorAssetParameterSummary) {
    setParameterTarget(summary ?? null)
    setComponentId(summary?.componente_id ?? journey?.componente?.id ?? '')
    setParameterName(summary?.parametro ?? 'HORIMETRO')
    setParameterValue('')
    setError('')
    setParameterOpen(true)
  }

  function openRequest(summary: GestorAssetParameterSummary) {
    const abnormal = ['ACIMA_LIMITE', 'ABAIXO_LIMITE'].includes(summary.status)
    setActionTarget(summary)
    setRequestType(abnormal ? 'CHECKLIST' : 'INSPECAO')
    setRequestPriority(abnormal ? 'ALTA' : 'MEDIA')
    setRequestNote(
      `${humanize(summary.parametro)} deve ser avaliado no ${summary.componente_nome || journey?.ativo?.nome || 'equipamento'}.`,
    )
    setProposedMin(
      summary.limite_min === null || summary.limite_min === undefined
        ? ''
        : String(summary.limite_min),
    )
    setProposedMax(
      summary.limite_max === null || summary.limite_max === undefined
        ? ''
        : String(summary.limite_max),
    )
    setError('')
  }

  async function reloadJourney() {
    if (!journey?.ativo) return
    await lookup(query || journey.componente?.tag || journey.ativo.tag || journey.ativo.id)
  }

  async function saveParameter() {
    if (!journey?.ativo?.id || saving || !parameterDefinition) return
    const value = numericValue(parameterValue)
    if (value === undefined) {
      setError('Informe um valor numérico válido para registrar a leitura.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await registerGestorParameter({
        ativo_id: journey.ativo.id,
        componente_id: componentId || undefined,
        parametro: parameterName,
        valor: value,
        unidade: parameterDefinition.unit,
      })
      setParameterOpen(false)
      setParameterTarget(null)
      setParameterValue('')
      await reloadJourney()
      setActiveTab('parameters')
      setNotice('Leitura registrada com data, ativo e responsável técnico.')
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível registrar a leitura.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function sendParameterRequest() {
    const reading = actionTarget?.leitura_atual
    if (!reading?.id || saving) return
    if (requestNote.trim().length < 5) {
      setError('Descreva brevemente o motivo da solicitação.')
      return
    }
    const minimum = numericValue(proposedMin)
    const maximum = numericValue(proposedMax)
    if (
      requestType === 'AJUSTE_LIMITE' &&
      minimum !== undefined &&
      maximum !== undefined &&
      minimum >= maximum
    ) {
      setError('O limite mínimo proposto deve ser menor que o máximo.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await requestGestorParameterAction({
        parametro_id: reading.id,
        tipo_solicitacao: requestType,
        prioridade: requestPriority,
        observacao: requestNote.trim(),
        limite_min_proposto: minimum,
        limite_max_proposto: maximum,
      })
      setActionTarget(null)
      await reloadJourney()
      setActiveTab('history')
      setNotice(
        requestType === 'CHECKLIST'
          ? 'Solicitação enviada. O Administrador abrirá o construtor com este contexto preenchido.'
          : 'Solicitação enviada ao Administrador com a leitura e a faixa técnica.',
      )
    } catch (cause) {
      if (isGestorAuthenticationError(cause)) {
        onSessionExpired()
        return
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível encaminhar a leitura.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`content manager-qr-workspace${journey ? ' has-dossier' : ''}`}>
      <header className="manager-qr-heading">
        <div>
          <h1>{journey ? 'Equipamento' : 'Ler QR'}</h1>
        </div>
        {journey ? (
          <button
            className="manager-qr-new-scan"
            type="button"
            onClick={() => {
              setJourney(null)
              setQuery('')
              setNotice('')
              setError('')
              setCameraError('')
              setCameraActive(true)
            }}
          >
            <CameraIcon />
            Ler outro
          </button>
        ) : null}
      </header>

      {!journey ? (
        <section className="manager-qr-scanner">
          {cameraActive ? (
            <div className="manager-qr-camera">
              <video ref={videoRef} muted playsInline aria-label="Leitor de QR Code" />
              <span aria-hidden="true"><i /><i /><i /><i /></span>
              {cameraError ? (
                <p className="manager-qr-camera-error" role="alert">
                  {cameraError}
                </p>
              ) : (
                <b>Centralize o código</b>
              )}
            </div>
          ) : (
            <button
              className="manager-qr-camera manager-qr-camera--idle"
              type="button"
              onClick={() => {
                setCameraError('')
                setCameraActive(true)
              }}
            >
              <CameraIcon />
              <strong>Abrir câmera</strong>
              <span>Use a câmera traseira para ler a identificação do ativo.</span>
            </button>
          )}

          <form
            className="manager-qr-search"
            onSubmit={(event) => {
              event.preventDefault()
              stopCamera()
              void lookup(query)
            }}
          >
            <label>
              <SearchIcon />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="TAG, código do equipamento ou componente"
                aria-label="Código do equipamento ou componente"
              />
            </label>
            <button type="submit" disabled={!query.trim() || loading}>
              {loading ? 'Consultando…' : 'Consultar'}
            </button>
          </form>
        </section>
      ) : null}

      {error ? <div className="dashboard-error" role="alert">{error}</div> : null}
      {notice ? <div className="dashboard-notice" role="status">{notice}</div> : null}

      {journey?.ativo ? (
        <section className="manager-qr-result">
          <header className="manager-qr-asset-header">
            <span><AssetIcon /></span>
            <div>
              <small>{journey.ativo.tag || journey.ativo.id}</small>
              <h2>{journey.ativo.nome || 'Equipamento sem nome'}</h2>
              <p>
                {journey.componente
                  ? `${journey.componente.tag || journey.componente.id} · ${journey.componente.nome || 'Componente'}`
                  : journey.ativo.localizacao_tecnica || 'Equipamento completo'}
              </p>
            </div>
            <b className={journey.parada_ativa ? 'is-alert' : ''}>
              {journey.parada_ativa ? 'Em parada' : humanize(journey.ativo.status)}
            </b>
          </header>

          <div className="manager-qr-facts">
            <article>
              <small>Saúde técnica</small>
              <strong>{journey.saude?.pct !== undefined ? `${journey.saude.pct}%` : 'Sem base'}</strong>
            </article>
            <article className={abnormalParameters.length ? 'is-attention' : ''}>
              <small>Parâmetros a tratar</small>
              <strong>{abnormalParameters.length}</strong>
            </article>
            <article>
              <small>Ações abertas</small>
              <strong>{journey.acoes_pendentes.length}</strong>
            </article>
            <article>
              <small>Última atividade</small>
              <strong>{formatDate(journey.historico_manutencao[0]?.criado_em)}</strong>
            </article>
          </div>

          <nav className="manager-qr-tabs" aria-label="Dossiê técnico">
            <button
              className={activeTab === 'overview' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('overview')}
            >
              <AssetIcon /> Agora
            </button>
            <button
              className={activeTab === 'parameters' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('parameters')}
            >
              <ChartIcon /> Parâmetros <b>{journey.parametros_analisados.length}</b>
            </button>
            <button
              className={activeTab === 'history' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('history')}
            >
              <DocumentIcon /> Histórico <b>{journey.historico_manutencao.length}</b>
            </button>
          </nav>

          {activeTab === 'overview' ? (
            <div className="manager-qr-overview">
              <section>
                <header>
                  <div><span className="eyebrow">ATENÇÃO AGORA</span><h3>Condição que pede ação</h3></div>
                  <b>{abnormalParameters.length + journey.ocorrencias_abertas.length}</b>
                </header>
                {abnormalParameters.slice(0, 4).map((parameter) => {
                  const content = STATUS_CONTENT[parameter.status]
                  return (
                    <button
                      type="button"
                      key={parameter.chave}
                      className={`manager-qr-attention is-${content.tone}`}
                      onClick={() => {
                        setActiveTab('parameters')
                        if (parameter.leitura_atual) openRequest(parameter)
                      }}
                    >
                      <AlertIcon />
                      <span>
                        <small>{content.label}</small>
                        <strong>{humanize(parameter.parametro)}</strong>
                        <em>{parameter.componente_nome || 'Equipamento completo'}</em>
                      </span>
                      <b>
                        {parameter.leitura_atual?.valor ?? '—'} {parameter.unidade}
                      </b>
                    </button>
                  )
                })}
                {journey.ocorrencias_abertas.slice(0, 3).map((occurrence) => (
                  <article className="manager-qr-attention is-critical" key={occurrence.id}>
                    <AlertIcon />
                    <span>
                      <small>{humanize(occurrence.severidade || 'Ocorrência')}</small>
                      <strong>
                        {String(occurrence.titulo || occurrence.tipo || 'Ocorrência técnica')}
                      </strong>
                      <em>{String(occurrence.descricao || 'Sem descrição complementar.')}</em>
                    </span>
                  </article>
                ))}
                {!abnormalParameters.length && !journey.ocorrencias_abertas.length ? (
                  <div className="manager-qr-empty is-success">
                    <CheckIcon />
                    <span>Nenhum desvio técnico aberto neste contexto.</span>
                  </div>
                ) : null}
              </section>

              <section>
                <header>
                  <div><span className="eyebrow">TRABALHO LIBERADO</span><h3>Ações no equipamento</h3></div>
                  <b>{journey.acoes_pendentes.length}</b>
                </header>
                {journey.acoes_pendentes.slice(0, 4).map((action) => (
                  <article className="manager-qr-action" key={action.id}>
                    <ChecklistIcon />
                    <span>
                      <small>{humanize(action.prioridade)}</small>
                      <strong>{action.titulo}</strong>
                      <em>{humanize(action.status)} · {action.componente_nome || 'Ativo completo'}</em>
                    </span>
                  </article>
                ))}
                {!journey.acoes_pendentes.length ? (
                  <div className="manager-qr-empty">
                    <WrenchIcon />
                    <span>Nenhuma ação aguardando início neste equipamento.</span>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {activeTab === 'parameters' ? (
            <section className="manager-qr-readings">
              <header>
                <div>
                  <span className="eyebrow">CONDIÇÃO E TENDÊNCIA</span>
                  <h3>Parâmetros técnicos</h3>
                  <p>Última leitura, faixa configurada e decisão disponível.</p>
                </div>
                <button type="button" onClick={() => openParameter()}>
                  Registrar leitura
                </button>
              </header>
              <div className="manager-qr-parameter-list">
                {journey.parametros_analisados.map((parameter) => {
                  const content = STATUS_CONTENT[parameter.status]
                  return (
                    <article className={`is-${content.tone}`} key={parameter.chave}>
                      <header>
                        <span>
                          <small>{parameter.componente_tag || journey.ativo?.tag}</small>
                          <strong>{humanize(parameter.parametro)}</strong>
                          <em>{parameter.componente_nome || 'Equipamento completo'}</em>
                        </span>
                        <b>{content.label}</b>
                      </header>
                      <div>
                        <span>
                          <small>Última leitura</small>
                          <strong>
                            {parameter.leitura_atual?.valor ?? '—'} <i>{parameter.unidade}</i>
                          </strong>
                          <em>{formatDate(parameter.leitura_atual?.registrado_em)}</em>
                        </span>
                        <span>
                          <small>Faixa normal</small>
                          <strong>
                            {parameter.limite_min ?? '—'} a {parameter.limite_max ?? '—'} <i>{parameter.unidade}</i>
                          </strong>
                          <em>{parameter.plano_nome || 'Limites ainda não configurados'}</em>
                        </span>
                        <span>
                          <small>Responsável</small>
                          <strong>{parameter.leitura_atual?.registrado_por_nome || 'Sem leitura'}</strong>
                          <em>{content.detail}</em>
                        </span>
                      </div>
                      {parameter.leituras_recentes.length > 1 ? (
                        <div className="manager-qr-trend" aria-label="Últimas leituras">
                          {parameter.leituras_recentes.slice(0, 6).reverse().map((reading) => (
                            <span
                              key={reading.id}
                              className={`is-${STATUS_CONTENT[reading.status_limite ?? 'SEM_LIMITE'].tone}`}
                              title={`${reading.valor} ${reading.unidade || parameter.unidade} · ${formatDate(reading.registrado_em)}`}
                            />
                          ))}
                        </div>
                      ) : null}
                      <footer>
                        <button type="button" onClick={() => openParameter(parameter)}>
                          Nova leitura
                        </button>
                        <button
                          type="button"
                          disabled={!parameter.leitura_atual}
                          onClick={() => openRequest(parameter)}
                        >
                          Sinalizar ao Admin
                        </button>
                      </footer>
                    </article>
                  )
                })}
                {!journey.parametros_analisados.length ? (
                  <div className="manager-qr-empty">
                    <ChartIcon />
                    <span>Nenhum parâmetro configurado ou medido. Registre a primeira leitura.</span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeTab === 'history' ? (
            <section className="manager-qr-history">
              <header>
                <div>
                  <span className="eyebrow">RASTREABILIDADE</span>
                  <h3>Manutenção e decisões</h3>
                  <p>Quem fez, o que registrou e quando ocorreu.</p>
                </div>
              </header>
              <div>
                {journey.historico_manutencao.map((event) => (
                  <article key={event.id}>
                    <span className="manager-qr-history__icon">
                      {String(event.evento).includes('PARAMETRO') ? <ChartIcon /> :
                        String(event.evento).includes('CHECKLIST') ? <ChecklistIcon /> :
                          String(event.evento).includes('QR') ? <CameraIcon /> : <WrenchIcon />}
                    </span>
                    <div>
                      <small>{formatDate(event.criado_em)} · {event.usuario_nome || event.usuario_id || 'Sistema'}</small>
                      <strong>{humanize(event.evento)}</strong>
                      <p>{event.descricao || event.acao_titulo || event.os_titulo || 'Registro técnico preservado.'}</p>
                      {event.os_codigo ? <em>{event.os_codigo} · {event.os_titulo}</em> : null}
                      {event.execucao ? (
                        <details>
                          <summary>
                            Execução por {event.execucao.operador_nome || event.execucao.operador_id || 'Operador'}
                            {' · '}{event.execucao.checklist_respondidos ?? 0}/{event.execucao.checklist_total ?? 0} itens
                          </summary>
                          <div>
                            <span>
                              <small>Resultado</small>
                              <b>{event.execucao.resultado || humanize(event.execucao.status)}</b>
                            </span>
                            <span>
                              <small>Duração</small>
                              <b>{formatDuration(event.execucao.duracao_segundos)}</b>
                            </span>
                            <span>
                              <small>Não conformes</small>
                              <b>{event.execucao.checklist_nao_conformes ?? 0}</b>
                            </span>
                            {(event.execucao.checklist_itens ?? []).map((item) => (
                              <p key={item.id}>
                                <b>{Number(item.ordem ?? 0).toString().padStart(2, '0')} · {item.titulo}</b>
                                <span>{item.resposta || item.valor_numero || 'Sem resposta'} {item.unidade}</span>
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!journey.historico_manutencao.length ? (
                  <div className="manager-qr-empty">
                    <DocumentIcon />
                    <span>Ainda não há manutenção ou decisão registrada para este contexto.</span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <footer className="manager-qr-result-footer">
            <span><ShieldIcon /> Consulta registrada para rastreabilidade.</span>
            <button
              type="button"
              onClick={() => onOpenAsset(journey.ativo?.id ?? '')}
            >
              Abrir ficha completa
            </button>
          </footer>
        </section>
      ) : null}

      {parameterOpen && journey?.ativo ? (
        <div
          className="manager-qr-dialog-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!saving) setParameterOpen(false)
          }}
        >
          <section
            className="manager-qr-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-parameter-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">LEITURA RASTREÁVEL</span>
                <h2 id="manager-parameter-title">Registrar parâmetro</h2>
              </div>
              <button
                type="button"
                disabled={saving}
                aria-label="Fechar"
                onClick={() => setParameterOpen(false)}
              >×</button>
            </header>
            <div>
              <label>
                <span>Aplicar em</span>
                <select
                  value={componentId}
                  onChange={(event) => {
                    setComponentId(event.target.value)
                    setParameterTarget(null)
                  }}
                >
                  <option value="">Equipamento completo</option>
                  {journey.componentes.map((component) => (
                    <option value={component.id} key={component.id}>
                      {component.tag || component.id} · {component.nome || 'Componente'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Parâmetro</span>
                <select
                  value={parameterName}
                  onChange={(event) => {
                    setParameterName(event.target.value)
                    setParameterTarget(
                      journey.parametros_analisados.find((item) => (
                        item.parametro === event.target.value &&
                        String(item.componente_id ?? '') === componentId
                      )) ?? null,
                    )
                  }}
                >
                  {parameterOptions
                    .filter((item, index, list) => (
                      item.componentId === componentId &&
                      list.findIndex((candidate) => (
                        candidate.componentId === item.componentId &&
                        candidate.value === item.value
                      )) === index
                    ))
                    .map((item) => (
                      <option value={item.value} key={`${item.componentId}|${item.value}`}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </label>
              {parameterTarget ? (
                <div className="manager-qr-dialog-range">
                  <span>Faixa configurada</span>
                  <strong>
                    {parameterTarget.limite_min ?? '—'} a {parameterTarget.limite_max ?? '—'} {parameterTarget.unidade}
                  </strong>
                  <small>Última: {parameterTarget.leitura_atual?.valor ?? '—'} {parameterTarget.unidade}</small>
                </div>
              ) : null}
              <label>
                <span>Valor ({parameterDefinition?.unit || 'un'})</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={parameterValue}
                  onChange={(event) => setParameterValue(event.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <footer>
              <span><CheckIcon /> A leitura será vinculada ao seu usuário.</span>
              <button
                type="button"
                disabled={saving || !parameterValue.trim()}
                onClick={() => void saveParameter()}
              >
                {saving ? 'Registrando…' : 'Confirmar leitura'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {actionTarget?.leitura_atual ? (
        <div
          className="manager-qr-dialog-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!saving) setActionTarget(null)
          }}
        >
          <section
            className="manager-qr-dialog manager-qr-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-request-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">DECISÃO BASEADA EM DADOS</span>
                <h2 id="manager-request-title">{humanize(actionTarget.parametro)}</h2>
                <p>
                  {actionTarget.leitura_atual.valor} {actionTarget.unidade} ·{' '}
                  {STATUS_CONTENT[actionTarget.status].label}
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                aria-label="Fechar"
                onClick={() => setActionTarget(null)}
              >×</button>
            </header>
            <div>
              <section className="manager-qr-request-options" aria-label="Tipo de solicitação">
                {([
                  ['INSPECAO', 'Inspeção', 'Programar verificação técnica', WrenchIcon],
                  ['CHECKLIST', 'Checklist', 'Criar roteiro com este contexto', ChecklistIcon],
                  ['AJUSTE_LIMITE', 'Limites', 'Propor revisão da faixa', ChartIcon],
                ] as const).map(([value, label, detail, Icon]) => (
                  <button
                    type="button"
                    className={requestType === value ? 'is-active' : ''}
                    onClick={() => setRequestType(value)}
                    key={value}
                  >
                    <Icon />
                    <span><strong>{label}</strong><small>{detail}</small></span>
                  </button>
                ))}
              </section>
              <div className="manager-qr-request-grid">
                <label>
                  <span>Prioridade</span>
                  <select
                    value={requestPriority}
                    onChange={(event) => setRequestPriority(event.target.value)}
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="MEDIA">Média</option>
                    <option value="ALTA">Alta</option>
                    <option value="CRITICA">Crítica</option>
                  </select>
                </label>
                {requestType === 'AJUSTE_LIMITE' ? (
                  <>
                    <label>
                      <span>Mínimo proposto</span>
                      <input
                        inputMode="decimal"
                        value={proposedMin}
                        onChange={(event) => setProposedMin(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Máximo proposto</span>
                      <input
                        inputMode="decimal"
                        value={proposedMax}
                        onChange={(event) => setProposedMax(event.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                <label className="is-wide">
                  <span>Motivo da solicitação</span>
                  <textarea
                    rows={4}
                    value={requestNote}
                    onChange={(event) => setRequestNote(event.target.value)}
                  />
                </label>
              </div>
              <div className="manager-qr-request-flow">
                <ShieldIcon />
                <span>
                  <strong>O Administrador receberá a leitura completa</strong>
                  <small>
                    Ativo, componente, valor, faixa, responsável e histórico permanecem vinculados.
                  </small>
                </span>
              </div>
            </div>
            <footer>
              <span>O Gestor sugere; a configuração mestre continua protegida.</span>
              <button
                type="button"
                disabled={saving || requestNote.trim().length < 5}
                onClick={() => void sendParameterRequest()}
              >
                {saving ? 'Enviando…' : 'Enviar ao Administrador'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}
