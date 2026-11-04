import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

export type PcmChartPresentation = {
  showTrackingMarker?: boolean
  cardFocusEffect?: 'none' | 'lift' | 'glow' | 'pulse' | 'reflection'
  cardFocusDuration?: number
  mttrUnit?: 'auto' | 's' | 'min' | 'h' | 'd'
  mtbfUnit?: 'auto' | 's' | 'min' | 'h' | 'd'
  timeUnit?: 'auto' | 's' | 'min' | 'h' | 'd'
  linkTimeMetricColors?: boolean
  metricNameSize?: number
  metricValueSize?: number
  metricBarWidth?: number
  metricBarHeight?: number
  chartFocusTarget?: 'card' | 'chart' | 'both'
  chartFocusEffect?: 'none' | 'flash' | 'glow' | 'sweep' | 'link' | 'vibrate' | 'reflection' | 'pulse' | 'lift' | 'saturation'
  chartVolume?: number
  chartVolumeEnabled?: boolean
  chartVolumeDirection?: number
  chartDepth?: number
  chartStyle?: 'default' | 'oval' | 'exploded' | 'depth' | 'smooth' | 'minimal' | 'rounded' | 'gradient' | 'bar-depth'
  legendHoverColor?: string
  legendHoverOpacity?: number
  chartFocusTrigger?: 'hover' | 'selection' | 'both'
  chartFocusIntensity?: number
  chartFocusDuration?: number
  chartFocusColor?: string
  chartFocusDim?: number
  chartGridStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  chartGridWidth?: number
  showChartAxes?: boolean
  legendPosition?: 'right' | 'bottom' | 'top' | 'hidden'
  legendName?: boolean
  legendValue?: boolean
  legendPercent?: boolean
  legendSwatch?: boolean
  legendVisible?: boolean
  legendLabelFormat?: 'full' | 'code' | 'name'
  legendSize?: number
  dataLabelMode?: 'default' | 'none' | 'value' | 'percent' | 'both'
  dataLabelPosition?: 'above' | 'center' | 'left' | 'right'
  dataLabelSize?: number
  chartLabelColor?: string
  dataLabelOffset?: number
  legendTextColor?: string
  legendValueColor?: string
  legendPercentColor?: string
  chartCenterColor?: string
  chartCenterSize?: number
  chartCenterTextSize?: number
  chartCenterGap?: number
  pieLabelContent?: 'default' | 'value' | 'percent' | 'name'
  chartCenterPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  chartCenterLabel?: boolean
  pieCallouts?: boolean
  pieCalloutDistance?: number
  chartCenterFormat?: 'total' | 'name' | 'code' | 'value'
}

