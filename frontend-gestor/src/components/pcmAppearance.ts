export type PcmAppearanceTheme = 'light' | 'dark' | 'ice'

type Appearance = {
  themeAdaptive?: boolean
  cardBackground?: string
  cardBorder?: string
  titleColor?: string
  contentColor?: string
  accentColor?: string
  iconColor?: string
  customColors?: string[]
  pointColors?: Record<string, string>
  pointGradientEnds?: Record<string, string>
}

const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)
const rgb = (color: string) => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
const luminance = (color: string) => rgb(color).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
const contrast = (first: string, second: string) => { const a = luminance(first); const b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
function mix(source: string, target: string, weight: number): string {
  const destination = rgb(target)
  return '#' + rgb(source).map((channel, index) => Math.round(channel * (1 - weight) + destination[index] * weight).toString(16).padStart(2, '0')).join('') + source.slice(7)
}
function readable(color: string, surface: string, minimum: number): string {
  if (contrast(color, surface) >= minimum) return color
  const target = contrast('#ffffff', surface) > contrast('#102234', surface) ? '#ffffff' : '#102234'
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(color, target, step / 20)
    if (contrast(candidate, surface) >= minimum) return candidate
  }
  return target + color.slice(7)
}

export function adaptPcmAppearance<T extends Appearance>(source: T, theme: PcmAppearanceTheme): T {
  if (!source.themeAdaptive) return source
  const next = { ...source }
  const canvas = theme === 'dark' ? '#142c3e' : theme === 'ice' ? '#edf5fc' : '#ffffff'
  let surface = canvas
  if (validColor(source.cardBackground)) {
    surface = source.cardBackground
    if (theme === 'dark' && luminance(surface) > .16) surface = mix(surface, '#102234', .84)
    if (theme !== 'dark' && luminance(surface) < .45) surface = mix(surface, canvas, .9)
    next.cardBackground = surface
  }
  const result = next as Record<string, unknown>
  const textKeys = ['titleColor', 'contentColor', 'legendTextColor', 'legendValueColor', 'legendPercentColor', 'chartCenterColor', 'chartLabelColor']
  const detailKeys = ['accentColor', 'iconColor', 'chartAreaColor', 'chartAreaEndColor', 'chartSelectionColor', 'customColor', 'gradientEnd', 'chartFocusColor']
  for (const key of textKeys) if (validColor(result[key])) result[key] = readable(result[key], surface, 7)
  for (const key of detailKeys) if (validColor(result[key])) result[key] = readable(result[key], surface, 3)
  if (validColor(next.cardBorder)) next.cardBorder = readable(next.cardBorder, surface, 1.5)
  if (source.customColors) next.customColors = source.customColors.map(color => validColor(color) ? readable(color, surface, 3) : color)
  for (const key of ['pointColors', 'pointGradientEnds'] as const) {
    const colors = source[key]
    if (colors) next[key] = Object.fromEntries(Object.entries(colors).map(([id, color]) => [id, validColor(color) ? readable(color, surface, 3) : color]))
  }
  let buttonSurface = surface
  if (validColor(result.buttonBackground)) {
    buttonSurface = result.buttonBackground
    if (theme === 'dark' && luminance(buttonSurface) > .16) buttonSurface = mix(buttonSurface, '#102234', .84)
    if (theme !== 'dark' && luminance(buttonSurface) < .45) buttonSurface = mix(buttonSurface, canvas, .9)
    result.buttonBackground = buttonSurface
  }
  if (validColor(result.buttonText)) result.buttonText = readable(result.buttonText, buttonSurface, 4.5)
  return next
}
