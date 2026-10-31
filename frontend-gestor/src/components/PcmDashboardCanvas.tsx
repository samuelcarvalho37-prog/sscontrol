import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, FormEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChartNoAxesCombined, Check, Eye, Filter, Layers, LayoutTemplate, Magnet, Palette, Plus, Printer, Save, Search, Trash2, X } from 'lucide-react'
import './PcmDashboardCanvas.css'

export type PcmCanvasMode = 'number' | 'line' | 'bar' | 'pie' | 'comparison' | 'list' | 'progress'
export type PcmCanvasCategory = { id: string; label: string }
export type PcmCanvasPalette = readonly [string, ...string[]]
export type PcmCanvasSegments = Record<string, string>
export type PcmCanvasSegmentFilter = { id: string; label: string; options: string[] }
const ignoreGlobalSegment = '__all__'
const chartPalettes: Record<string, { label: string; colors: PcmCanvasPalette }> = {
  ocean: { label: 'Azul', colors: ['#176fc1', '#63a2df', '#a9cbea', '#0b4b84', '#82b7dc', '#416d98'] },
  green: { label: 'Verde', colors: ['#14866d', '#55b99b', '#a8ddcd', '#0b5e4b', '#78cbb4', '#3d8c76'] },
  warm: { label: 'Quente', colors: ['#c66a2d', '#e9a34f', '#f2cf88', '#a94836', '#d98373', '#8e5738'] },
  neutral: { label: 'Neutro', colors: ['#526779', '#8295a4', '#b9c4cc', '#31485a', '#96a4ae', '#667f91'] },
  violet: { label: 'Violeta', colors: ['#7047b8', '#9a78d1', '#c5b1e8', '#50328b', '#b69be0', '#8060b8'] },
  rose: { label: 'Rosa', colors: ['#bd4772', '#dc7898', '#edb1c4', '#923657', '#e596ae', '#a85478'] },
  teal: { label: 'Turquesa', colors: ['#087f8c', '#3aabb2', '#8bd0d2', '#075c66', '#61bdc2', '#33848d'] },
  forest: { label: 'Floresta', colors: ['#567c36', '#84a956', '#b4cc84', '#3a5d27', '#98b66d', '#668d49'] },
  sunset: { label: 'Pôr do sol', colors: ['#d04f3c', '#ea8951', '#f4bd72', '#8d3e6c', '#d96a75', '#b96039'] },
  plum: { label: 'Ameixa', colors: ['#75436f', '#a56e9e', '#d1a4c9', '#543050', '#bd87b5', '#895c83'] },
}
export type PcmCanvasWidget = {
  id: string
  title: string
  categoryId: string
  note?: string
  modes: { id: PcmCanvasMode; label: string }[]
  defaultMode: PcmCanvasMode
  action?: boolean
  onActivate?: () => void
  render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments) => ReactNode
}

type PcmCanvasGroup = { id: string; label: string; description?: string; showHeading?: boolean; background?: string | 'transparent'; backgroundOpacity?: 40 | 60 | 80 | 100; border?: string | 'none'; titleColor?: string }
type CanvasPlacement = { groupId: string; span: number; left?: number; top?: number; column?: number; row?: number; rowSpan?: number; height?: number; mode: PcmCanvasMode; paletteId: string; segments?: PcmCanvasSegments; chartOpacity?: 40 | 60 | 80 | 100; customColor?: string; customColors?: string[]; cardBackground?: string | 'transparent'; cardBackgroundOpacity?: 40 | 60 | 80 | 100; cardBorder?: string | 'none'; titleColor?: string; contentColor?: string; customTitle?: string; customSubtitle?: string; showTitle?: boolean; showActionLabel?: boolean; titleSize?: 8 | 10 | 12 | 14; contentSize?: 9 | 11 | 13 | 15; shape?: 'wide' | 'square' | 'column'; buttonStyle?: 'solid' | 'outline' | 'minimal' | 'icon' }
type CanvasResizeDrag = { kind: 'widget' | 'group'; id: string; pointerId: number; startX: number; startY: number; stepWidth: number; columns: number; startSpan: number; startHeight: number }
type CanvasWidgetMove = { id: string; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; left: number; top: number; groupId: string; moved: boolean }
type CanvasLayout = {
  version: 4
  groupOrder: string[]
  groupWidths: Record<string, number>
  groupColumns: Record<string, 1 | 2 | 3 | 4 | 6 | 8 | 12>
  widgetOrder: string[]
  placements: Record<string, CanvasPlacement>
  customGroups: PcmCanvasGroup[]
  magnetEnabled: boolean
}
type SavedCanvasLayout = { id: string; name: string; layout: CanvasLayout }

const boardGroup: PcmCanvasGroup = { id: 'board', label: 'Painel' }
const professionalLayoutId = '__professional_default__'
const storageKey = 'vorqix.pcm.dashboard-canvas.v4'
const previousStorageKeys = ['vorqix.pcm.dashboard-canvas.v3', 'vorqix.pcm.dashboard-canvas.v2']
const namedLayoutsStorageKey = 'vorqix.pcm.dashboard-canvas.presets.v1'
const selectedLayoutStorageKey = 'vorqix.pcm.dashboard-canvas.selected-layout.v1'
const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

function resolvePalette(base: PcmCanvasPalette, customColors?: readonly string[], legacyColor?: string): PcmCanvasPalette {
  const [first, ...rest] = base
  return [customColors?.[0] || legacyColor || first, ...rest.map((color, index) => customColors?.[index + 1] || color)]
}

function withOpacity(color: string, opacity: number): string {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!match) return color
  const [red, green, blue] = [1, 2, 3].map(index => Number.parseInt(match[index] ?? '00', 16))
  return `rgba(${red}, ${green}, ${blue}, ${opacity / 100})`
}

function readSavedLayouts(): SavedCanvasLayout[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(namedLayoutsStorageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedCanvasLayout => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && item.layout && typeof item.layout === 'object')).slice(0, 20).map(item => {
      const placements = Object.fromEntries(Object.entries(item.layout.placements).map(([id, placement]) => {
        const migrated = item.layout.version < 4 ? { ...placement, span: Math.max(1, Math.min(24, placement.span * 2)) } : { ...placement }
        if (Number.isFinite(migrated.left) && Number.isFinite(migrated.top)) return [id, migrated]
        const left = Number.isFinite(migrated.column) ? ((Number(migrated.column) - 1) / 24) * 100 : undefined
        const top = Number.isFinite(migrated.row) ? (Number(migrated.row) - 1) * 8 : undefined
        const { column: _column, row: _row, rowSpan: _rowSpan, ...freePlacement } = migrated
        return [id, { ...freePlacement, ...(left !== undefined ? { left } : {}), ...(top !== undefined ? { top } : {}) }]
      }))
      return { ...item, layout: { ...item.layout, version: 4, placements } }
    })
  } catch {
    return []
  }
}

function readSelectedLayoutId(): string {
  try {
    return window.localStorage.getItem(selectedLayoutStorageKey) ?? ''
  } catch {
    return ''
  }
}

const professionalGroups: PcmCanvasGroup[] = [
  { id: 'group-prioridades', label: 'Prioridades', description: 'Condições que pedem ação imediata.' },
  { id: 'group-carga', label: 'Carga operacional', description: 'Volume de trabalho e capacidade da equipe.' },
  { id: 'group-confiabilidade', label: 'Confiabilidade', description: 'Disponibilidade, falhas e tendência de reparo.' },
  { id: 'group-ativos', label: 'Ativos e setores', description: 'Onde as falhas se concentram.' },
  { id: 'group-planejamento', label: 'Planejamento preventivo', description: 'Programação e cumprimento das preventivas.' },
  { id: 'group-materiais', label: 'Materiais e custos', description: 'Estoque, consumo e custos de manutenção.' },
  { id: 'group-resultados', label: 'Ordens e resultados', description: 'Fila, execuções e fechamento do período.' },
]

function defaultGroupForWidget(widget: PcmCanvasWidget): string {
  if (widget.id.startsWith('attention-')) return 'group-prioridades'
  if (widget.id === 'preventives-next') return 'group-prioridades'
  if (widget.id.startsWith('operational-')) return 'group-carga'
  if (widget.id.startsWith('reliability-') || ['mttr-mtbf-comparison', 'monthly-mttr'].includes(widget.id)) return 'group-confiabilidade'
  if (['sector-failures', 'asset-failures'].includes(widget.id)) return 'group-ativos'
  if (widget.id === 'preventives-next' || widget.id.startsWith('result-preventives-')) return 'group-planejamento'
  if (widget.id.startsWith('result-material-') || widget.id === 'result-low-stock' || widget.id === 'result-stock-items') return 'group-materiais'
  return 'group-resultados'
}

function createDefaultLayout(widgets: PcmCanvasWidget[]): CanvasLayout {
  const placements = Object.fromEntries(widgets.map(widget => {
    const groupId = defaultGroupForWidget(widget)
    return [widget.id, { groupId, span: groupId === 'group-prioridades' ? 6 : 12, mode: widget.defaultMode, paletteId: 'ocean' }]
  }))
  return {
    version: 4,
    groupOrder: [boardGroup.id, ...professionalGroups.map(group => group.id)],
    groupWidths: { board: 24, ...Object.fromEntries(professionalGroups.map(group => [group.id, group.id === 'group-prioridades' ? 24 : 12])) },
    groupColumns: { board: 4, ...Object.fromEntries(professionalGroups.map(group => [group.id, group.id === 'group-prioridades' ? 4 : 2])) },
    widgetOrder: widgets.map(widget => widget.id),
    placements,
    customGroups: professionalGroups,
    magnetEnabled: false,
  }
}

function readInitialLayout(widgets: PcmCanvasWidget[]): CanvasLayout {
  const selectedId = readSelectedLayoutId()
  if (selectedId === professionalLayoutId) return createDefaultLayout(widgets)
  const selected = readSavedLayouts().find(item => item.id === selectedId)
  return selected?.layout ?? readLayout(widgets)
}

