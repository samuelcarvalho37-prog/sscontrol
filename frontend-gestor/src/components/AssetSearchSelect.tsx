import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { GestorAsset } from '../types/gestor'
import { ArrowDownIcon, CheckIcon, SearchIcon } from './Icons'

interface AssetSearchSelectProps {
  assets: GestorAsset[]
  query: string
  selectedId: string
  onQueryChange: (query: string) => void
  onSelect: (asset: GestorAsset | null) => void
}

const PAGE_SIZE = 20

function assetLabel(asset: GestorAsset): string {
  return `${asset.tag || asset.id} · ${asset.nome || 'Ativo sem nome'}`
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR')
}

export function AssetSearchSelect({
  assets,
  query,
  selectedId,
  onQueryChange,
  onSelect,
}: AssetSearchSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)

  const matches = useMemo(() => {
    const search = normalized(query).split('·')[0].trim()
    if (!search) return assets
    return assets.filter((asset) => [
      asset.id,
      asset.tag,
      asset.nome,
      asset.tipo,
      asset.localizacao_tecnica,
    ].some((value) => normalized(value).includes(search)))
  }, [assets, query])

  const visibleAssets = matches.slice(0, visibleLimit)

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE)
    setActiveIndex(-1)
  }, [query])

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    if (activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function choose(asset: GestorAsset) {
    onQueryChange(assetLabel(asset))
    onSelect(asset)
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (!visibleAssets.length) return
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') {
          return Math.min(current + 1, visibleAssets.length - 1)
        }
        return current <= 0 ? visibleAssets.length - 1 : current - 1
      })
      return
    }

    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      const asset = visibleAssets[activeIndex]
      if (asset) choose(asset)
    }
  }

  return (
    <div className="manager-asset-combobox" ref={rootRef}>
      <div className="manager-asset-combobox__control">
        <SearchIcon />
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="manager-asset-options"
          aria-expanded={open}
          aria-activedescendant={
            activeIndex >= 0 ? `manager-asset-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={query}
          placeholder="Pesquisar TAG ou equipamento"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onQueryChange(event.target.value)
            onSelect(null)
            setOpen(true)
          }}
          onKeyDown={handleKeyboard}
        />
        <button
          type="button"
          aria-label={open ? 'Fechar lista de ativos' : 'Abrir lista de ativos'}
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current)
            inputRef.current?.focus()
          }}
        >
          <ArrowDownIcon />
        </button>
      </div>

      {open ? (
        <div
          className="manager-asset-combobox__menu"
          id="manager-asset-options"
          role="listbox"
          aria-label="Ativos encontrados"
          onScroll={(event) => {
            const menu = event.currentTarget
            const nearEnd =
              menu.scrollHeight - menu.scrollTop - menu.clientHeight < 28
            if (nearEnd && visibleLimit < matches.length) {
              setVisibleLimit((current) =>
                Math.min(current + PAGE_SIZE, matches.length),
              )
            }
          }}
        >
          <button
            className={!selectedId ? 'is-selected' : ''}
            type="button"
            role="option"
            aria-selected={!selectedId}
            onClick={() => {
              onQueryChange('')
              onSelect(null)
              setOpen(false)
            }}
          >
            <span>
              <strong>Todos os ativos</strong>
              <small>{assets.length} equipamento(s) no catálogo</small>
            </span>
            {!selectedId ? <CheckIcon /> : null}
          </button>

          {visibleAssets.map((asset, index) => (
            <button
              className={`${asset.id === selectedId ? 'is-selected' : ''}${
                activeIndex === index ? ' is-active' : ''
              }`}
              id={`manager-asset-option-${index}`}
              type="button"
              role="option"
              aria-selected={asset.id === selectedId}
              key={asset.id}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(asset)}
            >
              <span>
                <strong>{asset.tag || asset.id} · {asset.nome || 'Ativo sem nome'}</strong>
                <small>{asset.localizacao_tecnica || asset.tipo || 'Local não informado'}</small>
              </span>
              {asset.id === selectedId ? <CheckIcon /> : null}
            </button>
          ))}

          {!matches.length ? (
            <p>Nenhum ativo corresponde à pesquisa.</p>
          ) : null}
          {visibleLimit < matches.length ? (
            <small className="manager-asset-combobox__loading">
              Role para carregar mais · {visibleAssets.length} de {matches.length}
            </small>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
