import { useCallback, useEffect, useMemo, useState } from 'react'
import { AssetIcon, SearchIcon, WrenchIcon } from '../components/Icons'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import {
  getGestorAssetCatalog,
  isGestorAuthenticationError,
} from '../services/api/gestor'
import type {
  GestorAsset,
  GestorAssetCatalog,
  GestorComponent,
} from '../types/gestor'

export interface AssetsPageProps {
  onSessionExpired: () => void
}

const EMPTY_CATALOG: GestorAssetCatalog = { assets: [], components: [] }

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function displayNumber(value?: number, suffix = ''): string {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return 'Não informado'
  return `${Number(value).toLocaleString('pt-BR')}${suffix}`
}

export function AssetsPage({ onSessionExpired }: AssetsPageProps) {
  const [catalog, setCatalog] = useState<GestorAssetCatalog>(EMPTY_CATALOG)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (background) setRefreshing(true)
      else setLoading(true)
      setError('')

      try {
        const data = await getGestorAssetCatalog(signal)
        setCatalog(data)
        setLastSyncedAt(new Date())
        setSelectedId((current) =>
          current && data.assets.some((asset) => asset.id === current)
            ? current
            : data.assets[0]?.id ?? '',
        )
      } catch (cause) {
        if (signal?.aborted) return
        if (isGestorAuthenticationError(cause)) {
          onSessionExpired()
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível carregar o catálogo de ativos.',
        )
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [onSessionExpired],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useAutoRefresh(
    () => load(undefined, true),
    { intervalMs: 20_000 },
  )

  const filteredAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
    return catalog.assets.filter((asset) => {
      if (status && upper(asset.status) !== status) return false
      if (!normalizedSearch) return true
      return [asset.id, asset.tag, asset.nome, asset.tipo, asset.localizacao_tecnica]
        .some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    })
  }, [catalog.assets, search, status])

  useEffect(() => {
    if (filteredAssets.length === 0) return
    if (!filteredAssets.some((asset) => asset.id === selectedId)) {
      setSelectedId(filteredAssets[0].id)
    }
  }, [filteredAssets, selectedId])

  const selectedAsset = catalog.assets.find((asset) => asset.id === selectedId) ?? null
  const selectedComponents = selectedAsset
    ? catalog.components.filter((component) => component.ativo_id === selectedAsset.id)
    : []

  return (
    <main className="content assets-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">BIBLIOTECA TÉCNICA</span>
          <h1>Ativos e componentes</h1>
          <p>Consulte a estrutura cadastrada sem alterar os dados mestres.</p>
        </div>
        <span
          className={`manager-live-sync${refreshing ? ' is-syncing' : ''}`}
          title={lastSyncedAt
            ? `Sincronizado às ${lastSyncedAt.toLocaleTimeString('pt-BR')}`
            : 'Aguardando sincronização'}
          role="status"
        >
          <i aria-hidden="true" />
          {refreshing ? 'Sincronizando' : 'Atualização automática'}
        </span>
      </section>

      {error ? <div className="dashboard-error" role="alert"><strong>Falha no catálogo.</strong><span>{error}</span></div> : null}

      <section className="filter-bar asset-filter-bar" aria-label="Filtros de ativos">
        <label className="search-field">
          <SearchIcon />
          <input
            value={search}
            placeholder="TAG, equipamento, tipo ou localização"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="OPERANDO">Operando</option>
            <option value="PARADO">Parado</option>
            <option value="ATIVO">Ativo</option>
            <option value="INATIVO">Inativo</option>
          </select>
        </label>
      </section>

      <section className="asset-layout">
        <div className="asset-list-panel">
          <header className="section-heading">
            <div><span className="eyebrow">EQUIPAMENTOS</span><h2>Catálogo disponível</h2></div>
            <span className="section-count">{filteredAssets.length}</span>
          </header>

          {loading ? <p className="panel-state">Carregando ativos…</p> : null}
          {!loading && filteredAssets.length === 0 ? <p className="panel-state">Nenhum ativo encontrado.</p> : null}

          <div className="asset-list">
            {filteredAssets.map((asset) => {
              const componentCount = catalog.components.filter(
                (component) => component.ativo_id === asset.id,
              ).length
              return (
                <button
                  className={selectedId === asset.id ? 'asset-list-item is-selected' : 'asset-list-item'}
                  type="button"
                  key={asset.id}
                  onClick={() => setSelectedId(asset.id)}
                >
                  <span className="asset-list-item__icon"><AssetIcon /></span>
                  <span className="asset-list-item__copy">
                    <span><strong>{asset.tag || asset.id}</strong><i>{asset.status || 'SEM STATUS'}</i></span>
                    <b>{asset.nome || 'Ativo sem nome'}</b>
                    <small>{componentCount} componente(s) · {asset.localizacao_tecnica || 'Localização não informada'}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="asset-detail-panel">
          {selectedAsset ? (
            <AssetDetail asset={selectedAsset} components={selectedComponents} />
          ) : (
            <p className="panel-state">Selecione um ativo para consultar a ficha técnica.</p>
          )}
        </aside>
      </section>
    </main>
  )
}

function AssetDetail({
  asset,
  components,
}: {
  asset: GestorAsset
  components: GestorComponent[]
}) {
  const health = Math.max(0, Math.min(100, Number(asset.saude_pct ?? 0)))

  return (
    <>
      <header className="asset-detail-header">
        <span className="asset-detail-header__icon"><AssetIcon /></span>
        <div>
          <span className="eyebrow">{asset.tag || asset.id}</span>
          <h2>{asset.nome || 'Ativo sem nome'}</h2>
          <p>{asset.fabricante || 'Fabricante não informado'}{asset.modelo ? ` · ${asset.modelo}` : ''}</p>
        </div>
        <span className="status-chip status-chip--success">{asset.status || 'SEM STATUS'}</span>
      </header>

      <div className="asset-health">
        <div><span>Saúde cadastrada</span><strong>{displayNumber(asset.saude_pct, '%')}</strong></div>
        <div className="asset-health__track"><i style={{ width: `${health}%` }} /></div>
      </div>

      <dl className="asset-facts">
        <div><dt>Criticidade</dt><dd>{asset.criticidade || 'Não informada'}</dd></div>
        <div><dt>Tipo</dt><dd>{asset.tipo || 'Não informado'}</dd></div>
        <div><dt>Horímetro</dt><dd>{displayNumber(asset.horimetro_atual, ' h')}</dd></div>
        <div><dt>Número de série</dt><dd>{asset.numero_serie || 'Não informado'}</dd></div>
        <div className="asset-facts__wide"><dt>Localização técnica</dt><dd>{asset.localizacao_tecnica || 'Não informada'}</dd></div>
      </dl>

      <section className="component-section">
        <header className="section-heading">
          <div><span className="eyebrow">ESTRUTURA</span><h3>Componentes vinculados</h3></div>
          <span className="section-count">{components.length}</span>
        </header>

        {components.length === 0 ? <p className="panel-state">Nenhum componente cadastrado.</p> : null}
        <div className="component-list">
          {components.map((component) => (
            <article className="component-card" key={component.id}>
              <span className="component-card__icon"><WrenchIcon /></span>
              <div>
                <div><strong>{component.tag || component.id}</strong><span>{component.status || 'SEM STATUS'}</span></div>
                <h4>{component.nome || 'Componente sem nome'}</h4>
                <p>{component.tipo || 'Tipo não informado'} · {component.criticidade || 'Criticidade não informada'}</p>
                <small>Horas acumuladas: {displayNumber(component.horas_acumuladas, ' h')}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
