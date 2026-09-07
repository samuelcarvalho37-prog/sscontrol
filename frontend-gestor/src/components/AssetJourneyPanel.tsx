import { useEffect, useState } from 'react'
import type {
  GestorAsset,
  GestorAssetCatalog,
  GestorAssetJourney,
  GestorTechnicalKpis,
} from '../types/gestor'
import {
  AlertIcon,
  AssetIcon,
  CheckIcon,
  ChevronRightIcon,
  StopIcon,
  WrenchIcon,
} from './Icons'

interface AssetJourneyPanelProps {
  asset: GestorAsset | null
  components: GestorAssetCatalog['components']
  current: GestorTechnicalKpis | null
  journey: GestorAssetJourney | null
  componentId: string
  loading: boolean
  onComponentChange: (componentId: string) => void
  onOpenDecision: (
    kind: 'demand' | 'action' | 'model' | 'occurrence',
    id: string,
  ) => void
}

type JourneyTab = 'status' | 'parameters' | 'components' | 'history'

function upper(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR')
}

function humanize(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replaceAll('_', ' ')
    .toLocaleLowerCase('pt-BR')
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1)
    : 'Sem registro'
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Sem base'
    : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Sem base'
  }
  const hours = Math.floor(Math.max(0, value) / 3600)
  const minutes = Math.floor((Math.max(0, value) % 3600) / 60)
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min`
  return `${Math.floor(Math.max(0, value))} s`
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

export function AssetJourneyPanel({
  asset,
  components,
  current,
  journey,
  componentId,
  loading,
  onComponentChange,
  onOpenDecision,
}: AssetJourneyPanelProps) {
  const [tab, setTab] = useState<JourneyTab>('status')

  useEffect(() => {
    setTab('status')
    onComponentChange('')
  }, [asset?.id, onComponentChange])

  if (!asset) {
    return (
      <aside className="manager-library-detail">
        <div className="manager-decision-empty">
          <AssetIcon />
          <strong>Selecione um equipamento</strong>
          <span>Use o filtro acima para abrir a ficha técnica completa.</span>
        </div>
      </aside>
    )
  }

  const parameters = (journey?.parametros_atuais ?? []).filter(
    (parameter) => !componentId || parameter.componente_id === componentId,
  )
  const recentParameters = (journey?.parametros_recentes ?? []).filter(
    (parameter) => !componentId || parameter.componente_id === componentId,
  )
  const rules = (journey?.regras_parametros ?? []).filter(
    (rule) =>
      !componentId ||
      !rule.componente_id ||
      rule.componente_id === componentId,
  )
  const history = (journey?.historico_recente ?? []).filter(
    (item) => !componentId || item.componente_id === componentId,
  )
  const selectedComponent =
    components.find((component) => component.id === componentId) ?? null
  const operationalState = journey?.parada_ativa
    ? 'Em parada'
    : (journey?.acoes_pendentes ?? []).some(
      (action) => upper(action.status) === 'EM_EXECUCAO',
    )
      ? 'Em execução'
      : humanize(asset.status)

  return (
    <aside className="manager-library-detail manager-asset-journey">
      <header>
        <span><AssetIcon /></span>
        <div>
          <small>{asset.tag || asset.id}</small>
          <h2>{asset.nome || 'Ativo sem nome'}</h2>
          <p>
            {asset.fabricante || 'Fabricante não informado'}
            {asset.modelo ? ` · ${asset.modelo}` : ''}
          </p>
        </div>
        <b>{operationalState}</b>
      </header>

      <div className="manager-asset-vitals-label">
        {selectedComponent ? 'Indicadores do componente' : 'Indicadores do equipamento'}
      </div>
      <dl className="manager-asset-vitals">
        <div>
          <dt>Saúde</dt>
          <dd>
            {journey?.saude?.pct !== undefined
              ? `${journey.saude.pct}%`
              : 'Sem base'}
          </dd>
        </div>
        <div>
          <dt>Disponibilidade</dt>
          <dd>{formatPercent(current?.disponibilidade_pct)}</dd>
        </div>
        <div><dt>MTTR</dt><dd>{formatDuration(current?.mttr_segundos)}</dd></div>
        <div><dt>MTBF</dt><dd>{formatDuration(current?.mtbf_segundos)}</dd></div>
      </dl>

      <nav className="manager-asset-tabs" aria-label="Dados do equipamento">
        {([
          ['status', 'Agora', journey?.acoes_pendentes.length ?? 0],
          ['parameters', 'Parâmetros', parameters.length],
          ['components', 'Componentes', components.length],
          ['history', 'Histórico', history.length],
        ] as const).map(([id, label, count]) => (
          <button
            className={tab === id ? 'is-active' : ''}
            type="button"
            key={id}
            onClick={() => setTab(id)}
          >
            {label}<span>{count}</span>
          </button>
        ))}
      </nav>

      {loading ? <p className="panel-state">Carregando histórico técnico…</p> : null}

      {!loading && tab === 'status' ? (
        <div className="manager-asset-status-view">
          <section className="manager-asset-state-card">
            <header>
              <div>
                <small>ESTADO ATUAL</small>
                <strong>{operationalState}</strong>
              </div>
              <span className={journey?.parada_ativa ? 'is-alert' : 'is-ok'}>
                {journey?.parada_ativa ? <StopIcon /> : <CheckIcon />}
              </span>
            </header>
            <dl>
              <div><dt>Criticidade</dt><dd>{humanize(asset.criticidade)}</dd></div>
              <div><dt>Localização</dt><dd>{asset.localizacao_tecnica || 'Não informada'}</dd></div>
              <div><dt>Horímetro</dt><dd>{asset.horimetro_atual ?? 'Não informado'}</dd></div>
              <div><dt>Série</dt><dd>{asset.numero_serie || 'Não informada'}</dd></div>
            </dl>
          </section>

          <section className="manager-asset-live-list">
            <header>
              <strong>Intervenções em aberto</strong>
              <span>{journey?.acoes_pendentes.length ?? 0}</span>
            </header>
            <div>
              {(journey?.acoes_pendentes ?? []).map((action) => (
                <article key={action.id}>
                  <WrenchIcon />
                  <span>
                    <small>{humanize(action.status)}</small>
                    <strong>{action.titulo || 'Intervenção técnica'}</strong>
                    <p>{formatDate(action.gerado_em)}</p>
                  </span>
                  {upper(action.status) === 'AGUARDANDO_VALIDACAO' ? (
                    <button
                      type="button"
                      onClick={() => onOpenDecision('action', action.id)}
                    >
                      Auditar
                    </button>
                  ) : null}
                </article>
              ))}
              {!journey?.acoes_pendentes.length ? (
                <p className="panel-state">Nenhuma intervenção em aberto.</p>
              ) : null}
            </div>
          </section>

          {(journey?.ocorrencias_abertas.length ?? 0) > 0 ? (
            <section className="manager-asset-open-occurrences">
              <header>
                <strong>Ocorrências abertas</strong>
                <span>{journey?.ocorrencias_abertas.length}</span>
              </header>
              {journey?.ocorrencias_abertas.map((occurrence) => (
                <button
                  type="button"
                  key={occurrence.id}
                  onClick={() => onOpenDecision('occurrence', occurrence.id)}
                >
                  <AlertIcon />
                  <span>
                    <strong>{occurrence.titulo || 'Ocorrência'}</strong>
                    <small>{humanize(occurrence.severidade)}</small>
                  </span>
                  <ChevronRightIcon />
                </button>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === 'parameters' ? (
        <div className="manager-asset-parameter-view">
          {components.length > 0 ? (
            <select
              value={componentId}
              onChange={(event) => onComponentChange(event.target.value)}
              aria-label="Filtrar parâmetros por componente"
            >
              <option value="">Equipamento completo</option>
              {components.map((component) => (
                <option value={component.id} key={component.id}>
                  {component.tag || component.id} · {component.nome || 'Componente'}
                </option>
              ))}
            </select>
          ) : null}

          <section>
            <header>
              <strong>Leituras atuais</strong>
              <span>{parameters.length}</span>
            </header>
            <div className="manager-parameter-cards">
              {parameters.map((parameter) => (
                <article key={parameter.id}>
                  <small>{parameter.parametro || 'Parâmetro'}</small>
                  <strong>
                    {parameter.valor ?? '—'} <span>{parameter.unidade}</span>
                  </strong>
                  <p>{formatDate(parameter.registrado_em || parameter.criado_em)}</p>
                </article>
              ))}
              {parameters.length === 0 ? (
                <p className="panel-state">Nenhuma leitura registrada.</p>
              ) : null}
            </div>
          </section>

          <section>
            <header>
              <strong>Faixas configuradas</strong>
              <span>{rules.length}</span>
            </header>
            <div className="manager-parameter-rules">
              {rules.map((rule) => (
                <article key={rule.id}>
                  <span>
                    <strong>{rule.parametro_nome}</strong>
                    <small>{rule.plano_nome}</small>
                  </span>
                  <b>
                    {rule.limite_min !== '' && rule.limite_min !== undefined
                      ? rule.limite_min
                      : '—'}
                    {' — '}
                    {rule.limite_max !== '' && rule.limite_max !== undefined
                      ? rule.limite_max
                      : '—'}
                    {' '}{rule.unidade}
                  </b>
                </article>
              ))}
              {rules.length === 0 ? (
                <p className="panel-state">
                  Nenhuma faixa configurada nos planos deste ativo.
                </p>
              ) : null}
            </div>
          </section>

          <section>
            <header>
              <strong>Últimas alterações</strong>
              <span>{recentParameters.length}</span>
            </header>
            <div className="manager-parameter-history">
              {recentParameters.map((parameter) => (
                <article key={parameter.id}>
                  <i />
                  <span>
                    <strong>
                      {parameter.parametro}: {parameter.valor} {parameter.unidade}
                    </strong>
                    <small>
                      {formatDate(parameter.registrado_em || parameter.criado_em)}
                      {parameter.origem ? ` · ${humanize(parameter.origem)}` : ''}
                    </small>
                  </span>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {!loading && tab === 'components' ? (
        <div className="manager-asset-component-view">
          {selectedComponent ? (
            <section className="manager-component-detail">
              <header>
                <button type="button" onClick={() => onComponentChange('')}>
                  ← Equipamento
                </button>
                <div>
                  <small>{selectedComponent.tag || selectedComponent.id}</small>
                  <h3>{selectedComponent.nome || 'Componente'}</h3>
                  <p>{humanize(selectedComponent.status)}</p>
                </div>
              </header>
              <dl>
                <div><dt>Fabricante</dt><dd>{selectedComponent.fabricante || 'Sem cadastro'}</dd></div>
                <div><dt>Modelo</dt><dd>{selectedComponent.modelo || 'Sem cadastro'}</dd></div>
                <div><dt>Tipo</dt><dd>{humanize(selectedComponent.tipo)}</dd></div>
                <div><dt>Criticidade</dt><dd>{humanize(selectedComponent.criticidade)}</dd></div>
                <div><dt>Horas acumuladas</dt><dd>{selectedComponent.horas_acumuladas ?? 'Sem leitura'}</dd></div>
                <div><dt>Vida útil</dt><dd>
                  {selectedComponent.vida_util_horas
                    ? `${selectedComponent.vida_util_horas} h`
                    : selectedComponent.vida_util_dias
                      ? `${selectedComponent.vida_util_dias} dias`
                      : 'Sem cadastro'}
                </dd></div>
              </dl>
              <div>
                <button type="button" onClick={() => setTab('parameters')}>
                  Ver parâmetros ({parameters.length})
                </button>
                <button type="button" onClick={() => setTab('history')}>
                  Ver histórico ({history.length})
                </button>
              </div>
            </section>
          ) : null}
          {components.map((component) => {
            const readings = (journey?.parametros_atuais ?? []).filter(
              (parameter) => parameter.componente_id === component.id,
            )
            return (
              <article key={component.id}>
                <header>
                  <WrenchIcon />
                  <span>
                    <small>{component.tag || component.id}</small>
                    <strong>{component.nome || 'Componente sem nome'}</strong>
                  </span>
                  <b>{humanize(component.status)}</b>
                </header>
                <dl>
                  <div><dt>Tipo</dt><dd>{humanize(component.tipo)}</dd></div>
                  <div><dt>Criticidade</dt><dd>{humanize(component.criticidade)}</dd></div>
                  <div><dt>Local</dt><dd>{component.localizacao_tecnica || 'Não informado'}</dd></div>
                  <div><dt>Leituras</dt><dd>{readings.length}</dd></div>
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    onComponentChange(component.id)
                  }}
                >
                  Abrir componente
                </button>
              </article>
            )
          })}
          {components.length === 0 ? (
            <p className="panel-state">Nenhum componente cadastrado.</p>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === 'history' ? (
        <div className="manager-asset-history-view">
          {history.map((item) => (
            <article key={item.id}>
              <span><i /></span>
              <div>
                <small>{formatDate(item.criado_em)}</small>
                <strong>{humanize(item.evento)}</strong>
                <p>{item.descricao || 'Alteração registrada no histórico técnico.'}</p>
                <b>{item.usuario_id || item.perfil || 'Sistema'}</b>
              </div>
            </article>
          ))}
          {history.length === 0 ? (
            <p className="panel-state">
              Nenhum evento registrado para este equipamento.
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