export const PcmChartPresentationContext = createContext<PcmChartPresentation>({})
export const usePcmChartPresentation = () => useContext(PcmChartPresentationContext)
export function resolveTimeUnit(unit: PcmChartPresentation['timeUnit'], seconds: number): 's' | 'min' | 'h' | 'd' {
  return !unit || unit === 'h' ? 'h' : unit !== 'auto' ? unit : seconds >= 86400 ? 'd' : seconds >= 3600 ? 'h' : seconds >= 60 ? 'min' : 's'
}
export function formatChartTime(seconds: number | null, unit: PcmChartPresentation['timeUnit']): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const resolved = resolveTimeUnit(unit, seconds)
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(seconds / ({ s: 1, min: 60, h: 3600, d: 86400 }[resolved]))} ${resolved}`
}

export const focusEffectKeys = ['chartFocusTarget', 'chartFocusEffect', 'chartFocusTrigger', 'chartFocusIntensity', 'chartFocusDuration', 'chartFocusColor', 'chartFocusDim'] as const
export function pickFocusEffect(options: PcmChartPresentation): PcmChartPresentation {
  return Object.fromEntries(focusEffectKeys.filter(key => options[key] !== undefined).map(key => [key, options[key]])) as PcmChartPresentation
}

export function getChartVolume(options: PcmChartPresentation) {
  const enabled = options.chartVolumeEnabled ?? (options.chartStyle === 'depth' || options.chartStyle === 'bar-depth')
  const amount = enabled ? Math.max(0, Math.min(18, options.chartVolume ?? 8)) : 0
  const direction = options.chartVolumeDirection ?? 90
  const radians = direction * Math.PI / 180
  return { enabled, amount, direction, x: Number((Math.cos(radians) * amount).toFixed(4)) || 0, y: Number((Math.sin(radians) * amount).toFixed(4)) || 0 }
}

export function PcmChartSeriesVolume({ path, color }: { path: string; color: string }) {
  const volume = getChartVolume(usePcmChartPresentation())
  if (!volume.amount) return null
  const layers = Math.ceil(volume.amount)
  return <g className="pcm-chart-series-volume" aria-hidden="true" pointerEvents="none">{Array.from({ length: layers }, (_, index) => {
    const ratio = (layers - index) / layers
    return <path key={index} d={path} transform={`translate(${volume.x * ratio} ${volume.y * ratio})`} fill="none" stroke={color} strokeWidth="var(--pcm-chart-line-width, 3)" strokeOpacity={.25} vectorEffect="non-scaling-stroke" />
  })}</g>
}

export function PcmChartGridLine({ x1, y1, x2, y2, opacity = 1 }: { x1: number; y1: number; x2: number; y2: number; opacity?: number }) {
  const options = usePcmChartPresentation()
  const style = options.chartGridStyle ?? 'solid'
  const width = options.chartGridWidth ?? 1
  if (width === 0) return null
  const dash = style === 'dotted' ? `0 ${Math.max(3, width * 4)}` : style === 'dashed' ? `${Math.max(5, width * 6)} ${Math.max(3, width * 4)}` : undefined
  const separation = style === 'double' ? Math.max(1.5, width) : 0
  return <g className="pcm-chart-grid-line" opacity={opacity}>{(style === 'double' ? [-separation, separation] : [0]).map(offset => <line key={offset} x1={x1 + (x1 === x2 ? offset : 0)} x2={x2 + (x1 === x2 ? offset : 0)} y1={y1 + (y1 === y2 ? offset : 0)} y2={y2 + (y1 === y2 ? offset : 0)} stroke="var(--pcm-chart-grid, #d3dfe8)" strokeWidth={width} strokeDasharray={dash} strokeLinecap={style === 'dotted' ? 'round' : 'butt'} vectorEffect="non-scaling-stroke" />)}</g>
}

export function PcmChartColumnGrid({ ticks }: { ticks: ReadonlyArray<{ ratio: number }> }) {
  const options = usePcmChartPresentation()
  const style = options.chartGridStyle ?? 'solid'
  const width = options.chartGridWidth ?? 1
  const borderWidth = width === 0 ? 0 : style === 'double' ? Math.max(3, width * 3) : width
  return <div className="pcm-column-grid" aria-hidden="true">{ticks.map(tick => <span key={tick.ratio} style={{ bottom: `${tick.ratio * 100}%`, borderTopStyle: style, borderTopWidth: borderWidth }} />)}</div>
}

export function getHourlyChartScale(maximumSeconds: number) {
  const maximumHours = Math.max(Number.isFinite(maximumSeconds) ? maximumSeconds / 3600 : 0, 1 / 3600)
  const rawStep = maximumHours / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = ([1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= rawStep) ?? 10) * magnitude
  const ceiling = Math.ceil(maximumHours / step) * step
  return { maximumSeconds: ceiling * 3600, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, index) => ({ hours: index * step, ratio: index * step / ceiling })) }
}

export function getChartLabelPosition({ x, y, width, height, boundsWidth, boundsHeight, position, gap = 8, insetLeft = 6, insetBottom = 6 }: {
  x: number; y: number; width: number; height: number; boundsWidth: number; boundsHeight: number
  position: NonNullable<PcmChartPresentation['dataLabelPosition']>; gap?: number; insetLeft?: number; insetBottom?: number
}) {
  const left = position === 'left' ? x - width - gap : position === 'right' ? x + gap : x - width / 2
  const top = position === 'above' ? y - height - gap : y - height / 2
  return {
    left: Math.max(insetLeft, Math.min(left, Math.max(insetLeft, boundsWidth - width - 6))),
    top: Math.max(6, Math.min(top, Math.max(6, boundsHeight - height - insetBottom))),
  }
}

export function PcmChartPointLabel({ x, y, value, percent }: { x: number; y: number; value: string; percent: number }) {
  const options = usePcmChartPresentation()
  const ref = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    const label = ref.current
    const layer = label?.parentElement
    if (!label || !layer) return
    const update = () => {
      const next = getChartLabelPosition({ x: x * layer.clientWidth, y: y * layer.clientHeight, width: label.offsetWidth, height: label.offsetHeight, boundsWidth: layer.clientWidth, boundsHeight: layer.clientHeight, position: options.dataLabelPosition ?? 'above', gap: options.dataLabelOffset ?? 8, insetLeft: layer.clientWidth * .1 + 6, insetBottom: layer.clientHeight * .13 })
      setPosition(current => current.left === next.left && current.top === next.top ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(layer)
    observer.observe(label)
    return () => observer.disconnect()
  }, [x, y, value, percent, options.dataLabelPosition, options.dataLabelSize, options.dataLabelOffset, options.dataLabelMode])
  if (!options.dataLabelMode || options.dataLabelMode === 'default' || options.dataLabelMode === 'none') return null
  return <span ref={ref} className="pcm-chart-point-label" style={position} title={value}><PcmChartDataLabel value={value} percent={percent} /></span>
}

export function PcmChartDataLabel({ value, percent, defaultVisible = true }: { value: string | number; percent: number; defaultVisible?: boolean }) {
  const options = usePcmChartPresentation()
  const mode = options.dataLabelMode ?? 'default'
  if (mode === 'none' || (mode === 'default' && !defaultVisible)) return null
  const percentage = `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(percent)}%`
  return <span className="pcm-chart-data-label" style={{ fontSize: `${options.dataLabelSize ?? 12}px`, color: options.chartLabelColor }}>{mode === 'percent' ? percentage : mode === 'both' ? `${value} · ${percentage}` : value}</span>
}

export function PcmChartLegend({ items }: { items: ReadonlyArray<{ id: string; label: string; value: string | number; percent: number; color: string }> }) {
  const options = usePcmChartPresentation()
  if (options.legendVisible !== true || options.legendPosition === 'hidden') return null
  const labelFor = (label: string) => {
    const [code, ...name] = label.split(' · ')
    if (options.legendLabelFormat === 'code') return code
    if (options.legendLabelFormat === 'name') return name.join(' · ') || code
    return label
  }
  return <ul className="pcm-chart-legend" data-position={options.legendPosition ?? 'bottom'} aria-label="Legenda de cores">{items.map(item => <li key={item.id} title={item.label}>
    {options.legendSwatch !== false ? <i style={{ background: item.color }} aria-hidden="true" /> : null}
    {options.legendName !== false ? <span>{labelFor(item.label)}</span> : null}
    {options.legendValue !== false ? <strong>{item.value}</strong> : null}
    {options.legendPercent !== false ? <small>{new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(item.percent)}%</small> : null}
  </li>)}</ul>
}