function readInitialSelectedLayoutId(widgets: PcmCanvasWidget[], savedLayouts: SavedCanvasLayout[]): string {
  const storedId = readSelectedLayoutId()
  if (storedId === professionalLayoutId || savedLayouts.some(item => item.id === storedId)) return storedId
  const current = readInitialLayout(widgets)
  return sameLayout(current, createDefaultLayout(widgets)) ? professionalLayoutId : ''
}

function readLayout(widgets: PcmCanvasWidget[]): CanvasLayout {
  const defaults = createDefaultLayout(widgets)
  try {
    const raw = window.localStorage.getItem(storageKey) ?? previousStorageKeys.map(key => window.localStorage.getItem(key)).find(Boolean)
    const parsed = JSON.parse(raw ?? 'null') as (Omit<Partial<CanvasLayout>, 'version'> & { version?: number }) | null
    if (!parsed || (parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)) return defaults
    const legacy = parsed.version === 2
    const compactWidgetGrid = parsed.version < 4
    const customGroups = Array.isArray(parsed.customGroups)
      ? parsed.customGroups.filter(item => item && typeof item.id === 'string' && item.id.startsWith('group-') && typeof item.label === 'string' && item.label.trim()).slice(0, 20)
      : []
    const legacyUntouchedBoard = parsed.version === 3
      && customGroups.length === 0
      && (Array.isArray(parsed.groupOrder) ? parsed.groupOrder.every(id => id === boardGroup.id) : true)
      && (!Array.isArray(parsed.widgetOrder) || (parsed.widgetOrder.length === widgets.length && widgets.every((widget, index) => parsed.widgetOrder?.[index] === widget.id)))
      && (!parsed.groupWidths?.board || Number(parsed.groupWidths.board) === 24)
      && (!parsed.groupColumns?.board || Number(parsed.groupColumns.board) === 4)
      && widgets.every(widget => {
        const placement = parsed.placements?.[widget.id]
        if (!placement) return true
        const keys = Object.keys(placement)
        return placement.groupId === boardGroup.id
          && Number(placement.span) === 3
          && placement.mode === widget.defaultMode
          && (!placement.paletteId || placement.paletteId === 'ocean')
          && keys.every(key => ['groupId', 'span', 'mode', 'paletteId'].includes(key))
      })
    if (legacyUntouchedBoard) return defaults
    const groupIds = new Set([boardGroup.id, ...customGroups.map(group => group.id)])
    const widgetById = new Map(widgets.map(widget => [widget.id, widget]))
    const placements = Object.fromEntries(widgets.map(widget => {
      const saved = parsed.placements?.[widget.id]
      const mode = widget.modes.some(item => item.id === saved?.mode) ? saved?.mode as PcmCanvasMode : widget.defaultMode
      const groupId = saved && typeof saved.groupId === 'string' && groupIds.has(saved.groupId) ? saved.groupId : boardGroup.id
      const oldColumns = Number(parsed.groupColumns?.[groupId]) || (groupId === boardGroup.id ? 4 : 2)
      const savedSpan = Number(saved?.span)
      const normalizedSpan = legacy ? Math.max(1, Math.min(12, Math.round(savedSpan * 12 / oldColumns))) : savedSpan
      const span = Number.isInteger(savedSpan) && savedSpan >= 1 && savedSpan <= (compactWidgetGrid ? 12 : 24)
        ? compactWidgetGrid ? Math.max(1, Math.min(24, normalizedSpan * 2)) : savedSpan
        : groupId === boardGroup.id ? 6 : 12
      const savedLeft = Number.isFinite(saved?.left) ? Number(saved?.left) : Number.isInteger(saved?.column) ? ((Number(saved?.column) - 1) / 24) * 100 : undefined
      const left = savedLeft !== undefined ? Math.max(0, Math.min(100 - (span / 24) * 100, savedLeft)) : undefined
      const top = Number.isFinite(saved?.top) ? Math.max(0, Number(saved?.top)) : Number.isInteger(saved?.row) ? Math.max(0, (Number(saved?.row) - 1) * 8) : undefined
      const height = Number.isInteger(saved?.height) && Number(saved?.height) >= 48 && Number(saved?.height) <= 900 ? Number(saved?.height) : undefined
      const paletteId = saved && typeof (saved as CanvasPlacement).paletteId === 'string' && chartPalettes[(saved as CanvasPlacement).paletteId] ? (saved as CanvasPlacement).paletteId : 'ocean'
      const chartOpacity = [40, 60, 80, 100].includes(Number((saved as CanvasPlacement | undefined)?.chartOpacity)) ? Number((saved as CanvasPlacement).chartOpacity) as CanvasPlacement['chartOpacity'] : undefined
      const stored = saved as CanvasPlacement | undefined
      const customColors = Array.isArray(stored?.customColors) ? stored.customColors.slice(0, 6).map(color => isHexColor(color) ? color : '') : undefined
      const cardBackground = stored?.cardBackground === 'transparent' ? 'transparent' : isHexColor(stored?.cardBackground) ? stored.cardBackground : undefined
      const cardBorder = stored?.cardBorder === 'none' ? 'none' : isHexColor(stored?.cardBorder) ? stored.cardBorder : undefined
      const contentColor = isHexColor(stored?.contentColor) ? stored.contentColor : undefined
      const cardBackgroundOpacity = [40, 60, 80, 100].includes(Number(stored?.cardBackgroundOpacity)) ? Number(stored?.cardBackgroundOpacity) as CanvasPlacement['cardBackgroundOpacity'] : undefined
      const customTitle = typeof stored?.customTitle === 'string' ? stored.customTitle.trim().slice(0, 60) : undefined
      const customSubtitle = typeof stored?.customSubtitle === 'string' ? stored.customSubtitle.trim().slice(0, 100) : undefined
      const titleSize = [8, 10, 12, 14].includes(Number(stored?.titleSize)) ? Number(stored?.titleSize) as CanvasPlacement['titleSize'] : undefined
      const shape = ['wide', 'square', 'column'].includes(String(stored?.shape)) ? stored?.shape as CanvasPlacement['shape'] : undefined
      const buttonStyle = ['solid', 'outline', 'minimal', 'icon'].includes(String(stored?.buttonStyle)) ? stored?.buttonStyle as CanvasPlacement['buttonStyle'] : undefined
      const contentSize = [9, 11, 13, 15].includes(Number(stored?.contentSize)) ? Number(stored?.contentSize) as CanvasPlacement['contentSize'] : undefined
      return [widget.id, { groupId, span, mode, paletteId, ...(left !== undefined ? { left } : {}), ...(top !== undefined ? { top } : {}), ...(chartOpacity ? { chartOpacity } : {}), ...(height ? { height } : {}), ...(isHexColor(stored?.customColor) ? { customColor: stored.customColor } : {}), ...(customColors ? { customColors } : {}), ...(cardBackground ? { cardBackground } : {}), ...(cardBackgroundOpacity ? { cardBackgroundOpacity } : {}), ...(cardBorder ? { cardBorder } : {}), ...(isHexColor(stored?.titleColor) ? { titleColor: stored.titleColor } : {}), ...(contentColor ? { contentColor } : {}), ...(customTitle !== undefined ? { customTitle } : {}), ...(customSubtitle !== undefined ? { customSubtitle } : {}), ...(typeof stored?.showTitle === 'boolean' ? { showTitle: stored.showTitle } : {}), ...(typeof stored?.showActionLabel === 'boolean' ? { showActionLabel: stored.showActionLabel } : {}), ...(titleSize ? { titleSize } : {}), ...(contentSize ? { contentSize } : {}), ...(shape ? { shape } : {}), ...(buttonStyle ? { buttonStyle } : {}) }]
    }))
    const validOrder = (Array.isArray(parsed.groupOrder) ? parsed.groupOrder : []).filter((id): id is string => typeof id === 'string' && groupIds.has(id))
    const validWidgetOrder = (Array.isArray(parsed.widgetOrder) ? parsed.widgetOrder : []).filter((id): id is string => typeof id === 'string' && widgetById.has(id))
    const groupWidths: CanvasLayout['groupWidths'] = { board: 24 }
    const groupColumns: CanvasLayout['groupColumns'] = { board: 4 }
    for (const id of groupIds) {
      const width = Number(parsed.groupWidths?.[id])
      const columns = parsed.groupColumns?.[id]
      if (Number.isInteger(width) && width >= 1 && width <= (legacy ? 12 : 24)) groupWidths[id] = legacy ? Math.max(1, Math.min(24, width * 2)) : width
      if ([1, 2, 3, 4, 6, 8, 12].includes(Number(columns))) groupColumns[id] = columns as CanvasLayout['groupColumns'][string]
    }
    return {
      version: 4,
      groupOrder: [...new Set([boardGroup.id, ...validOrder, ...customGroups.map(group => group.id)])],
      groupWidths,
      groupColumns,
      widgetOrder: [...new Set([...validWidgetOrder, ...widgets.map(widget => widget.id)])],
      placements,
      customGroups,
      magnetEnabled: typeof parsed.magnetEnabled === 'boolean' ? parsed.magnetEnabled : true,
    }
  } catch {
    return defaults
  }
}

function sameLayout(left: CanvasLayout, right: CanvasLayout) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nextMode(mode: PcmCanvasMode, modes: PcmCanvasWidget['modes']) {
  const index = modes.findIndex(item => item.id === mode)
  return modes[(index + 1) % modes.length]
}

