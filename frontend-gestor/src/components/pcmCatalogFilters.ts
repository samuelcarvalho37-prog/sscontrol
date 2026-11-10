export type PcmColumnRule = { value: string; operator: 'contains' | 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'; order?: '' | 'asc' | 'desc' }
export type PcmColumnRules = Record<string, PcmColumnRule>
const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
export function filterPcmCatalog<T extends Record<string, unknown>>(rows: T[], rules: PcmColumnRules, getValue: (row: T, key: string) => unknown = (row, key) => row[key]): T[] {
  const entries = Object.entries(rules)
  const filtered = rows.filter(row => entries.every(([key, rule]) => {
    if (!rule.value.trim()) return true
    const actual = getValue(row, key)
    if (['lt', 'lte', 'gt', 'gte'].includes(rule.operator)) {
      if (actual === null || actual === undefined || actual === '') return false
      const left = Number(actual), right = Number(rule.value.replace(',', '.'))
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      return rule.operator === 'lt' ? left < right : rule.operator === 'lte' ? left <= right : rule.operator === 'gt' ? left > right : left >= right
    }
    if (rule.operator === 'contains') return fold(actual).includes(fold(rule.value))
    const numeric = ['saude_pct', 'horas_acumuladas', 'gatilho_valor', 'estoque_atual', 'estoque_minimo', 'valor_unitario'].includes(key)
    const equal = numeric ? actual !== null && actual !== undefined && actual !== '' && Number(actual) === Number(rule.value.replace(',', '.')) : fold(actual) === fold(rule.value)
    return rule.operator === 'neq' ? !equal : equal
  }))
  const sort = entries.find(([, rule]) => rule.order)
  if (!sort) return filtered
  const [key, rule] = sort
  const criticality: Record<string, number> = { critica: 4, alta: 3, media: 2, baixa: 1 }
  return [...filtered].sort((a, b) => {
    const left = getValue(a, key), right = getValue(b, key)
    const leftMissing = left === null || left === undefined || left === ''
    const rightMissing = right === null || right === undefined || right === ''
    if (leftMissing && rightMissing) return 0
    if (leftMissing) return 1
    if (rightMissing) return -1
    const comparison = key === 'criticidade' ? (criticality[fold(left)] ?? 0) - (criticality[fold(right)] ?? 0)
      : typeof left === 'number' || ['saude_pct', 'horas_acumuladas', 'gatilho_valor', 'estoque_atual', 'estoque_minimo', 'valor_unitario'].includes(key)
        ? Number(left) - Number(right)
        : String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' })
    return (Number.isFinite(comparison) ? comparison : 0) * (rule.order === 'desc' ? -1 : 1)
  })
}
