import { Fragment as ReactFragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent, FormEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChartNoAxesCombined, Check, CircleHelp, ClipboardPaste, Copy, Download, Eye, EyeOff, Filter, History, Layers, LayoutTemplate, Magnet, Move, Palette, Plus, Printer, Save, Search, Sparkles, SunMoon, Trash2, Upload, X } from 'lucide-react'
import './PcmDashboardCanvas.css'
import { getChartVolume, pickFocusEffect, PcmChartPresentationContext } from './PcmChartPresentation'
import type { PcmChartPresentation } from './PcmChartPresentation'

function PcmColorInput({ value, onChange, disabled, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const name = useId()
  const color = typeof value === 'string' ? value : '#176fc1'
  const [draft, setDraft] = useState(color)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => setDraft(color), [color])
  useEffect(() => {
    if (!open) return
    const close = (event: globalThis.PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <span ref={ref} className="pcm-color-control">
    <button type="button" disabled={disabled} aria-label={props['aria-label'] ?? 'Escolher cor'} aria-expanded={open} onClick={() => setOpen(current => !current)}><i style={{ backgroundColor: color }} /><span>{color.toUpperCase()}</span></button>
    {open ? <span className="pcm-color-options" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <span className="pcm-color-swatches">{['#ffffff','#edf5fc','#18364d','#252a30','#176fc1','#1b886b','#7952b3','#c65379','#e58937','#c83f49'].map(swatch => <input key={swatch} type="radio" name={name} value={swatch} checked={color.toLowerCase() === swatch} aria-label={`Cor ${swatch}`} style={{ backgroundColor: swatch }} onChange={onChange} />)}</span>
      <input type="text" aria-label="Cor hexadecimal" value={draft} maxLength={7} spellCheck={false} onChange={event => { setDraft(event.currentTarget.value); if (/^#[0-9a-f]{6}$/i.test(event.currentTarget.value)) onChange?.(event) }} />
      <span className="pcm-color-free"><Plus size={14} aria-hidden="true" /><span>Mais cores</span><input type="color" aria-label="Escolher qualquer cor" value={color} onChange={onChange} /></span>
    </span> : null}
  </span>
}

export type PcmCanvasMode = 'number' | 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'comparison' | 'list' | 'progress'
export type PcmCanvasCategory = { id: string; label: string }
export type PcmCanvasPalette = readonly [string, ...string[]]
export type PcmCanvasSegments = Record<string, string>
export type PcmCanvasSegmentFilter = { id: string; label: string; options: string[] }
const ignoreGlobalSegment = '__all__'
const toolbarFeatures = [
  { id: 'selection', label: 'Seleção de cards', selector: '.pcm-canvas__toolbar-title > button' },
  { id: 'help', label: 'Ajuda', selector: '.pcm-canvas__help-placement' },
  { id: 'arrange', label: 'Ímã e alinhamento', selector: '.pcm-canvas__layout-menu:has(.pcm-canvas__arrange-options)' },
  { id: 'period', label: 'Período', selector: '.pcm-canvas__period' },
  { id: 'history', label: 'Histórico e análise', selector: '[aria-label="Abrir histórico e análise"]' },
  { id: 'search', label: 'Busca', selector: '.pcm-canvas__search' },
  { id: 'category', label: 'Filtro de categoria', selector: '.pcm-canvas__filter:has(select[aria-label="Filtrar por categoria"])' },
  { id: 'segments', label: 'Filtros de segmentação', selector: '[aria-label="Mostrar filtros de segmentação"]' },
  { id: 'print', label: 'Imprimir', selector: '[aria-label="Imprimir lousa atual"]' },
  { id: 'layouts', label: 'Escolher layout', selector: '.pcm-canvas__layout-menu:has([aria-label="Escolher layout"])' },
  { id: 'headings', label: 'Alternar cabeçalhos', selector: '.pcm-canvas__heading-toggle' },
  { id: 'organize', label: 'Organizar indicadores', selector: '[aria-label="Organizar indicadores"]' },
  { id: 'add', label: 'Adicionar indicador', selector: '[aria-label="Adicionar indicador"]' },
  { id: 'save', label: 'Salvar layout', selector: '.pcm-canvas__save-button' },
] as const
const chartPalettes: Record<string, { label: string; colors: PcmCanvasPalette }> = {
  monoBlue: { label: 'Mono · azul', colors: ['#176fc1','#3886cb','#61a0d7','#8abbe3','#b4d5ef','#dcecf8'] },
  duoOcean: { label: 'Duo · oceano', colors: ['#087f8c','#e58a35','#43a5ad','#efa966','#83c8cd','#f6cda4'] },
  duoViolet: { label: 'Duo · violeta', colors: ['#7047b8','#29a38b','#9778ce','#62bca9','#bfabe3','#a0dacd'] },
  monoGreen: { label: 'Mono · verde', colors: ['#147a62','#39977e','#66b29d','#92cdbd','#b9e1d6','#e0f3ed'] },
  duoRose: { label: 'Duo · rosa e azul', colors: ['#bd4772','#237ead','#d67b9a','#63a6ca','#e9b0c4','#a4cee2'] },
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
  render: (mode: PcmCanvasMode, palette: PcmCanvasPalette, segments?: PcmCanvasSegments, chartStyle?: CanvasPlacement['chartStyle']) => ReactNode
}

type CanvasCornerStyle = number | 'square' | 'soft' | 'round'
type PcmCanvasGroup = { id: string; label: string; description?: string; parentId?: string; showHeading?: boolean; background?: string | 'transparent'; backgroundOpacity?: number; border?: string | 'none'; radius?: CanvasCornerStyle; titleColor?: string; shadow?: number; titleShadow?: number; subtitle?: string; titleSize?: number; subtitleSize?: number; subtitleColor?: string; titleAlign?: 'left' | 'center' | 'right' }
type CanvasPlacement = PcmChartPresentation & { chartGridColor?: string; chartGridWidth?: number; showChartAxes?: boolean; showChartCenter?: boolean; chartLabelColor?: string; legendGap?: number; gradientEnd?: string; ornamentColor?: string; ornamentPulses?: number; ornament?: 'none' | 'fold' | 'dot' | 'notch'; ornamentCorner?: 'tl' | 'tr' | 'bl' | 'br'; chartLabelWidth?: number; chartRowGap?: number; cornerCut?: number; hoverColor?: string; textTilt?: number; textDepth?: number; cardTilt?: number; cardInset?: number; subtitleSize?: number; accentPosition?: 'left' | 'right' | 'top' | 'bottom' | 'corners' | 'none'; chartDiameter?: number; chartLabels?: 'none' | 'value' | 'percent'; legendPosition?: 'right' | 'bottom' | 'top' | 'hidden'; groupId: string; span: number; left?: number; top?: number; column?: number; row?: number; rowSpan?: number; height?: number; aspectLocked?: boolean; contentScale?: number; mode: PcmCanvasMode; paletteId: string; segments?: PcmCanvasSegments; chartOpacity?: number; chartStyle?: 'default' | 'oval' | 'exploded' | 'depth' | 'smooth' | 'minimal' | 'rounded' | 'gradient' | 'bar-depth'; chartLineWidth?: number; chartPointSize?: number; chartBorderWidth?: number; chartDepth?: number; customColor?: string; customColors?: string[]; cardBackground?: string | 'transparent'; cardBackgroundOpacity?: number; cardBorder?: string | 'none'; cardBorderStyle?: 'solid' | 'dashed' | 'dotted' | 'double'; cardRadius?: CanvasCornerStyle; cardEffect?: 'flat' | 'glass' | 'glass-blue' | 'glass-mint' | 'gradient' | 'elevated' | 'outline'; titleColor?: string; contentColor?: string; accentColor?: string; iconColor?: string; customTitle?: string; customSubtitle?: string; showTitle?: boolean; showActionLabel?: boolean; titleSize?: 10 | 12 | 14 | 16 | 18; titleAlign?: 'left' | 'center' | 'right'; contentSize?: number; iconSize?: number; iconPosition?: 'inline' | 'top' | 'right'; shape?: 'wide' | 'square' | 'column' | 'banner' | 'portrait' | 'circle' | 'oval'; buttonStyle?: 'solid' | 'outline' | 'minimal' | 'icon' | 'soft'; buttonRadius?: 'square' | 'soft' | 'pill'; buttonColor?: string; buttonBackground?: string; buttonBorder?: string; buttonText?: string; cardShadow?: number; titleShadow?: number; contentShadow?: number; iconShadow?: number }

function parseCornerRadius(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(300, Math.round(value)))
  if (value === 'square') return 0
  if (value === 'round') return 12
  if (value === 'soft') return 4
  return undefined
}

function parseShadow(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(24, Math.round(value))) : undefined
}

const cornerRadiusValue = (style?: CanvasCornerStyle) => `${parseCornerRadius(style) ?? 4}px`
const shadowValue = (value?: number) => value ? `0 ${Math.max(1, Math.round(value * 0.45))}px ${value * 1.5}px rgba(8, 31, 50, ${Math.min(0.42, 0.06 + value / 80)})` : 'none'

type ContentSizeFieldProps = { value: number; onChange: (size: number) => void }

function ContentSizeField({ value, onChange }: ContentSizeFieldProps) {
  return <label className="pcm-canvas__range-field"><span>Tamanho de números e conteúdo <output>{value}px</output></span><input type="range" min={8} max={48} step={1} value={value} onChange={event => onChange(Number(event.currentTarget.value))} aria-label="Tamanho dos números e conteúdo" /></label>
}
const cardStylePresets = [
  { id: 'dashboard-ice', label: 'Gradiente gelo', effect: 'gradient', background: '#dceefa', border: '#aecfe5', titleColor: '#28536f', contentColor: '#12354e', chartColors: ['#2379b5', '#61a9d7', '#a2cde7', '#18527e', '#7fb9dc', '#3d8dbd'] },
  { id: 'dashboard-mint', label: 'Gradiente sálvia', effect: 'gradient', background: '#d8f1e7', border: '#a6d3c1', titleColor: '#285e4c', contentColor: '#173f33', chartColors: ['#218468', '#57b497', '#9ed8c4', '#195e49', '#7ec6ad', '#3b9b7e'] },
  { id: 'dashboard-night', label: 'Gradiente oceano', effect: 'gradient', background: '#173b59', border: '#3f6c8c', titleColor: '#c4e3fa', contentColor: '#f0f8ff', chartColors: ['#62b9f4', '#76d5be', '#b2a1f0', '#8acdf5', '#99e1d0', '#c8bdf3'] },
  { id: 'gradient-violet', label: 'Gradiente violeta', effect: 'gradient', background: '#e4d5ff', border: '#b7a0dc', titleColor: '#44257b', contentColor: '#29134e', chartColors: ['#7941cb', '#aa7ae2', '#d4b6f1', '#4e2488', '#b790e1', '#6837a6'] },
  { id: 'gradient-coral', label: 'Gradiente coral', effect: 'gradient', background: '#ffd4c5', border: '#eaa48d', titleColor: '#853e29', contentColor: '#552516', chartColors: ['#d45a39', '#e98b65', '#f5b392', '#9c3d25', '#ed9f80', '#b84a2d'] },
  { id: 'reflection', label: 'Reflexo cristal', effect: 'glass', background: '#d9edf7', border: '#99bfd5', titleColor: '#244d67', contentColor: '#123248', chartColors: ['#287fad', '#65add1', '#afd4e8', '#165575', '#89bed9', '#397c9e'] },
  { id: 'standard', label: 'Padrão transparente', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: 'var(--pcm-canvas-text)', contentColor: 'var(--pcm-canvas-text)', chartColors: ['#176fc1', '#58a6e8', '#a9cbea', '#0b4b84', '#82b7dc', '#416d98'] },
  { id: 'green-transparent', label: 'Verde transparente', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#46d6a7', contentColor: '#d7fff0', chartColors: ['#24c997', '#69e2bd', '#b0f3dc', '#119c73', '#83e5c4', '#38b88f'] },
  { id: 'soft', label: 'Suave', effect: 'flat', background: '#f2f6fa', border: '#d8e2e9', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#236eaa', '#6da8d6', '#a6c8e1', '#315777', '#77a6c8', '#4f829f'] },
  { id: 'glass', label: 'Vitrificado', effect: 'glass', background: '#edf6fc', border: '#d2e4f0', titleColor: '#234b68', contentColor: '#12324d', chartColors: ['#0879c9', '#29a4da', '#7dc8e8', '#16558c', '#58a9d2', '#347d9c'] },
  { id: 'glass-blue', label: 'Vidro azul', effect: 'glass-blue', background: '#dceeff', border: '#b8d5ed', titleColor: '#174d75', contentColor: '#12324d', chartColors: ['#0068d9', '#2687f5', '#77b7ff', '#174eaa', '#4d9fe8', '#3975c7'] },
  { id: 'glass-mint', label: 'Vidro menta', effect: 'glass-mint', background: '#e0f5ed', border: '#b9dfd1', titleColor: '#17634f', contentColor: '#174c43', chartColors: ['#008c69', '#23b58d', '#75d7b8', '#176c55', '#58b995', '#37947a'] },
  { id: 'gradient', label: 'Degradê', effect: 'gradient', background: '#e8f2fc', border: '#cbddec', titleColor: '#234b68', contentColor: '#12324d', chartColors: ['#176fc1', '#f08b38', '#36a881', '#7959c5', '#d64d67', '#28a6b4'] },
  { id: 'elevated', label: 'Elevado', effect: 'elevated', background: '#ffffff', border: '#e1e8ed', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1', '#e58a22', '#14866d', '#8157bd', '#c34660', '#168f9a'] },
  { id: 'outline', label: 'Contorno', effect: 'outline', background: 'transparent', border: '#8aa9bf', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1', '#eb8a2f', '#16866d', '#7655bd', '#c44863', '#1a929c'] },
  { id: 'blue-dark', label: 'Azul noite', effect: 'flat', background: '#17344d', border: '#17344d', titleColor: '#eaf3fa', contentColor: '#ffffff', chartColors: ['#60b8ff', '#7de0c1', '#ffd166', '#c5a5ff', '#ff8fab', '#75e5eb'] },
  { id: 'graphite', label: 'Grafite', effect: 'flat', background: '#252a30', border: '#252a30', titleColor: '#f1f4f6', contentColor: '#ffffff', chartColors: ['#56b4e9', '#e69f00', '#009e73', '#cc79a7', '#f0e442', '#d55e00'] },
  { id: 'sage', label: 'Sálvia', effect: 'flat', background: '#edf3e8', border: '#d3dfc8', titleColor: '#47623a', contentColor: '#263b25', chartColors: ['#467c38', '#86a83e', '#c48631', '#477c70', '#9d613b', '#61894c'] },
  { id: 'lavender', label: 'Lavanda', effect: 'flat', background: '#f1edfa', border: '#ddd3f0', titleColor: '#604d88', contentColor: '#3c3155', chartColors: ['#7047b8', '#a16dde', '#d2b6f0', '#4f358b', '#bb86dd', '#835db8'] },
  { id: 'transparent', label: 'Transparente', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: 'var(--pcm-canvas-text)', contentColor: 'var(--pcm-canvas-text)', chartColors: ['#176fc1', '#eb8a2f', '#16866d', '#7655bd', '#c44863', '#1a929c'] },
  { id: 'midnight-glass', label: 'Vidro noturno', effect: 'glass-blue', background: '#193b58', border: '#315d7b', titleColor: '#f3f9ff', contentColor: '#ffffff', chartColors: ['#53b9ff', '#64dfbd', '#ffd166', '#c6a0ff', '#ff92a8', '#7ee5ec'] },
  { id: 'slate', label: 'Ardósia', effect: 'elevated', background: '#e9eef2', border: '#c8d2db', titleColor: '#344d61', contentColor: '#263c4d', chartColors: ['#386f9e', '#d28b36', '#4b947d', '#8066b1', '#bd596c', '#438e9d'] },
  { id: 'sand', label: 'Areia', effect: 'flat', background: '#f7f1e6', border: '#e6dac4', titleColor: '#6e5536', contentColor: '#4c3c2b', chartColors: ['#b47b36', '#d69a4b', '#6f9463', '#8a6db0', '#c36b5c', '#4e8793'] },
  { id: 'coral', label: 'Coral', effect: 'gradient', background: '#fff0ec', border: '#f1d0c8', titleColor: '#873e37', contentColor: '#583632', chartColors: ['#db5d4c', '#f08a67', '#f2b34e', '#8aa454', '#7a78bd', '#278e9c'] },
  { id: 'rose', label: 'Rosa', effect: 'glass', background: '#fbedf2', border: '#eccbd8', titleColor: '#82435b', contentColor: '#533746', chartColors: ['#bd4772', '#df7095', '#f0a9bf', '#893456', '#d98caa', '#a95478'] },
  { id: 'teal', label: 'Turquesa', effect: 'glass-mint', background: '#e7f6f6', border: '#c3e2e2', titleColor: '#24656a', contentColor: '#24494c', chartColors: ['#087f8c', '#2ba7ac', '#80d0c9', '#075d68', '#55b8b1', '#33878b'] },
  { id: 'amber', label: 'Âmbar', effect: 'flat', background: '#fff6df', border: '#ead9aa', titleColor: '#715719', contentColor: '#4d421f', chartColors: ['#ba7b00', '#e7a91d', '#f0cf63', '#98601b', '#d58d32', '#8c7932'] },
  { id: 'violet', label: 'Violeta', effect: 'gradient', background: '#f0edff', border: '#d5cef5', titleColor: '#50437f', contentColor: '#373052', chartColors: ['#7047b8', '#9d72df', '#cdb9f3', '#48338d', '#ae8be0', '#7560b4'] },
  { id: 'forest', label: 'Floresta', effect: 'elevated', background: '#edf4e9', border: '#cbdcc3', titleColor: '#3c5d35', contentColor: '#293f29', chartColors: ['#4c812f', '#83aa4b', '#bbcf75', '#31603b', '#91b16a', '#548d68'] },
] as const
type CanvasLibraryStyle = { id: string; label: string; effect: CanvasPlacement['cardEffect']; background: string; border: string; titleColor: string; contentColor: string; chartColors: string[]; properties?: Partial<CanvasPlacement> }
const focusEffectPresets: CanvasLibraryStyle[] = ([['none', 'Sem animação'], ['flash', 'Flash suave'], ['glow', 'Luz'], ['reflection', 'Reflexo'], ['pulse', 'Pulso'], ['lift', 'Elevação'], ['sweep', 'Varredura'], ['link', 'Expansão'], ['vibrate', 'Vibração suave'], ['saturation', 'Realce de cor']] as const).map(([effect, label]) => ({ id: `focus-${effect}`, label, effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#12324d', contentColor: '#12324d', chartColors: ['#176fc1'], properties: { chartFocusEffect: effect, chartFocusTarget: 'card', chartFocusTrigger: 'both', chartFocusIntensity: 60, chartFocusDuration: 650, chartFocusColor: '#63a2df', chartFocusDim: 70 } }))
const textStylePresets: CanvasLibraryStyle[] = [
  { id: 'text-system', label: 'Padrão', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#23445e', contentColor: '#12324d', chartColors: ['#176fc1'] },
  { id: 'text-contrast', label: 'Alto contraste', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#12324d', contentColor: '#0b2235', chartColors: ['#0b68b0'] },
  { id: 'text-blue', label: 'Azul técnico', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#174d75', contentColor: '#236eaa', chartColors: ['#176fc1'] },
  { id: 'text-green', label: 'Verde operação', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#17634f', contentColor: '#24745f', chartColors: ['#14866d'] },
]
const borderStylePresets: Array<CanvasLibraryStyle & { line: CanvasPlacement['cardBorderStyle'] | 'none' }> = [
  { id: 'border-none', label: 'Sem borda', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1'], line: 'none' },
  { id: 'border-solid', label: 'Contínua', effect: 'flat', background: 'transparent', border: '#9aafbf', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1'], line: 'solid' },
  { id: 'border-dashed', label: 'Tracejada', effect: 'flat', background: 'transparent', border: '#9aafbf', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1'], line: 'dashed' },
  { id: 'border-dotted', label: 'Pontilhada', effect: 'flat', background: 'transparent', border: '#9aafbf', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1'], line: 'dotted' },
  { id: 'border-double', label: 'Dupla', effect: 'flat', background: 'transparent', border: '#9aafbf', titleColor: '#375873', contentColor: '#12324d', chartColors: ['#176fc1'], line: 'double' },
]
const buttonStylePresets: CanvasLibraryStyle[] = [
  { id: 'button-crystal', label: 'Cristal com reflexo', effect: 'glass', background: '#236d9e', border: '#6fb6e3', titleColor: '#ffffff', contentColor: '#ffffff', chartColors: ['#236d9e'], properties: { buttonStyle: 'solid', buttonRadius: 'soft' } },
  { id: 'button-gradient', label: 'Gradiente violeta', effect: 'gradient', background: '#7144b8', border: '#9874cd', titleColor: '#ffffff', contentColor: '#ffffff', chartColors: ['#7144b8'], properties: { buttonStyle: 'solid', buttonRadius: 'pill' } },
  { id: 'button-raised', label: 'Relevo azul', effect: 'elevated', background: '#174d75', border: '#174d75', titleColor: '#ffffff', contentColor: '#ffffff', chartColors: ['#174d75'], properties: { buttonStyle: 'solid', cardShadow: 8 } },
  { id: 'button-outline', label: 'Contorno', effect: 'outline', background: 'transparent', border: '#176fc1', titleColor: '#174d75', contentColor: '#174d75', chartColors: ['#176fc1'] },
  { id: 'button-filled', label: 'Preenchido', effect: 'flat', background: '#174d75', border: '#174d75', titleColor: '#ffffff', contentColor: '#ffffff', chartColors: ['#174d75'] },
  { id: 'button-soft', label: 'Suave', effect: 'glass-blue', background: '#e7f3fc', border: '#b8d5e8', titleColor: '#174d75', contentColor: '#174d75', chartColors: ['#176fc1'] },
  { id: 'button-minimal', label: 'Discreto', effect: 'flat', background: 'transparent', border: 'transparent', titleColor: '#174d75', contentColor: '#174d75', chartColors: ['#176fc1'] },
]
const chartStylePresets: CanvasLibraryStyle[] = Object.entries(chartPalettes).map(([id, palette]) => ({
  id: `chart-${id}`,
  label: palette.label,
  effect: 'flat',
  background: 'transparent',
  border: 'transparent',
  titleColor: 'var(--pcm-canvas-text)',
  contentColor: 'var(--pcm-canvas-text)',
  chartColors: [...palette.colors],
}))
type CanvasResizeDrag = { kind: 'widget' | 'group'; id: string; pointerId: number; startX: number; startY: number; stepWidth: number; columns: number; startSpan: number; startHeight: number; startWidth: number; startScale: number; aspectRatio: number; aspectLocked: boolean; edge?: 'se' | 'top' | 'left' | 'right' | 'bottom'; startTop?: number; startLeft?: number }
type CanvasWidgetMove = { id: string; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; left: number; top: number; groupId: string; moved: boolean; targetActionId?: string }
type CanvasLayout = {
  version: 4
  groupOrder: string[]
  groupWidths: Record<string, number>
  groupHeights: Record<string, number>
  groupColumns: Record<string, 1 | 2 | 3 | 4 | 6 | 8 | 12>
  widgetOrder: string[]
  placements: Record<string, CanvasPlacement>
  customGroups: PcmCanvasGroup[]
  magnetEnabled: boolean
  blankLayout?: boolean
}
type SavedCanvasLayout = { id: string; name: string; layout: CanvasLayout }

const stylePlacementKeys = [
  'chartFocusTarget', 'cardFocusEffect', 'cardFocusDuration', 'showTrackingMarker',
  'chartVolumeEnabled', 'chartVolumeDirection',
  'chartVolume', 'legendHoverColor', 'legendHoverOpacity',
  'chartFocusEffect', 'chartFocusTrigger', 'chartFocusIntensity', 'chartFocusDuration', 'chartFocusColor', 'chartFocusDim',
  'chartGridStyle',
  'dataLabelOffset', 'legendTextColor', 'legendValueColor', 'legendPercentColor',
  'legendName', 'legendValue', 'legendPercent', 'legendSwatch', 'legendVisible', 'dataLabelMode', 'dataLabelPosition', 'dataLabelSize',
  'chartGridColor', 'chartGridWidth', 'showChartAxes',
  'showChartCenter', 'chartCenterColor', 'chartCenterSize', 'chartCenterPosition', 'chartCenterLabel', 'chartCenterFormat', 'pieCalloutDistance', 'pieCallouts', 'chartLabelColor', 'legendGap', 'legendLabelFormat', 'legendSize',
  'gradientEnd', 'chartCenterTextSize', 'chartCenterGap', 'pieLabelContent', 'linkTimeMetricColors', 'metricNameSize', 'metricValueSize', 'metricBarWidth', 'metricBarHeight', 'mttrUnit', 'mtbfUnit',
  'ornamentColor', 'ornamentPulses',
  'ornament', 'ornamentCorner',
  'chartLabelWidth', 'chartRowGap',
  'cornerCut',
  'shape', 'hoverColor',
  'textTilt', 'textDepth',
  'cardTilt', 'cardInset',
  'subtitleSize',
  'accentPosition',
  'chartDiameter', 'chartLabels', 'legendPosition',
  'chartLineWidth', 'chartPointSize', 'chartBorderWidth', 'chartDepth',
  'chartOpacity', 'chartStyle', 'customColor', 'customColors', 'cardBackground', 'cardBackgroundOpacity',
  'cardBorder', 'cardBorderStyle', 'cardRadius', 'cardEffect', 'titleColor', 'contentColor', 'accentColor',
  'iconColor', 'showTitle', 'showActionLabel', 'titleSize', 'titleAlign', 'contentSize', 'iconSize',
  'iconPosition', 'buttonStyle', 'buttonRadius', 'buttonColor', 'buttonBackground', 'buttonBorder',
  'buttonText', 'cardShadow', 'titleShadow', 'contentShadow', 'iconShadow', 'paletteId',
] as const
type CanvasStyleValues = Partial<Pick<CanvasPlacement, typeof stylePlacementKeys[number]>>

const boardGroup: PcmCanvasGroup = { id: 'board', label: 'Painel' }
const professionalLayoutId = '__professional_default__'
const storageKey = 'vorqix.pcm.dashboard-canvas.v4'
const dashboardThemeStorageKey = 'vorqix.pcm.dashboard-theme.v1'
const previousStorageKeys = ['vorqix.pcm.dashboard-canvas.v3', 'vorqix.pcm.dashboard-canvas.v2']
const namedLayoutsStorageKey = 'vorqix.pcm.dashboard-canvas.presets.v1'
const selectedLayoutStorageKey = 'vorqix.pcm.dashboard-canvas.selected-layout.v1'
const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
function isDarkColor(value: string | undefined, theme: 'light' | 'dark' | 'ice'): boolean {
  if (!value || value === 'transparent') return theme === 'dark'
  const match = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!match) return theme === 'dark'
  const [red, green, blue] = [1, 2, 3].map(index => Number.parseInt(match[index] ?? 'ff', 16))
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 142
}

function mixHexColor(color: string, target: string, amount: number): string {
  const source = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  const destination = target.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!source || !destination) return color
  const clamp = Math.max(0, Math.min(1, amount))
  const channels = [1, 2, 3].map(index => Math.round(Number.parseInt(source[index], 16) * (1 - clamp) + Number.parseInt(destination[index], 16) * clamp).toString(16).padStart(2, '0'))
  return `#${channels.join('')}`
}

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
      return { ...item, layout: { ...item.layout, version: 4, groupHeights: item.layout.groupHeights ?? {}, placements } }
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
  const groupAppearance: Record<string, Pick<PcmCanvasGroup, 'background' | 'backgroundOpacity' | 'border' | 'radius' | 'titleColor' | 'shadow'>> = {
    'group-prioridades': { background: '#10283b', backgroundOpacity: 76, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-carga': { background: '#0d263a', backgroundOpacity: 70, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-confiabilidade': { background: '#0b2a42', backgroundOpacity: 78, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-ativos': { background: '#10283b', backgroundOpacity: 70, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-planejamento': { background: '#0d2d37', backgroundOpacity: 72, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-materiais': { background: '#142940', backgroundOpacity: 72, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
    'group-resultados': { background: '#10283b', backgroundOpacity: 72, border: 'none', radius: 'soft', titleColor: '#d9ebf7', shadow: 0 },
  }
  const groupColumns: CanvasLayout['groupColumns'] = {
    board: 4,
    'group-prioridades': 4,
    'group-carga': 3,
    'group-confiabilidade': 3,
    'group-ativos': 2,
    'group-planejamento': 3,
    'group-materiais': 3,
    'group-resultados': 3,
  }
  const baseCard: Partial<CanvasPlacement> = {
    paletteId: 'duoOcean',
    cardBackground: 'transparent',
    cardBackgroundOpacity: 0,
    cardBorder: 'none',
    cardBorderStyle: 'solid',
    cardEffect: 'flat',
    cardRadius: 10,
    titleColor: '#d9ebf7',
    contentColor: '#f5faff',
    accentColor: '#5bbcf5',
    iconColor: '#79caff',
    titleSize: 12,
    contentSize: 25,
    iconSize: 22,
    accentPosition: 'left',
    chartFocusTarget: 'chart',
    chartFocusEffect: 'glow',
    chartFocusTrigger: 'both',
    chartFocusIntensity: 46,
    chartFocusDuration: 520,
    chartFocusColor: '#72c8fb',
    chartFocusDim: 66,
  }
  const metricAccents: Record<string, Partial<CanvasPlacement>> = {
    'attention-stopped': { paletteId: 'sunset', accentColor: '#ff6f7d', iconColor: '#ff8490', chartFocusColor: '#ff7181' },
    'attention-critical': { paletteId: 'warm', accentColor: '#ff9653', iconColor: '#ffa568', chartFocusColor: '#ff9454' },
    'attention-overdue': { paletteId: 'warm', accentColor: '#f2c45a', iconColor: '#f6d273', chartFocusColor: '#f2c45a' },
    'preventives-next': { paletteId: 'green', accentColor: '#4ed4b1', iconColor: '#65dfbd', chartFocusColor: '#4ed4b1' },
    'operational-backlog': { accentColor: '#65bdf2', iconColor: '#81cef8' },
    'operational-open-orders': { accentColor: '#63c7eb', iconColor: '#79d3f2' },
    'operational-active-technicians': { paletteId: 'teal', accentColor: '#4ac9bf', iconColor: '#65ddd2' },
    'operational-unestimated': { paletteId: 'violet', accentColor: '#b3a1ff', iconColor: '#c6b8ff' },
    'reliability-availability': { paletteId: 'green', accentColor: '#58d5a7', iconColor: '#70dfb8' },
    'reliability-failures': { paletteId: 'warm', accentColor: '#f6b85a', iconColor: '#ffd077' },
    'reliability-recurrence': { paletteId: 'violet', accentColor: '#b09af7', iconColor: '#c4b1ff' },
  }
  const analyticCards: Record<string, Partial<CanvasPlacement>> = {
    'mttr-mtbf-comparison': { span: 12, paletteId: 'duoOcean', cardEffect: 'glass-blue', cardBackground: '#14354d', cardBackgroundOpacity: 62, chartStyle: 'bar-depth', chartVolumeEnabled: true, chartVolume: 5, chartVolumeDirection: 90, chartFocusEffect: 'reflection', chartFocusTarget: 'both' },
    'monthly-mttr': { span: 24, paletteId: 'duoOcean', cardEffect: 'glass-blue', cardBackground: '#123149', cardBackgroundOpacity: 54, chartStyle: 'smooth', chartLineWidth: 3, chartPointSize: 5, chartGridStyle: 'dashed', chartGridColor: '#60869f', chartGridWidth: 1, showChartAxes: true, customColors: ['#63c8ff', '#76dec7', '#a9d8ff', '#2e95cd', '#4fb7a1', '#8abce7'], gradientEnd: '#63d4bd', chartFocusEffect: 'sweep', chartFocusTarget: 'chart', chartFocusIntensity: 52 },
    'sector-failures': { span: 12, paletteId: 'warm', cardEffect: 'glass', cardBackground: '#153247', cardBackgroundOpacity: 52, chartStyle: 'gradient', customColors: ['#f7ae54', '#ff7862', '#efcb78', '#f18d53', '#f4b77a', '#e36c61'], gradientEnd: '#ff6c58', chartFocusEffect: 'flash', chartFocusTarget: 'chart' },
    'asset-failures': { span: 12, mode: 'donut', paletteId: 'duoOcean', cardEffect: 'glass-blue', cardBackground: '#14354d', cardBackgroundOpacity: 52, chartStyle: 'depth', chartVolumeEnabled: true, chartVolume: 7, chartVolumeDirection: 90, chartDiameter: 86, chartLabels: 'percent', legendPosition: 'right', legendName: true, legendValue: true, legendPercent: true, legendSwatch: true, legendGap: 8, chartFocusEffect: 'lift', chartFocusTarget: 'chart' },
    'team-executions': { span: 12, paletteId: 'teal', cardEffect: 'glass-mint', cardBackground: '#103946', cardBackgroundOpacity: 50, chartStyle: 'rounded', chartFocusEffect: 'pulse' },
    'result-team-hours': { span: 12, paletteId: 'green', cardEffect: 'glass-mint', cardBackground: '#103946', cardBackgroundOpacity: 50, chartStyle: 'rounded', chartFocusEffect: 'pulse' },
  }
  const placements = Object.fromEntries(widgets.map(widget => {
    const groupId = defaultGroupForWidget(widget)
    const span = groupId === 'group-prioridades' ? 6 : groupId === 'group-carga' || groupId === 'group-planejamento' || groupId === 'group-materiais' || groupId === 'group-resultados' ? 8 : 12
    const placement: CanvasPlacement = {
      groupId,
      span,
      mode: widget.defaultMode,
      paletteId: 'duoOcean',
      ...baseCard,
      ...metricAccents[widget.id],
      ...analyticCards[widget.id],
      ...(widget.action ? { showTitle: false, buttonStyle: 'minimal' as const } : {}),
    }
    return [widget.id, placement]
  }))
  const sortedWidgets = [...widgets].sort((left, right) => {
    const groupDifference = professionalGroups.findIndex(group => group.id === defaultGroupForWidget(left)) - professionalGroups.findIndex(group => group.id === defaultGroupForWidget(right))
    if (groupDifference !== 0) return groupDifference
    const order = ['attention-stopped', 'attention-critical', 'attention-overdue', 'preventives-next', 'operational-backlog', 'operational-open-orders', 'operational-active-technicians', 'operational-unestimated', 'reliability-availability', 'reliability-failures', 'reliability-recurrence', 'mttr-mtbf-comparison', 'monthly-mttr', 'sector-failures', 'asset-failures', 'team-executions', 'result-preventives-on-time', 'result-preventives-late', 'result-material-cost', 'result-low-stock', 'result-orders-open', 'result-orders-closed', 'result-team-hours']
    return order.indexOf(left.id) - order.indexOf(right.id)
  })
  return {
    version: 4,
    groupOrder: [boardGroup.id, ...professionalGroups.map(group => group.id)],
    groupWidths: { board: 24, ...Object.fromEntries(professionalGroups.map(group => [group.id, 24])) },
    groupHeights: {},
    groupColumns,
    widgetOrder: sortedWidgets.map(widget => widget.id),
    placements,
    customGroups: professionalGroups.map(group => ({ ...group, ...groupAppearance[group.id] })),
    magnetEnabled: true,
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
  if (storedId === professionalLayoutId || storedId === 'preset-blank' || storedId === 'preset-reliability' || savedLayouts.some(item => item.id === storedId)) return storedId
  if (storedId === 'preset-compact' || storedId === 'preset-operations') return professionalLayoutId
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
    const rawCustomGroups = Array.isArray(parsed.customGroups)
      ? parsed.customGroups.filter(item => item && typeof item.id === 'string' && item.id.startsWith('group-') && typeof item.label === 'string' && item.label.trim()).slice(0, 20)
      : []
    const validCustomGroupIds = new Set([...professionalGroups.map(group => group.id), ...rawCustomGroups.map(group => group.id)])
    const customGroups: PcmCanvasGroup[] = rawCustomGroups.map(group => ({
      ...group,
      ...(group.radius === 'square' || group.radius === 'soft' || group.radius === 'round' ? { radius: group.radius } : { radius: undefined }),
      ...(typeof group.parentId === 'string' && validCustomGroupIds.has(group.parentId) && group.parentId !== group.id ? { parentId: group.parentId } : { parentId: undefined }),
    }))
    const groupsById = new Map(customGroups.map(group => [group.id, group]))
    for (const group of customGroups) {
      const ancestors = new Set([group.id])
      let parentId = group.parentId
      while (parentId) {
        if (ancestors.has(parentId)) {
          group.parentId = undefined
          break
        }
        ancestors.add(parentId)
        parentId = groupsById.get(parentId)?.parentId
      }
    }
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
      const chartOpacityValue = Number((saved as CanvasPlacement | undefined)?.chartOpacity)
      const chartOpacity = Number.isFinite(chartOpacityValue) ? Math.max(0, Math.min(100, Math.round(chartOpacityValue))) : undefined
      const stored = saved as CanvasPlacement | undefined
      const customColors = Array.isArray(stored?.customColors) ? stored.customColors.slice(0, 6).map(color => isHexColor(color) ? color : '') : undefined
      const cardBackground = stored?.cardBackground === 'transparent' ? 'transparent' : isHexColor(stored?.cardBackground) ? stored.cardBackground : undefined
      const cardBorder = stored?.cardBorder === 'none' ? 'none' : isHexColor(stored?.cardBorder) ? stored.cardBorder : undefined
      const cardBorderStyle = ['solid', 'dashed', 'dotted', 'double'].includes(String(stored?.cardBorderStyle)) ? stored?.cardBorderStyle as CanvasPlacement['cardBorderStyle'] : undefined
      const cardRadius = parseCornerRadius(stored?.cardRadius)
      const contentColor = isHexColor(stored?.contentColor) ? stored.contentColor : undefined
      const backgroundOpacityValue = Number(stored?.cardBackgroundOpacity)
      const cardBackgroundOpacity = Number.isFinite(backgroundOpacityValue) ? Math.max(0, Math.min(100, Math.round(backgroundOpacityValue))) : undefined
      const customTitle = typeof stored?.customTitle === 'string' ? stored.customTitle.trim().slice(0, 60) : undefined
      const customSubtitle = typeof stored?.customSubtitle === 'string' ? stored.customSubtitle.trim().slice(0, 100) : undefined
      const titleSize = Number.isInteger(stored?.titleSize) && Number(stored?.titleSize) >= 10 && Number(stored?.titleSize) <= 25 ? Number(stored?.titleSize) as CanvasPlacement['titleSize'] : undefined
      const cardEffect = ['flat', 'glass', 'glass-blue', 'glass-mint', 'gradient', 'elevated', 'outline'].includes(String(stored?.cardEffect)) ? stored?.cardEffect as CanvasPlacement['cardEffect'] : undefined
      const validShape = ['wide', 'square', 'column', 'banner', 'portrait', 'circle', 'oval'].includes(String(stored?.shape)) ? stored?.shape as CanvasPlacement['shape'] : undefined
      const buttonStyle = ['solid', 'outline', 'minimal', 'icon', 'soft'].includes(String(stored?.buttonStyle)) ? stored?.buttonStyle as CanvasPlacement['buttonStyle'] : undefined
      const buttonRadius = ['square', 'soft', 'pill'].includes(String(stored?.buttonRadius)) ? stored?.buttonRadius as CanvasPlacement['buttonRadius'] : undefined
      const contentSize = Number.isInteger(stored?.contentSize) && Number(stored?.contentSize) >= 8 && Number(stored?.contentSize) <= 64 ? Number(stored?.contentSize) : undefined
      const chartStyle = ['default', 'oval', 'exploded', 'depth', 'smooth', 'minimal', 'rounded', 'gradient', 'bar-depth'].includes(String(stored?.chartStyle)) ? stored?.chartStyle as CanvasPlacement['chartStyle'] : undefined
      const titleAlign = ['left', 'center', 'right'].includes(String(stored?.titleAlign)) ? stored?.titleAlign as CanvasPlacement['titleAlign'] : undefined
      const iconPosition = ['inline', 'top', 'right'].includes(String(stored?.iconPosition)) ? stored?.iconPosition as CanvasPlacement['iconPosition'] : undefined
      const iconSizeValue = Number(stored?.iconSize)
      const iconSize = Number.isInteger(iconSizeValue) && iconSizeValue >= 12 && iconSizeValue <= 40 ? iconSizeValue : undefined
      return [widget.id, { groupId, span, mode, paletteId, ...(left !== undefined ? { left } : {}), ...(top !== undefined ? { top } : {}), ...(chartOpacity !== undefined ? { chartOpacity } : {}), ...(chartStyle ? { chartStyle } : {}), ...(height ? { height } : {}), ...(isHexColor(stored?.customColor) ? { customColor: stored.customColor } : {}), ...(customColors ? { customColors } : {}), ...(cardBackground ? { cardBackground } : {}), ...(cardBackgroundOpacity !== undefined ? { cardBackgroundOpacity } : {}), ...(cardBorder ? { cardBorder } : {}), ...(cardBorderStyle ? { cardBorderStyle } : {}), ...(cardRadius ? { cardRadius } : {}), ...(cardEffect ? { cardEffect } : {}), ...(isHexColor(stored?.titleColor) ? { titleColor: stored.titleColor } : {}), ...(contentColor ? { contentColor } : {}), ...(isHexColor(stored?.accentColor) ? { accentColor: stored.accentColor } : {}), ...(isHexColor(stored?.iconColor) ? { iconColor: stored.iconColor } : {}), ...(customTitle !== undefined ? { customTitle } : {}), ...(customSubtitle !== undefined ? { customSubtitle } : {}), ...(typeof stored?.showTitle === 'boolean' ? { showTitle: stored.showTitle } : {}), ...(typeof stored?.showActionLabel === 'boolean' ? { showActionLabel: stored.showActionLabel } : {}), ...(titleSize ? { titleSize } : {}), ...(titleAlign ? { titleAlign } : {}), ...(contentSize ? { contentSize } : {}), ...(iconSize ? { iconSize } : {}), ...(iconPosition ? { iconPosition } : {}), ...(validShape ? { shape: validShape } : {}), ...(buttonStyle ? { buttonStyle } : {}), ...(buttonRadius ? { buttonRadius } : {}), ...(isHexColor(stored?.buttonColor) ? { buttonColor: stored.buttonColor } : {}), ...(stored?.buttonBackground === 'transparent' || isHexColor(stored?.buttonBackground) ? { buttonBackground: stored.buttonBackground } : {}), ...(stored?.buttonBorder === 'none' || isHexColor(stored?.buttonBorder) ? { buttonBorder: stored.buttonBorder } : {}), ...(isHexColor(stored?.buttonText) ? { buttonText: stored.buttonText } : {}) }]
    }))
    const chartRanges = { chartDiameter: [80, 280], chartLineWidth: [1, 8], chartPointSize: [2, 10], chartBorderWidth: [0, 4], chartDepth: [0, 32] } as const
    for (const widget of widgets) {
      const placement = placements[widget.id] as CanvasPlacement
      const stored = parsed.placements?.[widget.id] as CanvasPlacement | undefined
      if (isHexColor(stored?.gradientEnd)) placement.gradientEnd = stored.gradientEnd
      if (isHexColor(stored?.ornamentColor)) placement.ornamentColor = stored.ornamentColor
      if (typeof stored?.ornamentPulses === 'number' && Number.isFinite(stored.ornamentPulses)) placement.ornamentPulses = Math.max(0, Math.min(10, stored.ornamentPulses))
      if (stored?.ornament && ['none', 'fold', 'dot', 'notch'].includes(stored.ornament)) placement.ornament = stored.ornament
      if (stored?.ornamentCorner && ['tl', 'tr', 'bl', 'br'].includes(stored.ornamentCorner)) placement.ornamentCorner = stored.ornamentCorner
      if (typeof stored?.chartLabelWidth === 'number' && Number.isFinite(stored.chartLabelWidth)) placement.chartLabelWidth = Math.max(15, Math.min(60, stored.chartLabelWidth))
      if (typeof stored?.chartRowGap === 'number' && Number.isFinite(stored.chartRowGap)) placement.chartRowGap = Math.max(4, Math.min(40, stored.chartRowGap))
      if (typeof stored?.cornerCut === 'number' && Number.isFinite(stored.cornerCut)) placement.cornerCut = Math.max(0, Math.min(40, stored.cornerCut))
      const savedRadius = parseCornerRadius(stored?.cardRadius)
      if (savedRadius !== undefined) placement.cardRadius = savedRadius
      if (isHexColor(stored?.hoverColor)) placement.hoverColor = stored.hoverColor
      for (const key of ['titleShadow', 'contentShadow', 'textDepth', 'textTilt'] as const) {
        const value = stored?.[key]
        if (typeof value === 'number' && Number.isFinite(value)) placement[key] = Math.max(key === 'textTilt' ? -20 : 0, Math.min(20, value))
      }
      if (typeof stored?.cardTilt === 'number' && Number.isFinite(stored.cardTilt)) placement.cardTilt = Math.max(-12, Math.min(12, stored.cardTilt))
      if (typeof stored?.cardInset === 'number' && Number.isFinite(stored.cardInset)) placement.cardInset = Math.max(0, Math.min(12, stored.cardInset))
      if (typeof stored?.subtitleSize === 'number' && Number.isFinite(stored.subtitleSize)) placement.subtitleSize = Math.max(8, Math.min(25, stored.subtitleSize))
      if (stored?.accentPosition && ['left', 'right', 'top', 'bottom', 'corners', 'none'].includes(stored.accentPosition)) placement.accentPosition = stored.accentPosition
      if (typeof stored?.cardShadow === 'number' && Number.isFinite(stored.cardShadow)) placement.cardShadow = Math.max(0, Math.min(24, stored.cardShadow))
      for (const key of ['legendName', 'legendValue', 'legendPercent', 'legendSwatch', 'legendVisible'] as const) if (typeof stored?.[key] === 'boolean') placement[key] = stored[key]
      if (stored?.dataLabelMode && ['default', 'none', 'value', 'percent', 'both'].includes(stored.dataLabelMode)) placement.dataLabelMode = stored.dataLabelMode
      if (stored?.dataLabelPosition && ['above', 'center', 'left', 'right'].includes(stored.dataLabelPosition)) placement.dataLabelPosition = stored.dataLabelPosition
      if (typeof stored?.dataLabelSize === 'number' && Number.isFinite(stored.dataLabelSize)) placement.dataLabelSize = Math.max(8, Math.min(32, stored.dataLabelSize))
      if (typeof stored?.dataLabelOffset === 'number' && Number.isFinite(stored.dataLabelOffset)) placement.dataLabelOffset = Math.max(0, Math.min(24, stored.dataLabelOffset))
      for (const key of ['legendTextColor', 'legendValueColor', 'legendPercentColor'] as const) if (typeof stored?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(stored[key])) placement[key] = stored[key]
      if (typeof stored?.showChartAxes === 'boolean') placement.showChartAxes = stored.showChartAxes
      if (typeof stored?.chartGridColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.chartGridColor)) placement.chartGridColor = stored.chartGridColor
      if (typeof stored?.chartVolumeEnabled === 'boolean') placement.chartVolumeEnabled = stored.chartVolumeEnabled
      if (typeof stored?.chartVolumeDirection === 'number' && Number.isFinite(stored.chartVolumeDirection)) placement.chartVolumeDirection = Math.max(0, Math.min(360, stored.chartVolumeDirection))
      if (typeof stored?.chartVolume === 'number' && Number.isFinite(stored.chartVolume)) placement.chartVolume = Math.max(0, Math.min(18, stored.chartVolume))
      if (typeof stored?.legendHoverOpacity === 'number' && Number.isFinite(stored.legendHoverOpacity)) placement.legendHoverOpacity = Math.max(0, Math.min(100, stored.legendHoverOpacity))
      if (typeof stored?.legendHoverColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.legendHoverColor)) placement.legendHoverColor = stored.legendHoverColor
      if (stored?.chartFocusEffect && ['none', 'flash', 'glow', 'sweep', 'link', 'vibrate', 'reflection', 'pulse', 'lift', 'saturation'].includes(stored.chartFocusEffect)) placement.chartFocusEffect = stored.chartFocusEffect
      if (stored?.chartFocusTarget && ['card', 'chart', 'both'].includes(stored.chartFocusTarget)) placement.chartFocusTarget = stored.chartFocusTarget
      if (stored?.chartFocusTrigger && ['hover', 'selection', 'both'].includes(stored.chartFocusTrigger)) placement.chartFocusTrigger = stored.chartFocusTrigger
      if (typeof stored?.chartFocusColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.chartFocusColor)) placement.chartFocusColor = stored.chartFocusColor
      for (const [key, minimum, maximum] of [['chartFocusIntensity', 0, 100], ['chartFocusDuration', 200, 1600], ['chartFocusDim', 0, 100]] as const) if (typeof stored?.[key] === 'number' && Number.isFinite(stored[key])) placement[key] = Math.max(minimum, Math.min(maximum, stored[key]))
      if (stored?.chartGridStyle && ['solid', 'dashed', 'dotted', 'double'].includes(stored.chartGridStyle)) placement.chartGridStyle = stored.chartGridStyle
      if (typeof stored?.chartGridWidth === 'number' && Number.isFinite(stored.chartGridWidth)) placement.chartGridWidth = Math.max(0, Math.min(3, stored.chartGridWidth))
      if (typeof stored?.showChartCenter === 'boolean') placement.showChartCenter = stored.showChartCenter
      if (typeof stored?.chartCenterLabel === 'boolean') placement.chartCenterLabel = stored.chartCenterLabel
      if (typeof stored?.pieCallouts === 'boolean') placement.pieCallouts = stored.pieCallouts
      if (stored?.chartCenterPosition && ['center', 'top', 'bottom', 'left', 'right'].includes(stored.chartCenterPosition)) placement.chartCenterPosition = stored.chartCenterPosition
      if (stored?.legendLabelFormat && ['full', 'code', 'name'].includes(stored.legendLabelFormat)) placement.legendLabelFormat = stored.legendLabelFormat
      if (typeof stored?.chartCenterColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.chartCenterColor)) placement.chartCenterColor = stored.chartCenterColor
      if (typeof stored?.chartCenterSize === 'number' && Number.isFinite(stored.chartCenterSize)) placement.chartCenterSize = Math.max(8, Math.min(48, stored.chartCenterSize))
      if (typeof stored?.legendSize === 'number' && Number.isFinite(stored.legendSize)) placement.legendSize = Math.max(8, Math.min(32, stored.legendSize))
      if (typeof stored?.chartLabelColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.chartLabelColor)) placement.chartLabelColor = stored.chartLabelColor
      if (typeof stored?.legendGap === 'number' && Number.isFinite(stored.legendGap)) placement.legendGap = Math.max(0, Math.min(40, stored.legendGap))
      if (stored?.chartLabels && ['none', 'value', 'percent'].includes(stored.chartLabels)) placement.chartLabels = stored.chartLabels
      if (stored?.legendPosition && ['right', 'bottom', 'top', 'hidden'].includes(stored.legendPosition)) placement.legendPosition = stored.legendPosition
      for (const key of Object.keys(chartRanges) as Array<keyof typeof chartRanges>) {
        const value = stored?.[key]
        const [minimum, maximum] = chartRanges[key]
        if (typeof value === 'number' && Number.isFinite(value)) placement[key] = Math.max(minimum, Math.min(maximum, value))
      }
    }
    const validOrder = (Array.isArray(parsed.groupOrder) ? parsed.groupOrder : []).filter((id): id is string => typeof id === 'string' && groupIds.has(id))
    const validWidgetOrder = (Array.isArray(parsed.widgetOrder) ? parsed.widgetOrder : []).filter((id): id is string => typeof id === 'string' && widgetById.has(id))
    const groupWidths: CanvasLayout['groupWidths'] = { board: 24 }
    const groupHeights: CanvasLayout['groupHeights'] = {}
    const groupColumns: CanvasLayout['groupColumns'] = { board: 4 }
    for (const id of groupIds) {
      const width = Number(parsed.groupWidths?.[id])
      const columns = parsed.groupColumns?.[id]
      if (Number.isInteger(width) && width >= 1 && width <= (legacy ? 12 : 24)) groupWidths[id] = legacy ? Math.max(1, Math.min(24, width * 2)) : width
      const height = Number((parsed as Partial<CanvasLayout>).groupHeights?.[id])
      if (Number.isInteger(height) && height >= 80 && height <= 1600) groupHeights[id] = height
      if ([1, 2, 3, 4, 6, 8, 12].includes(Number(columns))) groupColumns[id] = columns as CanvasLayout['groupColumns'][string]
    }
    return {
      version: 4,
      groupOrder: [...new Set([boardGroup.id, ...validOrder, ...customGroups.map(group => group.id)])],
      groupWidths,
      groupHeights,
      groupColumns,
      widgetOrder: [...new Set(validWidgetOrder)],
      placements,
      customGroups,
      magnetEnabled: typeof parsed.magnetEnabled === 'boolean' ? parsed.magnetEnabled : true,
      blankLayout: parsed.blankLayout === true,
    }
  } catch {
    return defaults
  }
}

function sameLayout(left: CanvasLayout, right: CanvasLayout) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nearestSnap(value: number, candidates: number[], threshold: number) {
  const candidate = candidates.reduce<number | null>((nearest, next) => {
    if (Math.abs(next - value) > threshold) return nearest
    return nearest === null || Math.abs(next - value) < Math.abs(nearest - value) ? next : nearest
  }, null)
  return candidate ?? value
}

function nextMode(mode: PcmCanvasMode, modes: PcmCanvasWidget['modes']) {
  const index = modes.findIndex(item => item.id === mode)
  return modes[(index + 1) % modes.length]
}

export function PcmDashboardCanvas({ categories, widgets: sourceWidgets, segmentFilters = [], helpContent, toolbarContent, onOpenHistory, onPrintCanvas }: { categories: PcmCanvasCategory[]; widgets: PcmCanvasWidget[]; segmentFilters?: PcmCanvasSegmentFilter[]; helpContent?: ReactNode; toolbarContent?: ReactNode; onOpenHistory?: () => void; onPrintCanvas?: (board: HTMLElement, filters: string[]) => void }) {
  const [duplicateIds, setDuplicateIds] = useState<string[]>(() => { try { const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null"); return Object.keys(saved?.placements ?? {}).filter(id => id.includes("::copy::")) } catch { return [] } })
  const widgets = useMemo(() => [...sourceWidgets, ...duplicateIds.flatMap(id => { const source = sourceWidgets.find(widget => widget.id === id.split("::copy::")[0]); return source ? [{ ...source, id }] : [] })], [sourceWidgets, duplicateIds])
  const [layout, setLayout] = useState(() => readInitialLayout(widgets))
  const [savedLayout, setSavedLayout] = useState(() => readInitialLayout(widgets))
  const [savedLayouts, setSavedLayouts] = useState<SavedCanvasLayout[]>(() => readSavedLayouts())
  const [selectedLayoutId, setSelectedLayoutId] = useState(() => readInitialSelectedLayoutId(widgets, readSavedLayouts()))
  const [layoutName, setLayoutName] = useState('')
  const [savingNamedLayout, setSavingNamedLayout] = useState(false)
  const layoutImportRef = useRef<HTMLInputElement>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState('all')
  const [groupTarget, setGroupTarget] = useState('group-prioridades')
  const [filterCategory, setFilterCategory] = useState('all')
  const [segmentFiltersOpen, setSegmentFiltersOpen] = useState(false)
  const [segments, setSegments] = useState<PcmCanvasSegments>({})
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [snapMode, setSnapMode] = useState<'magnet' | 'alignment'>('magnet')
  const [spacing, setSpacing] = useState(16)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renamingGroupLabel, setRenamingGroupLabel] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [dashboardTheme, setDashboardTheme] = useState<'light' | 'ice' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem(dashboardThemeStorageKey)
      return saved === 'ice' || saved === 'dark' ? saved : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [paletteWidgetId, setPaletteWidgetId] = useState<string | null>(null)
  const [movingActionWidgetId, setMovingActionWidgetId] = useState<string | null>(null)
  const [actionGroupPrompt, setActionGroupPrompt] = useState<{ sourceId: string; targetId: string; left: number; top: number } | null>(null)
  const [styleLibraryOpen, setStyleLibraryOpen] = useState(false)
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right')
  const [editingLibraryStyle, setEditingLibraryStyle] = useState<CanvasLibraryStyle | null>(null)
  const [savedStyleProperties, setSavedStyleProperties] = useState<Record<string, CanvasLibraryStyle>>(() => {
    try { const value = JSON.parse(window.localStorage.getItem('vorqix.pcm.library-styles.v1') ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
  })
  const [panelAppearance, setPanelAppearance] = useState(() => {
    const defaults = { background: 'transparent', border: '#cbd8e3', width: 0 }
    try {
      const saved = JSON.parse(window.localStorage.getItem('vorqix.pcm.panel-appearance.v1') ?? 'null')
      return saved && (saved.background === 'transparent' || isHexColor(saved.background)) && isHexColor(saved.border) && Number.isInteger(saved.width) && saved.width >= 0 && saved.width <= 6 ? { background: String(saved.background), border: String(saved.border), width: Number(saved.width) } : defaults
    } catch { return defaults }
  })
  const [areaBackground, setAreaBackground] = useState(() => {
    try { const saved = JSON.parse(window.localStorage.getItem('vorqix.pcm.panel-appearance.v1') ?? 'null'); return isHexColor(saved?.areaBackground) ? String(saved.areaBackground) : '' } catch { return '' }
  })
  const [toolbarHidden, setToolbarHidden] = useState<string[]>(() => {
    try { const saved = JSON.parse(window.localStorage.getItem('vorqix.pcm.panel-appearance.v1') ?? 'null')?.toolbarHidden; return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && toolbarFeatures.some(feature => feature.id === id)) : [] } catch { return [] }
  })
  const [panelOptions, setPanelOptions] = useState(() => {
    const defaults = { text: '', noticeBackground: '', noticeText: '', showNotices: true, showUpdated: true, showGroupTitles: true }
    try {
      const saved = JSON.parse(window.localStorage.getItem('vorqix.pcm.panel-appearance.v1') ?? 'null')?.options
      if (!saved || typeof saved !== 'object') return defaults
      return { text: isHexColor(saved.text) ? String(saved.text) : '', noticeBackground: isHexColor(saved.noticeBackground) ? String(saved.noticeBackground) : '', noticeText: isHexColor(saved.noticeText) ? String(saved.noticeText) : '', showNotices: saved.showNotices !== false, showUpdated: saved.showUpdated !== false, showGroupTitles: saved.showGroupTitles !== false }
    } catch { return defaults }
  })
  useEffect(() => {
    const dashboard = boardRef.current?.closest<HTMLElement>('.pcm-dashboard')
    if (!dashboard) return
    const surfaces = [dashboard, dashboard.closest<HTMLElement>('.app-content'), dashboard.closest<HTMLElement>('.manager-app-stage')].filter((element): element is HTMLElement => Boolean(element))
    const previous = surfaces.map(element => element.style.background)
    if (areaBackground) surfaces.forEach(element => { element.style.background = areaBackground })
    const text = panelOptions.text || (areaBackground ? isDarkColor(areaBackground, dashboardTheme) ? '#f1f7fc' : '#17354d' : '')
    dashboard.style.setProperty('--pcm-area-text', text || 'var(--pcm-ink)')
    dashboard.style.setProperty('--pcm-notice-background', panelOptions.noticeBackground || 'var(--pcm-panel)')
    dashboard.style.setProperty('--pcm-notice-text', panelOptions.noticeText || text || 'var(--pcm-ink)')
    dashboard.dataset.hideNotices = String(!panelOptions.showNotices)
    dashboard.dataset.hideUpdated = String(!panelOptions.showUpdated)
    dashboard.dataset.hideGroupTitles = String(!panelOptions.showGroupTitles)
    return () => { surfaces.forEach((element, index) => { element.style.background = previous[index] }); ['--pcm-area-text','--pcm-notice-background','--pcm-notice-text'].forEach(key => dashboard.style.removeProperty(key)); delete dashboard.dataset.hideNotices; delete dashboard.dataset.hideUpdated; delete dashboard.dataset.hideGroupTitles }
  }, [areaBackground, panelOptions, dashboardTheme])
  const [panelShadow, setPanelShadow] = useState(() => {
    try { const saved = JSON.parse(window.localStorage.getItem('vorqix.pcm.panel-appearance.v1') ?? 'null'); return typeof saved?.shadow === 'number' && Number.isFinite(saved.shadow) ? Math.max(0, Math.min(24, saved.shadow)) : 0 } catch { return 0 }
  })
  const [styleLibraryScope, setStyleLibraryScope] = useState<'selected' | 'all'>('all')
  useEffect(() => {
    if (selectedIds.length > 0) setStyleLibraryScope('selected')
  }, [selectedIds.length])
  const [styleLibraryCategory, setStyleLibraryCategory] = useState<'card' | 'button' | 'text' | 'border' | 'content' | 'chart' | 'effects'>('card')
  const [copiedStyle, setCopiedStyle] = useState<CanvasStyleValues | null>(null)
  const [pasteTarget, setPasteTarget] = useState<string | null>(null)
  const [pasteSections, setPasteSections] = useState<string[]>(['colors', 'effects', 'border', 'text', 'chart'])
  const [filterWidgetId, setFilterWidgetId] = useState<string | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [filterPosition, setFilterPosition] = useState({ left: 8, top: 8 })
  const [groupEditor, setGroupEditor] = useState<{ id: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.pcm-canvas__help-placement')) setHelpOpen(false)
      if (!target?.closest('.pcm-canvas__style-library, .pcm-canvas__style-library-trigger')) { setStyleLibraryOpen(false); setEditingLibraryStyle(null) }
      document.querySelectorAll<HTMLDetailsElement>('.pcm-canvas__layout-menu[open]').forEach(menu => { if (!target || !menu.contains(target)) menu.open = false })
    }
    const positionPanels = () => {
      const header = document.querySelector('.app-shell--manager > .topbar')?.getBoundingClientRect()
      document.documentElement.style.setProperty('--pcm-popup-top', `${Math.max(16, (header?.bottom ?? 92) + 12)}px`)
    }
    positionPanels()
    window.addEventListener('resize', positionPanels)
    document.addEventListener('pointerdown', closeOutside)
    return () => { window.removeEventListener('resize', positionPanels); document.removeEventListener('pointerdown', closeOutside) }
  }, [])
  useEffect(() => {
    const coordinatePopups = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null
      const trigger = target?.closest<HTMLElement>('.pcm-canvas button[aria-expanded], .pcm-canvas summary')
      if (!trigger) return
      if (!trigger.matches('.pcm-canvas__palette-trigger')) setPaletteWidgetId(null)
      if (!trigger.matches('.pcm-canvas__group-config-button')) setGroupEditor(null)
      if (!trigger.matches('.pcm-canvas__style-library-trigger')) { setStyleLibraryOpen(false); setEditingLibraryStyle(null) }
      if (!trigger.matches('.pcm-canvas__filter-trigger')) { setFilterWidgetId(null); setFilterAnchor(null) }
      if (!trigger.matches('.pcm-canvas__help-trigger')) setHelpOpen(false)
      if (trigger.getAttribute('aria-label') !== 'Adicionar indicador') setCatalogOpen(false)
      setContextMenu(null)
      document.querySelectorAll<HTMLDetailsElement>('.pcm-canvas__layout-menu[open], .pcm-canvas__theme-menu[open]').forEach(menu => {
        if (!menu.contains(trigger)) menu.open = false
      })
    }
    document.addEventListener('click', coordinatePopups, true)
    return () => document.removeEventListener('click', coordinatePopups, true)
  }, [])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const suppressActionClick = useRef<string | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState('')
  const [contextMenu, setContextMenu] = useState<{ kind: 'widget' | 'group'; id: string; x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ groupId: string; left?: number; top?: number } | null>(null)
  const resizeDrag = useRef<CanvasResizeDrag | null>(null)
  const widgetMoveDrag = useRef<CanvasWidgetMove | null>(null)

  useEffect(() => {
    const dashboard = boardRef.current?.closest<HTMLElement>('.pcm-dashboard')
    if (!dashboard) return
    dashboard.dataset.pcmTheme = dashboardTheme
    const appShell = dashboard.closest<HTMLElement>('.app-shell--manager')
    if (appShell) appShell.dataset.pcmTheme = dashboardTheme
    document.documentElement.dataset.pcmDashboardTheme = dashboardTheme
    try {
      window.localStorage.setItem(dashboardThemeStorageKey, dashboardTheme)
    } catch {
      // O tema continua ativo nesta sessão se o armazenamento local estiver indisponível.
    }
    return () => {
      if (dashboard.dataset.pcmTheme === dashboardTheme) delete dashboard.dataset.pcmTheme
      if (appShell?.dataset.pcmTheme === dashboardTheme) delete appShell.dataset.pcmTheme
      if (document.documentElement.dataset.pcmDashboardTheme === dashboardTheme) {
        delete document.documentElement.dataset.pcmDashboardTheme
      }
    }
  }, [dashboardTheme])

  useLayoutEffect(() => {
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
      const verticalChrome = (heading?.offsetHeight ?? 0)
        + (heading ? Number.parseFloat(window.getComputedStyle(heading).marginBottom) || 0 : 0)
        + (Number.parseFloat(style.paddingTop) || 0)
        + (Number.parseFloat(style.paddingBottom) || 0)
        + (Number.parseFloat(style.borderTopWidth) || 0)
        + (Number.parseFloat(style.borderBottomWidth) || 0)
      const positionedBottom = [...widgets.querySelectorAll<HTMLElement>(':scope > .pcm-canvas__widget.is-free-positioned')]
        .reduce((bottom, card) => Math.max(bottom, card.offsetTop + card.offsetHeight), 0)
      const flowBottom = [...widgets.querySelectorAll<HTMLElement>(':scope > .pcm-canvas__widget:not(.is-free-positioned), :scope > .pcm-canvas__group')]
        .reduce((bottom, child) => Math.max(bottom, child.offsetTop + child.offsetHeight), 0)
      const requestedHeight = Number.parseFloat(group.style.getPropertyValue('--pcm-group-min-height')) || 0
      const hasContent = Boolean(widgets.querySelector(':scope > .pcm-canvas__widget, :scope > .pcm-canvas__group'))
      const hiddenHeadingOffset = group.classList.contains('pcm-canvas__group--heading-hidden') ? 21 : 0
      const requestedContentHeight = Math.max(0, requestedHeight - verticalChrome - hiddenHeadingOffset)
      const contentHeight = hasContent ? Math.max(flowBottom, positionedBottom, requestedContentHeight) : requestedContentHeight
      widgets.style.minHeight = `${contentHeight}px`
      const boardStep = rowStep(board)
      const rowSpan = Math.max(1, Math.ceil((contentHeight + verticalChrome + boardStep.gap) / boardStep.step))
      group.style.setProperty('--pcm-group-row-span', String(rowSpan))
    }
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        if (element.classList.contains('pcm-canvas__widget')) {
          const height = Math.max(element.offsetHeight, 32)
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
    board.querySelectorAll<HTMLElement>('.pcm-canvas__widget, .pcm-canvas__widgets, .pcm-canvas__group-heading, .pcm-canvas__group').forEach(element => observer.observe(element))
    board.querySelectorAll<HTMLElement>('.pcm-canvas__group').forEach(updateGroupSpan)
    return () => observer.disconnect()
  }, [layout.groupOrder, layout.placements, layout.widgetOrder, layout.groupWidths, layout.groupHeights, layout.customGroups, search, filterCategory])

  useEffect(() => {
    if (!paletteWidgetId) return
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.pcm-canvas__palette-control, .pcm-canvas__palette-menu')) {
        setPaletteWidgetId(null)
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPaletteWidgetId(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [paletteWidgetId])

  useEffect(() => {
    if (!styleLibraryOpen) return
    const close = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('.pcm-canvas__style-library, .pcm-canvas__style-library-trigger')) {
        setStyleLibraryOpen(false)
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setStyleLibraryOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', closeOnEscape) }
  }, [styleLibraryOpen])

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
      const missing: PcmCanvasWidget[] = []
      if (Object.keys(placements).length === Object.keys(current.placements).length && missing.length === 0) return current
      return {
        ...current,
        placements: { ...placements, ...Object.fromEntries(missing.map(widget => { const groupId = defaultGroupForWidget(widget); return [widget.id, { groupId, span: groupId === 'group-prioridades' ? 6 : 12, mode: widget.defaultMode, paletteId: 'ocean', cardBackground: 'transparent', cardBackgroundOpacity: 0, cardBorder: 'none', cardEffect: 'flat', iconSize: 22, ...(widget.action ? { showTitle: false, buttonStyle: 'minimal' as const } : {}) }] })) },
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
  const libraryStyles: CanvasLibraryStyle[] = styleLibraryCategory === 'effects' ? focusEffectPresets : styleLibraryCategory === 'button'
    ? buttonStylePresets
    : styleLibraryCategory === 'text' || styleLibraryCategory === 'content'
      ? textStylePresets
      : styleLibraryCategory === 'border'
        ? borderStylePresets
        : styleLibraryCategory === 'chart'
          ? chartStylePresets
          : cardStylePresets as unknown as CanvasLibraryStyle[]
  const styleThemeGroup = (style: CanvasLibraryStyle) => style.background === 'transparent' || !/^#[0-9a-f]{6}$/i.test(style.background) ? 'adaptive' : isDarkColor(style.background, 'light') ? 'dark' : 'light'
  const themeStyleOrder = dashboardTheme === 'dark' ? ['dark', 'adaptive', 'light'] : ['light', 'adaptive', 'dark']
  const groupedLibraryStyles = themeStyleOrder.flatMap(group => libraryStyles.filter(style => styleThemeGroup(style) === group))

  function applyLibraryStyle(style: CanvasLibraryStyle & { line?: CanvasPlacement['cardBorderStyle'] | 'none' }) {
    const scopedIds = styleLibraryScope === 'all'
      ? layout.widgetOrder.filter(id => Boolean(layout.placements[id]))
      : selectedIds.filter(id => Boolean(layout.placements[id]))
    const chartModes: PcmCanvasMode[] = ['line', 'area', 'bar', 'pie', 'donut', 'comparison', 'progress']
    const targetIds = styleLibraryCategory === 'button'
      ? scopedIds.filter(id => Boolean(widgetById.get(id)?.action))
      : styleLibraryCategory === 'chart' || (styleLibraryCategory === 'effects' && style.properties?.chartFocusTarget === 'chart')
      ? scopedIds.filter(id => {
        const widget = widgetById.get(id)
        const placement = layout.placements[id]
        return Boolean(widget && placement && chartModes.includes(placement.mode) && widget.modes.some(mode => chartModes.includes(mode.id)))
      })
      : scopedIds.filter(id => !widgetById.get(id)?.action)
    if (!targetIds.length) { setSaveMessage('Selecione itens compatíveis ou escolha Todos os cards.'); return }
    setLayout(current => {
      const placements = { ...current.placements }
      for (const id of targetIds) {
        const placement = placements[id]
        if (!placement) continue
        if (styleLibraryCategory === 'effects') placements[id] = { ...placement, ...pickFocusEffect(style.properties ?? {}) }
        if (styleLibraryCategory === 'card') {
          const transparent = style.background === 'transparent'
          const themeDefault = style.id === 'standard'
          placements[id] = { ...placement, cardBackground: style.background, cardBackgroundOpacity: transparent ? 0 : style.effect?.startsWith('glass') ? 82 : 100, cardBorder: style.border === 'transparent' ? 'none' : style.border, cardEffect: style.effect, titleColor: themeDefault ? undefined : style.titleColor, contentColor: themeDefault ? undefined : style.contentColor, accentColor: themeDefault ? undefined : style.chartColors[0], iconColor: themeDefault ? undefined : style.chartColors[0] }
          placements[id] = { ...placements[id], customColors: themeDefault ? undefined : [...style.chartColors], customColor: undefined }
          placements[id] = { ...placements[id], ...style.properties }
        }
        if (styleLibraryCategory === 'button') {
          const buttonStyle = (style.id === 'button-filled' ? 'solid' : style.id === 'button-soft' ? 'soft' : style.id === 'button-minimal' ? 'minimal' : 'outline') as CanvasPlacement['buttonStyle']
          placements[id] = { ...placement, buttonStyle, buttonColor: style.chartColors[0], buttonBackground: style.background, buttonBorder: style.border, buttonText: style.contentColor }
          placements[id] = { ...placements[id], ...style.properties, cardEffect: style.effect, cardBackground: 'transparent', cardBackgroundOpacity: 0 }
        }
        if (styleLibraryCategory === 'text') placements[id] = { ...placement, ...style.properties, titleColor: style.titleColor, contentColor: style.contentColor }
        if (styleLibraryCategory === 'border') placements[id] = { ...placement, cardBorder: style.border === 'transparent' ? 'none' : style.border, cardBorderStyle: (('line' in style && style.line !== 'none') ? style.line : 'solid') as CanvasPlacement['cardBorderStyle'] }
        if (styleLibraryCategory === 'content') placements[id] = { ...placement, ...style.properties, contentColor: style.contentColor, iconColor: style.chartColors[0] }
        if (styleLibraryCategory === 'chart') placements[id] = { ...placement, customColors: [...style.chartColors], customColor: undefined, accentColor: style.chartColors[0], chartOpacity: 100 }
      }
      return { ...current, placements }
    })
    setSaveMessage(styleLibraryCategory === 'effects' ? `Efeito “${style.label}” aplicado a ${targetIds.length} card(s) compatíveis.` : styleLibraryCategory === 'chart'
      ? `Paleta “${style.label}” aplicada a ${targetIds.length === 1 ? '1 gráfico' : `${targetIds.length} gráficos`}.`
      : styleLibraryCategory === 'button'
        ? `Estilo “${style.label}” aplicado a ${targetIds.length === 1 ? '1 botão' : `${targetIds.length} botões`}.`
        : `Estilo “${style.label}” aplicado a ${targetIds.length === 1 ? '1 indicador' : `${targetIds.length} indicadores`}.`)
    setEditingLibraryStyle(null)
    setPaletteWidgetId(null)
  }

  function setPlacement(widgetId: string, update: (placement: CanvasPlacement) => CanvasPlacement) {
    const existing = layout.placements[widgetId]
    if (!existing) return
    const updated = update(existing)
    const changed = Object.fromEntries(Object.keys(updated).filter(key => updated[key as keyof CanvasPlacement] !== existing[key as keyof CanvasPlacement]).map(key => [key, updated[key as keyof CanvasPlacement]]))
    setLayout(current => {
      const placement = current.placements[widgetId]
      return placement ? { ...current, placements: { ...current.placements, [widgetId]: { ...placement, ...changed } } } : current
    })
    setSaveMessage('')
  }

  function copyWidgetStyle(widgetId: string) {
    const placement = layout.placements[widgetId]
    if (!placement) return
    const copied = Object.fromEntries(stylePlacementKeys.map(key => {
      const value = placement[key]
      return [key, Array.isArray(value) ? [...value] : value]
    })) as CanvasStyleValues
    setCopiedStyle(copied)
    setContextMenu(null)
    setSaveMessage('Aparência copiada. Use “Colar aparência” em outro indicador.')
  }

  function duplicateWidget(widgetId: string) {
    const source = layout.placements[widgetId]
    if (!source) return
    const id = `${widgetId.split('::copy::')[0]}::copy::${crypto.randomUUID()}`
    const groupMembers = Object.values(layout.placements).filter(item => item.groupId === source.groupId)
    const bottom = Math.max(0, ...groupMembers.map(item => (item.top ?? 0) + (item.height ?? 160)))
    setDuplicateIds(current => [...current, id])
    setLayout(current => ({ ...current, widgetOrder: [...current.widgetOrder, id], placements: { ...current.placements, [id]: { ...structuredClone(source), left: 0, top: bottom + 16, customTitle: `${source.customTitle || widgetById.get(widgetId)?.title || 'Indicador'} · cópia` } } }))
    setContextMenu(null)
    setSaveMessage('Indicador duplicado com filtros e aparência independentes. Salve o layout para manter a cópia.')
  }

  function pasteWidgetStyle(widgetId: string) {
    if (!copiedStyle) return
    setPasteTarget(widgetId)
    setContextMenu(null)
  }

  function applyCopiedAppearance() {
    if (!pasteTarget || !copiedStyle) return
    const sectionFor = (key: string) => /Border|Radius|shape|cornerCut/.test(key) ? 'border' : /Shadow|Effect|Tilt|Depth|Inset|ornament|accentPosition|hoverColor/.test(key) ? 'effects' : /^(title|content|subtitle|icon|show)/.test(key) ? 'text' : /^(chart|legend|dataLabel|pie|gradient)/.test(key) ? 'chart' : 'colors'
    const values = Object.fromEntries(Object.entries(copiedStyle).filter(([key]) => pasteSections.includes(sectionFor(key)))) as CanvasStyleValues
    setPlacement(pasteTarget, placement => ({ ...placement, ...values }))
    setPasteTarget(null)
    setSaveMessage('Propriedades selecionadas aplicadas ao card.')
  }

  function deleteSavedLayout(id: string, name: string) {
    if (!window.confirm(`Excluir o layout “${name}”?`)) return
    const nextSavedLayouts = savedLayouts.filter(item => item.id !== id)
    try {
      window.localStorage.setItem(namedLayoutsStorageKey, JSON.stringify(nextSavedLayouts))
      setSavedLayouts(nextSavedLayouts)
      if (selectedLayoutId === id) applyBuiltInLayout(professionalLayoutId)
      setSaveMessage(`Layout “${name}” excluído.`)
    } catch {
      setSaveMessage('Não foi possível excluir o layout salvo neste navegador.')
    }
  }

  function setWidgetShape(widgetId: string, shape: CanvasPlacement['shape'], span: number) {
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
      const sourceGroupWidth = Math.max(1, current.groupWidths[placement.groupId] ?? 24)
      const destinationGroupWidth = Math.max(1, current.groupWidths[groupId] ?? 24)
      const proportionalSpan = placement.groupId === groupId
        ? placement.span
        : Math.max(1, Math.min(24, Math.round((placement.span / destinationGroupWidth) * sourceGroupWidth)))
      const { column: _column, row: _row, rowSpan: _rowSpan, ...freePlacement } = placement
      const spanPercent = (proportionalSpan / 24) * 100
      return { ...current, widgetOrder: order, placements: { ...current.placements, [widgetId]: {
        ...freePlacement,
        span: proportionalSpan,
        groupId,
        ...(left !== undefined && top !== undefined ? { left: Math.max(0, Math.min(100 - spanPercent, left)), top: Math.max(0, top) } : {}),
      } } }
    })
    setSaveMessage('')
  }

  function startWidgetMove(event: ReactPointerEvent<HTMLElement>, widgetId: string, groupId: string, isAction = false) {
    if (selectionMode) return
    const actionTarget = (event.target as HTMLElement).closest('.pcm-canvas__action')
    if (event.button !== 0 || ((event.target as HTMLElement).closest('button, input, select, textarea, a') && !(isAction && actionTarget))) return
    const card = event.currentTarget.closest<HTMLElement>('.pcm-canvas__widget')
    const widgets = event.currentTarget.closest<HTMLElement>('.pcm-canvas__widgets')
    const placement = layout.placements[widgetId]
    if (!card || !widgets || !placement) return
    const rect = card.getBoundingClientRect()
    widgetMoveDrag.current = {
      id: widgetId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      left: placement.left ?? 0, top: placement.top ?? 0, groupId, moved: false, targetActionId: undefined,
    }
    event.preventDefault()
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
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    if (widgetById.get(drag.id)?.action) {
      const targetAction = hit?.closest<HTMLElement>('.pcm-canvas__widget[data-action-card="true"]')
      const targetActionId = targetAction?.dataset.widgetId
      drag.targetActionId = targetActionId && targetActionId !== drag.id ? targetActionId : undefined
    }
    const target = hit?.closest<HTMLElement>('.pcm-canvas__group')
    const rootBoard = hit?.closest<HTMLElement>('.pcm-canvas__board')
    const groupId = target?.dataset.groupId ?? (rootBoard ? boardGroup.id : undefined)
    const widgets = target?.querySelector<HTMLElement>(':scope > .pcm-canvas__widgets')
      ?? rootBoard?.querySelector<HTMLElement>(`.pcm-canvas__group[data-group-id="${CSS.escape(boardGroup.id)}"] > .pcm-canvas__widgets`)
      ?? rootBoard
    if (!groupId || !widgets) return
    const rect = widgets.getBoundingClientRect()
    const placement = layout.placements[drag.id]
    if (!placement) return
    const span = Math.max(1, Math.min(24, placement.span))
    const spanPercent = (span / 24) * 100
    const rawLeft = Math.max(0, Math.min(100 - spanPercent, ((event.clientX - rect.left - drag.offsetX + widgets.scrollLeft) / Math.max(1, rect.width)) * 100))
    const rawTop = Math.max(0, event.clientY - rect.top - drag.offsetY + widgets.scrollTop)
    let left = rawLeft
    let top = rawTop
    if (layout.magnetEnabled) {
      const containerRect = widgets.getBoundingClientRect()
      const cardWidth = (widgets.clientWidth * span) / 24
      const draggedCard = widgets.querySelector<HTMLElement>(`:scope > [data-widget-id="${CSS.escape(drag.id)}"]`)
      const cardHeight = draggedCard?.getBoundingClientRect().height ?? placement.height ?? 96
      const siblings = [...widgets.querySelectorAll<HTMLElement>(':scope > .pcm-canvas__widget:not(.is-dragging)')]
        .filter(card => card.dataset.widgetId !== drag.id)
      const xCandidates: number[] = []
      const yCandidates: number[] = []
      for (const card of siblings) {
        const sibling = card.getBoundingClientRect()
        const siblingLeft = sibling.left - containerRect.left + widgets.scrollLeft
        const siblingRight = sibling.right - containerRect.left + widgets.scrollLeft
        const siblingTop = sibling.top - containerRect.top + widgets.scrollTop
        const siblingBottom = sibling.bottom - containerRect.top + widgets.scrollTop
        xCandidates.push(...(snapMode === 'alignment' ? [siblingLeft, siblingRight - cardWidth, (siblingLeft + siblingRight - cardWidth) / 2] : [siblingLeft, siblingRight + spacing, siblingLeft - cardWidth - spacing]))
        yCandidates.push(...(snapMode === 'alignment' ? [siblingTop, siblingBottom - cardHeight, (siblingTop + siblingBottom - cardHeight) / 2] : [siblingTop, siblingBottom + spacing, siblingTop - cardHeight - spacing]))
      }
      const rawLeftPx = (rawLeft / 100) * widgets.clientWidth
      left = (nearestSnap(rawLeftPx, xCandidates, 8) / Math.max(1, widgets.clientWidth)) * 100
      top = nearestSnap(rawTop, yCandidates, 8)
      left = Math.max(0, Math.min(100 - spanPercent, left))
      top = Math.max(0, top)
    }
    drag.groupId = groupId
    drag.left = left
    drag.top = top
    setDropTarget(current => current?.groupId === groupId && Math.abs((current.left ?? -1) - left) < .5 && Math.abs((current.top ?? -1) - top) < 2 ? current : { groupId, left, top })
  }

  function finishWidgetMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = widgetMoveDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      if (widgetById.get(drag.id)?.action && drag.targetActionId && widgetById.get(drag.targetActionId)?.action) {
        setActionGroupPrompt({ sourceId: drag.id, targetId: drag.targetActionId, left: event.clientX, top: event.clientY })
        suppressActionClick.current = drag.id
        setMovingActionWidgetId(null)
      } else {
        moveWidget(drag.id, drag.groupId, drag.left, drag.top)
        if (widgetById.get(drag.id)?.action) {
          suppressActionClick.current = drag.id
          setMovingActionWidgetId(null)
          setSaveMessage('Botão reposicionado. Salve o layout para manter a posição.')
        }
      }
    }
    widgetMoveDrag.current = null
    setDragging('')
    setDropTarget(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function moveGroup(groupId: string, targetId: string) {
    const destinationId = targetId === boardGroup.id ? undefined : targetId
    if (groupId === destinationId) return
    let ancestorId = destinationId
    const visited = new Set<string>()
    while (ancestorId && !visited.has(ancestorId)) {
      if (ancestorId === groupId) return
      visited.add(ancestorId)
      ancestorId = layout.customGroups.find(group => group.id === ancestorId)?.parentId
    }
    setLayout(current => ({
      ...current,
      customGroups: current.customGroups.map(group => group.id === groupId
        ? { ...group, ...(destinationId ? { parentId: destinationId } : { parentId: undefined }) }
        : group),
    }))
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

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, kind: 'widget' | 'group', id: string, span: number, edge: 'se' | 'top' | 'left' | 'right' | 'bottom' = 'se') {
    event.preventDefault()
    event.stopPropagation()
    const container = kind === 'widget'
      ? event.currentTarget.closest('.pcm-canvas__widgets') as HTMLElement | null
      : (event.currentTarget.closest('.pcm-canvas__group')?.parentElement?.closest('.pcm-canvas__widgets')
        ?? event.currentTarget.closest('.pcm-canvas__board')) as HTMLElement | null
    const card = event.currentTarget.closest(kind === 'widget' ? '.pcm-canvas__widget' : '.pcm-canvas__group') as HTMLElement | null
    const stepWidth = (container?.clientWidth ?? 0) / 24
    const cardRect = card?.getBoundingClientRect()
    const containerRect = container?.getBoundingClientRect()
    const startLeft = cardRect && containerRect ? ((cardRect.left - containerRect.left) / Math.max(1, containerRect.width)) * 100 : 0
    const startTop = cardRect && containerRect ? Math.max(0, cardRect.top - containerRect.top) : 0
    if (kind === 'widget' && edge === 'left') {
      setPlacement(id, placement => ({ ...placement, left: startLeft, top: startTop }))
    }
    const startWidth = Math.max(1, cardRect?.width ?? Math.max(stepWidth, 1) * span)
    const startHeight = kind === 'group'
      ? Math.max(80, layout.groupHeights[id] ?? cardRect?.height ?? 120)
      : cardRect?.height ?? 120
    const placement = kind === 'widget' ? layout.placements[id] : undefined
    resizeDrag.current = {
      kind, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      stepWidth: Math.max(stepWidth, 1), columns: 24,
      edge,
      startLeft,
      startSpan: span, startHeight, startWidth,
      startScale: placement?.contentScale ?? 1,
      aspectRatio: startWidth / Math.max(1, startHeight),
      aspectLocked: Boolean(placement?.aspectLocked || placement?.shape),
      ...(kind === 'widget' && edge === 'top' ? { startTop: layout.placements[id]?.top ?? 0 } : {}),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = resizeDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const horizontalOnly = drag.edge === 'left' || drag.edge === 'right'
    const spanDelta = drag.edge === 'top' || drag.edge === 'bottom' ? 0 : Math.round((event.clientX - drag.startX) / drag.stepWidth) * (drag.edge === 'left' ? -1 : 1)
    const height = Math.max(48, Math.min(900, Math.round(drag.startHeight + (drag.edge === 'top' ? drag.startY - event.clientY : event.clientY - drag.startY))))
    if (drag.kind === 'widget') {
      setLayout(current => {
        const placement = current.placements[drag.id]
        if (!placement) return current
        const maximumSpan = drag.edge === 'left' ? Math.min(drag.columns, drag.startSpan + Math.floor((drag.startLeft ?? 0) / 100 * drag.columns)) : drag.columns
        const verticalSpan = drag.aspectLocked && (drag.edge === 'top' || drag.edge === 'bottom')
          ? Math.round((height * drag.aspectRatio) / drag.stepWidth)
          : drag.startSpan + spanDelta
        const span = Math.max(1, Math.min(maximumSpan, verticalSpan)) as CanvasPlacement['span']
        const lockedHeight = Math.max(48, Math.min(900, Math.round((span * drag.stepWidth) / Math.max(.1, drag.aspectRatio))))
        const nextHeight = placement.shape ? undefined : drag.aspectLocked ? lockedHeight : horizontalOnly ? drag.startHeight : height
        const nextTop = drag.edge === 'top' ? Math.max(0, (drag.startTop ?? 0) + event.clientY - drag.startY) : placement.top
        const anchoredHeight = drag.edge === 'top' ? drag.aspectLocked ? lockedHeight : Math.max(48, Math.round(drag.startHeight - ((nextTop ?? 0) - (drag.startTop ?? 0)))) : nextHeight
        const left = drag.edge === 'left'
          ? Math.max(0, (drag.startLeft ?? 0) + ((drag.startSpan - span) / drag.columns) * 100)
          : Number.isFinite(placement.left)
          ? Math.max(0, Math.min(100 - (span / 24) * 100, Number(placement.left)))
          : undefined
        const effectiveHeight = placement.shape ? Math.max(1, (span * drag.stepWidth) / Math.max(.1, drag.aspectRatio)) : anchoredHeight ?? drag.startHeight
        const contentScale = Math.max(.65, Math.min(2.4, Number((drag.startScale * Math.sqrt(((span * drag.stepWidth) * effectiveHeight) / Math.max(1, drag.startWidth * drag.startHeight))).toFixed(3))))
        const nextPlacement = {
          ...placement,
          span,
          height: anchoredHeight,
          contentScale,
          rowSpan: anchoredHeight ? Math.max(1, Math.ceil((anchoredHeight + 2) / 8)) : undefined,
          ...(drag.edge === 'top' ? { top: nextTop } : {}),
          ...(left !== undefined ? { left } : {}),
        }
        const next = { ...current, placements: { ...current.placements, [drag.id]: nextPlacement } }
        return sameLayout(current, next) ? current : next
      })
    } else {
      setLayout(current => {
        const width = Math.max(1, Math.min(24, drag.startSpan + spanDelta))
        const height = Math.max(80, Math.min(1600, Math.round(drag.startHeight + event.clientY - drag.startY)))
        const next = {
          ...current,
          groupWidths: { ...current.groupWidths, [drag.id]: width },
          groupHeights: { ...current.groupHeights, [drag.id]: height },
        }
        return current.groupWidths[drag.id] === width && current.groupHeights[drag.id] === height ? current : next
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
        groupWidths: { ...current.groupWidths, [id]: 24 },
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

  function groupActionWidgets(sourceId: string, targetId: string, orientation: 'row' | 'column') {
    const sourceWidget = widgetById.get(sourceId)
    const targetWidget = widgetById.get(targetId)
    if (!sourceWidget?.action || !targetWidget?.action || sourceId === targetId) return
    const id = `group-actions-${crypto.randomUUID()}`
    setLayout(current => {
      const sourcePlacement = current.placements[sourceId]
      const targetPlacement = current.placements[targetId]
      if (!sourcePlacement || !targetPlacement) return current
      const sameGroup = sourcePlacement.groupId === targetPlacement.groupId
      const parentId = sameGroup && sourcePlacement.groupId !== boardGroup.id ? sourcePlacement.groupId : undefined
      const span = orientation === 'row' ? 12 : 24
      const placements = { ...current.placements }
      for (const widgetId of [sourceId, targetId]) {
        const placement = placements[widgetId]
        const { column: _column, row: _row, rowSpan: _rowSpan, left: _left, top: _top, ...flowPlacement } = placement
        placements[widgetId] = { ...flowPlacement, groupId: id, span }
      }
      return {
        ...current,
        customGroups: [...current.customGroups, { id, label: 'Botões agrupados', ...(parentId ? { parentId } : {}) }],
        groupOrder: [...current.groupOrder, id],
        groupWidths: { ...current.groupWidths, [id]: 12 },
        groupColumns: { ...current.groupColumns, [id]: orientation === 'row' ? 2 : 1 },
        placements,
      }
    })
    setActionGroupPrompt(null)
    setSaveMessage('Botões agrupados. Personalize o grupo e salve o layout para manter a alteração.')
  }

  function addWidget(widgetId: string) {
    const widget = widgetById.get(widgetId)
    if (!widget || placedIds.has(widgetId)) return
    const groupId = allGroups.some(group => group.id === groupTarget) ? groupTarget : boardGroup.id
    setLayout(current => ({
      ...current,
      widgetOrder: [...current.widgetOrder, widgetId],
      placements: { ...current.placements, [widgetId]: { groupId, span: Math.max(1, Math.round(24 / (current.groupColumns[groupId] ?? 4))), mode: widget.defaultMode, paletteId: 'ocean', ...(widget.action ? { showTitle: false } : {}) } },
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
      customGroups: current.customGroups.flatMap(group => group.id === groupId ? [] : group.parentId === groupId
        ? [{ ...group, parentId: current.customGroups.find(item => item.id === groupId)?.parentId }]
        : [group]),
      groupOrder: current.groupOrder.filter(id => id !== groupId),
      groupWidths: Object.fromEntries(Object.entries(current.groupWidths).filter(([id]) => id !== groupId)),
      groupColumns: Object.fromEntries(Object.entries(current.groupColumns).filter(([id]) => id !== groupId)),
      placements: Object.fromEntries(Object.entries(current.placements).map(([id, placement]) => {
        if (placement.groupId !== groupId) return [id, placement]
        const { column: _column, row: _row, rowSpan: _rowSpan, ...flowPlacement } = placement
        return [id, { ...flowPlacement, groupId: current.customGroups.find(group => group.id === groupId)?.parentId ?? boardGroup.id }]
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

  function setGroupParent(groupId: string, parentId: string) {
    moveGroup(groupId, parentId)
    setGroupEditor(null)
  }

  function setActionGroupOrientation(groupId: string, orientation: 'row' | 'column') {
    const memberIds = layout.widgetOrder.filter(id => layout.placements[id]?.groupId === groupId)
    if (memberIds.length < 2 || !memberIds.every(id => widgetById.get(id)?.action)) return
    setLayout(current => ({
      ...current,
      groupColumns: { ...current.groupColumns, [groupId]: orientation === 'row' ? 2 : 1 },
      placements: Object.fromEntries(Object.entries(current.placements).map(([widgetId, placement]) => {
        if (!memberIds.includes(widgetId)) return [widgetId, placement]
        const { column: _column, row: _row, rowSpan: _rowSpan, left: _left, top: _top, ...flowPlacement } = placement
        return [widgetId, { ...flowPlacement, span: orientation === 'row' ? 12 : 24 }]
      })),
    }))
    setSaveMessage('Disposição dos botões atualizada. Salve o layout para manter a alteração.')
  }

  function toggleAllGroupHeadings() {
    const showHeading = layout.customGroups.every(group => group.showHeading === false)
    setLayout(current => ({ ...current, customGroups: current.customGroups.map(group => ({ ...group, showHeading })) }))
    setSaveMessage('')
  }

  function organizeCanvas() {
    setLayout(current => {
      const placements = Object.fromEntries(Object.entries(current.placements).map(([id, placement]) => {
        const { left: _left, top: _top, column: _column, row: _row, rowSpan: _rowSpan, height: _height, ...flowPlacement } = placement
        return [id, flowPlacement]
      }))
      const next = { ...current, placements, groupHeights: {}, magnetEnabled: true }
      return sameLayout(current, next) ? current : next
    })
    setSaveMessage('Indicadores reorganizados. Salve para manter o layout.')
  }

  function toggleMagnet() {
    const enable = !layout.magnetEnabled
    setLayout(current => ({
      ...current,
      magnetEnabled: enable,
    }))
    setSaveMessage(enable
      ? 'Encaixe ligado para os próximos movimentos. Posições e tamanhos preservados.'
      : 'Encaixe desligado: arraste os cards livremente e ajuste o espaçamento.')
  }

  function alignSelection(direction: 'left' | 'top' | 'horizontal' | 'vertical') {
    const members = selectedIds.map(id => {
      const element = boardRef.current?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(id)}"]`)
      const parent = element?.parentElement
      if (!element || !parent) return null
      const rect = element.getBoundingClientRect()
      const bounds = parent.getBoundingClientRect()
      return { id, groupId: layout.placements[id]?.groupId, x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height, containerWidth: bounds.width }
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (members.length < 2) return
    if (new Set(members.map(item => item.groupId)).size !== 1) { setSaveMessage('Selecione cards do mesmo grupo para alinhar.'); return }
    members.sort((a, b) => direction === 'vertical' ? a.y - b.y : a.x - b.x)
    const minX = Math.min(...members.map(item => item.x))
    const minY = Math.min(...members.map(item => item.y))
    if (direction === 'horizontal' && members.reduce((sum, item) => sum + item.width, 0) + spacing * (members.length - 1) > members[0].containerWidth) { setSaveMessage('Os cards não cabem lado a lado. Reduza a largura ou o espaçamento.'); return }
    let cursor = direction === 'vertical' ? minY : direction === 'horizontal' ? 0 : minX
    setLayout(current => {
      const placements = { ...current.placements }
      for (const member of members) {
        const placement = placements[member.id]
        if (!placement) continue
        const x = direction === 'horizontal' ? cursor : direction === 'left' || direction === 'vertical' ? minX : member.x
        const y = direction === 'vertical' ? cursor : direction === 'top' || direction === 'horizontal' ? minY : member.y
        placements[member.id] = { ...placement, left: x / Math.max(1, member.containerWidth) * 100, top: y }
        cursor += (direction === 'vertical' ? member.height : member.width) + spacing
      }
      return { ...current, placements }
    })
    setSaveMessage('Alinhamento aplicado. Salve o layout para manter as posições.')
  }

  function applyBuiltInLayout(id: string) {
    if (unsaved && !window.confirm('As alterações atuais ainda não foram salvas. Trocar de layout mesmo assim?')) return
    let nextLayout: CanvasLayout
    if (id === 'preset-blank') {
      nextLayout = {
        ...layout,
        groupOrder: [boardGroup.id],
        groupWidths: { [boardGroup.id]: 24 },
        groupHeights: {},
        groupColumns: { [boardGroup.id]: 4 },
        widgetOrder: [],
        placements: {},
        customGroups: [],
        blankLayout: true,
        magnetEnabled: true,
      }
    } else if (id === professionalLayoutId) {
      nextLayout = createDefaultLayout(widgets)
      nextLayout.blankLayout = false
    } else {
      const baseLayout = createDefaultLayout(widgets)
      const preferredOrders: Record<string, string[]> = {
        'preset-compact': ['group-prioridades', 'group-carga', 'group-confiabilidade', 'group-ativos', 'group-planejamento', 'group-materiais', 'group-resultados'],
        'preset-reliability': ['group-confiabilidade', 'group-prioridades', 'group-ativos', 'group-carga', 'group-planejamento', 'group-resultados', 'group-materiais'],
        'preset-operations': ['group-prioridades', 'group-carga', 'group-planejamento', 'group-resultados', 'group-ativos', 'group-materiais', 'group-confiabilidade'],
      }
      const currentIds = baseLayout.customGroups.map(group => group.id)
      const requestedOrder = preferredOrders[id] ?? currentIds
      const orderedIds = [...requestedOrder.filter(groupId => currentIds.includes(groupId)), ...currentIds.filter(groupId => !requestedOrder.includes(groupId))]
      const getGroupWidth = (groupId: string) => {
        if (id === 'preset-compact') return 24
        return 24
      }
      const getWidgetSpan = (widgetId: string, groupId: string) => {
        if (id === 'preset-compact') return 6
        if (id === 'preset-operations' && groupId === 'group-prioridades') return 6
        if (id === 'preset-reliability' && ['mttr-mtbf-comparison', 'monthly-mttr'].includes(widgetId)) return 12
        return 12
      }
      const getStyleId = (groupId: string, index: number) => {
        if (id === 'preset-compact') return index % 3 === 0 ? 'glass-blue' : index % 3 === 1 ? 'soft' : 'standard'
        if (id === 'preset-reliability') return groupId === 'group-confiabilidade' ? 'glass-blue' : groupId === 'group-ativos' ? 'outline' : groupId === 'group-prioridades' ? 'soft' : 'standard'
        if (id === 'preset-operations') return groupId === 'group-prioridades' ? 'gradient' : groupId === 'group-planejamento' ? 'sage' : groupId === 'group-carga' ? 'glass-mint' : 'standard'
        return 'standard'
      }
      const groupWidthEntries = Object.fromEntries(orderedIds.map(groupId => [groupId, getGroupWidth(groupId)]))
      const placements = Object.fromEntries(Object.entries(baseLayout.placements).map(([widgetId, placement], index) => {
        const { left: _left, top: _top, column: _column, row: _row, rowSpan: _rowSpan, height: _height, ...flowPlacement } = placement
        const groupId = id === 'preset-compact' ? boardGroup.id : placement.groupId
        const style = cardStylePresets.find(item => item.id === getStyleId(groupId, index)) ?? cardStylePresets[0]
        return [widgetId, { ...flowPlacement, groupId, span: getWidgetSpan(widgetId, groupId), left: undefined, top: undefined, height: undefined, cardBackground: style.background, cardBackgroundOpacity: style.effect.startsWith('glass') ? 80 as const : 100 as const, cardBorder: style.border, titleColor: style.titleColor, contentColor: style.contentColor, cardEffect: style.effect }]
      }))
      const compactGroups = id === 'preset-compact' ? [] : baseLayout.customGroups.map(group => {
        if (id === 'preset-reliability' && group.id === 'group-confiabilidade') {
          return { ...group, background: '#edf6fc', backgroundOpacity: 60 as const, border: '#d2e4f0', titleColor: '#174d75', showHeading: true }
        }
        if (id === 'preset-operations' && group.id === 'group-prioridades') {
          return { ...group, background: '#fff7ef', backgroundOpacity: 80 as const, border: '#f0d8bd', titleColor: '#814916', showHeading: true }
        }
        return { ...group, showHeading: true }
      })
      nextLayout = {
        ...baseLayout,
        groupOrder: id === 'preset-compact' ? [boardGroup.id] : [boardGroup.id, ...orderedIds],
        groupWidths: id === 'preset-compact' ? { [boardGroup.id]: 24 } : { ...baseLayout.groupWidths, ...groupWidthEntries },
        groupHeights: {},
        groupColumns: id === 'preset-compact' ? { [boardGroup.id]: 4 } : { ...baseLayout.groupColumns, ...Object.fromEntries(orderedIds.map(groupId => [groupId, getGroupWidth(groupId) === 24 ? 2 : 1])) },
        placements,
        customGroups: compactGroups,
        widgetOrder: id === 'preset-compact' ? widgets.map(widget => widget.id) : baseLayout.widgetOrder,
        blankLayout: false,
      }
    }
    setSelectedIds([])
    setCreatingGroup(false)
    setGroupName('')
    setGroupEditor(null)
    setContextMenu(null)
    setCatalogOpen(false)
    setPaletteWidgetId(null)
    setFilterWidgetId(null)
    setFilterAnchor(null)
    if (id === 'preset-blank') setGroupTarget(boardGroup.id)
    setLayout(nextLayout)
    setSavedLayout(nextLayout)
    setSelectedLayoutId(id)
    try {
      window.localStorage.setItem(selectedLayoutStorageKey, id)
      window.localStorage.setItem(storageKey, JSON.stringify(nextLayout))
    } catch { /* A seleção permanece ativa na sessão atual. */ }
    setSaveMessage('Layout carregado. Salve após personalizar para manter os ajustes.')
  }

  function saveLayout() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
      if (selectedLayoutId && selectedLayoutId !== professionalLayoutId && !selectedLayoutId.startsWith('preset-')) {
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

  function exportCurrentLayout() {
    const activeName = selectedLayoutId === professionalLayoutId ? 'padrao-profissional' : savedLayouts.find(item => item.id === selectedLayoutId)?.name ?? 'lousa-pcm'
    const payload = { format: 'vorqix-pcm-layout', version: 1, exportedAt: new Date().toISOString(), name: activeName, layout }
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${activeName.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lousa-pcm'}.json`
    anchor.click()
    URL.revokeObjectURL(href)
    setSaveMessage('Layout exportado em arquivo JSON.')
  }

  function importLayout(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { format?: unknown; name?: unknown; layout?: unknown }
        const candidate = parsed?.format === 'vorqix-pcm-layout' ? parsed.layout : parsed
        if (!candidate || typeof candidate !== 'object' || !('placements' in candidate) || !('groupOrder' in candidate) || !('widgetOrder' in candidate)) throw new Error('invalid')
        const imported = candidate as CanvasLayout
        const validWidgetIds = new Set(widgets.map(widget => widget.id))
        const importedCopies = Object.keys(imported.placements ?? {}).filter(id => id.includes('::copy::') && sourceWidgets.some(widget => widget.id === id.split('::copy::')[0]))
        importedCopies.forEach(id => validWidgetIds.add(id))
        setDuplicateIds(current => [...new Set([...current, ...importedCopies])])
        const placements = Object.fromEntries(Object.entries(imported.placements ?? {}).filter(([id, placement]) => validWidgetIds.has(id) && placement && typeof placement === 'object')) as Record<string, CanvasPlacement>
        const merged = { ...createDefaultLayout(widgets), ...imported, version: 4 as const, placements: { ...createDefaultLayout(widgets).placements, ...placements }, widgetOrder: (imported.widgetOrder ?? []).filter(id => validWidgetIds.has(id)), customGroups: Array.isArray(imported.customGroups) ? imported.customGroups.filter(group => group && typeof group.id === 'string' && typeof group.label === 'string') : [] }
        const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 40) : `Layout importado ${savedLayouts.length + 1}`
        const id = `layout-${Date.now().toString(36)}`
        const nextLayouts = [...savedLayouts, { id, name, layout: merged }].slice(-20)
        window.localStorage.setItem(namedLayoutsStorageKey, JSON.stringify(nextLayouts))
        window.localStorage.setItem(storageKey, JSON.stringify(merged))
        window.localStorage.setItem(selectedLayoutStorageKey, id)
        setSavedLayouts(nextLayouts)
        setLayout(merged)
        setSavedLayout(merged)
        setSelectedLayoutId(id)
        setSaveMessage(`Layout “${name}” importado e aplicado.`)
      } catch {
        setSaveMessage('Arquivo inválido. Escolha um layout JSON exportado pela lousa PCM.')
      }
    }
    reader.readAsText(file)
  }

  function adaptThemeToSurface() {
    const reference = areaBackground || (panelAppearance.background === 'transparent' ? (dashboardTheme === 'dark' ? '#102234' : '#edf5fc') : panelAppearance.background)
    const nextTheme = isDarkColor(reference, dashboardTheme) ? 'dark' : 'ice'
    setDashboardTheme(nextTheme)
    setLayout(current => ({
      ...current,
      placements: Object.fromEntries(Object.entries(current.placements).map(([id, placement]) => {
        const background = placement.cardBackground
        const backgroundNeedsAdaptation = background && background !== 'transparent' && isDarkColor(background, dashboardTheme) !== (nextTheme === 'dark')
        return [id, {
          ...placement,
          ...(backgroundNeedsAdaptation ? { cardBackground: mixHexColor(background, nextTheme === 'dark' ? '#102234' : '#eef5fa', nextTheme === 'dark' ? .68 : .78) } : {}),
          ...(placement.cardBorder && placement.cardBorder !== 'none' && placement.cardBorder !== 'transparent' ? { cardBorder: mixHexColor(placement.cardBorder, nextTheme === 'dark' ? '#6d92ab' : '#b7cbd9', .46) } : {}),
          titleColor: nextTheme === 'dark' ? '#dcecf7' : '#244762',
          contentColor: nextTheme === 'dark' ? '#f5faff' : '#12324d',
        }]
      })),
      customGroups: current.customGroups.map(group => ({
        ...group,
        ...(group.background && group.background !== 'transparent' && isDarkColor(group.background, dashboardTheme) !== (nextTheme === 'dark') ? { background: mixHexColor(group.background, nextTheme === 'dark' ? '#102234' : '#eef5fa', nextTheme === 'dark' ? .68 : .78) } : {}),
        titleColor: nextTheme === 'dark' ? '#dcecf7' : '#244762',
      })),
    }))
    setPanelOptions(current => ({ ...current, text: '', noticeBackground: '', noticeText: '' }))
    setSaveMessage(`Tema e superfícies adaptados automaticamente ao modo ${nextTheme === 'dark' ? 'escuro' : 'claro'}.`)
  }

  function selectSavedLayout(id: string) {
    if (!id) {
      setSelectedLayoutId('')
      try { window.localStorage.removeItem(selectedLayoutStorageKey) } catch { /* A seleção da sessão continua disponível. */ }
      return
    }
    if (id === professionalLayoutId || id.startsWith('preset-')) {
      applyBuiltInLayout(id)
      return
    }
    const target = savedLayouts.find(item => item.id === id)
    const nextLayout = target?.layout
    if (!nextLayout) return
    if (unsaved && !window.confirm('As alterações atuais ainda não foram salvas. Trocar de layout mesmo assim?')) return
    setLayout(nextLayout)
    setSavedLayout(nextLayout)
    setSelectedLayoutId(id)
    window.localStorage.setItem(selectedLayoutStorageKey, id)
    setSaveMessage(`Layout “${target?.name}” carregado.`)
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
    if (!layout.placements[id]) return false
    const widget = widgetById.get(id)
    if (!widget) return false
    const matchesCategory = filterCategory === 'all' || widget.categoryId === filterCategory
    const placement = layout.placements[id]
    const matchesSearch = !normalizedSearch || `${placement.customTitle ?? widget.title} ${placement.customSubtitle ?? ''} ${categoryById.get(widget.categoryId) ?? ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
    return matchesCategory && matchesSearch
  })
  const hasAnyPlacedWidgets = layout.widgetOrder.some(id => widgetById.has(id))
  const hasActiveCanvasSearch = Boolean(normalizedSearch) || filterCategory !== 'all'
  const visibleGroupIds = new Set<string>()
  for (const widgetId of visibleWidgetIds) {
    let groupId: string | undefined = layout.placements[widgetId]?.groupId
    while (groupId && !visibleGroupIds.has(groupId)) {
      visibleGroupIds.add(groupId)
      groupId = layout.customGroups.find(group => group.id === groupId)?.parentId
    }
  }
  const paletteWidget = paletteWidgetId ? widgetById.get(paletteWidgetId) : undefined
  const palettePlacement = paletteWidgetId ? layout.placements[paletteWidgetId] : undefined
  const paletteMode = paletteWidget && palettePlacement && paletteWidget.modes.some(item => item.id === palettePlacement.mode) ? palettePlacement.mode : paletteWidget?.defaultMode
  const filterWidget = filterWidgetId ? widgetById.get(filterWidgetId) : undefined
  const filterPlacement = filterWidgetId ? layout.placements[filterWidgetId] : undefined
  const paletteBaseColors = palettePlacement ? chartPalettes[palettePlacement.paletteId]?.colors ?? chartPalettes.ocean.colors : chartPalettes.ocean.colors
  const paletteColors = resolvePalette(paletteBaseColors, palettePlacement?.customColors, palettePlacement?.customColor)
  const chartPresentationOptions: { id: NonNullable<CanvasPlacement['chartStyle']>; label: string }[] = paletteMode === 'pie' || paletteMode === 'donut'
    ? [{ id: 'default', label: 'Circular' }, { id: 'gradient', label: 'Fatias em degradê' }, { id: 'oval', label: 'Oval' }, { id: 'exploded', label: 'Fatias separadas' }, { id: 'depth', label: 'Com profundidade' }]
    : paletteMode === 'bar' || paletteMode === 'progress'
      ? [{ id: 'default', label: 'Pontas retas' }, { id: 'minimal', label: 'Cantos suaves' }, { id: 'rounded', label: 'Cápsula' }, { id: 'gradient', label: 'Degradê' }, { id: 'bar-depth', label: 'Relevo' }]
      : paletteMode === 'line' || paletteMode === 'area'
        ? [{ id: 'default', label: 'Linha padrão' }, { id: 'smooth', label: 'Linha suave' }, { id: 'minimal', label: 'Linha minimalista' }, { id: 'gradient', label: 'Linha em degradê' }]
        : paletteMode === 'comparison'
          ? [{ id: 'default', label: 'Lado a lado' }, { id: 'bar-depth', label: 'Comparação com profundidade' }]
          : []
  const editableGroup = groupEditor ? layout.customGroups.find(group => group.id === groupEditor.id) : undefined
  const editableGroupWidgets = editableGroup
    ? layout.widgetOrder.filter(id => layout.placements[id]?.groupId === editableGroup.id).map(id => widgetById.get(id)).filter((widget): widget is PcmCanvasWidget => Boolean(widget))
    : []
  const editableGroupIsActionGroup = editableGroupWidgets.length > 1 && editableGroupWidgets.every(widget => widget.action)
  const editableGroupOrientation = editableGroup ? (layout.groupColumns[editableGroup.id] ?? 2) === 1 ? 'column' : 'row' : 'row'
  const allGroupHeadingsHidden = layout.customGroups.length > 0 && layout.customGroups.every(group => group.showHeading === false)
  const editableGroupDescendants = new Set<string>()
  if (editableGroup) {
    for (const group of layout.customGroups) {
      let parentId = group.parentId
      while (parentId) {
        if (parentId === editableGroup.id) {
          editableGroupDescendants.add(group.id)
          break
        }
        parentId = layout.customGroups.find(item => item.id === parentId)?.parentId
      }
    }
  }
  const unplacedWidgets = widgets.filter(widget => !placedIds.has(widget.id))
    .filter(widget => catalogCategory === 'all' || widget.categoryId === catalogCategory)
    .filter(widget => !catalogQuery.trim() || `${widget.title} ${widget.note ?? ''}`.toLocaleLowerCase('pt-BR').includes(catalogQuery.trim().toLocaleLowerCase('pt-BR')))

  const renderZone = (group: PcmCanvasGroup, nested = false): ReactNode => {
    if (!visibleGroupIds.has(group.id)) return null
    const groupIds = layout.widgetOrder.filter(id => layout.placements[id]?.groupId === group.id && visibleWidgetIds.includes(id))
    const childZones = layout.groupOrder.map(id => allGroups.find(item => item.id === id)).filter((item): item is PcmCanvasGroup => Boolean(item && item.parentId === group.id && visibleGroupIds.has(item.id)))
    const width = layout.groupWidths[group.id] ?? 24
    const groupBackground = group.background === 'transparent' ? 'transparent' : group.background ?? 'transparent'
    const groupStyle = { '--pcm-category-span': width, '--pcm-category-span-compact': Math.max(1, Math.ceil(width / 2)), '--pcm-widget-columns': 24, '--pcm-group-min-height': layout.groupHeights[group.id] ? `${layout.groupHeights[group.id]}px` : '0px', '--pcm-group-background': groupBackground === 'transparent' ? 'transparent' : `color-mix(in srgb, ${groupBackground} ${group.backgroundOpacity ?? 100}%, transparent)`, '--pcm-group-border': group.border === 'none' ? 'transparent' : group.border ?? 'transparent', '--pcm-group-radius': cornerRadiusValue(group.radius), '--pcm-group-title': group.titleColor ?? (dashboardTheme === 'dark' ? '#d8e8f4' : '#23445e') } as CSSProperties
    return <section key={group.id} data-group-id={group.id} className={`pcm-canvas__group${group.id === boardGroup.id ? ' pcm-canvas__group--board' : ''}${nested ? ' pcm-canvas__group--nested' : ''}${group.showHeading === false ? ' pcm-canvas__group--heading-hidden' : ''}${dragging === `group:${group.id}` ? ' is-dragging' : ''}${dropTarget?.groupId === group.id && dropTarget.left === undefined ? ' is-drop-target' : ''}`} style={groupStyle} onDragOver={event => { event.preventDefault(); if (!dragging.startsWith('widget:')) setDropTarget({ groupId: group.id }) }} onDrop={event => { event.stopPropagation(); handleDrop(event, group.id) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null) }} onContextMenu={group.id === boardGroup.id ? undefined : event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'group', id: group.id, x: event.clientX, y: event.clientY }) }}>
      {group.id !== boardGroup.id && group.showHeading !== false ? <header className="pcm-canvas__group-heading" title={group.description} draggable onDragStart={event => { if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return } startDrag(event, 'group', group.id) }} onDragEnd={() => { setDragging(''); setDropTarget(null) }}>
        <div style={{ flex: 1, minWidth: 0, textAlign: group.titleAlign ?? 'left' }}><h3 style={{ fontSize: `${group.titleSize ?? 11}px`, color: group.titleColor }}>{group.label}</h3>{group.subtitle ? <p style={{ margin: '4px 0 0', fontSize: `${group.subtitleSize ?? 10}px`, color: group.subtitleColor ?? group.titleColor }}>{group.subtitle}</p> : null}</div>
        <div className="pcm-canvas__group-controls"><button type="button" className="pcm-canvas__icon-button pcm-canvas__group-config-button" aria-label={`Personalizar zona ${group.label}`} aria-expanded={groupEditor?.id === group.id} title="Personalizar zona" onClick={event => { event.stopPropagation(); if (groupEditor?.id === group.id) { setGroupEditor(null); return } setPaletteWidgetId(null); setStyleLibraryOpen(false); setFilterWidgetId(null); setFilterAnchor(null); setContextMenu(null); setGroupEditor({ id: group.id }) }}><Palette size={13} aria-hidden="true" /></button></div>
      </header> : null}
      <div className="pcm-canvas__widgets" style={{ '--pcm-widget-columns': 24 } as CSSProperties}>
        {groupIds.map(widgetId => {
          const widget = widgetById.get(widgetId)
          const placement = layout.placements[widgetId]
          if (!widget || !placement) return null
          const mode = widget.modes.some(item => item.id === placement.mode) ? placement.mode : widget.defaultMode
          const currentSpan = Math.max(1, Math.min(24, placement.span))
          const colors = chartPalettes[placement.paletteId]?.colors ?? chartPalettes.ocean.colors
          const sourceMetric = layout.placements['mttr-mtbf-comparison']
          const linkedMetric = widget.id === 'monthly-mttr' && sourceMetric?.linkTimeMetricColors !== false && sourceMetric
          const metricColors = linkedMetric ? resolvePalette(chartPalettes[sourceMetric.paletteId]?.colors ?? colors, sourceMetric.customColors, sourceMetric.customColor) : null
          const linkedColor = metricColors?.[widget.title.startsWith('MTBF') ? 1 : 0]
          const rawPalette = linkedColor ? [linkedColor, linkedColor, linkedColor] as unknown as PcmCanvasPalette : resolvePalette(colors, placement.customColors, placement.customColor)
          const chartPalette = rawPalette.map(color => withOpacity(color, placement.chartOpacity ?? 100)) as unknown as PcmCanvasPalette
          const effectiveSegments = { ...segments }
          Object.entries(placement.segments ?? {}).forEach(([filterId, value]) => {
            if (value === ignoreGlobalSegment) delete effectiveSegments[filterId]
            else if (value) effectiveSegments[filterId] = value
          })
          const backgroundColor = placement.cardBackground === 'transparent' ? 'transparent' : placement.cardBackground ?? 'transparent'
          const isFreePositioned = Number.isFinite(placement.left) && Number.isFinite(placement.top)
          const cardStyle = { '--pcm-widget-span': currentSpan, '--pcm-widget-column': placement.column ?? 'auto', '--pcm-widget-row': placement.row ?? 'auto', '--pcm-widget-row-span': placement.rowSpan ?? 1, '--pcm-widget-free-left': `${placement.left ?? 0}%`, '--pcm-widget-free-top': `${placement.top ?? 0}px`, '--pcm-widget-free-width': `${(currentSpan / 24) * 100}%`, '--pcm-widget-height': placement.shape ? 'auto' : placement.height ? `${placement.height}px` : 'auto', '--pcm-widget-scale': placement.contentScale ?? 1, '--pcm-widget-background': backgroundColor === 'transparent' ? 'transparent' : `color-mix(in srgb, ${backgroundColor} ${placement.cardBackgroundOpacity ?? 100}%, transparent)`, '--pcm-widget-border': placement.cardBorder === 'none' ? 'transparent' : placement.cardBorder ?? 'transparent', '--pcm-widget-border-style': placement.cardBorderStyle ?? 'solid', '--pcm-widget-radius': cornerRadiusValue(placement.cardRadius), '--pcm-widget-title': placement.titleColor ?? (dashboardTheme === 'dark' ? '#d8e8f4' : '#375873'), '--pcm-widget-content': placement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d'), '--pcm-widget-accent': placement.accentColor ?? '#176fc1', '--pcm-widget-icon-color': placement.iconColor ?? placement.accentColor ?? '#176fc1', '--pcm-widget-chart': rawPalette[0], '--pcm-chart-grid': `color-mix(in srgb, ${placement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d')} ${dashboardTheme === 'dark' ? '23%' : '15%'}, transparent)`, '--pcm-chart-track': `color-mix(in srgb, ${placement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d')} ${dashboardTheme === 'dark' ? '18%' : '10%'}, transparent)`, '--pcm-chart-surface': backgroundColor === 'transparent' ? 'transparent' : `color-mix(in srgb, ${backgroundColor} ${placement.cardBackgroundOpacity ?? 100}%, transparent)`, '--pcm-widget-title-size': `${placement.titleSize ?? 9}px`, '--pcm-widget-title-align': placement.titleAlign ?? 'left', '--pcm-widget-content-size': `${placement.contentSize ?? 25}px`, '--pcm-widget-metric-size': `${placement.contentSize ?? 25}px`, '--pcm-widget-icon-size': `${placement.iconSize ?? 22}px`, '--pcm-action-accent': placement.buttonColor ?? (dashboardTheme === 'dark' ? '#90caff' : '#174d75'), '--pcm-action-background': placement.buttonBackground ?? (dashboardTheme === 'dark' ? '#174b70' : '#e7f3fc'), '--pcm-action-border': placement.buttonBorder ?? (dashboardTheme === 'dark' ? '#4e83a5' : '#b8d5e8'), '--pcm-action-text': placement.buttonText ?? (dashboardTheme === 'dark' ? '#f2f8fc' : '#174d75') } as CSSProperties
          Object.assign(cardStyle, { '--pcm-chart-grid': placement.chartGridColor ?? (dashboardTheme === 'dark' ? '#52697a' : '#d3dfe8'), '--pcm-grid-width': placement.chartGridWidth ?? 1, '--pcm-axes-display': placement.showChartAxes === false ? 'none' : 'inline', '--pcm-chart-line-width': placement.chartLineWidth ?? 3, '--pcm-chart-point-size': placement.chartPointSize ?? 5, '--pcm-chart-border-width': placement.chartBorderWidth ?? 0, '--pcm-chart-depth': `${placement.chartDepth ?? 16}deg` })
          const isTransparent = backgroundColor === 'transparent' || (placement.cardBackgroundOpacity ?? 0) === 0
          Object.assign(cardStyle, { '--pcm-legend-text': placement.legendTextColor ?? 'var(--pcm-widget-content)', '--pcm-legend-value': placement.legendValueColor ?? 'var(--pcm-widget-content)', '--pcm-legend-percent': placement.legendPercentColor ?? 'var(--pcm-widget-content)', '--pcm-gradient-end': placement.gradientEnd ?? rawPalette[1] ?? rawPalette[0], '--pcm-center-display': placement.showChartCenter === false ? 'none' : 'flex', '--pcm-center-color': placement.chartCenterColor ?? placement.contentColor ?? 'var(--pcm-widget-content)', '--pcm-center-size': `${placement.chartCenterSize ?? 13}px`, '--pcm-chart-label-color': placement.chartLabelColor ?? '#ffffff', '--pcm-legend-gap': `${placement.legendGap ?? 12}px`, '--pcm-legend-size': `${placement.legendSize ?? placement.contentSize ?? 12}px` })
          Object.assign(cardStyle, { '--pcm-ornament-color': placement.ornamentColor ?? placement.accentColor ?? '#176fc1', '--pcm-ornament-pulses': placement.ornamentPulses ?? 0, '--pcm-ornament-rotation': `${({ tl: 0, tr: 90, br: 180, bl: 270 } as const)[placement.ornamentCorner ?? 'tr']}deg` })
          if (placement.ornament === 'fold') {
            const clips = { tl: 'polygon(24px 0,100% 0,100% 100%,0 100%,0 24px)', tr: 'polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,0 100%)', bl: 'polygon(0 0,100% 0,100% 100%,24px 100%,0 calc(100% - 24px))', br: 'polygon(0 0,100% 0,100% calc(100% - 24px),calc(100% - 24px) 100%,0 100%)' }
            Object.assign(cardStyle, { clipPath: clips[placement.ornamentCorner ?? 'tr'] })
          }
          if (placement.ornament === 'notch') Object.assign(cardStyle, { maskImage: `radial-gradient(circle at ${placement.ornamentCorner?.endsWith('l') ? '0%' : '100%'} ${placement.ornamentCorner?.startsWith('b') ? '100%' : '0%'}, transparent 20px, black 21px)` })
          Object.assign(cardStyle, { '--pcm-ornament-top': placement.ornamentCorner?.startsWith('b') ? 'auto' : '0px', '--pcm-ornament-bottom': placement.ornamentCorner?.startsWith('b') ? '0px' : 'auto', '--pcm-ornament-left': placement.ornamentCorner?.endsWith('l') ? '0px' : 'auto', '--pcm-ornament-right': placement.ornamentCorner?.endsWith('l') ? 'auto' : '0px' })
          Object.assign(cardStyle, { '--pcm-label-width': `${placement.chartLabelWidth ?? 35}%`, '--pcm-row-gap': `${placement.chartRowGap ?? 12}px` })
          if (placement.cornerCut) Object.assign(cardStyle, { clipPath: `polygon(0 0, calc(100% - ${placement.cornerCut}px) 0, 100% ${placement.cornerCut}px, 100% 100%, 0 100%)` })
          Object.assign(cardStyle, { borderWidth: placement.cardBorderStyle === 'double' ? '4px' : '1px' })
          Object.assign(cardStyle, { '--pcm-card-hover': placement.hoverColor ?? placement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d') })
          Object.assign(cardStyle, { '--pcm-title-shadow': placement.titleShadow ? shadowValue(placement.titleShadow) : '0 0 0 transparent', '--pcm-content-shadow': shadowValue(placement.contentShadow) })
          Object.assign(cardStyle, { '--pcm-text-tilt': `${placement.textTilt ?? 0}deg`, '--pcm-text-depth': `${placement.textDepth ?? 0}px` })
          Object.assign(cardStyle, { '--pcm-card-tilt': `${placement.cardTilt ?? 0}deg`, '--pcm-card-inset': `${placement.cardInset ?? 0}px` })
          Object.assign(cardStyle, { '--pcm-widget-title-size': `${placement.titleSize ?? 12}px`, '--pcm-widget-subtitle-size': `${placement.subtitleSize ?? 12}px` })
          Object.assign(cardStyle, { '--pcm-accent-clip': placement.accentPosition === 'corners' ? 'polygon(0 0, 28px 0, 28px 3px, 3px 3px, 3px 28px, 0 28px, 0 0, 100% 100%, calc(100% - 28px) 100%, calc(100% - 28px) calc(100% - 3px), calc(100% - 3px) calc(100% - 3px), calc(100% - 3px) calc(100% - 28px), 100% calc(100% - 28px), 100% 100%)' : 'none', '--pcm-card-shadow': shadowValue(placement.cardShadow), '--pcm-accent-inset': placement.accentPosition === 'top' ? '0 0 auto 0' : placement.accentPosition === 'bottom' ? 'auto 0 0 0' : placement.accentPosition === 'right' ? '0 0 0 auto' : '0 auto 0 0', '--pcm-accent-width': placement.accentPosition === 'corners' ? '100%' : placement.accentPosition === 'top' || placement.accentPosition === 'bottom' ? '100%' : '3px', '--pcm-accent-height': placement.accentPosition === 'top' || placement.accentPosition === 'bottom' ? '3px' : '100%', '--pcm-accent-display': placement.accentPosition === 'none' ? 'none' : 'block' })
          const volume = getChartVolume(placement)
          Object.assign(cardStyle, { '--pcm-legend-hover-color': placement.legendHoverColor ?? '#176fc1', '--pcm-legend-hover-opacity': `${placement.legendHoverOpacity ?? 12}%`, '--pcm-volume-space': `${volume.amount * (placement.chartDiameter ?? 112) / 100}px`, '--pcm-volume-shadow': volume.amount === 0 ? 'none' : Array.from({ length: Math.ceil(volume.amount) }, (_, index) => `${volume.x * (index + 1) / volume.amount}px ${volume.y * (index + 1) / volume.amount}px 0 color-mix(in srgb, var(--pcm-widget-chart) 65%, black)`).join(', ') })
          Object.assign(cardStyle, { '--pcm-grid-style': placement.chartGridStyle ?? 'solid', '--pcm-grid-border-width': `${placement.chartGridWidth === 0 ? 0 : placement.chartGridStyle === 'double' ? Math.max(3, (placement.chartGridWidth ?? 1) * 3) : placement.chartGridWidth ?? 1}px` })
          Object.assign(cardStyle, { '--pcm-focus-cut': `${(placement.chartFocusIntensity ?? 60) * .6}%`, '--pcm-focus-scale': 1 + (placement.chartFocusIntensity ?? 60) / 1600, '--pcm-focus-alpha': (placement.chartFocusIntensity ?? 60) / 100, '--pcm-focus-duration': `${placement.chartFocusDuration ?? 650}ms`, '--pcm-focus-brightness': 1 + (placement.chartFocusIntensity ?? 60) / 160, '--pcm-focus-shift': `${(placement.chartFocusIntensity ?? 60) / 35}px`, '--pcm-focus-radius': `${(placement.chartFocusIntensity ?? 60) / 8}px`, '--pcm-focus-color': placement.chartFocusColor ?? '#ffffff', '--pcm-focus-dim': 1 - (placement.chartFocusDim ?? 70) / 100 })
          Object.assign(cardStyle, { '--pcm-circle-diameter': `${placement.chartDiameter ?? 112}px`, '--pcm-label-value': placement.chartLabels === 'value' ? 'block' : 'none', '--pcm-label-percent': placement.chartLabels === 'percent' ? 'block' : 'none', '--pcm-legend-display': placement.legendPosition === 'hidden' ? 'none' : 'grid', '--pcm-pie-columns': placement.legendPosition === 'bottom' || placement.legendPosition === 'top' ? '1fr' : 'auto minmax(0, 1fr)', '--pcm-legend-order': placement.legendPosition === 'top' ? -1 : 1 })
          return <article data-card-focus={placement.cardFocusEffect ?? 'none'} data-focus-target={placement.chartFocusTarget ?? 'chart'} data-chart-volume={volume.enabled} data-chart-focus={placement.chartFocusIntensity === 0 ? 'none' : placement.chartFocusEffect ?? 'none'} data-chart-focus-trigger={placement.chartFocusTrigger ?? 'both'} key={widget.id} data-widget-id={widget.id} data-card-transparent={isTransparent ? 'true' : 'false'} data-chart-style={placement.chartStyle ?? 'default'} data-icon-position={placement.iconPosition ?? 'inline'} data-show-title={placement.showTitle === false || (widget.action && placement.showTitle === undefined) ? 'false' : 'true'} data-action-card={widget.action ? 'true' : 'false'} data-show-action-label={placement.showActionLabel === false ? 'false' : 'true'} data-button-style={placement.buttonStyle ?? (widget.action ? 'minimal' : 'outline')} data-button-radius={placement.buttonRadius ?? 'soft'} data-card-effect={placement.cardEffect ?? 'flat'} data-card-shape={placement.shape ?? 'free'} data-card-tone={isDarkColor(backgroundColor === 'transparent' ? undefined : backgroundColor, dashboardTheme) ? 'dark' : 'light'} className={`pcm-canvas__widget${isFreePositioned ? ' is-free-positioned' : ''}${dragging === `widget:${widget.id}` ? ' is-dragging' : ''}${selectedIds.includes(widget.id) ? ' is-selected' : ''}${paletteWidgetId === widget.id ? ' has-palette-open' : ''}${movingActionWidgetId === widget.id ? ' is-move-armed' : ''}`} style={{ ...cardStyle, '--pcm-card-focus-duration': `${placement.cardFocusDuration ?? 450}ms` } as CSSProperties} onPointerDown={!widget.action ? event => startWidgetMove(event, widget.id, group.id) : widget.action && movingActionWidgetId === widget.id ? event => startWidgetMove(event, widget.id, group.id, true) : undefined} onPointerMove={!widget.action ? moveWidgetPointer : widget.action && movingActionWidgetId === widget.id ? moveWidgetPointer : undefined} onPointerUp={!widget.action ? finishWidgetMove : widget.action && movingActionWidgetId === widget.id ? finishWidgetMove : undefined} onPointerCancel={!widget.action ? finishWidgetMove : widget.action && movingActionWidgetId === widget.id ? finishWidgetMove : undefined} onClickCapture={widget.action ? event => { if (suppressActionClick.current === widget.id) { event.preventDefault(); event.stopPropagation(); suppressActionClick.current = null } } : undefined} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'widget', id: widget.id, x: event.clientX, y: event.clientY }) }}>
            {placement.ornament && placement.ornament !== 'none' && placement.ornament !== 'notch' ? <span aria-hidden="true" className={`pcm-canvas__ornament is-${placement.ornament}`} /> : null}
            {placement.ornament === 'notch' && placement.cardBorder !== 'none' ? <svg aria-hidden="true" className="pcm-canvas__notch-border" viewBox="0 0 24 24"><path d="M 21 0 A 21 21 0 0 1 0 21" fill="none" stroke="var(--pcm-widget-border)" strokeWidth={placement.cardBorderStyle === 'double' ? 4 : 2} /></svg> : null}
            <header className="pcm-canvas__widget-heading">
              <button type="button" className={`pcm-canvas__select-handle${selectedIds.includes(widget.id) ? ' is-selected' : ''}`} title={selectedIds.includes(widget.id) ? 'Remover da seleção' : 'Selecionar para agrupar'} aria-label={selectedIds.includes(widget.id) ? `Desselecionar ${widget.title}` : `Selecionar ${widget.title}`} aria-pressed={selectedIds.includes(widget.id)} onClick={event => { event.stopPropagation(); toggleSelectedWidget(widget.id) }}><Check size={12} aria-hidden="true" /></button>
              <div className="pcm-canvas__widget-title" role="button" tabIndex={0} title="Arraste para posicionar; Ctrl/Cmd+clique para selecionar vários" aria-pressed={selectedIds.includes(widget.id)} onClick={event => selectWidget(widget.id, event)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWidget(widget.id, event) } }}>
                <span><strong title={widget.id === 'monthly-mttr' ? widget.title : placement.customTitle || widget.title}>{widget.id === 'monthly-mttr' ? (placement.customTitle ? placement.customTitle.replace(/MTTR|MTBF/gi, widget.title.startsWith('MTBF') ? 'MTBF' : 'MTTR') : widget.title) : placement.customTitle || widget.title}</strong>{placement.customSubtitle ? <small title={placement.customSubtitle}>{placement.customSubtitle}</small> : null}</span>
              </div>
              <div className="pcm-canvas__palette-control" onPointerDown={event => event.stopPropagation()}>
            {!widget.action ? <div className="pcm-canvas__filter-control" onPointerDown={event => event.stopPropagation()}><button type="button" className={`pcm-canvas__icon-button pcm-canvas__filter-trigger${filterWidgetId === widget.id ? ' is-active' : ''}`} aria-label={`Filtrar indicador ${widget.title}`} aria-expanded={filterWidgetId === widget.id} title="Filtrar este indicador" onClick={event => { event.stopPropagation(); setPaletteWidgetId(null); setStyleLibraryOpen(false); setGroupEditor(null); setContextMenu(null); if (filterWidgetId === widget.id) { setFilterWidgetId(null); setFilterAnchor(null) } else { setFilterWidgetId(widget.id); setFilterAnchor(event.currentTarget) } }}><Filter size={13} aria-hidden="true" /></button></div> : null}
                <button type="button" className="pcm-canvas__icon-button pcm-canvas__palette-trigger" aria-label={`Personalizar ${widget.action ? 'botão' : 'card'} ${widget.title}`} aria-expanded={paletteWidgetId === widget.id} title={widget.action ? 'Personalizar botão' : 'Personalizar card'} onClick={event => { event.stopPropagation(); if (paletteWidgetId === widget.id) setPaletteWidgetId(null); else { setGroupEditor(null); setStyleLibraryOpen(false); setFilterWidgetId(null); setFilterAnchor(null); setContextMenu(null); setPaletteWidgetId(widget.id) } }}><Palette size={13} aria-hidden="true" /></button>
              </div>
            </header>
            <div className={`pcm-canvas__widget-body${widget.onActivate ? ' is-interactive' : ''}`} onClick={widget.onActivate ? event => { if ((event.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return; widget.onActivate?.() } : undefined} onKeyDown={widget.onActivate ? event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); widget.onActivate?.() } } : undefined} role={widget.onActivate ? 'button' : undefined} tabIndex={widget.onActivate ? 0 : undefined} title={widget.onActivate ? 'Abrir detalhes' : undefined}><PcmChartPresentationContext.Provider value={widget.id === 'monthly-mttr' ? { ...placement, timeUnit: widget.title.startsWith('MTBF') ? sourceMetric?.mtbfUnit ?? 'h' : sourceMetric?.mttrUnit ?? 'h' } : placement}>{widget.render(mode, chartPalette, effectiveSegments, placement.chartStyle)}</PcmChartPresentationContext.Provider></div>
            {isFreePositioned && !placement.shape ? <button type="button" className="pcm-canvas__resize-handle pcm-canvas__resize-handle--top" aria-label={`Redimensionar ${widget.title} pela borda superior`} title="Arraste para cima ou para baixo para ajustar a altura" onPointerDown={event => startResize(event, 'widget', widget.id, currentSpan, 'top')} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button> : null}
            <button type="button" className="pcm-canvas__resize-handle" aria-label={`Redimensionar ${widget.title}`} title="Arraste para ajustar largura e altura" onPointerDown={event => startResize(event, 'widget', widget.id, currentSpan)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button>
            {(['left', 'right', ...(!placement.shape ? ['bottom'] : [])] as Array<'left' | 'right' | 'bottom'>).map(edge => <button key={edge} type="button" className={`pcm-canvas__resize-handle pcm-canvas__resize-handle--${edge}`} aria-label={`Redimensionar ${widget.title} pela borda ${edge === 'left' ? 'esquerda' : edge === 'right' ? 'direita' : 'inferior'}`} title={edge === 'bottom' ? 'Arraste para ajustar a altura' : 'Arraste para ajustar a largura'} onPointerDown={event => startResize(event, 'widget', widget.id, currentSpan, edge)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button>)}
          </article>
        })}
        {dropTarget?.groupId === group.id && dropTarget.left !== undefined && dropTarget.top !== undefined && dragging.startsWith('widget:') ? (() => {
          const draggedId = dragging.slice('widget:'.length)
          const draggedPlacement = layout.placements[draggedId]
          if (!draggedPlacement) return null
          return <div aria-hidden="true" className="pcm-canvas__drop-preview" style={{ '--pcm-drop-left': `${dropTarget.left}%`, '--pcm-drop-top': `${dropTarget.top}px`, '--pcm-drop-width': `${(draggedPlacement.span / 24) * 100}%`, '--pcm-drop-height': `${draggedPlacement.height ?? 96}px` } as CSSProperties} />
        })() : null}
        {childZones.map(zone => renderZone(zone, true))}
        {groupIds.length === 0 && childZones.length === 0 ? <p className="pcm-canvas__empty">Nenhum indicador nesta zona.</p> : null}
      </div>
      {group.id !== boardGroup.id ? <button type="button" className="pcm-canvas__resize-handle pcm-canvas__resize-handle--group" aria-label={`Redimensionar zona ${group.label}`} title="Arraste para ajustar a largura e altura da zona" onPointerDown={event => startResize(event, 'group', group.id, width)} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize}><span aria-hidden="true" /></button> : null}
    </section>
  }

  return <section style={{ backgroundColor: panelAppearance.background, boxShadow: `inset 0 0 0 ${panelAppearance.width}px ${panelAppearance.border}, 0 ${panelShadow}px ${panelShadow * 3}px #10223430`, padding: '10px', borderRadius: '8px' }} className={`pcm-canvas${layout.magnetEnabled ? ' is-magnetized' : ''}`} aria-label="Lousa configurável do PCM">
    <style>{toolbarFeatures.filter(feature => toolbarHidden.includes(feature.id)).map(feature => `.pcm-canvas > .pcm-canvas__toolbar ${feature.selector} { display: none !important; }`).join(' ')}</style>
    <header className="pcm-canvas__toolbar">
      <div className="pcm-canvas__toolbar-title">{helpContent ? <div className="pcm-canvas__help-placement"><button type="button" className="pcm-canvas__icon-button pcm-canvas__help-trigger" aria-label="Ajuda sobre a lousa" aria-expanded={helpOpen} onClick={() => setHelpOpen(value => !value)}><CircleHelp size={15} /></button>{helpOpen ? <div className="pcm-canvas__help-popover" role="dialog" aria-label="Ajuda sobre a lousa">{helpContent}</div> : null}</div> : null}<h2>Lousa do PCM</h2><span>{visibleWidgetIds.length}</span><button type="button" className="pcm-canvas__button pcm-canvas__select-mode" aria-pressed={selectionMode} onClick={() => setSelectionMode(value => !value)}><Check size={14} />{selectionMode ? `Concluir seleção · ${selectedIds.length}` : 'Selecionar cards'}</button>{selectionMode ? <button type="button" className="pcm-canvas__button" onClick={() => setSelectedIds([...visibleWidgetIds])}>Selecionar todos</button> : null}{selectedIds.length > 0 ? <><button type="button" className="pcm-canvas__button" onClick={() => { setStyleLibraryScope('selected'); setStyleLibraryOpen(true); setSelectionMode(false) }}>Estilo dos selecionados · {selectedIds.length}</button><button type="button" className="pcm-canvas__button" onClick={() => setSelectedIds([])}>Limpar seleção</button></> : null}</div>

      <div className="pcm-canvas__toolbar-tools">

<details className="pcm-canvas__layout-menu"><summary className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Organizar a lousa" aria-label="Organizar a lousa"><Magnet size={15} /></summary>
<div className="pcm-canvas__layout-options pcm-canvas__arrange-options">
<header><strong>Organizar a lousa</strong><small>Encaixe e alinhamento dos cards</small></header>
<label className="pcm-canvas__snap-switch"><span>Encaixe automático</span><input type="checkbox" checked={layout.magnetEnabled} onChange={toggleMagnet} /></label>
<div className="pcm-canvas__snap-modes" role="group" aria-label="Modo de encaixe">
<button type="button" aria-pressed={snapMode === 'magnet'} onClick={() => setSnapMode('magnet')}><Magnet size={17} /><span>Ímã<small>Respeitar espaço</small></span></button>
<button type="button" aria-pressed={snapMode === 'alignment'} onClick={() => setSnapMode('alignment')}><Move size={17} /><span>Alinhamento<small>Bordas e centros</small></span></button>
</div>
<label className="pcm-canvas__spacing-field"><span>Espaçamento<output>{spacing} px</output></span><input type="range" min={0} max={48} value={spacing} onChange={event => setSpacing(Number(event.currentTarget.value))} /></label>
<strong className="pcm-canvas__arrange-label">Aplicar à seleção · {selectedIds.length}</strong>
<div className="pcm-canvas__align-grid">
{([{ id: 'left', label: 'Esquerda', rotate: 0 }, { id: 'top', label: 'Topo', rotate: 90 }, { id: 'horizontal', label: 'Espaçar na horizontal', rotate: 0 }, { id: 'vertical', label: 'Espaçar na vertical', rotate: 90 }] as const).map(action => <button key={action.id} type="button" title={action.label} aria-label={action.label} disabled={selectedIds.length < 2} onClick={() => alignSelection(action.id)}>{action.id === 'left' || action.id === 'top' ? <Move size={19} style={{ transform: `rotate(${action.rotate}deg)` }} /> : <Layers size={19} style={{ transform: `rotate(${action.rotate}deg)` }} />}<span>{action.label}</span></button>)}
</div>
{selectedIds.length < 2 ? <p>Selecione dois ou mais cards do mesmo grupo.</p> : null}
</div></details>
        {toolbarContent}
        {onOpenHistory ? <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Abrir histórico e análise" aria-label="Abrir histórico e análise" onClick={onOpenHistory}><History size={15} aria-hidden="true" /></button> : null}
        <label className="pcm-canvas__search" title="Buscar indicador"><Search size={14} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar indicador no painel" placeholder="Buscar" /></label>
        <label className="pcm-canvas__filter" title="Filtrar por categoria"><Filter size={14} aria-hidden="true" /><select value={filterCategory} onChange={event => setFilterCategory(event.target.value)} aria-label="Filtrar por categoria"><option value="all">Todas</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        {segmentFilters.length ? <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon${segmentFiltersOpen ? ' is-active' : ''}`} title="Segmentar os dados dos indicadores" aria-label="Mostrar filtros de segmentação" aria-expanded={segmentFiltersOpen} onClick={() => setSegmentFiltersOpen(value => !value)}><Filter size={14} aria-hidden="true" /></button> : null}
        {onPrintCanvas ? <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Imprimir lousa atual" aria-label="Imprimir lousa atual" onClick={() => { if (boardRef.current) onPrintCanvas(boardRef.current, segmentFilters.flatMap(filter => segments[filter.id] ? [`${filter.label}: ${segments[filter.id]}`] : [])) }}><Printer size={15} aria-hidden="true" /></button> : null}
        <details className="pcm-canvas__layout-menu">
          <summary className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon${selectedLayoutId ? ' is-active' : ''}`} title="Escolher layout" aria-label="Escolher layout"><LayoutTemplate size={15} aria-hidden="true" /></summary>
          <div className="pcm-canvas__layout-options" role="menu" aria-label="Layouts disponíveis">
            <div className="pcm-canvas__layout-actions" role="group" aria-label="Ações do layout"><button type="button" title="Salvar como novo layout" aria-label="Salvar como novo layout" onClick={event => { setSavingNamedLayout(true); event.currentTarget.closest('details')?.removeAttribute('open') }}><Save size={15} aria-hidden="true" /></button><button type="button" title="Exportar layout" aria-label="Exportar layout" onClick={exportCurrentLayout}><Download size={15} aria-hidden="true" /></button><button type="button" title="Importar layout" aria-label="Importar layout" onClick={() => layoutImportRef.current?.click()}><Upload size={15} aria-hidden="true" /></button><input ref={layoutImportRef} type="file" accept="application/json,.json" onChange={importLayout} tabIndex={-1} aria-label="Importar layout JSON" /></div><strong>Layouts padrão</strong>
            {[[professionalLayoutId, 'Padrão profissional'], ['preset-reliability', 'Confiabilidade'], ['preset-blank', 'Em branco · limpar lousa']].map(([id, label]) => <button key={id} type="button" role="menuitemradio" aria-checked={selectedLayoutId === id} className={selectedLayoutId === id ? 'is-active' : ''} onClick={event => { applyBuiltInLayout(id); event.currentTarget.closest('details')?.removeAttribute('open') }}><span>{label}</span>{selectedLayoutId === id ? <Check size={14} aria-label="Layout ativo" /> : null}</button>)}
            {savedLayouts.length ? <><strong>Meus layouts</strong>{savedLayouts.map(item => <div className="pcm-canvas__saved-layout-row" key={item.id}><button type="button" role="menuitemradio" aria-checked={selectedLayoutId === item.id} className={selectedLayoutId === item.id ? 'is-active' : ''} onClick={event => { selectSavedLayout(item.id); event.currentTarget.closest('details')?.removeAttribute('open') }}><span>{item.name}</span>{selectedLayoutId === item.id ? <Check size={14} aria-label="Layout ativo" /> : null}</button><button type="button" className="pcm-canvas__saved-layout-delete" aria-label={`Excluir layout ${item.name}`} title={`Excluir layout ${item.name}`} onClick={event => { event.stopPropagation(); deleteSavedLayout(item.id, item.name) }}><Trash2 size={13} aria-hidden="true" /></button></div>)}</> : null}
          </div>
        </details>

        <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon pcm-canvas__style-library-trigger${styleLibraryOpen ? ' is-active' : ''}`} title="Abrir biblioteca de estilos" aria-label="Abrir biblioteca de estilos" aria-expanded={styleLibraryOpen} onClick={event => { event.stopPropagation(); const opening = !styleLibraryOpen; setPaletteWidgetId(null); setFilterWidgetId(null); setFilterAnchor(null); setGroupEditor(null); setContextMenu(null); setStyleLibraryOpen(opening) }}><Palette size={15} aria-hidden="true" /></button>

        <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon pcm-canvas__heading-toggle" title={allGroupHeadingsHidden ? 'Mostrar todos os cabeçalhos das zonas' : 'Ocultar todos os cabeçalhos das zonas'} aria-label={allGroupHeadingsHidden ? 'Mostrar todos os cabeçalhos das zonas' : 'Ocultar todos os cabeçalhos das zonas'} aria-pressed={allGroupHeadingsHidden} onClick={toggleAllGroupHeadings}>{allGroupHeadingsHidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}</button>
        <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Organizar indicadores em fluxo dentro das zonas" aria-label="Organizar indicadores" onClick={organizeCanvas}><Sparkles size={15} aria-hidden="true" /></button>
        <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title="Adicionar indicador" aria-label="Adicionar indicador" aria-expanded={catalogOpen} onClick={() => setCatalogOpen(value => !value)}><Plus size={16} /></button>
        {selectedIds.length >= 2 ? <button type="button" className="pcm-canvas__icon-button pcm-canvas__toolbar-icon" title={`Criar zona com ${selectedIds.length} indicadores selecionados`} aria-label={`Criar zona com ${selectedIds.length} indicadores selecionados`} onClick={() => setCreatingGroup(value => !value)}><Layers size={15} /></button> : null}

        <button type="button" className={`pcm-canvas__icon-button pcm-canvas__toolbar-icon pcm-canvas__save-button${unsaved ? ' is-pending' : ''}`} title={saveMessage || (unsaved ? 'Salvar alterações do layout' : 'Layout salvo')} aria-label={saveMessage || (unsaved ? 'Salvar alterações do layout' : 'Layout salvo')} onClick={saveLayout} disabled={!unsaved}><Save size={15} /></button>
        <span className="pcm-canvas__visually-hidden" role="status">{saveMessage || (unsaved ? 'Alterações do layout não salvas' : 'Layout salvo')}</span>
      </div>
    </header>

    {segmentFiltersOpen && segmentFilters.length ? <div className="pcm-canvas__segment-filters" aria-label="Filtros opcionais de segmentação">
      <span>Segmentar</span>
      {segmentFilters.map(filter => <label key={filter.id}><span>{filter.label}</span><select value={segments[filter.id] ?? ''} onChange={event => setSegments(current => ({ ...current, [filter.id]: event.target.value }))} aria-label={`Segmentar por ${filter.label}`}><option value="">Todos</option>{filter.options.map(option => <option value={option} key={option}>{option}</option>)}</select></label>)}
      {Object.values(segments).some(Boolean) ? <button type="button" onClick={() => setSegments({})}>Limpar</button> : null}
    </div> : null}

    {savingNamedLayout ? <form className="pcm-canvas__layout-form" onSubmit={saveNamedLayout}><label htmlFor="pcm-canvas-layout-name">Nome do layout</label><input id="pcm-canvas-layout-name" value={layoutName} onChange={event => setLayoutName(event.target.value)} maxLength={40} autoFocus placeholder="Ex.: Acompanhamento semanal" /><button type="submit" disabled={!layoutName.trim()}>Salvar layout</button><button type="button" onClick={() => { setSavingNamedLayout(false); setLayoutName('') }}>Cancelar</button></form> : null}

    {creatingGroup ? <form className="pcm-canvas__group-form" onSubmit={createGroup}>
      <label htmlFor="pcm-canvas-group-name">Nome da zona</label><input id="pcm-canvas-group-name" value={groupName} onChange={event => setGroupName(event.target.value)} maxLength={40} autoFocus placeholder="Ex.: Indicadores críticos" />
      <button type="submit" disabled={!groupName.trim() || selectedIds.length < 2}>Criar zona</button><button type="button" onClick={() => { setCreatingGroup(false); setGroupName('') }}>Cancelar</button>
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

    <div ref={boardRef} data-selection-mode={selectionMode ? 'true' : 'false'} onClickCapture={event => { if (!selectionMode) return; const card = (event.target as Element).closest<HTMLElement>('[data-widget-id]'); const id = card?.dataset.widgetId; if (!id) return; event.preventDefault(); event.stopPropagation(); toggleSelectedWidget(id) }} style={{ backgroundColor: panelAppearance.background, boxShadow: panelAppearance.width ? `inset 0 0 0 ${panelAppearance.width}px ${panelAppearance.border}` : 'none' }} className={`pcm-canvas__board${selectionMode || selectedIds.length ? ' is-selecting' : ''}`} onDragOver={event => { event.preventDefault(); if (!dragging.startsWith('widget:')) setDropTarget({ groupId: boardGroup.id }) }} onDrop={event => handleDrop(event, boardGroup.id)}>
      {pasteTarget ? createPortal(<div className="pcm-canvas__paste-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setPasteTarget(null) }}><section className="pcm-canvas__paste-dialog" role="dialog" aria-modal="true" aria-label="Colar aparência"><strong>Colar aparência</strong><p>Escolha as propriedades para aplicar neste card.</p>{[['colors', 'Fundo e cores'], ['effects', 'Efeitos e decorações'], ['border', 'Bordas e formato'], ['text', 'Tipografia e ícones'], ['chart', 'Gráfico e legenda']].map(([id, label]) => <label key={id}><input type="checkbox" checked={pasteSections.includes(id)} onChange={event => setPasteSections(current => event.target.checked ? [...current, id] : current.filter(value => value !== id))} />{label}</label>)}<footer><button type="button" onClick={() => setPasteTarget(null)}>Cancelar</button><button type="button" disabled={!pasteSections.length} onClick={applyCopiedAppearance}>Aplicar propriedades</button></footer></section></div>, document.body) : null}
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
      {layout.placements && visibleGroupIds.has(boardGroup.id) ? renderZone(boardGroup) : null}
      {layout.groupOrder.map(groupId => allGroups.find(group => group.id === groupId)).filter((group): group is PcmCanvasGroup => Boolean(group && group.id !== boardGroup.id && !group.parentId)).map(group => renderZone(group))}
    </div>
    {editableGroup && groupEditor ? createPortal(<div className="pcm-canvas__group-editor" role="dialog" aria-label={`Personalizar grupo ${editableGroup.label}`} onPointerDown={event => event.stopPropagation()}>
      <header><strong>Personalizar grupo</strong><button type="button" aria-label="Fechar personalização do grupo" onClick={() => setGroupEditor(null)}><X size={14} /></button></header>
      <fieldset><legend>Título e subtítulo</legend><label>Subtítulo<input value={editableGroup.subtitle ?? ''} onChange={event => updateGroup(editableGroup.id, { subtitle: event.currentTarget.value })} /></label><label>Alinhamento<select value={editableGroup.titleAlign ?? 'left'} onChange={event => updateGroup(editableGroup.id, { titleAlign: event.currentTarget.value as PcmCanvasGroup['titleAlign'] })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label><label>Título · {editableGroup.titleSize ?? 11}px<input type="range" min={9} max={30} value={editableGroup.titleSize ?? 11} onChange={event => updateGroup(editableGroup.id, { titleSize: Number(event.currentTarget.value) })} /></label><label>Subtítulo · {editableGroup.subtitleSize ?? 10}px<input type="range" min={8} max={24} value={editableGroup.subtitleSize ?? 10} onChange={event => updateGroup(editableGroup.id, { subtitleSize: Number(event.currentTarget.value) })} /></label><label>Cor do subtítulo<PcmColorInput type="color" value={editableGroup.subtitleColor ?? '#91aabb'} onChange={event => updateGroup(editableGroup.id, { subtitleColor: event.currentTarget.value })} /></label></fieldset>
      <label className="pcm-canvas__group-editor-field">Nome<input type="text" value={editableGroup.label} maxLength={40} onChange={event => updateGroup(editableGroup.id, { label: event.target.value.slice(0, 40) })} /></label>
      <label className="pcm-canvas__group-editor-field">Zona contida em<select value={editableGroup.parentId ?? boardGroup.id} onChange={event => setGroupParent(editableGroup.id, event.target.value)}><option value={boardGroup.id}>Painel principal</option>{layout.customGroups.filter(group => group.id !== editableGroup.id && !editableGroupDescendants.has(group.id)).map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
      <label className="pcm-canvas__group-heading-toggle"><span>Mostrar cabeçalho</span><input type="checkbox" checked={editableGroup.showHeading !== false} onChange={event => updateGroup(editableGroup.id, { showHeading: event.target.checked })} /></label>
      {editableGroupIsActionGroup ? <fieldset><legend>Disposição dos botões</legend><div className="pcm-canvas__group-widths"><button type="button" className={editableGroupOrientation === 'row' ? 'is-active' : ''} aria-pressed={editableGroupOrientation === 'row'} onClick={() => setActionGroupOrientation(editableGroup.id, 'row')}>Lado a lado</button><button type="button" className={editableGroupOrientation === 'column' ? 'is-active' : ''} aria-pressed={editableGroupOrientation === 'column'} onClick={() => setActionGroupOrientation(editableGroup.id, 'column')}>Em coluna</button></div></fieldset> : null}
      <fieldset><legend>Tamanho</legend><div className="pcm-canvas__group-widths">{([[6, '25%'], [12, '50%'], [18, '75%'], [24, '100%']] as const).map(([width, label]) => <button key={width} type="button" className={(layout.groupWidths[editableGroup.id] ?? 12) === width ? 'is-active' : ''} aria-pressed={(layout.groupWidths[editableGroup.id] ?? 12) === width} onClick={() => setLayout(current => ({ ...current, groupWidths: { ...current.groupWidths, [editableGroup.id]: width } }))}>{label}</button>)}</div></fieldset>
      <fieldset><legend>Aparência</legend>
        <label>Fundo<span className="pcm-canvas__group-color"><PcmColorInput type="color" value={editableGroup.background && editableGroup.background !== 'transparent' ? editableGroup.background : '#ffffff'} disabled={editableGroup.background === 'transparent'} onChange={event => updateGroup(editableGroup.id, { background: event.target.value })} /><button type="button" className={editableGroup.background === 'transparent' ? 'is-active' : ''} aria-pressed={editableGroup.background === 'transparent'} onClick={() => updateGroup(editableGroup.id, { background: editableGroup.background === 'transparent' ? '#ffffff' : 'transparent' })}>Transparente</button></span></label>
        <label>Opacidade do fundo · {editableGroup.backgroundOpacity ?? 100}%<input type="range" min={0} max={100} value={editableGroup.backgroundOpacity ?? 100} onChange={event => updateGroup(editableGroup.id, { backgroundOpacity: Number(event.currentTarget.value) })} /></label>
        <label>Borda<span className="pcm-canvas__group-color"><PcmColorInput type="color" value={editableGroup.border && editableGroup.border !== 'none' ? editableGroup.border : '#dce5eb'} disabled={editableGroup.border === 'none'} onChange={event => updateGroup(editableGroup.id, { border: event.target.value })} /><button type="button" className={editableGroup.border === 'none' ? 'is-active' : ''} aria-pressed={editableGroup.border === 'none'} onClick={() => updateGroup(editableGroup.id, { border: editableGroup.border === 'none' ? '#dce5eb' : 'none' })}>Sem borda</button></span></label>
        <div className="pcm-canvas__corner-options" role="group" aria-label="Formato dos cantos da zona"><span>Cantos</span>{([['square', 'Reto'], ['soft', 'Leve'], ['round', 'Arredondado']] as const).map(([radius, label]) => <button key={radius} type="button" className={(editableGroup.radius ?? 'soft') === radius ? 'is-active' : ''} aria-pressed={(editableGroup.radius ?? 'soft') === radius} onClick={() => updateGroup(editableGroup.id, { radius })}>{label}</button>)}</div>
        <label>Cor do título<PcmColorInput type="color" value={editableGroup.titleColor ?? '#23445e'} onChange={event => updateGroup(editableGroup.id, { titleColor: event.target.value })} /></label>
      </fieldset>
      <button type="button" className="pcm-canvas__group-editor-reset" onClick={() => updateGroup(editableGroup.id, { background: undefined, backgroundOpacity: undefined, border: undefined, radius: undefined, titleColor: undefined })}>Restaurar aparência</button>
    </div>, document.body) : null}
    {paletteWidget && palettePlacement && paletteMode ? createPortal(<div className="pcm-canvas__palette-menu" data-panel-side={panelSide} role="dialog" aria-label={`Personalização de ${paletteWidget.title}`} onPointerDown={event => event.stopPropagation()}>
      <button type="button" className="pcm-canvas__side-switch" onClick={() => setPanelSide(side => side === 'right' ? 'left' : 'right')}><Move size={14} />{panelSide === 'right' ? 'Mover para esquerda' : 'Mover para direita'}</button>
      <header><strong>Personalizar {paletteWidget.action ? 'botão' : 'card'}</strong></header>
      <details className="pcm-canvas__editor-section"><summary>Animação independente do card</summary><label>Efeito do card<select value={palettePlacement.cardFocusEffect ?? 'none'} onChange={event => { const cardFocusEffect = event.currentTarget.value as PcmChartPresentation['cardFocusEffect']; setPlacement(paletteWidget.id, value => ({ ...value, cardFocusEffect, chartFocusTarget: 'chart' })) }}><option value="none">Sem animação</option><option value="lift">Elevação</option><option value="glow">Halo de luz</option><option value="pulse">Pulso suave</option><option value="reflection">Reflexo</option></select></label><label>Duração · {palettePlacement.cardFocusDuration ?? 450}ms<input type="range" min={200} max={1600} step={50} value={palettePlacement.cardFocusDuration ?? 450} onChange={event => { const cardFocusDuration = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, cardFocusDuration })) }} /></label><small>Combina com o efeito configurado em Gráfico → Efeitos de foco.</small></details>
      {paletteWidget.id === 'mttr-mtbf-comparison' ? <fieldset><legend>Unidades de tempo</legend>{(['mttrUnit', 'mtbfUnit'] as const).map(key => <label key={key}>{key === 'mttrUnit' ? 'MTTR' : 'MTBF'}<select value={palettePlacement[key] ?? 'h'} onChange={event => { const unit = event.currentTarget.value as PcmChartPresentation['timeUnit']; setPlacement(paletteWidget.id, value => ({ ...value, [key]: unit })) }}><option value="h">Horas (padrão)</option><option value="auto">Automático</option><option value="s">Segundos</option><option value="min">Minutos</option><option value="d">Dias (24 horas)</option></select></label>)}</fieldset> : null}
      {paletteWidget.id === 'mttr-mtbf-comparison' ? <details className="pcm-canvas__editor-section" open><summary>Apresentação dos indicadores</summary>{([['metricNameSize', 'Tamanho de MTTR e MTBF', 24, 10, 40, 'px'], ['metricValueSize', 'Tamanho dos valores', 18, 8, 48, 'px'], ['metricBarWidth', 'Largura da barra', 100, 20, 100, '%'], ['metricBarHeight', 'Espessura da barra', 5, 1, 20, 'px']] as const).map(([key, label, fallback, min, max, unit]) => <label key={key}>{label} · {palettePlacement[key] ?? fallback}{unit}<input type="range" min={min} max={max} value={palettePlacement[key] ?? fallback} onChange={event => { const next = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, [key]: next })) }} /></label>)}<small>Ambos medem tempo. Os dados em segundos são convertidos para a unidade exibida.</small></details> : null}
      {paletteWidget.id === 'mttr-mtbf-comparison' ? <details className="pcm-canvas__editor-section" open><summary>Vínculo com o gráfico mensal</summary><label className="pcm-canvas__palette-toggle"><span>Usar as cores de MTTR e MTBF no gráfico</span><input type="checkbox" checked={palettePlacement.linkTimeMetricColors !== false} onChange={event => { const linkTimeMetricColors = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, linkTimeMetricColors })) }} /></label><small>Ao clicar em MTTR ou MTBF, o gráfico mensal acompanha o indicador. Configure as duas cores em Gráfico.</small></details> : null}
      <details className="pcm-canvas__editor-section"><summary>Texto</summary>
        <label className="pcm-canvas__palette-toggle"><span>Mostrar título</span><input type="checkbox" checked={palettePlacement.showTitle ?? !paletteWidget.action} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, showTitle: event.target.checked }))} /></label>
        <label className="pcm-canvas__palette-title-field">Título<input type="text" value={palettePlacement.customTitle ?? paletteWidget.title} maxLength={60} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customTitle: event.target.value }))} aria-label="Título do card" /></label>
        <label className="pcm-canvas__palette-title-field">Subtítulo<input type="text" value={palettePlacement.customSubtitle ?? ''} maxLength={100} placeholder="Adicionar uma descrição curta" onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customSubtitle: event.target.value }))} aria-label="Subtítulo do card" /></label>
        <label>Alinhamento do título<select value={palettePlacement.titleAlign ?? 'left'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, titleAlign: event.target.value as CanvasPlacement['titleAlign'] }))}><option value="left">À esquerda</option><option value="center">Centralizado</option><option value="right">À direita</option></select></label>
        <ContentSizeField value={palettePlacement.contentSize ?? 25} onChange={size => setPlacement(paletteWidget.id, value => ({ ...value, contentSize: size }))} />
        <label className="pcm-canvas__range-field"><span>Corte no canto superior direito · {palettePlacement.cornerCut ?? 0}px</span><input type="range" min={0} max={40} value={palettePlacement.cornerCut ?? 0} onChange={event => { const cornerCut = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, cornerCut })) }} /></label>
        <label className="pcm-canvas__range-field"><span>Raio dos cantos · {parseCornerRadius(palettePlacement.cardRadius) ?? 4}px</span><input type="range" min={0} max={300} value={parseCornerRadius(palettePlacement.cardRadius) ?? 4} onChange={event => { const cardRadius = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, cardRadius })) }} /></label>
        <label className="pcm-canvas__range-field"><span>Tamanho do subtítulo <output>{palettePlacement.subtitleSize ?? 12}px</output></span><input type="range" min={8} max={25} step={1} value={palettePlacement.subtitleSize ?? 12} onChange={event => { const subtitleSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, subtitleSize })) }} aria-label="Tamanho do subtítulo" /></label>
        <label className="pcm-canvas__range-field"><span>Tamanho do ícone <output>{palettePlacement.iconSize ?? 22}px</output></span><input type="range" min={12} max={40} step={1} value={palettePlacement.iconSize ?? 22} onChange={event => { const iconSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, iconSize })) }} aria-label="Tamanho do ícone no conteúdo" /></label>
        <label className="pcm-canvas__range-field"><span>Tamanho do título <output>{palettePlacement.titleSize ?? 12}px</output></span><input type="range" min={10} max={25} step={1} value={palettePlacement.titleSize ?? 12} onChange={event => { const size = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, titleSize: size as CanvasPlacement['titleSize'] })) }} aria-label="Tamanho do título" /></label>
      </details>
      <details className="pcm-canvas__editor-section"><summary>Destaque do card</summary>
        <label>Cor do detalhe<PcmColorInput type="color" value={palettePlacement.ornamentColor ?? palettePlacement.accentColor ?? '#176fc1'} onChange={event => { const ornamentColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, ornamentColor })) }} /></label>
        {palettePlacement.ornament === 'dot' ? <label>Pulsações · {palettePlacement.ornamentPulses ?? 0}<input type="range" min={0} max={10} step={1} value={palettePlacement.ornamentPulses ?? 0} onChange={event => { const ornamentPulses = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, ornamentPulses })) }} /></label> : null}
        <label>Enfeite de canto<select value={palettePlacement.ornament ?? 'none'} onChange={event => { const ornament = event.currentTarget.value as CanvasPlacement['ornament']; setPlacement(paletteWidget.id, value => ({ ...value, ornament })) }}><option value="none">Sem enfeite</option><option value="fold">Dobra de papel</option><option value="dot">Detalhe circular</option><option value="notch">Recorte circular</option></select></label>
        <label>Canto<select value={palettePlacement.ornamentCorner ?? 'tr'} onChange={event => { const ornamentCorner = event.currentTarget.value as CanvasPlacement['ornamentCorner']; setPlacement(paletteWidget.id, value => ({ ...value, ornamentCorner })) }}><option value="tl">Superior esquerdo</option><option value="tr">Superior direito</option><option value="bl">Inferior esquerdo</option><option value="br">Inferior direito</option></select></label>
        <label>Posição da faixa<select value={palettePlacement.accentPosition ?? 'left'} onChange={event => { const accentPosition = event.currentTarget.value as CanvasPlacement['accentPosition']; setPlacement(paletteWidget.id, value => ({ ...value, accentPosition })) }}><option value="left">Esquerda</option><option value="right">Direita</option><option value="corners">Quinas opostas</option><option value="top">Topo</option><option value="bottom">Base</option><option value="none">Sem faixa</option></select></label>
        <label className="pcm-canvas__range-field"><span>Sombra do card · {palettePlacement.cardShadow ?? 0}</span><input type="range" min={0} max={24} value={palettePlacement.cardShadow ?? 0} onChange={event => { const cardShadow = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, cardShadow })) }} /></label>
      </details>
      {paletteWidget.modes.length > 1 ? <details className="pcm-canvas__editor-section"><summary>Visualização</summary>
        <label>Formato do conteúdo<select value={paletteMode} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, mode: event.target.value as PcmCanvasMode }))}>{paletteWidget.modes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </details> : null}
      <details className="pcm-canvas__editor-section"><summary>Tamanho do card</summary>
        <label className="pcm-canvas__palette-toggle"><span>Manter proporção ao redimensionar</span><input type="checkbox" checked={Boolean(palettePlacement.aspectLocked || palettePlacement.shape)} disabled={Boolean(palettePlacement.shape)} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, aspectLocked: event.target.checked }))} /></label>
        <p className="pcm-canvas__editor-hint">Redimensiona largura, altura, ícone e texto juntos.</p>
        <div className="pcm-canvas__palette-presets" aria-label="Formato do card">
          <button type="button" className={!palettePlacement.shape ? 'is-active' : ''} aria-pressed={!palettePlacement.shape} onClick={() => setWidgetShape(paletteWidget.id, undefined, palettePlacement.span)}>Livre</button>
          <button type="button" className={palettePlacement.shape === 'circle' ? 'is-active' : ''} onClick={() => setWidgetShape(paletteWidget.id, 'circle', 6)}>Círculo</button>
          <button type="button" className={palettePlacement.shape === 'oval' ? 'is-active' : ''} onClick={() => setWidgetShape(paletteWidget.id, 'oval', 8)}>Oval</button>
          <button type="button" className={palettePlacement.shape === 'wide' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'wide'} onClick={() => setWidgetShape(paletteWidget.id, 'wide', 12)}>Retângulo</button>
          <button type="button" className={palettePlacement.shape === 'banner' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'banner'} onClick={() => setWidgetShape(paletteWidget.id, 'banner', 18)}>Faixa</button>
          <button type="button" className={palettePlacement.shape === 'square' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'square'} onClick={() => setWidgetShape(paletteWidget.id, 'square', 8)}>Quadrado</button>
          <button type="button" className={palettePlacement.shape === 'column' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'column'} onClick={() => setWidgetShape(paletteWidget.id, 'column', 6)}>Coluna</button>
          <button type="button" className={palettePlacement.shape === 'portrait' ? 'is-active' : ''} aria-pressed={palettePlacement.shape === 'portrait'} onClick={() => setWidgetShape(paletteWidget.id, 'portrait', 6)}>Retrato</button>
        </div>
      </details>
      {paletteWidget.action ? <details className="pcm-canvas__editor-section"><summary>Botão</summary>
        <label className="pcm-canvas__palette-toggle"><span>Mostrar texto do botão</span><input type="checkbox" checked={palettePlacement.showActionLabel !== false} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, showActionLabel: event.target.checked }))} /></label>
        <div className="pcm-canvas__palette-presets" aria-label="Estilo do botão">
          {([['minimal', 'Texto'], ['outline', 'Contorno'], ['soft', 'Suave'], ['solid', 'Preenchido'], ['icon', 'Só ícone']] as const).map(([id, label]) => <button key={id} type="button" className={(palettePlacement.buttonStyle ?? 'minimal') === id ? 'is-active' : ''} aria-pressed={(palettePlacement.buttonStyle ?? 'minimal') === id} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, buttonStyle: id, ...(id === 'icon' ? { showActionLabel: false } : value.buttonStyle === 'icon' && value.showActionLabel === false ? { showActionLabel: true } : {}) }))}>{label}</button>)}
        </div>
        <label>Formato do botão<select value={palettePlacement.buttonRadius ?? 'soft'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, buttonRadius: event.target.value as CanvasPlacement['buttonRadius'] }))}><option value="square">Reto</option><option value="soft">Arredondado</option><option value="pill">Pílula</option></select></label>
        <div className="pcm-canvas__palette-colors"><label>Ênfase<PcmColorInput type="color" value={palettePlacement.buttonColor ?? '#174d75'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, buttonColor: event.target.value }))} aria-label="Cor de ênfase do botão" /></label><label>Fundo<PcmColorInput type="color" value={palettePlacement.buttonBackground && palettePlacement.buttonBackground !== 'transparent' ? palettePlacement.buttonBackground : '#e7f3fc'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, buttonBackground: event.target.value }))} aria-label="Cor de fundo do botão" /></label><label>Texto<PcmColorInput type="color" value={palettePlacement.buttonText ?? '#174d75'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, buttonText: event.target.value }))} aria-label="Cor do texto do botão" /></label><label>Borda<PcmColorInput type="color" value={palettePlacement.buttonBorder && palettePlacement.buttonBorder !== 'none' ? palettePlacement.buttonBorder : '#b8d5e8'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, buttonBorder: event.target.value }))} aria-label="Cor da borda do botão" /></label></div>
      </details> : null}
      {!paletteWidget.action ? <details className="pcm-canvas__editor-section"><summary>Ícone</summary>
        <label>Posição<select value={palettePlacement.iconPosition ?? 'inline'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, iconPosition: event.target.value as CanvasPlacement['iconPosition'] }))}><option value="inline">Ao lado do valor</option><option value="top">Acima do valor</option><option value="right">À direita do valor</option></select></label>
        <label>Cor do ícone<PcmColorInput type="color" value={palettePlacement.iconColor ?? palettePlacement.accentColor ?? '#176fc1'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, iconColor: event.target.value }))} aria-label="Cor do ícone" /></label>
      </details> : null}
      {['line', 'area', 'bar', 'pie', 'donut', 'comparison', 'progress'].includes(paletteMode) ? <details className="pcm-canvas__editor-section"><summary>Gráfico</summary>
        {['line', 'area'].includes(paletteMode) ? <fieldset><legend>Interação com o mouse</legend><label className="pcm-canvas__palette-toggle"><span>Bolinha que acompanha o mouse</span><input type="checkbox" checked={palettePlacement.showTrackingMarker === true} onChange={event => { const showTrackingMarker = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, showTrackingMarker })) }} /></label><small>Acompanha a curva ao passar o mouse, sem precisar clicar.</small></fieldset> : null}
        <details className="pcm-canvas__editor-section"><summary>Efeitos de foco</summary>
          <label>Onde animar<select value={palettePlacement.chartFocusTarget ?? 'chart'} onChange={event => { const chartFocusTarget = event.currentTarget.value as PcmChartPresentation['chartFocusTarget']; setPlacement(paletteWidget.id, value => ({ ...value, chartFocusTarget })) }}><option value="card">Conteúdo do card</option><option value="chart">Elementos do gráfico</option><option value="both">Card e gráfico</option></select></label>
          <label>Efeito<select value={palettePlacement.chartFocusEffect ?? 'none'} onChange={event => { const chartFocusEffect = event.currentTarget.value as PcmChartPresentation['chartFocusEffect']; setPlacement(paletteWidget.id, value => ({ ...value, chartFocusEffect })) }}><option value="none">Sem efeito animado</option><option value="flash">Flash suave</option><option value="glow">Luz</option><option value="sweep">Varredura de corte</option><option value="link">Ligação / expansão</option><option value="vibrate">Vibração suave</option><option value="reflection">Reflexo</option><option value="pulse">Pulso</option><option value="lift">Elevação</option><option value="saturation">Realce de cor</option></select></label>
          <label>Ativar<select value={palettePlacement.chartFocusTrigger ?? 'both'} onChange={event => { const chartFocusTrigger = event.currentTarget.value as PcmChartPresentation['chartFocusTrigger']; setPlacement(paletteWidget.id, value => ({ ...value, chartFocusTrigger })) }}><option value="hover">Ao passar o mouse</option><option value="selection">Ao selecionar</option><option value="both">Mouse e seleção</option></select></label>
          <label>Intensidade · {palettePlacement.chartFocusIntensity ?? 60}%<input type="range" min={0} max={100} value={palettePlacement.chartFocusIntensity ?? 60} onChange={event => { const chartFocusIntensity = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartFocusIntensity })) }} /></label>
          <label>Duração · {palettePlacement.chartFocusDuration ?? 650} ms<input type="range" min={200} max={1600} step={50} value={palettePlacement.chartFocusDuration ?? 650} onChange={event => { const chartFocusDuration = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartFocusDuration })) }} /></label>
          <label>Cor da luz<PcmColorInput type="color" value={palettePlacement.chartFocusColor ?? '#ffffff'} onChange={event => { const chartFocusColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, chartFocusColor })) }} /></label>
          <label>Atenuar os outros itens · {palettePlacement.chartFocusDim ?? 70}%<input type="range" min={0} max={100} value={palettePlacement.chartFocusDim ?? 70} onChange={event => { const chartFocusDim = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartFocusDim })) }} /></label>
        </details>
        <details className="pcm-canvas__editor-section"><summary>Legenda e rótulos</summary>
          <details className="pcm-canvas__editor-section"><summary>Cores da legenda</summary>
            <label>Cor do destaque ao passar o mouse<PcmColorInput type="color" value={palettePlacement.legendHoverColor ?? '#176fc1'} onChange={event => { const legendHoverColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, legendHoverColor })) }} /></label>
            <label>Intensidade do destaque · {palettePlacement.legendHoverOpacity ?? 12}%<input type="range" min={0} max={100} value={palettePlacement.legendHoverOpacity ?? 12} onChange={event => { const legendHoverOpacity = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, legendHoverOpacity })) }} /></label>
            {([['legendTextColor', 'Nome dos itens'], ['legendValueColor', 'Valores'], ['legendPercentColor', 'Porcentagens']] as const).map(([key, label]) => <label key={key}>{label}<PcmColorInput type="color" value={palettePlacement[key] ?? palettePlacement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d')} onChange={event => { const color = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, [key]: color })) }} /></label>)}
            <button type="button" onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, legendTextColor: undefined, legendValueColor: undefined, legendPercentColor: undefined }))}>Usar cores do card</button>
          </details>
          <label>Distância do rótulo · {palettePlacement.dataLabelOffset ?? 8}px<input type="range" min={0} max={24} value={palettePlacement.dataLabelOffset ?? 8} onChange={event => { const dataLabelOffset = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, dataLabelOffset })) }} /></label>
          <label>Posição da legenda<select value={palettePlacement.legendPosition ?? 'right'} onChange={event => { const legendPosition = event.currentTarget.value as CanvasPlacement['legendPosition']; setPlacement(paletteWidget.id, value => ({ ...value, legendPosition })) }}><option value="right">À direita</option><option value="bottom">Abaixo</option><option value="top">Acima</option><option value="hidden">Ocultar</option></select></label>
          <label>Espaçamento da legenda · {palettePlacement.legendGap ?? 12}px<input type="range" min={0} max={40} value={palettePlacement.legendGap ?? 12} onChange={event => { const legendGap = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, legendGap })) }} /></label>
          <label>Tamanho da legenda · {palettePlacement.legendSize ?? palettePlacement.contentSize ?? 12}px<input type="range" min={8} max={32} value={palettePlacement.legendSize ?? palettePlacement.contentSize ?? 12} onChange={event => { const legendSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, legendSize })) }} /></label>
          {['pie', 'donut'].includes(paletteMode) ? <label>Texto da legenda<select value={palettePlacement.legendLabelFormat ?? 'full'} onChange={event => { const legendLabelFormat = event.currentTarget.value as NonNullable<PcmChartPresentation['legendLabelFormat']>; setPlacement(paletteWidget.id, value => ({ ...value, legendLabelFormat })) }}><option value="full">Código e nome</option><option value="code">Somente código</option><option value="name">Somente nome</option></select></label> : null}
          <label>Cor dos rótulos<PcmColorInput type="color" value={palettePlacement.chartLabelColor ?? '#ffffff'} onChange={event => { const chartLabelColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, chartLabelColor })) }} /></label>
          <label className="pcm-canvas__palette-toggle"><span>Mostrar legenda</span><input type="checkbox" checked={palettePlacement.legendVisible ?? ['pie', 'donut'].includes(paletteMode)} onChange={event => { const legendVisible = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, legendVisible, legendPosition: legendVisible && value.legendPosition === 'hidden' ? 'right' : value.legendPosition })) }} /></label>
          {([['legendName', 'Nome do item'], ['legendValue', 'Valor'], ['legendPercent', 'Porcentagem'], ['legendSwatch', 'Marcador de cor']] as const).map(([key, label]) => <label key={key} className="pcm-canvas__palette-toggle"><span>{label} na legenda</span><input type="checkbox" checked={palettePlacement[key] !== false} onChange={event => { const checked = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, [key]: checked })) }} /></label>)}
          <label>Conteúdo dos rótulos<select value={palettePlacement.dataLabelMode ?? 'default'} onChange={event => { const dataLabelMode = event.currentTarget.value as PcmChartPresentation['dataLabelMode']; setPlacement(paletteWidget.id, value => ({ ...value, dataLabelMode })) }}><option value="default">Padrão do gráfico</option><option value="none">Ocultar</option><option value="value">Valor</option><option value="percent">Porcentagem</option><option value="both">Valor e porcentagem</option></select></label>
          <label>Posição dos rótulos<select value={palettePlacement.dataLabelPosition ?? 'above'} onChange={event => { const dataLabelPosition = event.currentTarget.value as PcmChartPresentation['dataLabelPosition']; setPlacement(paletteWidget.id, value => ({ ...value, dataLabelPosition, dataLabelMode: !value.dataLabelMode || value.dataLabelMode === 'default' ? 'value' : value.dataLabelMode })) }}><option value="above">Acima</option><option value="center">No centro</option><option value="left">À esquerda</option><option value="right">À direita</option></select></label>
          <label>Tamanho dos rótulos · {palettePlacement.dataLabelSize ?? 12}px<input type="range" min={8} max={32} value={palettePlacement.dataLabelSize ?? 12} onChange={event => { const dataLabelSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, dataLabelSize })) }} /></label>
        </details>
        {(['line', 'area'].includes(paletteMode) || (paletteMode === 'bar' && paletteWidget.id === 'monthly-mttr')) ? <details className="pcm-canvas__editor-section"><summary>Eixos e réguas</summary><label>Formato das linhas<select value={palettePlacement.chartGridStyle ?? 'solid'} onChange={event => { const chartGridStyle = event.currentTarget.value as PcmChartPresentation['chartGridStyle']; setPlacement(paletteWidget.id, value => ({ ...value, chartGridStyle })) }}><option value="solid">Linha contínua</option><option value="dashed">Tracejada</option><option value="dotted">Pontilhada</option><option value="double">Linha dupla</option></select></label><label className="pcm-canvas__palette-toggle"><span>Mostrar escala vertical</span><input type="checkbox" checked={palettePlacement.showChartAxes !== false} onChange={event => { const showChartAxes = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, showChartAxes })) }} /></label><label>Cor das réguas<PcmColorInput type="color" value={palettePlacement.chartGridColor ?? (dashboardTheme === 'dark' ? '#52697a' : '#d3dfe8')} onChange={event => { const chartGridColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, chartGridColor })) }} /></label><label>Espessura das réguas · {palettePlacement.chartGridWidth ?? 1}px<input type="range" min={0} max={3} step={0.25} value={palettePlacement.chartGridWidth ?? 1} onChange={event => { const chartGridWidth = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartGridWidth })) }} /></label></details> : null}
        <label>Segunda cor do degradê<PcmColorInput type="color" value={palettePlacement.gradientEnd ?? '#63a2df'} onChange={event => { const gradientEnd = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, gradientEnd })) }} /></label>
        {['bar', 'progress'].includes(paletteMode) ? <>
          <label>Espaço reservado aos nomes · {palettePlacement.chartLabelWidth ?? 35}%<input type="range" min={15} max={60} value={palettePlacement.chartLabelWidth ?? 35} onChange={event => { const chartLabelWidth = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartLabelWidth })) }} /></label>
          <label>Espaço entre linhas · {palettePlacement.chartRowGap ?? 12}px<input type="range" min={4} max={40} value={palettePlacement.chartRowGap ?? 12} onChange={event => { const chartRowGap = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartRowGap })) }} /></label>
        </> : null}
        {['pie', 'donut'].includes(paletteMode) ? <>
          <label>Posição do valor e nome<select value={palettePlacement.chartCenterPosition ?? 'center'} onChange={event => { const chartCenterPosition = event.currentTarget.value as PcmChartPresentation['chartCenterPosition']; setPlacement(paletteWidget.id, value => ({ ...value, chartCenterPosition })) }}><option value="center">Centro</option><option value="top">Acima</option><option value="bottom">Abaixo</option><option value="left">À esquerda</option><option value="right">À direita</option></select></label>
          <label>Tamanho do nome central · {palettePlacement.chartCenterTextSize ?? 11}px<input type="range" min={8} max={28} value={palettePlacement.chartCenterTextSize ?? 11} onChange={event => { const chartCenterTextSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartCenterTextSize })) }} /></label>
          <label>Distância entre valor e nome · {palettePlacement.chartCenterGap ?? 4}px<input type="range" min={0} max={24} value={palettePlacement.chartCenterGap ?? 4} onChange={event => { const chartCenterGap = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartCenterGap })) }} /></label>
          <label>Conteúdo dos rótulos do círculo<select value={palettePlacement.pieLabelContent ?? 'default'} onChange={event => { const pieLabelContent = event.currentTarget.value as PcmChartPresentation['pieLabelContent']; setPlacement(paletteWidget.id, value => ({ ...value, pieLabelContent })) }}><option value="default">Usar configuração de rótulos</option><option value="value">Somente valor</option><option value="percent">Somente porcentagem</option><option value="name">Nome</option></select></label>
          <label>Conteúdo do centro<select value={palettePlacement.chartCenterFormat ?? 'total'} onChange={event => { const chartCenterFormat = event.currentTarget.value as PcmChartPresentation['chartCenterFormat']; setPlacement(paletteWidget.id, value => ({ ...value, chartCenterFormat })) }}><option value="total">Total fixo</option><option value="name">Nome ao passar o mouse</option><option value="code">Código ao passar o mouse</option><option value="value">Somente valor</option></select></label>
          <label>Distância dos conectores · {palettePlacement.pieCalloutDistance ?? 8}<input type="range" min={0} max={16} value={palettePlacement.pieCalloutDistance ?? 8} onChange={event => { const pieCalloutDistance = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, pieCalloutDistance })) }} /></label>
          {paletteMode === 'donut' ? <><label className="pcm-canvas__palette-toggle"><span>Mostrar total no centro</span><input type="checkbox" checked={palettePlacement.showChartCenter !== false} onChange={event => { const showChartCenter = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, showChartCenter })) }} /></label><label className="pcm-canvas__palette-toggle"><span>Mostrar texto do centro</span><input type="checkbox" checked={palettePlacement.chartCenterLabel !== false} onChange={event => { const chartCenterLabel = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, chartCenterLabel })) }} /></label><label>Posição do centro<select value={palettePlacement.chartCenterPosition ?? 'center'} onChange={event => { const chartCenterPosition = event.currentTarget.value as NonNullable<PcmChartPresentation['chartCenterPosition']>; setPlacement(paletteWidget.id, value => ({ ...value, chartCenterPosition })) }}><option value="center">Centralizado</option><option value="top">Acima do círculo</option><option value="bottom">Abaixo do círculo</option></select></label><label>Cor do total central<PcmColorInput type="color" value={palettePlacement.chartCenterColor ?? palettePlacement.contentColor ?? (dashboardTheme === 'dark' ? '#edf5fb' : '#12324d')} onChange={event => { const chartCenterColor = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, chartCenterColor })) }} /></label><label>Tamanho do total central · {palettePlacement.chartCenterSize ?? 13}px<input type="range" min={8} max={48} value={palettePlacement.chartCenterSize ?? 13} onChange={event => { const chartCenterSize = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartCenterSize })) }} /></label></> : null}
          <label className="pcm-canvas__palette-toggle"><span>Rótulos externos com conectores</span><input type="checkbox" checked={palettePlacement.pieCallouts === true} onChange={event => { const pieCallouts = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, pieCallouts, dataLabelMode: pieCallouts && (!value.dataLabelMode || value.dataLabelMode === 'default') ? 'both' : value.dataLabelMode })) }} /></label>
          <label className="pcm-canvas__range-field"><span>Diâmetro do círculo · {palettePlacement.chartDiameter ?? 112}px</span><input type="range" min={80} max={280} value={palettePlacement.chartDiameter ?? 112} onChange={event => { const chartDiameter = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartDiameter })) }} /></label>
        </> : null}
        {chartPresentationOptions.length ? <label>Apresentação<select value={chartPresentationOptions.some(item => item.id === palettePlacement.chartStyle) ? palettePlacement.chartStyle : 'default'} onChange={event => { const chartStyle = event.currentTarget.value as CanvasPlacement['chartStyle']; setPlacement(paletteWidget.id, value => ({ ...value, chartStyle, chartVolumeEnabled: chartStyle === 'depth' || chartStyle === 'bar-depth' ? true : getChartVolume(value).enabled })) }}>{chartPresentationOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
        <div className="pcm-canvas__palette-presets" aria-label="Paleta do gráfico">{Object.entries(chartPalettes).filter(([id]) => ['ocean', 'green', 'warm'].includes(id)).map(([id, palette]) => <button key={id} type="button" className={palettePlacement.paletteId === id ? 'is-active' : ''} aria-label={`Paleta ${palette.label}`} aria-pressed={palettePlacement.paletteId === id} title={palette.label} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, paletteId: id, customColor: undefined, customColors: undefined, gradientEnd: palette.colors[1] ?? palette.colors[0] }))}><span aria-hidden="true">{palette.colors.slice(0, 4).map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><small>{palette.label}</small></button>)}</div>
        <details className="pcm-canvas__more-palettes"><summary><Plus size={13} /> Mais combinações de cores</summary>
        <div className="pcm-canvas__palette-presets" aria-label="Outras combinações de cores">{Object.entries(chartPalettes).filter(([id]) => !['ocean', 'green', 'warm'].includes(id)).map(([id, palette]) => <button key={id} type="button" className={palettePlacement.paletteId === id ? 'is-active' : ''} aria-label={`Paleta ${palette.label}`} aria-pressed={palettePlacement.paletteId === id} title={palette.label} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, paletteId: id, customColor: undefined, customColors: undefined, gradientEnd: palette.colors[1] ?? palette.colors[0] }))}><span aria-hidden="true">{palette.colors.slice(0, 4).map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><small>{palette.label}</small></button>)}</div>
        </details>
        <label className="pcm-canvas__range-field"><span>Opacidade do gráfico <output>{palettePlacement.chartOpacity ?? 100}%</output></span><input type="range" min={0} max={100} step={1} value={palettePlacement.chartOpacity ?? 100} onChange={event => { const chartOpacity = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartOpacity })) }} aria-label="Opacidade do gráfico" /></label>
        <label className="pcm-canvas__range-field"><span>{paletteMode === 'bar' ? 'Espessura das barras e colunas' : 'Espessura da linha de dados'} <output>{palettePlacement.chartLineWidth ?? 3} / 8</output></span><input type="range" min={1} max={8} step={1} value={palettePlacement.chartLineWidth ?? 3} onChange={event => { const width = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartLineWidth: width })) }} aria-label={paletteMode === 'bar' ? 'Espessura das barras e colunas' : 'Espessura da linha de dados'} /></label>
        {['line', 'area'].includes(paletteMode) ? <label className="pcm-canvas__range-field"><span>Tamanho dos pontos <output>{palettePlacement.chartPointSize ?? 5}px</output></span><input type="range" min={2} max={10} step={1} value={palettePlacement.chartPointSize ?? 5} onChange={event => { const size = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartPointSize: size })) }} aria-label="Tamanho dos pontos do gráfico" /></label> : null}
        <label className="pcm-canvas__range-field"><span>Borda do gráfico <output>{palettePlacement.chartBorderWidth ?? 0}px</output></span><input type="range" min={0} max={4} step={1} value={palettePlacement.chartBorderWidth ?? 0} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, chartBorderWidth: Number(event.currentTarget.value) }))} aria-label="Borda do gráfico" /></label>
        <details className="pcm-canvas__editor-section"><summary>Perspectiva e volume</summary>
          <label className="pcm-canvas__palette-toggle"><span>Ativar profundidade</span><input type="checkbox" checked={getChartVolume(palettePlacement).enabled} onChange={event => { const chartVolumeEnabled = event.currentTarget.checked; setPlacement(paletteWidget.id, value => ({ ...value, chartVolumeEnabled })) }} /></label>
          <label>Direção · {palettePlacement.chartVolumeDirection ?? 90}°<input type="range" min={0} max={360} step={5} value={palettePlacement.chartVolumeDirection ?? 90} onChange={event => { const chartVolumeDirection = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartVolumeDirection, chartVolumeEnabled: true })) }} /></label>
          <div className="pcm-canvas__palette-presets">{([[0, 'Direita'], [90, 'Baixo'], [180, 'Esquerda'], [270, 'Cima'], [45, 'Diagonal ↘'], [135, 'Diagonal ↙'], [225, 'Diagonal ↖'], [315, 'Diagonal ↗']] as const).map(([direction, label]) => <button type="button" key={direction} aria-pressed={(palettePlacement.chartVolumeDirection ?? 90) === direction} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, chartVolumeDirection: direction, chartVolumeEnabled: true }))}>{label}</button>)}</div>
          {!['line', 'area'].includes(paletteMode) ? <label>Inclinação · {palettePlacement.chartDepth ?? 16}°<input type="range" min={0} max={32} value={palettePlacement.chartDepth ?? 16} onChange={event => { const chartDepth = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartDepth, chartVolumeEnabled: true })) }} /></label> : null}
          <label>Profundidade · {palettePlacement.chartVolume ?? 8}<input type="range" min={0} max={18} value={palettePlacement.chartVolume ?? 8} onChange={event => { const chartVolume = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, chartVolume, chartVolumeEnabled: true })) }} /></label>
        </details>
        <div className="pcm-canvas__palette-colors">
          {(paletteMode === 'pie' || paletteMode === 'donut' ? paletteColors.map((_, index) => `Fatia ${index + 1}`) : paletteMode === 'comparison' ? ['MTTR', 'MTBF'] : ['Linha e barras']).map((label, index) => <label key={label} title={`Cor: ${label}`}>{label}<PcmColorInput type="color" value={paletteColors[index] ?? paletteColors[0]} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, customColor: undefined, customColors: paletteColors.map((color, colorIndex) => colorIndex === index ? event.target.value : color) }))} aria-label={`Cor de ${label}`} /></label>)}
        </div>
      </details> : null}
      <details className="pcm-canvas__editor-section"><summary>Aparência</summary>
        <label>Cor ao passar o mouse<PcmColorInput type="color" value={palettePlacement?.hoverColor ?? '#176fc1'} onChange={event => { const hoverColor = event.currentTarget.value; if (paletteWidget) setPlacement(paletteWidget.id, value => ({ ...value, hoverColor })) }} /></label>
        <label>Contorno<select value={palettePlacement.cardBorderStyle ?? 'solid'} onChange={event => { const cardBorderStyle = event.currentTarget.value as CanvasPlacement['cardBorderStyle']; setPlacement(paletteWidget.id, value => ({ ...value, cardBorderStyle, cardBorder: value.cardBorder === 'none' || !value.cardBorder ? '#176fc1' : value.cardBorder })) }}><option value="solid">Linha simples</option><option value="double">Linha dupla</option><option value="dashed">Tracejado</option><option value="dotted">Pontilhado</option></select></label>
        <button type="button" onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBackground: 'transparent', cardBackgroundOpacity: 0, cardEffect: 'flat' }))}>Sem fundo</button>
        <label className="pcm-canvas__palette-title-field">Fundo personalizado<PcmColorInput type="color" value={palettePlacement.cardBackground && palettePlacement.cardBackground !== 'transparent' ? palettePlacement.cardBackground : '#ffffff'} onChange={event => { const cardBackground = event.currentTarget.value; setPlacement(paletteWidget.id, value => ({ ...value, cardBackground, cardBackgroundOpacity: 100, cardEffect: 'flat' })) }} aria-label="Cor de fundo do card" /></label>
        <label className="pcm-canvas__range-field"><span>Opacidade do fundo <output>{palettePlacement.cardBackgroundOpacity ?? 100}%</output></span><input type="range" min={0} max={100} step={1} value={palettePlacement.cardBackgroundOpacity ?? 100} onChange={event => { const cardBackgroundOpacity = Number(event.currentTarget.value); setPlacement(paletteWidget.id, value => ({ ...value, cardBackgroundOpacity })) }} aria-label="Opacidade do fundo do card" /></label>
        <div className="pcm-canvas__palette-colors"><label>Borda<PcmColorInput type="color" value={palettePlacement.cardBorder && palettePlacement.cardBorder !== 'none' ? palettePlacement.cardBorder : '#e1e8ed'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, cardBorder: event.target.value }))} aria-label="Cor da borda" /></label><button type="button" className={palettePlacement.cardBorder === 'none' ? 'is-active' : ''} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardBorder: 'none' }))}>Sem borda</button><label>Título<PcmColorInput type="color" value={palettePlacement.titleColor ?? '#375873'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, titleColor: event.target.value }))} aria-label="Cor do título" /></label><label>Conteúdo<PcmColorInput type="color" value={palettePlacement.contentColor ?? '#12324d'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, contentColor: event.target.value }))} aria-label="Cor do conteúdo" /></label><label>Faixa lateral<PcmColorInput type="color" value={palettePlacement.accentColor ?? '#176fc1'} onChange={event => setPlacement(paletteWidget.id, value => ({ ...value, accentColor: event.target.value }))} aria-label="Cor da faixa lateral" /></label></div>
        {!paletteWidget.action ? <div className="pcm-canvas__corner-options" role="group" aria-label="Formato dos cantos do card"><span>Cantos</span>{([['square', 'Reto'], ['soft', 'Leve'], ['round', 'Arredondado']] as const).map(([radius, label]) => <button key={radius} type="button" className={(palettePlacement.cardRadius ?? 'soft') === radius ? 'is-active' : ''} aria-pressed={(palettePlacement.cardRadius ?? 'soft') === radius} onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, cardRadius: radius }))}>{label}</button>)}</div> : null}
      </details>
      <button type="button" className="pcm-canvas__palette-reset" onClick={() => setPlacement(paletteWidget.id, value => ({ ...value, segments: undefined, customTitle: undefined, customSubtitle: undefined, showTitle: undefined, showActionLabel: undefined, titleSize: undefined, contentSize: undefined, shape: undefined, aspectLocked: undefined, contentScale: undefined, buttonStyle: undefined, buttonRadius: undefined, buttonColor: undefined, buttonBackground: undefined, buttonBorder: undefined, buttonText: undefined, height: undefined, paletteId: 'ocean', chartOpacity: undefined, chartStyle: undefined, customColor: undefined, customColors: undefined, cardBackground: undefined, cardBackgroundOpacity: undefined, cardBorder: undefined, cardBorderStyle: undefined, cardRadius: undefined, cardEffect: undefined, titleColor: undefined, contentColor: undefined, accentColor: undefined, iconColor: undefined }))}>Restaurar padrão</button>
    </div>, document.body) : null}
    {styleLibraryOpen ? createPortal(<div className="pcm-canvas__style-library" data-panel-side={panelSide} role="dialog" aria-label="Biblioteca de estilos da lousa" onPointerDown={event => event.stopPropagation()}>
      <button type="button" className="pcm-canvas__side-switch" onClick={() => setPanelSide(side => side === 'right' ? 'left' : 'right')}><Move size={14} />{panelSide === 'right' ? 'Mover para esquerda' : 'Mover para direita'}</button>
      <details className="pcm-canvas__panel-editor"><summary>Personalizar painel</summary>
<div className="pcm-canvas__panel-fields">
        <details className="pcm-canvas__property-section"><summary>Ferramentas da lousa</summary><div className="pcm-canvas__toolbar-checks">{toolbarFeatures.map(feature => <label key={feature.id}><span>{feature.label}</span><input type="checkbox" checked={!toolbarHidden.includes(feature.id)} onChange={event => { const checked = event.currentTarget.checked; setToolbarHidden(current => checked ? current.filter(id => id !== feature.id) : [...current, feature.id]) }} /></label>)}</div><button type="button" onClick={() => setToolbarHidden([])}>Mostrar todas</button></details>
        <details className="pcm-canvas__property-section"><summary>Textos e avisos</summary>
          {([{ key: 'text', label: 'Texto da área PCM' }, { key: 'noticeBackground', label: 'Fundo dos avisos' }, { key: 'noticeText', label: 'Texto dos avisos' }] as const).map(field => <label key={field.key}>{field.label}<PcmColorInput type="color" value={panelOptions[field.key] || (dashboardTheme === 'dark' ? '#e5eef5' : '#17354d')} onChange={event => { const color = event.currentTarget.value; setPanelOptions(current => ({ ...current, [field.key]: color })) }} /></label>)}
          <button type="button" onClick={() => setPanelOptions(current => ({ ...current, text: '', noticeBackground: '', noticeText: '' }))}>Cores automáticas</button>
        </details>
        <details className="pcm-canvas__property-section"><summary>Elementos visíveis</summary>{([{ key: 'showNotices', label: 'Avisos operacionais' }, { key: 'showUpdated', label: 'Data de atualização' }, { key: 'showGroupTitles', label: 'Títulos dos grupos' }] as const).map(field => <label key={field.key}>{field.label}<input type="checkbox" checked={panelOptions[field.key]} onChange={event => { const checked = event.currentTarget.checked; setPanelOptions(current => ({ ...current, [field.key]: checked })) }} /></label>)}</details>
        <div className="pcm-canvas__panel-row"><label>Fundo da área PCM<PcmColorInput type="color" value={areaBackground || (dashboardTheme === 'dark' ? '#102234' : '#f4f7fa')} onChange={event => setAreaBackground(event.currentTarget.value)} /></label><button type="button" aria-pressed={!areaBackground} onClick={() => setAreaBackground('')}>Usar tema</button></div>
        <div className="pcm-canvas__theme-choice"><span>Tema do sistema</span><div><button type="button" aria-pressed={dashboardTheme !== 'dark'} onClick={() => setDashboardTheme(current => current === 'light' ? 'ice' : 'light')}><SunMoon size={15} />{dashboardTheme === 'ice' ? 'Azul claro' : 'Claro'}</button><button type="button" aria-pressed={dashboardTheme === 'dark'} onClick={() => setDashboardTheme('dark')}><span aria-hidden="true">☾</span>Escuro</button></div><button type="button" className="pcm-canvas__theme-adapt" onClick={adaptThemeToSurface}><Sparkles size={14} />Adaptar à superfície</button></div>
<div className="pcm-canvas__panel-row">
        <label>Fundo da lousa<PcmColorInput type="color" value={panelAppearance.background === 'transparent' ? '#edf5fc' : panelAppearance.background} onChange={event => { const background = event.currentTarget.value; setPanelAppearance(current => ({ ...current, background })) }} /></label>
        <button type="button" aria-pressed={panelAppearance.background === 'transparent'} onClick={() => setPanelAppearance(current => ({ ...current, background: 'transparent' }))}>Sem fundo</button>
</div>
<div className="pcm-canvas__panel-row">
        <label>Cor da borda<PcmColorInput type="color" value={panelAppearance.border} onChange={event => { const border = event.currentTarget.value; setPanelAppearance(current => ({ ...current, border })) }} /></label>
        <button type="button" aria-pressed={panelAppearance.width === 0} onClick={() => setPanelAppearance(current => ({ ...current, width: 0 }))}>Sem borda</button>
</div>
        <label>Espessura da borda · {panelAppearance.width}px<input type="range" min={0} max={6} value={panelAppearance.width} onChange={event => { const width = Number(event.currentTarget.value); setPanelAppearance(current => ({ ...current, width })) }} /></label>
        <label>Sombra · {panelShadow}<input type="range" min={0} max={24} value={panelShadow} onChange={event => setPanelShadow(Number(event.currentTarget.value))} /></label>
<div className="pcm-canvas__panel-actions">
        <button type="button" onClick={() => { setPanelAppearance({ background: 'transparent', border: '#cbd8e3', width: 0 }); setAreaBackground(''); setToolbarHidden([]); setPanelOptions({ text: '', noticeBackground: '', noticeText: '', showNotices: true, showUpdated: true, showGroupTitles: true }); setPanelShadow(0); setSaveMessage('Padrão restaurado. Salve a aparência para manter a alteração.') }}>Restaurar padrão</button>
        <button type="button" className="is-primary" onClick={() => { try { window.localStorage.setItem('vorqix.pcm.panel-appearance.v1', JSON.stringify({ ...panelAppearance, areaBackground, options: panelOptions, toolbarHidden, shadow: panelShadow })); setSaveMessage('Aparência do painel salva neste navegador.') } catch { setSaveMessage('Não foi possível salvar a aparência do painel.') } }}>Salvar aparência</button>
</div>
</div>
      </details>
      <header><div><strong>Biblioteca de estilos</strong><small>Aplicar uma aparência pronta aos itens selecionados</small></div></header>
      <label className="pcm-canvas__style-library-category">Personalizar<select value={styleLibraryCategory} onChange={event => { setStyleLibraryCategory(event.currentTarget.value as typeof styleLibraryCategory); setEditingLibraryStyle(null) }}><option value="card">Estilo do card</option><option value="button">Estilo dos botões</option><option value="text">Texto</option><option value="border">Bordas</option><option value="content">Conteúdo</option><option value="chart">Gráficos</option><option value="effects">Efeitos de foco</option></select></label>
      <div className="pcm-canvas__style-library-scope" aria-label="Escopo de aplicação">
        <button type="button" className={styleLibraryScope === 'selected' ? 'is-active' : ''} aria-pressed={styleLibraryScope === 'selected'} disabled={selectedIds.length === 0} onClick={() => setStyleLibraryScope('selected')}>Selecionados{selectedIds.length ? ` · ${selectedIds.length}` : ''}</button>
        <button type="button" className={styleLibraryScope === 'all' ? 'is-active' : ''} aria-pressed={styleLibraryScope === 'all'} onClick={() => setStyleLibraryScope('all')}>Todos os cards</button>
      </div>
      {styleLibraryScope === 'selected' && selectedIds.length === 0 ? <p className="pcm-canvas__style-library-hint">Selecione cards com Ctrl + clique ou escolha “Todos os cards”.</p> : null}
      <div className="pcm-canvas__card-style-gallery" aria-label="Estilos disponíveis">
        {groupedLibraryStyles.map((style, index) => <ReactFragment key={style.id}>{index === 0 || styleThemeGroup(groupedLibraryStyles[index - 1]) !== styleThemeGroup(style) ? <strong className="pcm-canvas__style-theme-heading">{styleThemeGroup(style) === 'adaptive' ? 'Adaptáveis aos temas' : styleThemeGroup(style) === 'dark' ? 'Superfícies escuras' : 'Superfícies claras'}{styleThemeGroup(style) === (dashboardTheme === 'dark' ? 'dark' : 'light') ? ' · tema atual' : ''}</strong> : null}<button type="button" title={`Editar ${style.label}`} onClick={() => setEditingLibraryStyle({ ...(savedStyleProperties[style.id] ?? style), chartColors: [...(savedStyleProperties[style.id] ?? style).chartColors] })}>
          {styleLibraryCategory === 'effects' ? <span className="pcm-canvas__focus-preview" data-effect={style.properties?.chartFocusEffect} aria-hidden="true"><i /><i /><i /></span> : styleLibraryCategory === 'chart' ? <span className="pcm-canvas__chart-style-preview" aria-hidden="true">{style.chartColors.slice(0, 4).map((color, index) => <i key={`${style.id}-${index}`} style={{ backgroundColor: color }} />)}</span> : styleLibraryCategory === 'button' ? <span className="pcm-canvas__button-style-preview" style={{ color: style.contentColor, background: style.background === 'transparent' ? 'transparent' : style.background, borderColor: style.border, boxShadow: `inset 0 -3px ${style.chartColors[0]}` }}>Ação</span> : styleLibraryCategory === 'border' ? <span className="pcm-canvas__border-style-preview" style={{ borderColor: style.border === 'transparent' ? style.chartColors[0] : style.border, borderStyle: ((('line' in style ? style.line : 'solid') === 'none' ? 'solid' : ('line' in style ? style.line : 'solid')) as React.CSSProperties['borderStyle']), borderWidth: (('line' in style ? style.line : 'solid') === 'none' ? 0 : 2) }} aria-hidden="true" /> : styleLibraryCategory === 'text' || styleLibraryCategory === 'content' ? <span className="pcm-canvas__text-style-preview" aria-hidden="true"><i style={{ backgroundColor: style.titleColor }} /><i style={{ backgroundColor: style.contentColor }} /></span> : <span className={`pcm-canvas__card-style-preview is-${style.effect}`} style={{ background: style.background === 'transparent' ? 'transparent' : style.background, borderColor: style.border === 'transparent' ? 'transparent' : style.border }}><i style={{ backgroundColor: style.titleColor }} /><i style={{ backgroundColor: style.contentColor }} /></span>}
          <small>{style.label}{savedStyleProperties[style.id] ? ' · personalizado' : ''}</small>
        </button></ReactFragment>)}
      </div>
      {editingLibraryStyle && styleLibraryCategory === 'effects' ? <fieldset className="pcm-canvas__preset-editor pcm-canvas__focus-editor"><legend>{editingLibraryStyle.label}</legend>
        <label>Nome do efeito<input type="text" maxLength={60} value={editingLibraryStyle.label} onChange={event => { const label = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, label } : current) }} /></label>
        <label>Aplicar em<select value={styleLibraryScope} onChange={event => setStyleLibraryScope(event.currentTarget.value as 'selected' | 'all')}><option value="selected">Cards selecionados · {selectedIds.length}</option><option value="all">Todos os cards compatíveis</option></select></label>
        <label>Onde animar<select value={editingLibraryStyle.properties?.chartFocusTarget ?? 'card'} onChange={event => { const chartFocusTarget = event.currentTarget.value as PcmChartPresentation['chartFocusTarget']; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, chartFocusTarget } } : current) }}><option value="card">Conteúdo do card</option><option value="chart">Somente elementos do gráfico</option><option value="both">Card e gráfico</option></select></label>
        <label>Ativar<select value={editingLibraryStyle.properties?.chartFocusTrigger ?? 'both'} onChange={event => { const chartFocusTrigger = event.currentTarget.value as PcmChartPresentation['chartFocusTrigger']; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, chartFocusTrigger } } : current) }}><option value="hover">Mouse e foco do teclado</option><option value="selection">Seleção</option><option value="both">Mouse e seleção</option></select></label>
        {([{ key: 'chartFocusIntensity', label: 'Intensidade', initial: 60, min: 0, max: 100, step: 1 }, { key: 'chartFocusDuration', label: 'Duração em ms', initial: 650, min: 200, max: 1600, step: 50 }, { key: 'chartFocusDim', label: 'Atenuar outros itens do gráfico', initial: 70, min: 0, max: 100, step: 1 }] as const).map(field => <label key={field.key}>{field.label} · {editingLibraryStyle.properties?.[field.key] ?? field.initial}<input type="range" min={field.min} max={field.max} step={field.step} value={editingLibraryStyle.properties?.[field.key] ?? field.initial} onChange={event => { const value = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, [field.key]: value } } : current) }} /></label>)}
        <label>Cor da luz<PcmColorInput type="color" value={editingLibraryStyle.properties?.chartFocusColor ?? '#63a2df'} onChange={event => { const chartFocusColor = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, chartFocusColor } } : current) }} /></label>
        <p className="pcm-canvas__style-library-hint">{styleLibraryScope === 'selected' ? `Aplicação restrita aos ${selectedIds.length} cards selecionados compatíveis.` : 'O efeito será aplicado a todos os cards compatíveis da lousa.'}</p>
        <button type="button" className="pcm-canvas__apply-style" disabled={styleLibraryScope === 'selected' && selectedIds.length === 0} onClick={() => applyLibraryStyle(editingLibraryStyle)}>Aplicar efeito</button>
        <button type="button" onClick={() => { const next = { ...savedStyleProperties, [editingLibraryStyle.id]: editingLibraryStyle }; try { window.localStorage.setItem('vorqix.pcm.library-styles.v1', JSON.stringify(next)); setSavedStyleProperties(next); setSaveMessage('Efeito salvo na biblioteca deste navegador.') } catch { setSaveMessage('Não foi possível salvar o efeito.') } }}>Salvar efeito na biblioteca</button>
        <button type="button" onClick={() => setEditingLibraryStyle(null)}>Voltar aos efeitos</button>
      </fieldset> : editingLibraryStyle ? <fieldset className="pcm-canvas__preset-editor"><legend>Editar {editingLibraryStyle.label}</legend>
        <label>Segunda cor do degradê<PcmColorInput type="color" value={editingLibraryStyle.properties?.gradientEnd ?? editingLibraryStyle.chartColors[1] ?? '#63a2df'} onChange={event => { const gradientEnd = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, gradientEnd } } : current) }} /></label>
        <label>Corte de canto · {editingLibraryStyle.properties?.cornerCut ?? 0}px<input type="range" min={0} max={40} value={editingLibraryStyle.properties?.cornerCut ?? 0} onChange={event => { const cornerCut = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, cornerCut } } : current) }} /></label>
        <label>Raio dos cantos · {parseCornerRadius(editingLibraryStyle.properties?.cardRadius) ?? 4}px<input type="range" min={0} max={300} value={parseCornerRadius(editingLibraryStyle.properties?.cardRadius) ?? 4} onChange={event => { const cardRadius = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, cardRadius } } : current) }} /></label>
        <label>Formato do card<select value={editingLibraryStyle.properties?.shape ?? ''} onChange={event => { const shape = (event.currentTarget.value || undefined) as CanvasPlacement['shape']; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, shape } } : current) }}><option value="">Livre</option><option value="square">Quadrado</option><option value="wide">Retângulo</option><option value="circle">Círculo</option><option value="oval">Oval</option></select></label>
        <label>Realce ao passar o mouse<PcmColorInput type="color" value={editingLibraryStyle.properties?.hoverColor ?? '#176fc1'} onChange={event => { const hoverColor = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, hoverColor } } : current) }} /></label>
        {styleLibraryCategory === 'text' || styleLibraryCategory === 'content' ? <details className="pcm-canvas__property-section" open><summary>Sombra do texto</summary>
          {(['titleShadow', 'contentShadow'] as const).map((key, index) => <label key={key}>{index === 0 ? 'Sombra do título' : 'Sombra do conteúdo'} · {editingLibraryStyle.properties?.[key] ?? 0}<input type="range" min={0} max={16} value={editingLibraryStyle.properties?.[key] ?? 0} onChange={event => { const value = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, [key]: value } } : current) }} /></label>)}
        </details> : null}
        <label>Aplicar em<select value={styleLibraryScope} onChange={event => setStyleLibraryScope(event.currentTarget.value as 'selected' | 'all')}><option value="all">Todos os itens compatíveis</option><option value="selected">Selecionados · {selectedIds.length}</option></select></label>
        {styleLibraryCategory === 'button' ? <>
          <label>Cantos<select value={editingLibraryStyle.properties?.buttonRadius ?? 'soft'} onChange={event => { const buttonRadius = event.currentTarget.value as CanvasPlacement['buttonRadius']; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, buttonRadius } } : current) }}><option value="square">Retos</option><option value="soft">Suaves</option><option value="pill">Cápsula</option></select></label>
          <label>Apresentação<select value={editingLibraryStyle.properties?.buttonStyle ?? 'solid'} onChange={event => { const buttonStyle = event.currentTarget.value as CanvasPlacement['buttonStyle']; setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, buttonStyle, showActionLabel: buttonStyle !== 'icon' } } : current) }}><option value="solid">Preenchido com ícone</option><option value="outline">Contorno com ícone</option><option value="soft">Suave com ícone</option><option value="minimal">Texto com ícone</option><option value="icon">Somente ícone</option></select></label>
        </> : null}
        <label>Nome do estilo<input type="text" value={editingLibraryStyle.label} maxLength={60} onChange={event => { const label = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, label } : current) }} /></label>
        {styleLibraryCategory === 'text' || styleLibraryCategory === 'content' ? <details className="pcm-canvas__property-section"><summary>Texto · relevo e perspectiva</summary>
          {([{ key: 'textDepth', label: 'Relevo 3D', min: 0, max: 6 }, { key: 'textTilt', label: 'Perspectiva do texto', min: -20, max: 20 }] as const).map(field => <label key={field.key}>{field.label} · {editingLibraryStyle.properties?.[field.key] ?? 0}<input type="range" min={field.min} max={field.max} value={editingLibraryStyle.properties?.[field.key] ?? 0} onChange={event => { const value = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, [field.key]: value } } : current) }} /></label>)}
        </details> : null}
        <details className="pcm-canvas__property-section"><summary>Tipografia e ícones</summary>
        {([{ key: 'titleSize', label: 'Tamanho do título', min: 10, max: 25, initial: 12 }, { key: 'subtitleSize', label: 'Tamanho do subtítulo', min: 8, max: 25, initial: 12 }, { key: 'contentSize', label: 'Tamanho do conteúdo', min: 8, max: 48, initial: 25 }, { key: 'iconSize', label: 'Tamanho do ícone', min: 12, max: 40, initial: 22 }, { key: 'cardShadow', label: 'Elevação e sombra', min: 0, max: 24, initial: 0 }] as const).map(field => <label key={field.key}>{field.label} · {editingLibraryStyle.properties?.[field.key] ?? field.initial}<input type="range" min={field.min} max={field.max} value={editingLibraryStyle.properties?.[field.key] ?? field.initial} onChange={event => { const size = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, [field.key]: size } } : current) }} /></label>)}
        </details>
        <details className="pcm-canvas__property-section" open><summary>Efeitos e profundidade</summary>
        <label>Superfície<select value={editingLibraryStyle.effect ?? 'flat'} onChange={event => { const effect = event.currentTarget.value as CanvasLibraryStyle['effect']; setEditingLibraryStyle(current => current ? { ...current, effect } : current) }}><option value="flat">Chapado · cor uniforme</option><option value="glass">Cristal · reflexo diagonal</option><option value="glass-blue">Vidro azul · translúcido</option><option value="glass-mint">Vidro menta · translúcido</option><option value="gradient">Gradiente · transição de tons</option><option value="elevated">Elevado · superfície destacada</option><option value="outline">Contorno · fundo transparente</option></select></label>
        <label>Perspectiva · {editingLibraryStyle.properties?.cardTilt ?? 0}°<input type="range" min={-12} max={12} value={editingLibraryStyle.properties?.cardTilt ?? 0} onChange={event => { const cardTilt = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, cardTilt } } : current) }} /></label>
        <label>Entalhe visual · {editingLibraryStyle.properties?.cardInset ?? 0}<input type="range" min={0} max={12} value={editingLibraryStyle.properties?.cardInset ?? 0} onChange={event => { const cardInset = Number(event.currentTarget.value); setEditingLibraryStyle(current => current ? { ...current, properties: { ...current.properties, cardInset } } : current) }} /></label>
        </details>
        <button type="button" onClick={() => { const next = { ...savedStyleProperties, [editingLibraryStyle.id]: editingLibraryStyle }; try { window.localStorage.setItem('vorqix.pcm.library-styles.v1', JSON.stringify(next)); setSavedStyleProperties(next); setSaveMessage('Estilo personalizado salvo neste navegador.') } catch { setSaveMessage('Não foi possível salvar o estilo.') } }}>Salvar estilo na biblioteca</button>
        {(['background', 'border', 'titleColor', 'contentColor'] as const).map((key, index) => <label key={key}>{['Fundo', 'Borda', 'Título', 'Conteúdo'][index]}<PcmColorInput type="color" value={isHexColor(editingLibraryStyle[key]) ? editingLibraryStyle[key] : '#ffffff'} onChange={event => { const color = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, [key]: color } : current) }} /></label>)}
        <label>Cor do gráfico<PcmColorInput type="color" value={editingLibraryStyle.chartColors[0]} onChange={event => { const color = event.currentTarget.value; setEditingLibraryStyle(current => current ? { ...current, chartColors: [color, ...current.chartColors.slice(1)] } : current) }} /></label>
        <button type="button" className="pcm-canvas__apply-style" disabled={styleLibraryScope === 'selected' && selectedIds.length === 0} onClick={() => applyLibraryStyle(editingLibraryStyle)}>Aplicar estilo editado</button>
        <button type="button" onClick={() => setEditingLibraryStyle(null)}>Fechar propriedades</button>
      </fieldset> : null}
      <footer>As alterações ficam pendentes até salvar o layout.</footer>
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
        <option value="">Padrão do painel</option><option value={ignoreGlobalSegment}>Todos (ignorar filtros gerais)</option>
        {filter.options.map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>)}
      {Object.keys(filterPlacement.segments ?? {}).length ? <button type="button" className="pcm-canvas__filter-reset" onClick={() => setPlacement(filterWidget.id, value => ({ ...value, segments: undefined }))}>Limpar filtros deste indicador</button> : null}
    </div>, document.body) : null}
    {actionGroupPrompt ? createPortal(<div className="pcm-canvas__action-group-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setActionGroupPrompt(null) }}><div className="pcm-canvas__action-group-prompt" role="dialog" aria-modal="true" aria-label="Agrupar botões" style={{ left: Math.max(8, Math.min(window.innerWidth - 256, actionGroupPrompt.left)), top: Math.max(8, Math.min(window.innerHeight - 144, actionGroupPrompt.top)) }} onPointerDown={event => event.stopPropagation()}><header><strong>Agrupar botões</strong><button type="button" aria-label="Fechar" onClick={() => setActionGroupPrompt(null)}><X size={14} /></button></header><p>Como deseja organizar os botões?</p><div><button type="button" onClick={() => groupActionWidgets(actionGroupPrompt.sourceId, actionGroupPrompt.targetId, 'row')}><span className="pcm-canvas__group-option-icon is-row" aria-hidden="true"><i /><i /></span>Lado a lado</button><button type="button" onClick={() => groupActionWidgets(actionGroupPrompt.sourceId, actionGroupPrompt.targetId, 'column')}><span className="pcm-canvas__group-option-icon is-column" aria-hidden="true"><i /><i /></span>Em coluna</button></div><button type="button" className="pcm-canvas__action-group-cancel" onClick={() => setActionGroupPrompt(null)}>Cancelar</button></div></div>, document.body) : null}
    {contextMenu ? <div className="pcm-canvas__context-menu" role="menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 250) }} onPointerDown={event => event.stopPropagation()}>
      {contextMenu.kind === 'widget' ? (() => {
        const widget = widgetById.get(contextMenu.id)
        const placement = layout.placements[contextMenu.id]
        if (!widget || !placement) return null
        const next = widget.modes.length > 1 ? nextMode(placement.mode, widget.modes) : null
        const groups = allGroups.filter(group => group.id !== placement.groupId)
        const owningGroup = allGroups.find(group => group.id === placement.groupId)
        const showTitle = placement.showTitle ?? !widget.action
        return <>
          {widget.action ? <button type="button" role="menuitem" onClick={() => { const isMoving = movingActionWidgetId === widget.id; setMovingActionWidgetId(isMoving ? null : widget.id); setContextMenu(null); setSaveMessage(isMoving ? 'Movimentação do botão cancelada.' : 'Arraste o botão até a posição desejada e solte.') }}><Move size={14} /> {movingActionWidgetId === widget.id ? 'Cancelar movimentação' : 'Mover botão'}</button> : null}
          <button type="button" role="menuitem" onClick={() => { setGroupEditor(null); setStyleLibraryOpen(false); setFilterWidgetId(null); setFilterAnchor(null); setPaletteWidgetId(widget.id); setContextMenu(null) }}><Palette size={14} /> Personalizar aparência</button>
          <button type="button" role="menuitem" onClick={() => copyWidgetStyle(widget.id)}><Copy size={14} /> Copiar aparência</button>
          {!widget.action ? <button type="button" role="menuitem" onClick={() => duplicateWidget(widget.id)}><Copy size={14} /> Duplicar indicador</button> : null}
          <button type="button" role="menuitem" disabled={!copiedStyle} onClick={() => pasteWidgetStyle(widget.id)}><ClipboardPaste size={14} /> Colar aparência</button>
          <button type="button" role="menuitem" onClick={() => { setPlacement(widget.id, value => ({ ...value, showTitle: !showTitle })); setContextMenu(null) }}><Eye size={14} /> {showTitle ? 'Ocultar título' : 'Mostrar título'}</button>
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