export function PcmDashboardCanvas({ categories, widgets, segmentFilters = [], helpContent, onPrintCanvas }: { categories: PcmCanvasCategory[]; widgets: PcmCanvasWidget[]; segmentFilters?: PcmCanvasSegmentFilter[]; helpContent?: ReactNode; onPrintCanvas?: (board: HTMLElement, filters: string[]) => void }) {
  const [layout, setLayout] = useState(() => readInitialLayout(widgets))
  const [savedLayout, setSavedLayout] = useState(() => readInitialLayout(widgets))
  const [savedLayouts, setSavedLayouts] = useState<SavedCanvasLayout[]>(() => readSavedLayouts())
  const [selectedLayoutId, setSelectedLayoutId] = useState(() => readInitialSelectedLayoutId(widgets, readSavedLayouts()))
  const [layoutName, setLayoutName] = useState('')
  const [savingNamedLayout, setSavingNamedLayout] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState('all')
  const [groupTarget, setGroupTarget] = useState('group-prioridades')
  const [filterCategory, setFilterCategory] = useState('all')
  const [segmentFiltersOpen, setSegmentFiltersOpen] = useState(false)
  const [segments, setSegments] = useState<PcmCanvasSegments>({})
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renamingGroupLabel, setRenamingGroupLabel] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [paletteWidgetId, setPaletteWidgetId] = useState<string | null>(null)
  const [paletteAnchor, setPaletteAnchor] = useState<HTMLElement | null>(null)
  const [palettePosition, setPalettePosition] = useState({ left: 8, top: 8 })
  const [filterWidgetId, setFilterWidgetId] = useState<string | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [filterPosition, setFilterPosition] = useState({ left: 8, top: 8 })
  const [groupEditor, setGroupEditor] = useState<{ id: string; left: number; top: number } | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const paletteMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState('')
  const [contextMenu, setContextMenu] = useState<{ kind: 'widget' | 'group'; id: string; x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ groupId: string; left?: number; top?: number } | null>(null)
  const resizeDrag = useRef<CanvasResizeDrag | null>(null)
  const widgetMoveDrag = useRef<CanvasWidgetMove | null>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') return
    const rowStep = (element: HTMLElement) => {
      const style = window.getComputedStyle(element)
      const rowHeight = Number.parseFloat(style.gridAutoRows) || 6
      const rowGap = Number.parseFloat(style.rowGap) || 0
      return { step: Math.max(1, rowHeight + rowGap), gap: rowGap }
    }
    const updateGroupSpan = (group: HTMLElement) => {
      const widgets = group.querySelector<HTMLElement>('.pcm-canvas__widgets')
      if (!widgets) return
      const heading = group.querySelector<HTMLElement>('.pcm-canvas__group-heading')
      const style = window.getComputedStyle(group)
      const verticalChrome = (heading?.getBoundingClientRect().height ?? 0)
        + (heading ? Number.parseFloat(window.getComputedStyle(heading).marginBottom) || 0 : 0)
        + (Number.parseFloat(style.paddingTop) || 0)
        + (Number.parseFloat(style.paddingBottom) || 0)
        + (Number.parseFloat(style.borderTopWidth) || 0)
        + (Number.parseFloat(style.borderBottomWidth) || 0)
      const widgetsRect = widgets.getBoundingClientRect()
      const positionedBottom = [...widgets.querySelectorAll<HTMLElement>('.pcm-canvas__widget.is-free-positioned')]
        .reduce((bottom, card) => Math.max(bottom, card.getBoundingClientRect().bottom - widgetsRect.top), 0)
      const flowBottom = [...widgets.querySelectorAll<HTMLElement>(':scope > .pcm-canvas__widget:not(.is-free-positioned)')]
        .reduce((bottom, card) => Math.max(bottom, card.getBoundingClientRect().bottom - widgetsRect.top), 0)
      const contentHeight = Math.max(80, flowBottom, positionedBottom)
      widgets.style.minHeight = `${Math.max(80, contentHeight)}px`
      const boardStep = rowStep(board)
      const rowSpan = Math.max(1, Math.ceil((contentHeight + verticalChrome + boardStep.gap) / boardStep.step))
      group.style.setProperty('--pcm-group-row-span', String(rowSpan))
    }
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        if (element.classList.contains('pcm-canvas__widget')) {
          const height = Math.max(element.getBoundingClientRect().height, 48)
          const widgetStep = rowStep(element.parentElement ?? element)
          element.style.setProperty('--pcm-widget-row-span', String(Math.max(1, Math.ceil((height + widgetStep.gap) / widgetStep.step))))
          const group = element.closest<HTMLElement>('.pcm-canvas__group')
          if (group) updateGroupSpan(group)
          continue
        }
        if (element.classList.contains('pcm-canvas__widgets')) {
          const group = element.closest<HTMLElement>('.pcm-canvas__group')
          if (group) updateGroupSpan(group)
        } else {
          const group = element.closest<HTMLElement>('.pcm-canvas__group')
          if (group) updateGroupSpan(group)
        }
      }
    })
    board.querySelectorAll<HTMLElement>('.pcm-canvas__widget, .pcm-canvas__widgets, .pcm-canvas__group-heading').forEach(element => observer.observe(element))
    board.querySelectorAll<HTMLElement>('.pcm-canvas__group').forEach(updateGroupSpan)
    return () => observer.disconnect()
  }, [layout.groupOrder, layout.placements, layout.widgetOrder, layout.groupWidths, layout.customGroups])

  useEffect(() => {
    if (!paletteWidgetId) return
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.pcm-canvas__palette-control, .pcm-canvas__palette-menu')) {
        setPaletteWidgetId(null)
        setPaletteAnchor(null)
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPaletteWidgetId(null)
      setPaletteAnchor(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [paletteWidgetId])

  useEffect(() => {
    if (!groupEditor) return
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.pcm-canvas__group-editor, .pcm-canvas__group-config-button')) setGroupEditor(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setGroupEditor(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [groupEditor])

  useLayoutEffect(() => {
    if (!paletteWidgetId || !paletteAnchor) return
    const menuElement = paletteMenuRef.current
    if (menuElement && typeof menuElement.showPopover === 'function' && !menuElement.matches(':popover-open')) {
      menuElement.showPopover()
    }
    const place = () => {
      const anchor = paletteAnchor.getBoundingClientRect()
      const menu = menuElement?.getBoundingClientRect()
      const width = menu?.width || 276
      const height = menu?.height || 320
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.right - width))
      const below = anchor.bottom + 6
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 6)
      setPalettePosition(current => current.left === left && current.top === top ? current : { left, top })
    }
    place()
    const frame = window.requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [paletteWidgetId, paletteAnchor])

  useEffect(() => {
    if (!filterWidgetId) return
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.pcm-canvas__filter-control, .pcm-canvas__filter-menu')) setFilterWidgetId(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setFilterWidgetId(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', closeOnEscape) }
  }, [filterWidgetId])

  useLayoutEffect(() => {
    if (!filterWidgetId || !filterAnchor) return
    const place = () => {
      const anchor = filterAnchor.getBoundingClientRect()
      const menu = filterMenuRef.current?.getBoundingClientRect()
      const width = menu?.width || 280
      const height = menu?.height || 230
      const right = anchor.right + 6
      const left = right + width <= window.innerWidth - 8 ? right : Math.max(8, anchor.left - width - 6)
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, anchor.top))
      setFilterPosition(current => current.left === left && current.top === top ? current : { left, top })
    }
    place()
    const frame = window.requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [filterWidgetId, filterAnchor])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: globalThis.MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== 'Escape') return
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  useEffect(() => {
    const validIds = new Set(widgets.map(widget => widget.id))
    setLayout(current => {
      const placements = Object.fromEntries(Object.entries(current.placements).filter(([id]) => validIds.has(id)))
      const widgetOrder = current.widgetOrder.filter(id => validIds.has(id))
      const missing = widgets.filter(widget => !widgetOrder.includes(widget.id))
      if (Object.keys(placements).length === Object.keys(current.placements).length && missing.length === 0) return current
      return {
        ...current,
        placements: { ...placements, ...Object.fromEntries(missing.map(widget => { const groupId = defaultGroupForWidget(widget); return [widget.id, { groupId, span: groupId === 'group-prioridades' ? 6 : 12, mode: widget.defaultMode, paletteId: 'ocean' }] })) },
        widgetOrder: [...widgetOrder, ...missing.map(widget => widget.id)],
      }
    })
    setSelectedIds(current => current.filter(id => validIds.has(id)))
  }, [widgets])

  const allGroups = useMemo(() => [boardGroup, ...layout.customGroups], [layout.customGroups])
  const widgetById = useMemo(() => new Map(widgets.map(widget => [widget.id, widget])), [widgets])
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category.label])), [categories])
  const placedIds = useMemo(() => new Set(Object.keys(layout.placements)), [layout.placements])
  const unsaved = !sameLayout(layout, savedLayout)
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')

  function setPlacement(widgetId: string, update: (placement: CanvasPlacement) => CanvasPlacement) {
    setLayout(current => {
      const placement = current.placements[widgetId]
      return placement ? { ...current, placements: { ...current.placements, [widgetId]: update(placement) } } : current
    })
    setSaveMessage('')
  }

  function setWidgetShape(widgetId: string, shape: NonNullable<CanvasPlacement['shape']>, span: number) {
    const card = boardRef.current?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(widgetId)}"]`)
    const widgets = card?.parentElement
    const rect = card?.getBoundingClientRect()
    const containerRect = widgets?.getBoundingClientRect()
    const current = layout.placements[widgetId]
    if (!current) return
    const left = current.left ?? (rect && containerRect ? ((rect.left - containerRect.left) / Math.max(1, containerRect.width)) * 100 : 0)
    const top = current.top ?? (rect && containerRect ? rect.top - containerRect.top + (widgets?.scrollTop ?? 0) : 0)
    setPlacement(widgetId, placement => {
      const { column: _column, row: _row, rowSpan: _rowSpan, ...freePlacement } = placement
      return { ...freePlacement, shape, span, height: undefined, left: Math.max(0, Math.min(100 - (span / 24) * 100, left)), top: Math.max(0, top) }
    })
  }

  function setGroupHeading(groupId: string, showHeading: boolean) {
    updateGroup(groupId, { showHeading })
    setContextMenu(null)
  }

  function moveWidget(widgetId: string, groupId: string, left?: number, top?: number) {
    setLayout(current => {
      const order = current.widgetOrder.filter(id => id !== widgetId)
      order.push(widgetId)
      const placement = current.placements[widgetId]
      if (!placement) return current
      const { column: _column, row: _row, rowSpan: _rowSpan, ...freePlacement } = placement
      const spanPercent = (placement.span / 24) * 100
      return { ...current, widgetOrder: order, placements: { ...current.placements, [widgetId]: {
        ...freePlacement,
        groupId,
        ...(left !== undefined && top !== undefined ? { left: Math.max(0, Math.min(100 - spanPercent, left)), top: Math.max(0, top) } : {}),
      } } }
    })
    setSaveMessage('')
  }

  function startWidgetMove(event: ReactPointerEvent<HTMLElement>, widgetId: string, groupId: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea, a')) return
    const card = event.currentTarget.closest<HTMLElement>('.pcm-canvas__widget')
    const widgets = event.currentTarget.closest<HTMLElement>('.pcm-canvas__widgets')
    const placement = layout.placements[widgetId]
    if (!card || !widgets || !placement) return
    const rect = card.getBoundingClientRect()
    widgetMoveDrag.current = {
      id: widgetId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      left: placement.left ?? 0, top: placement.top ?? 0, groupId, moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveWidgetPointer(event: ReactPointerEvent<HTMLElement>) {
    const drag = widgetMoveDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(`widget:${drag.id}`)
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.pcm-canvas__group')
    const groupId = target?.dataset.groupId
    const widgets = target?.querySelector<HTMLElement>('.pcm-canvas__widgets')
    if (!groupId || !widgets) return
    const rect = widgets.getBoundingClientRect()
    const placement = layout.placements[drag.id]
    if (!placement) return
    const spanPercent = (Math.max(1, Math.min(24, placement.span)) / 24) * 100
    const left = Math.max(0, Math.min(100 - spanPercent, ((event.clientX - rect.left - drag.offsetX + widgets.scrollLeft) / Math.max(1, rect.width)) * 100))
    const top = Math.max(0, event.clientY - rect.top - drag.offsetY + widgets.scrollTop)
    drag.groupId = groupId
    drag.left = left
    drag.top = top
    setDropTarget(current => current?.groupId === groupId && Math.abs((current.left ?? -1) - left) < .5 && Math.abs((current.top ?? -1) - top) < 2 ? current : { groupId, left, top })
  }

  function finishWidgetMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = widgetMoveDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) moveWidget(drag.id, drag.groupId, drag.left, drag.top)
    widgetMoveDrag.current = null
    setDragging('')
    setDropTarget(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function moveGroup(groupId: string, targetId: string) {
    if (groupId === targetId) return
    setLayout(current => {
      const order = current.groupOrder.filter(id => id !== groupId)
      const targetIndex = order.indexOf(targetId)
      order.splice(targetIndex < 0 ? order.length : targetIndex, 0, groupId)
      return { ...current, groupOrder: order }
    })
    setSaveMessage('')
  }

  function handleDrop(event: DragEvent<HTMLElement>, groupId: string) {
    event.preventDefault()
    const payload = event.dataTransfer.getData('text/plain')
    try {
      const parsed = JSON.parse(payload) as { kind?: string; id?: string }
      if (!parsed.id) return
      if (parsed.kind === 'group') moveGroup(parsed.id, groupId)
    } catch { /* Aceita somente arrastes iniciados na lousa. */ }
    setDragging('')
    setDropTarget(null)
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, kind: 'widget' | 'group', id: string, span: number) {
    event.preventDefault()
    event.stopPropagation()
    const container = kind === 'widget'
      ? event.currentTarget.closest('.pcm-canvas__widgets') as HTMLElement | null
      : event.currentTarget.closest('.pcm-canvas__board') as HTMLElement | null
    const card = event.currentTarget.closest(kind === 'widget' ? '.pcm-canvas__widget' : '.pcm-canvas__group') as HTMLElement | null
    const stepWidth = (container?.clientWidth ?? 0) / 24
    resizeDrag.current = {
      kind, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      stepWidth: Math.max(stepWidth, 1), columns: 24,
      startSpan: span, startHeight: card?.getBoundingClientRect().height ?? 120,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = resizeDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const spanDelta = Math.round((event.clientX - drag.startX) / drag.stepWidth)
    const height = Math.max(48, Math.min(900, Math.round(drag.startHeight + event.clientY - drag.startY)))
    if (drag.kind === 'widget') {
      setLayout(current => {
        const placement = current.placements[drag.id]
        if (!placement) return current
        const span = Math.max(1, Math.min(drag.columns, drag.startSpan + spanDelta)) as CanvasPlacement['span']
        const nextHeight = placement.shape ? undefined : height
        const left = Number.isFinite(placement.left)
          ? Math.max(0, Math.min(100 - (span / 24) * 100, Number(placement.left)))
          : undefined
        const nextPlacement = {
          ...placement,
          span,
          height: nextHeight,
          rowSpan: nextHeight ? Math.max(1, Math.ceil((nextHeight + 2) / 8)) : undefined,
          ...(left !== undefined ? { left } : {}),
        }
        const next = { ...current, placements: { ...current.placements, [drag.id]: nextPlacement } }
        return sameLayout(current, next) ? current : next
      })
    } else {
      setLayout(current => {
      const width = Math.max(6, Math.min(24, drag.startSpan + spanDelta))
        const next = { ...current, groupWidths: { ...current.groupWidths, [drag.id]: width } }
        return current.groupWidths[drag.id] === width ? current : next
      })
    }
    setSaveMessage('')
  }

  function stopResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeDrag.current?.pointerId !== event.pointerId) return
    resizeDrag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function selectWidget(widgetId: string, event: KeyboardEvent<HTMLElement> | MouseEvent<HTMLElement>) {
    const multi = 'ctrlKey' in event && (event.ctrlKey || event.metaKey)
    setSelectedIds(current => {
      if (multi) return current.includes(widgetId) ? current.filter(id => id !== widgetId) : [...current, widgetId]
      if ('key' in event) return current.includes(widgetId) ? current.filter(id => id !== widgetId) : [...current, widgetId]
      return []
    })
  }

  function toggleSelectedWidget(widgetId: string) {
    setSelectedIds(current => current.includes(widgetId) ? current.filter(id => id !== widgetId) : [...current, widgetId])
  }

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = groupName.trim()
    if (!label || selectedIds.length < 2) return
    const id = `group-${crypto.randomUUID()}`
    setLayout(current => ({
      ...current,
      customGroups: [...current.customGroups, { id, label }],
      groupOrder: [...current.groupOrder, id],
        groupWidths: { ...current.groupWidths, [id]: 12 },
      groupColumns: { ...current.groupColumns, [id]: 2 },
      placements: Object.fromEntries(Object.entries(current.placements).map(([widgetId, placement]) => {
        if (!selectedIds.includes(widgetId)) return [widgetId, placement]
        const { column: _column, row: _row, rowSpan: _rowSpan, left: _left, top: _top, ...flowPlacement } = placement
        return [widgetId, { ...flowPlacement, groupId: id, span: Math.min(24, Math.max(12, placement.span * 2)) }]
      })),
    }))
    setSelectedIds([])
    setGroupName('')
    setCreatingGroup(false)
    setSaveMessage('')
  }

  function addWidget(widgetId: string) {
    const widget = widgetById.get(widgetId)
    if (!widget || placedIds.has(widgetId)) return
    const groupId = allGroups.some(group => group.id === groupTarget) ? groupTarget : boardGroup.id
    setLayout(current => ({
      ...current,
      widgetOrder: [...current.widgetOrder, widgetId],
      placements: { ...current.placements, [widgetId]: { groupId, span: Math.max(1, Math.round(24 / (current.groupColumns[groupId] ?? 4))), mode: widget.defaultMode, paletteId: 'ocean' } },
    }))
    setCatalogOpen(false)
    setSaveMessage('')
  }

  function removeWidget(widgetId: string) {
    setLayout(current => ({
      ...current,
      widgetOrder: current.widgetOrder.filter(id => id !== widgetId),
      placements: Object.fromEntries(Object.entries(current.placements).filter(([id]) => id !== widgetId)),
    }))
    setSelectedIds(current => current.filter(id => id !== widgetId))
    setSaveMessage('')
  }

  function ungroup(groupId: string) {
    setLayout(current => ({
      ...current,
      customGroups: current.customGroups.filter(group => group.id !== groupId),
      groupOrder: current.groupOrder.filter(id => id !== groupId),
      groupWidths: Object.fromEntries(Object.entries(current.groupWidths).filter(([id]) => id !== groupId)),
      groupColumns: Object.fromEntries(Object.entries(current.groupColumns).filter(([id]) => id !== groupId)),
      placements: Object.fromEntries(Object.entries(current.placements).map(([id, placement]) => {
        if (placement.groupId !== groupId) return [id, placement]
        const { column: _column, row: _row, rowSpan: _rowSpan, ...flowPlacement } = placement
        return [id, { ...flowPlacement, groupId: boardGroup.id }]
      })),
    }))
    setContextMenu(null)
    setSaveMessage('')
  }

  function renameGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = renamingGroupLabel.trim().slice(0, 40)
    if (!renamingGroupId || !label) return
    setLayout(current => ({ ...current, customGroups: current.customGroups.map(group => group.id === renamingGroupId ? { ...group, label } : group) }))
    setRenamingGroupId(null)
    setRenamingGroupLabel('')
    setContextMenu(null)
    setSaveMessage('')
  }

  function updateGroup(groupId: string, update: Partial<PcmCanvasGroup>) {
    setLayout(current => ({ ...current, customGroups: current.customGroups.map(group => group.id === groupId ? { ...group, ...update } : group) }))
    setSaveMessage('')
  }

  function saveLayout() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
      if (selectedLayoutId && selectedLayoutId !== professionalLayoutId) {
        const updated = savedLayouts.map(item => item.id === selectedLayoutId ? { ...item, layout } : item)
        window.localStorage.setItem(namedLayoutsStorageKey, JSON.stringify(updated))
        setSavedLayouts(updated)
      } else if (selectedLayoutId === professionalLayoutId) {
        window.localStorage.removeItem(selectedLayoutStorageKey)
        setSelectedLayoutId('')
      }
      setSavedLayout(layout)
      setSaveMessage('Layout salvo neste navegador.')
    } catch {
      setSaveMessage('Não foi possível salvar o layout neste navegador.')
    }
  }

  function saveNamedLayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = layoutName.trim().slice(0, 40)
    if (!name) return
    const id = `layout-${Date.now().toString(36)}`
    const next = [...savedLayouts, { id, name, layout }].slice(-20)
    try {
      window.localStorage.setItem(namedLayoutsStorageKey, JSON.stringify(next))
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
      window.localStorage.setItem(selectedLayoutStorageKey, id)
      setSavedLayouts(next)
      setSelectedLayoutId(id)
      setSavedLayout(layout)
      setLayoutName('')
      setSavingNamedLayout(false)
      setSaveMessage(`Layout “${name}” salvo.`)
    } catch {
      setSaveMessage('Não foi possível salvar o layout neste navegador.')
    }
  }

  function selectSavedLayout(id: string) {
    if (!id) {
      setSelectedLayoutId('')
      try { window.localStorage.removeItem(selectedLayoutStorageKey) } catch { /* A seleção da sessão continua disponível. */ }
      return
    }
    const target = savedLayouts.find(item => item.id === id)
    const nextLayout = id === professionalLayoutId ? createDefaultLayout(widgets) : target?.layout
    if (!nextLayout) return
    if (unsaved && !window.confirm('As alterações atuais ainda não foram salvas. Trocar de layout mesmo assim?')) return
    setLayout(nextLayout)
    setSavedLayout(nextLayout)
    setSelectedLayoutId(id)
    window.localStorage.setItem(selectedLayoutStorageKey, id)
    setSaveMessage(id === professionalLayoutId ? 'Layout padrão profissional carregado.' : `Layout “${target?.name}” carregado.`)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextLayout))
    } catch {
      setSaveMessage('Layout carregado, mas não foi possível mantê-lo como layout atual.')
    }
  }

  function startDrag(event: DragEvent<HTMLElement>, kind: 'group' | 'widget', id: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind, id }))
    setDragging(`${kind}:${id}`)
    setDropTarget(null)
  }

  const visibleWidgetIds = layout.widgetOrder.filter(id => {
    const widget = widgetById.get(id)
    if (!widget) return false
    const matchesCategory = filterCategory === 'all' || widget.categoryId === filterCategory
    const matchesSearch = !normalizedSearch || `${widget.title} ${widget.note ?? ''} ${categoryById.get(widget.categoryId) ?? ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
    return matchesCategory && matchesSearch
  })
  const hasAnyPlacedWidgets = layout.widgetOrder.some(id => widgetById.has(id))
  const hasActiveCanvasSearch = Boolean(normalizedSearch) || filterCategory !== 'all'
  const visibleGroups = allGroups.filter(group => layout.widgetOrder.some(id => layout.placements[id]?.groupId === group.id && visibleWidgetIds.includes(id)))
  const paletteWidget = paletteWidgetId ? widgetById.get(paletteWidgetId) : undefined
  const palettePlacement = paletteWidgetId ? layout.placements[paletteWidgetId] : undefined
  const paletteMode = paletteWidget && palettePlacement && paletteWidget.modes.some(item => item.id === palettePlacement.mode) ? palettePlacement.mode : paletteWidget?.defaultMode
  const filterWidget = filterWidgetId ? widgetById.get(filterWidgetId) : undefined
  const filterPlacement = filterWidgetId ? layout.placements[filterWidgetId] : undefined
  const paletteBaseColors = palettePlacement ? chartPalettes[palettePlacement.paletteId]?.colors ?? chartPalettes.ocean.colors : chartPalettes.ocean.colors
  const paletteColors = resolvePalette(paletteBaseColors, palettePlacement?.customColors, palettePlacement?.customColor)
  const editableGroup = groupEditor ? layout.customGroups.find(group => group.id === groupEditor.id) : undefined
  const unplacedWidgets = widgets.filter(widget => !placedIds.has(widget.id))
    .filter(widget => catalogCategory === 'all' || widget.categoryId === catalogCategory)
    .filter(widget => !catalogQuery.trim() || `${widget.title} ${widget.note ?? ''}`.toLocaleLowerCase('pt-BR').includes(catalogQuery.trim().toLocaleLowerCase('pt-BR')))

  return <section className={`pcm-canvas${layout.magnetEnabled ? ' is-magnetized' : ''}`} aria-label="Lousa configurável do PCM">
    <header className="pcm-canvas__toolbar">
      <div className="pcm-canvas__toolbar-title"><h2>Lousa do PCM</h2><span>{visibleWidgetIds.length}</span></div>
      <div className="pcm-canvas__toolbar-tools">
        <label className="pcm-canvas__search" title="Buscar indicador"><Search size={14} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar indicador no painel" placeholder="Buscar" /></label>
        <label className="pcm-canvas__filter" title="Filtrar por categoria"><Filter size={14} aria-hidden="true" /><select value={filterCategory} onChange={event => setFilterCategory(event.target.value)} aria-label="Filtrar por categoria"><option value="all">Todas</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        {segmentFilters.length ? <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon${segmentFiltersOpen ? ' is-active' : ''}`} title="Segmentar os dados dos indicadores" aria-label="Mostrar filtros de segmentação" aria-expanded={segmentFiltersOpen} onClick={() => setSegmentFiltersOpen(value => !value)}><Filter size={14} aria-hidden="true" /></button> : null}
        {onPrintCanvas ? <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Imprimir lousa atual" aria-label="Imprimir lousa atual" onClick={() => { if (boardRef.current) onPrintCanvas(boardRef.current, segmentFilters.flatMap(filter => segments[filter.id] ? [`${filter.label}: ${segments[filter.id]}`] : [])) }}><Printer size={15} aria-hidden="true" /></button> : null}
        <label className="pcm-canvas__layout-select" title="Selecionar um layout salvo"><span>Layout</span><select value={selectedLayoutId} onChange={event => selectSavedLayout(event.target.value)} aria-label="Selecionar layout salvo"><option value={professionalLayoutId}>Padrão profissional</option><option value="">Atual</option>{savedLayouts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon${layout.magnetEnabled ? ' is-active' : ''}`} title={layout.magnetEnabled ? 'Encaixe magnético ligado' : 'Ligar encaixe magnético'} aria-label="Alternar encaixe magnético" aria-pressed={layout.magnetEnabled} onClick={() => setLayout(current => ({ ...current, magnetEnabled: !current.magnetEnabled }))}><Magnet size={15} aria-hidden="true" /></button>
        <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Adicionar indicador" aria-label="Adicionar indicador" aria-expanded={catalogOpen} onClick={() => setCatalogOpen(value => !value)}><Plus size={16} /></button>
        {selectedIds.length >= 2 ? <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title={`Criar grupo com ${selectedIds.length} indicadores selecionados`} aria-label={`Criar grupo com ${selectedIds.length} indicadores selecionados`} onClick={() => setCreatingGroup(value => !value)}><Layers size={15} /></button> : null}
        <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Salvar como novo layout" aria-label="Salvar como novo layout" aria-expanded={savingNamedLayout} onClick={() => setSavingNamedLayout(value => !value)}><LayoutTemplate size={15} aria-hidden="true" /></button>
        <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon pcm-canvas__save-button${unsaved ? ' is-pending' : ''}`} title={saveMessage || (unsaved ? 'Salvar alterações do layout' : 'Layout salvo')} aria-label={saveMessage || (unsaved ? 'Salvar alterações do layout' : 'Layout salvo')} onClick={saveLayout} disabled={!unsaved}><Save size={15} /></button>
        <span className="pcm-canvas__visually-hidden" role="status">{saveMessage || (unsaved ? 'Alterações do layout não salvas' : 'Layout salvo')}</span>
      </div>
    </header>

    {helpContent ? <div className="pcm-canvas__help-placement">{helpContent}</div> : null}

    {segmentFiltersOpen && segmentFilters.length ? <div className="pcm-canvas__segment-filters" aria-label="Filtros opcionais de segmentação">
      <span>Segmentar</span>
      {segmentFilters.map(filter => <label key={filter.id}><span>{filter.label}</span><select value={segments[filter.id] ?? ''} onChange={event => setSegments(current => ({ ...current, [filter.id]: event.target.value }))} aria-label={`Segmentar por ${filter.label}`}><option value="">Todos</option>{filter.options.map(option => <option value={option} key={option}>{option}</option>)}</select></label>)}
      {Object.values(segments).some(Boolean) ? <button type="button" onClick={() => setSegments({})}>Limpar</button> : null}
    </div> : null}

    {savingNamedLayout ? <form className="pcm-canvas__layout-form" onSubmit={saveNamedLayout}><label htmlFor="pcm-canvas-layout-name">Nome do layout</label><input id="pcm-canvas-layout-name" value={layoutName} onChange={event => setLayoutName(event.target.value)} maxLength={40} autoFocus placeholder="Ex.: Acompanhamento semanal" /><button type="submit" disabled={!layoutName.trim()}>Salvar layout</button><button type="button" onClick={() => { setSavingNamedLayout(false); setLayoutName('') }}>Cancelar</button></form> : null}

    {creatingGroup ? <form className="pcm-canvas__group-form" onSubmit={createGroup}>
      <label htmlFor="pcm-canvas-group-name">Nome do grupo</label><input id="pcm-canvas-group-name" value={groupName} onChange={event => setGroupName(event.target.value)} maxLength={40} autoFocus placeholder="Ex.: Indicadores críticos" />
      <button type="submit" disabled={!groupName.trim() || selectedIds.length < 2}>Criar grupo</button><button type="button" onClick={() => { setCreatingGroup(false); setGroupName('') }}>Cancelar</button>
    </form> : null}

    {catalogOpen ? <aside className="pcm-canvas__catalog" aria-label="Catálogo de indicadores">
      <header><strong>Adicionar indicadores</strong><button type="button" className="pcm-canvas__icon-button" aria-label="Fechar catálogo" onClick={() => setCatalogOpen(false)}><X size={15} /></button></header>
      <div className="pcm-canvas__catalog-tools">
        <label className="pcm-canvas__search"><Search size={14} aria-hidden="true" /><input value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} aria-label="Buscar indicador disponível" placeholder="Buscar" /></label>
        <label><span>Tipo</span><select value={catalogCategory} onChange={event => setCatalogCategory(event.target.value)}><option value="all">Todos</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        <label><span>Adicionar em</span><select value={groupTarget} onChange={event => setGroupTarget(event.target.value)}>{allGroups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
      </div>
      <div className="pcm-canvas__catalog-grid">
        {unplacedWidgets.map(widget => <button key={widget.id} type="button" onClick={() => addWidget(widget.id)}><span><strong>{widget.title}</strong>{widget.note ? <small title={widget.note}>{widget.note}</small> : null}</span><Plus size={14} aria-hidden="true" /></button>)}
        {unplacedWidgets.length === 0 ? <p>Não há outros indicadores disponíveis para esse filtro.</p> : null}
      </div>
    </aside> : null}

    <div ref={boardRef} className={`pcm-canvas__board${selectedIds.length ? ' is-selecting' : ''}`}>
      {visibleWidgetIds.length === 0 ? <section className="pcm-canvas__empty-state" aria-live="polite">
        <div className="pcm-canvas__empty-state-copy">
          <strong>{hasActiveCanvasSearch ? 'Nenhum indicador encontrado' : 'Sua lousa está vazia'}</strong>
          <p>{hasActiveCanvasSearch
            ? 'Ajuste a busca ou a categoria para voltar a visualizar os indicadores.'
            : hasAnyPlacedWidgets
              ? 'Adicione indicadores pelo botão “+”. Depois, arraste os cartões para organizar a lousa, personalize cada um e salve o layout.'
              : 'Adicione indicadores pelo botão “+”, arraste os cartões para organizar a lousa, personalize cada um e salve seu layout de trabalho.'}</p>
        </div>
        {hasActiveCanvasSearch
          ? <button type="button" onClick={() => { setSearch(''); setFilterCategory('all') }}>Limpar busca e categoria</button>
          : <button type="button" onClick={() => setCatalogOpen(true)}><Plus size={14} aria-hidden="true" /> Adicionar indicadores</button>}
      </section> : null}
      {layout.groupOrder.map(groupId => allGroups.find(group => group.id === groupId)).filter((group): group is PcmCanvasGroup => Boolean(group)).map(group => {
        if (!visibleGroups.some(item => item.id === group.id)) return null
        const groupIds = layout.widgetOrder.filter(id => layout.placements[id]?.groupId === group.id && visibleWidgetIds.includes(id))
        const width = layout.groupWidths[group.id] ?? 24
        const groupBackground = group.background === 'transparent' ? 'transparent' : group.background ?? 'transparent'
        const groupStyle = { '--pcm-category-span': width, '--pcm-category-span-compact': Math.max(1, Math.ceil(width / 2)), '--pcm-widget-columns': 24, '--pcm-group-background': groupBackground === 'transparent' ? 'transparent' : `color-mix(in srgb, ${groupBackground} ${group.backgroundOpacity ?? 100}%, transparent)`, '--pcm-group-border': group.border === 'none' ? 'transparent' : group.border ?? 'transparent', '--pcm-group-title': group.titleColor ?? '#23445e' } as CSSProperties
        return <section key={group.id} data-group-id={group.id} className={`pcm-canvas__group${group.id === boardGroup.id ? ' pcm-canvas__group--board' : ''}${dragging === `group:${group.id}` ? ' is-dragging' : ''}${dropTarget?.groupId === group.id && dropTarget.left === undefined ? ' is-drop-target' : ''}`} style={groupStyle} onDragOver={event => { event.preventDefault(); if (!dragging.startsWith('widget:')) setDropTarget({ groupId: group.id }) }} onDrop={event => handleDrop(event, group.id)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null) }} onContextMenu={group.id === boardGroup.id ? undefined : event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'group', id: group.id, x: event.clientX, y: event.clientY }) }}>
          {group.id !== boardGroup.id && group.showHeading !== false ? <header className="pcm-canvas__group-heading" title={group.description} draggable onDragStart={event => { if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return } startDrag(event, 'group', group.id) }} onDragEnd={() => { setDragging(''); setDropTarget(null) }}>
            <h3>{group.label}</h3>
            <div className="pcm-canvas__group-controls"><button type="button" className="pcm-canvas__icon-button pcm-canvas__group-config-button" aria-label={`Personalizar grupo ${group.label}`} aria-expanded={groupEditor?.id === group.id} title="Personalizar grupo" onClick={event => { event.stopPropagation(); if (groupEditor?.id === group.id) { setGroupEditor(null); return } const rect = event.currentTarget.getBoundingClientRect(); setGroupEditor({ id: group.id, left: Math.max(8, Math.min(window.innerWidth - 292, rect.right - 268)), top: Math.max(8, Math.min(window.innerHeight - 360, rect.bottom + 5)) }) }}><Palette size={13} aria-hidden="true" /></button></div>
          </header> : null}
          <div className="pcm-canvas__widgets" style={{ '--pcm-widget-columns': 24 } as CSSProperties}>
            {groupIds.map(widgetId => {
              const widget = widgetById.get(widgetId)
              const placement = layout.placements[widgetId]
              if (!widget || !placement) return null
              const mode = widget.modes.some(item => item.id === placement.mode) ? placement.mode : widget.defaultMode
              const currentSpan = Math.max(1, Math.min(24, placement.span))
              const colors = chartPalettes[placement.paletteId]?.colors ?? chartPalettes.ocean.colors
              const rawPalette = resolvePalette(colors, placement.customColors, placement.customColor)
              const chartPalette = rawPalette.map(color => withOpacity(color, placement.chartOpacity ?? 100)) as unknown as PcmCanvasPalette
              const effectiveSegments = { ...segments }
              Object.entries(placement.segments ?? {}).forEach(([filterId, value]) => {
                if (value === ignoreGlobalSegment) delete effectiveSegments[filterId]
                else if (value) effectiveSegments[filterId] = value
              })
              const backgroundColor = placement.cardBackground === 'transparent' ? 'transparent' : placement.cardBackground ?? '#ffffff'
              const isFreePositioned = Number.isFinite(placement.left) && Number.isFinite(placement.top)
              const cardStyle = { '--pcm-widget-span': currentSpan, '--pcm-widget-column': placement.column ?? 'auto', '--pcm-widget-row': placement.row ?? 'auto', '--pcm-widget-row-span': placement.rowSpan ?? 1, '--pcm-widget-free-left': `${placement.left ?? 0}%`, '--pcm-widget-free-top': `${placement.top ?? 0}px`, '--pcm-widget-free-width': `${(currentSpan / 24) * 100}%`, '--pcm-widget-height': placement.shape ? 'auto' : placement.height ? `${placement.height}px` : 'auto', '--pcm-widget-background': backgroundColor === 'transparent' ? 'transparent' : `color-mix(in srgb, ${backgroundColor} ${placement.cardBackgroundOpacity ?? 100}%, transparent)`, '--pcm-widget-border': placement.cardBorder === 'none' ? 'transparent' : placement.cardBorder ?? '#edf1f4', '--pcm-widget-title': placement.titleColor ?? '#375873', '--pcm-widget-content': placement.contentColor ?? '#12324d', '--pcm-widget-title-size': `${placement.titleSize ?? 9}px`, '--pcm-widget-content-size': `${placement.contentSize ?? 11}px` } as CSSProperties
              return <article key={widget.id} data-widget-id={widget.id} data-show-title={placement.showTitle === false ? 'false' : 'true'} data-action-card={widget.action ? 'true' : 'false'} data-show-action-label={placement.showActionLabel === false ? 'false' : 'true'} data-card-shape={placement.shape ?? 'free'} className={`pcm-canvas__widget${isFreePositioned ? ' is-free-positioned' : ''}${dragging === `widget:${widget.id}` ? ' is-dragging' : ''}${selectedIds.includes(widget.id) ? ' is-selected' : ''}${paletteWidgetId === widget.id ? ' has-palette-open' : ''}`} style={cardStyle} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'widget', id: widget.id, x: event.clientX, y: event.clientY }) }}>
                <header className="pcm-canvas__widget-heading">
                  <button type="button" className={`pcm-canvas__select-handle${selectedIds.includes(widget.id) ? ' is-selected' : ''}`} title={selectedIds.includes(widget.id) ? 'Remover da seleção' : 'Selecionar para agrupar'} aria-label={selectedIds.includes(widget.id) ? `Desselecionar ${widget.title}` : `Selecionar ${widget.title}`} aria-pressed={selectedIds.includes(widget.id)} onClick={event => { event.stopPropagation(); toggleSelectedWidget(widget.id) }}><Check size={12} aria-hidden="true" /></button>
                  <div className="pcm-canvas__widget-title" role="button" tabIndex={0} title="Arraste para posicionar; Ctrl/Cmd+clique para selecionar vários" aria-pressed={selectedIds.includes(widget.id)} onPointerDown={event => startWidgetMove(event, widget.id, group.id)} onPointerMove={moveWidgetPointer} onPointerUp={finishWidgetMove} onPointerCancel={finishWidgetMove} onClick={event => selectWidget(widget.id, event)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWidget(widget.id, event) } }}>
                    <span><strong title={placement.customTitle || widget.title}>{placement.customTitle || widget.title}</strong>{placement.customSubtitle ? <small title={placement.customSubtitle}>{placement.customSubtitle}</small> : null}</span>
                  </div>
                  <div className="pcm-canvas__palette-control" onPointerDown={event => event.stopPropagation()}>
                    <button type="button" className="pcm-canvas__icon-button pcm-canvas__palette-trigger" aria-label={`Personalizar card ${widget.title}`} aria-expanded={paletteWidgetId === widget.id} title="Personalizar card" onClick={event => { event.stopPropagation(); if (paletteWidgetId === widget.id) { setPaletteWidgetId(null); setPaletteAnchor(null) } else { setFilterWidgetId(null); setFilterAnchor(null); setPaletteWidgetId(widget.id); setPaletteAnchor(event.currentTarget) } }}><Palette size={13} aria-hidden="true" /></button>
                  </div>
                </header>
                {!widget.action ? <div className="pcm-canvas__filter-control" onPointerDown={event => event.stopPropagation()}><button type="button" className={`pcm-canvas__icon-button pcm-canvas__filter-trigger${filterWidgetId === widget.id ? ' is-active' : ''}`} aria-label={`Filtrar indicador ${widget.title}`} aria-expanded={filterWidgetId === widget.id} title="Filtrar este indicador" onClick={event => { event.stopPropagation(); setPaletteWidgetId(null); setPaletteAnchor(null); if (filterWidgetId === widget.id) { setFilterWidgetId(null); setFilterAnchor(null) } else { setFilterWidgetId(widget.id); setFilterAnchor(event.currentTarget) } }}><Filter size={13} aria-hidden="true" /></button></div> : null}
                <div className={`pcm-canvas__widget-body${widget.onActivate ? ' is-interactive' : ''}`} onClick={widget.onActivate ? event => { if ((event.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return; widget.onActivate?.() } : undefined} onKeyDown={widget.onActivate ? event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); widget.onActivate?.() } } : undefined} role={widget.onActivate ? 'button' : undefined} tabIndex={widget.onActivate ? 0 : undefined} title={widget.onActivate ? 'Abrir detalhes' : undefined}>{widget.render(mode, chartPalette, effectiveSegments)}</div>
                <button type="button" className="pcm-canvas__resize-handle" aria-label={`Redimensionar ${widget.title}`} title="Arraste para ajustar largura e altura" onPointerDown={event => startResize(event, 'widget', widget.id, currentSpan)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button>
              </article>
            })}
            {dropTarget?.groupId === group.id && dropTarget.left !== undefined && dropTarget.top !== undefined && dragging.startsWith('widget:') ? (() => {
              const draggedId = dragging.slice('widget:'.length)
              const draggedPlacement = layout.placements[draggedId]
              if (!draggedPlacement) return null
              return <div aria-hidden="true" className="pcm-canvas__drop-preview" style={{ '--pcm-drop-left': `${dropTarget.left}%`, '--pcm-drop-top': `${dropTarget.top}px`, '--pcm-drop-width': `${(draggedPlacement.span / 24) * 100}%`, '--pcm-drop-height': `${draggedPlacement.height ?? 96}px` } as CSSProperties} />
            })() : null}
            {groupIds.length === 0 ? <p className="pcm-canvas__empty">Nenhum indicador corresponde ao filtro atual.</p> : null}
          </div>
          {group.id !== boardGroup.id ? <button type="button" className="pcm-canvas__resize-handle pcm-canvas__resize-handle--group" aria-label={`Redimensionar grupo ${group.label}`} title="Arraste para ajustar a largura do grupo" onPointerDown={event => startResize(event, 'group', group.id, width)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button> : null}
        </section>
      })}
    </div>
    {editableGroup && groupEditor ? createPortal(<div className="pcm-canvas__group-editor" role="dialog" aria-label={`Personalizar grupo ${editableGroup.label}`} style={{ left: groupEditor.left, top: groupEditor.top }} onPointerDown={event => event.stopPropagation()}>
      <header><strong>Personalizar grupo</strong><button type="button" aria-label="Fechar personalização do grupo" onClick={() => setGroupEditor(null)}><X size={14} /></button></header>
      <label className="pcm-canvas__group-editor-field">Nome<input type="text" value={editableGroup.label} maxLength={40} onChange={event => updateGroup(editableGroup.id, { label: event.target.value.slice(0, 40) })} /></label>
      <label className="pcm-canvas__group-heading-toggle"><span>Mostrar cabeçalho</span><input type="checkbox" checked={editableGroup.showHeading !== false} onChange={event => updateGroup(editableGroup.id, { showHeading: event.target.checked })} /></label>
      <fieldset><legend>Tamanho</legend><div className="pcm-canvas__group-widths">{([[6, '25%'], [12, '50%'], [18, '75%'], [24, '100%']] as const).map(([width, label]) => <button key={width} type="button" className={(layout.groupWidths[editableGroup.id] ?? 12) === width ? 'is-active' : ''} aria-pressed={(layout.groupWidths[editableGroup.id] ?? 12) === width} onClick={() => setLayout(current => ({ ...current, groupWidths: { ...current.groupWidths, [editableGroup.id]: width } }))}>{label}</button>)}</div></fieldset>
      <fieldset><legend>Aparência</legend>
        <label>Fundo<span className="pcm-canvas__group-color"><input type="color" value={editableGroup.background && editableGroup.background !== 'transparent' ? editableGroup.background : '#ffffff'} disabled={editableGroup.background === 'transparent'} onChange={event => updateGroup(editableGroup.id, { background: event.target.value })} /><button type="button" className={editableGroup.background === 'transparent' ? 'is-active' : ''} aria-pressed={editableGroup.background === 'transparent'} onClick={() => updateGroup(editableGroup.id, { background: editableGroup.background === 'transparent' ? '#ffffff' : 'transparent' })}>Transparente</button></span></label>
        <label>Opacidade<select value={editableGroup.backgroundOpacity ?? 100} onChange={event => updateGroup(editableGroup.id, { backgroundOpacity: Number(event.target.value) as PcmCanvasGroup['backgroundOpacity'] })}><option value={40}>40%</option><option value={60}>60%</option><option value={80}>80%</option><option value={100}>100%</option></select></label>
        <label>Borda<span className="pcm-canvas__group-color"><input type="color" value={editableGroup.border && editableGroup.border !== 'none' ? editableGroup.border : '#dce5eb'} disabled={editableGroup.border === 'none'} onChange={event => updateGroup(editableGroup.id, { border: event.target.value })} /><button type="button" className={editableGroup.border === 'none' ? 'is-active' : ''} aria-pressed={editableGroup.border === 'none'} onClick={() => updateGroup(editableGroup.id, { border: editableGroup.border === 'none' ? '#dce5eb' : 'none' })}>Sem borda</button></span></label>
        <label>Cor do título<input type="color" value={editableGroup.titleColor ?? '#23445e'} onChange={event => updateGroup(editableGroup.id, { titleColor: event.target.value })} /></label>
      </fieldset>
      <button type="button" className="pcm-canvas__group-editor-reset" onClick={() => updateGroup(editableGroup.id, { background: undefined, backgroundOpacity: undefined, border: undefined, titleColor: undefined })}>Restaurar aparência</button>
    </div>, document.body) : null}
    {paletteWidget && palettePlacement && paletteMode ? createPortal(<div ref={paletteMenuRef} popover="manual" className="pcm-canvas__palette-menu" role="dialog" aria-label={`Personalização de ${paletteWidget.title}`} style={{ left: palettePosition.left, top: palettePosition.top }} onPointerDown={event => event.stopPropagation()}>
      <header><strong>Personalizar card</strong><button type="button" aria-label="Fechar personalização" onClick={() => { setPaletteWidgetId(null); setPaletteAnchor(null) }}><X size={14} /></button></header>
      <fieldset><legend>Texto</legend>
        <label className="pcm-canvas__palette-toggle"><span>Mostrar título</span><input type="checkbox" checked={palettePlacement.showTitle !== false} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, showTitle: event.target.checked }))} /></label>
        <label className="pcm-canvas__palette-title-field">Título<input type="text" value={palettePlacement.customTitle ?? paletteWidget.title} maxLength={60} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customTitle: event.target.value }))} aria-label="Título do card" /></label>
        <label className="pcm-canvas__palette-title-field">Subtítulo<input type="text" value={palettePlacement.customSubtitle ?? ''} maxLength={100} placeholder="Adicionar uma descrição curta" onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customSubtitle: event.target.value }))} aria-label="Subtítulo do card" /></label>
        <label>Tamanho do título<select value={palettePlacement.titleSize ?? 9} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, titleSize: Number(event.target.value) as CanvasPlacement['titleSize'] }))}><option value={8}>8 px</option><option value={10}>10 px</option><option value={12}>12 px</option><option value={14}>14 px</option></select></label>
        <label>Tamanho do conteúdo<select value={palettePlacement.contentSize ?? 11} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, contentSize: Number(event.target.value) as CanvasPlacement['contentSize'] }))}><option value={9}>Compacto</option><option value={11}>Padrão</option><option value={13}>Amplo</option><option value={15}>Grande</option></select></label>
      </fieldset>
      {paletteWidget.modes.length > 1 ? <fieldset><legend>Visualização</legend>
        <label>Formato do conteúdo<select value={paletteMode} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, mode: event.target.value as PcmCanvasMode }))}>{paletteWidget.modes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </fieldset> : null}
      <fieldset><legend>Tamanho do card</legend>
        <div className="pcm-canvas__palette-presets" aria-label="Formato do card">
          <button type="button" className={palettePlacement.shape === 'wide' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'wide'} onClick={() => setWidgetShape(paletteWidget.id, 'wide', 12)}>Horizontal</button>
          <button type="button" className={palettePlacement.shape === 'square' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'square'} onClick={() => setWidgetShape(paletteWidget.id, 'square', 8)}>Quadrado</button>
          <button type="button" className={palettePlacement.shape === 'column' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'column'} onClick={() => setWidgetShape(paletteWidget.id, 'column', 6)}>Coluna</button>
        </div>
      </fieldset>
      {paletteWidget.action ? <fieldset><legend>Botão</legend>
        <label className="pcm-canvas__palette-toggle"><span>Mostrar texto do botão</span><input type="checkbox" checked={palettePlacement.showActionLabel !== false} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, showActionLabel: event.target.checked }))} /></label>
        <div className="pcm-canvas__palette-presets" aria-label="Estilo do botão">
          {([['solid', 'Preenchido'], ['outline', 'Contorno'], ['minimal', 'Sem borda'], ['icon', 'Só ícone']] as const).map(([id, label]) => <button key={id} type="button" className={(palettePlacement.buttonStyle ?? 'outline') === id ? 'is-active' : ''} aria-pressed={(palettePlacement.buttonStyle ?? 'outline') === id} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, buttonStyle: id, ...(id === 'icon' ? { showActionLabel: false } : {}) }))}>{label}</button>)}
        </div>
      </fieldset> : null}
      {['line', 'bar', 'pie', 'comparison', 'progress'].includes(paletteMode) ? <fieldset><legend>Gráfico</legend>
        <div className="pcm-canvas__palette-presets" aria-label="Paleta do gráfico">{Object.entries(chartPalettes).map(([id, palette]) => <button key={id} type="button" className={palettePlacement.paletteId === id ? 'is-active' : ''} aria-label={`Paleta ${palette.label}`} aria-pressed={palettePlacement.paletteId === id} title={palette.label} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, paletteId: id, customColor: undefined, customColors: undefined }))}><span aria-hidden="true">{palette.colors.slice(0, 4).map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><small>{palette.label}</small></button>)}</div>
        <label>Opacidade do gráfico<select value={palettePlacement.chartOpacity ?? 100} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, chartOpacity: Number(event.target.value) as CanvasPlacement['chartOpacity'] }))}><option value={40}>40%</option><option value={60}>60%</option><option value={80}>80%</option><option value={100}>100%</option></select></label>
        <div className="pcm-canvas__palette-colors">
          {(paletteMode === 'pie' ? paletteColors.map((_, index) => `Fatia ${index + 1}`) : paletteMode === 'comparison' ? ['MTTR', 'MTBF'] : ['Linha e barras']).map((label, index) => <label key={label} title={`Cor: ${label}`}>{label}<input type="color" value={paletteColors[index] ?? paletteColors[0]} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customColor: undefined, customColors: paletteColors.map((color, colorIndex) => colorIndex === index ? event.target.value : color) }))} aria-label={`Cor de ${label}`} /></label>)}
        </div>
      </fieldset> : null}
      <fieldset><legend>Aparência</legend>
        <label className="pcm-canvas__palette-title-field">Fundo<input type="color" value={palettePlacement.cardBackground && palettePlacement.cardBackground !== 'transparent' ? palettePlacement.cardBackground : '#ffffff'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, cardBackground: event.target.value }))} aria-label="Cor de fundo do card" /></label>
        <div className="pcm-canvas__palette-presets" aria-label="Estilo do fundo"><button type="button" className={!palettePlacement.cardBackground || palettePlacement.cardBackground === '#ffffff' ? 'is-active' : ''} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBackground: undefined }))}>Branco</button><button type="button" className={palettePlacement.cardBackground === '#f2f6fa' ? 'is-active' : ''} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBackground: '#f2f6fa' }))}>Suave</button><button type="button" className={palettePlacement.cardBackground === 'transparent' ? 'is-active' : ''} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBackground: 'transparent' }))}>Transparente</button></div>
        <label>Opacidade do fundo<select value={palettePlacement.cardBackgroundOpacity ?? 100} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, cardBackgroundOpacity: Number(event.target.value) as CanvasPlacement['cardBackgroundOpacity'] }))}><option value={40}>40%</option><option value={60}>60%</option><option value={80}>80%</option><option value={100}>100%</option></select></label>
        <div className="pcm-canvas__palette-colors"><label>Borda<input type="color" value={palettePlacement.cardBorder && palettePlacement.cardBorder !== 'none' ? palettePlacement.cardBorder : '#e1e8ed'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, cardBorder: event.target.value }))} aria-label="Cor da borda" /></label><button type="button" className={palettePlacement.cardBorder === 'none' ? 'is-active' : ''} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBorder: 'none' }))}>Sem borda</button><label>Título<input type="color" value={palettePlacement.titleColor ?? '#375873'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, titleColor: event.target.value }))} aria-label="Cor do título" /></label><label>Conteúdo<input type="color" value={palettePlacement.contentColor ?? '#12324d'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, contentColor: event.target.value }))} aria-label="Cor do conteúdo" /></label></div>
      </fieldset>
      <button type="button" className="pcm-canvas__palette-reset" onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, segments: undefined, customTitle: undefined, customSubtitle: undefined, showTitle: undefined, showActionLabel: undefined, titleSize: undefined, contentSize: undefined, shape: undefined, buttonStyle: undefined, height: undefined, paletteId: 'ocean', chartOpacity: undefined, customColor: undefined, customColors: undefined, cardBackground: undefined, cardBackgroundOpacity: undefined, cardBorder: undefined, titleColor: undefined, contentColor: undefined }))}>Restaurar padrão</button>
    </div>, document.body) : null}
    {filterWidget && filterPlacement ? createPortal(<div ref={filterMenuRef} className="pcm-canvas__filter-menu" role="dialog" aria-label={`Filtros de ${filterWidget.title}`} style={{ left: filterPosition.left, top: filterPosition.top }} onPointerDown={event => event.stopPropagation()}>
      <header><strong>Filtrar indicador</strong><button type="button" aria-label="Fechar filtros do indicador" onClick={() => setFilterWidgetId(null)}><X size={14} /></button></header>
      <p>{filterWidget.title}</p>
      {!segmentFilters.length ? <p className="pcm-canvas__filter-empty">Ainda não há valores disponíveis para segmentar este indicador.</p> : null}
      {segmentFilters.map(filter => <label key={filter.id}>{filter.label}<select value={filterPlacement.segments?.[filter.id] ?? ''} onChange={event => {
        const selectedValue = event.target.value
        setPlacement(filterWidget.id, value => {
          const next = { ...(value.segments ?? {}) }
          if (selectedValue) next[filter.id] = selectedValue
          else delete next[filter.id]
          return { ...value, segments: Object.keys(next).length ? next : undefined }
        })
      }} aria-label={`Filtro individual ${filter.label} para ${filterWidget.title}`}>
        <option value="">Herdar global</option><option value={ignoreGlobalSegment}>Todos (ignorar global)</option>
        {filter.options.map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>)}
      {Object.keys(filterPlacement.segments ?? {}).length ? <button type="button" className="pcm-canvas__filter-reset" onClick={() => setPlacement(filterWidget.id, value => ({ ...value, segments: undefined }))}>Limpar filtros deste indicador</button> : null}
    </div>, document.body) : null}
    {contextMenu ? <div className="pcm-canvas__context-menu" role="menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 250) }} onPointerDown={event => event.stopPropagation()}>
      {contextMenu.kind === 'widget' ? (() => {
        const widget = widgetById.get(contextMenu.id)
        const placement = layout.placements[contextMenu.id]
        if (!widget || !placement) return null
        const next = widget.modes.length > 1 ? nextMode(placement.mode, widget.modes) : null
        const groups = allGroups.filter(group => group.id !== placement.groupId)
        const owningGroup = allGroups.find(group => group.id === placement.groupId)
        return <>
          {next ? <button type="button" role="menuitem" onClick={() => { setPlacement(widget.id, value => ({ ...value, mode: next.id })); setContextMenu(null) }}><ChartNoAxesCombined size={14} /> Formato: {next.label}</button> : null}
          {owningGroup && owningGroup.id !== boardGroup.id ? <button type="button" role="menuitem" onClick={() => setGroupHeading(owningGroup.id, owningGroup.showHeading === false)}><Eye size={14} /> {owningGroup.showHeading === false ? 'Visualizar grupo' : 'Ocultar cabeçalho do grupo'}</button> : null}
          {groups.length ? <label className="pcm-canvas__context-select"><span>Mover para</span><select value="" onChange={event => { if (event.target.value) moveWidget(widget.id, event.target.value); setContextMenu(null) }}><option value="">Escolher grupo</option>{groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label> : null}
          <button type="button" role="menuitem" className="is-danger" onClick={() => { removeWidget(widget.id); setContextMenu(null) }}><Trash2 size={14} /> Remover indicador</button>
        </>
      })() : (() => {
        const group = layout.customGroups.find(item => item.id === contextMenu.id)
        if (!group) return null
        return <>
          <button type="button" role="menuitem" onClick={() => setGroupHeading(group.id, group.showHeading === false)}><Eye size={14} /> {group.showHeading === false ? 'Visualizar grupo' : 'Ocultar cabeçalho'}</button>
          {renamingGroupId === group.id ? <form className="pcm-canvas__group-rename" onSubmit={renameGroup} onPointerDown={event => event.stopPropagation()}><input aria-label="Nome do grupo" value={renamingGroupLabel} onChange={event => setRenamingGroupLabel(event.target.value)} maxLength={40} autoFocus /><button type="submit" disabled={!renamingGroupLabel.trim()}><Check size={14} aria-hidden="true" /> Salvar nome</button><button type="button" onClick={() => { setRenamingGroupId(null); setRenamingGroupLabel(''); setContextMenu(null) }}>Cancelar</button></form> : <button type="button" role="menuitem" onClick={() => { setRenamingGroupId(group.id); setRenamingGroupLabel(group.label) }}><span aria-hidden="true">Aa</span> Renomear grupo</button>}
          <button type="button" role="menuitem" className="is-danger" onClick={() => ungroup(group.id)}><X size={14} /> Desagrupar</button>
        </>
      })()}
    </div> : null}
  </section>
}
