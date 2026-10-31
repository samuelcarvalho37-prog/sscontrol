import { getAdminImportBatch } from '../api/imports'
import { listAdminEntity } from '../api/catalog'
import type { AdminEntity } from '../../types/catalog'
import type { AdminImportBatch } from '../../types/imports'

export type AdminImportExportFormat = 'xlsx' | 'csv' | 'json' | 'xml'

export interface AdminExportSource {
  entity: AdminEntity
  name: string
  sheetName: string
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function safeFileName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'lote'
}

function rowsFromBatch(batch: AdminImportBatch): Array<Record<string, unknown>> {
  return batch.registros.map((record) => ({
    ...record.origem,
    __linha_origem: record.linha_numero,
    __identificador: record.entidade_id,
    __operacao: record.operacao,
    __status: record.status,
    __erros: record.erros.map((item) => item.mensagem).join(' | '),
  }))
}

function serializeCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const quote = (value: unknown) => `"${cellText(value).replace(/"/g, '""')}"`
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))].map((line) => line.map(quote).join(',')).join('\r\n')}`
}

function serializeXml(rows: Array<Record<string, unknown>>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<importacao>${rows.map((row) => `\n  <registro>${Object.entries(row).map(([name, value]) => `\n    <campo nome="${xmlEscape(name)}">${xmlEscape(cellText(value))}</campo>`).join('')}\n  </registro>`).join('')}\n</importacao>`
}

function download(contents: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Dados'
}

function serializeMasterXml(datasets: Array<{ name: string; rows: Array<Record<string, unknown>> }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<exportacao>${datasets.map(({ name, rows }) => `\n  <cadastro nome="${xmlEscape(name)}">${rows.map((row) => `\n    <registro>${Object.entries(row).map(([key, value]) => `\n      <campo nome="${xmlEscape(key)}">${xmlEscape(cellText(value))}</campo>`).join('')}\n    </registro>`).join('')}\n  </cadastro>`).join('')}\n</exportacao>`
}

function serializeMasterCsv(datasets: Array<{ name: string; rows: Array<Record<string, unknown>> }>): string {
  const headers = [...new Set(datasets.flatMap(({ rows }) => rows.flatMap((row) => Object.keys(row))))]
  const quote = (value: unknown) => `"${cellText(value).replace(/"/g, '""')}"`
  const lines = [['cadastro', ...headers], ...datasets.flatMap(({ name, rows }) => rows.map((row) => [name, ...headers.map((header) => row[header] ?? '')]))]
  return `\uFEFF${lines.map((line) => line.map(quote).join(',')).join('\r\n')}`
}

export function exportableEntityForImportType(type: string): AdminEntity | null {
  const entities: Readonly<Record<string, AdminEntity>> = {
    plantas: 'plantas',
    setores: 'setores',
    linhas: 'linhas',
    ativos: 'ativos',
    componentes: 'componentes',
    materiais: 'materiais',
  }
  return entities[type] ?? null
}

export async function exportAdminCurrentData(
  sources: AdminExportSource[],
  format: AdminImportExportFormat,
): Promise<number> {
  const uniqueSources = [...new Map(sources.map((source) => [source.entity, source])).values()]
  if (!uniqueSources.length) throw new Error('Nenhum cadastro atual está disponível para exportar.')

  const data = await Promise.all(uniqueSources.map(async (source) => {
    const result = await listAdminEntity(source.entity)
    if (result.total > result.rows.length) {
      throw new Error(`A API retornou ${result.rows.length} de ${result.total} registros de ${source.name}. A exportação foi interrompida para não criar um arquivo incompleto.`)
    }
    return { ...source, rows: result.rows as Array<Record<string, unknown>> }
  }))
  const totalRows = data.reduce((total, dataset) => total + dataset.rows.length, 0)

  const stamp = new Date().toISOString().slice(0, 10)
  const baseName = data.length === 1 ? `vorqix_${safeFileName(data[0].entity)}_${stamp}` : `vorqix_dados_mestre_${stamp}`
  if (format === 'xlsx') {
    const xlsx = await import('xlsx')
    const workbook = xlsx.utils.book_new()
    const usedNames = new Set<string>()
    data.forEach((dataset) => {
      const worksheet = xlsx.utils.json_to_sheet(dataset.rows)
      const baseName = safeSheetName(dataset.sheetName)
      let sheetName = baseName
      let suffix = 2
      while (usedNames.has(sheetName.toLocaleLowerCase('pt-BR'))) {
        const marker = ` (${suffix})`
        sheetName = `${baseName.slice(0, 31 - marker.length)}${marker}`
        suffix += 1
      }
      usedNames.add(sheetName.toLocaleLowerCase('pt-BR'))
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName)
    })
    xlsx.writeFileXLSX(workbook, `${baseName}.xlsx`, { compression: true })
    return totalRows
  }

  if (format === 'json') {
    const payload = data.length === 1
      ? { entidade: data[0].entity, exportado_em: new Date().toISOString(), registros: data[0].rows }
      : { exportado_em: new Date().toISOString(), cadastros: Object.fromEntries(data.map(({ entity, rows }) => [entity, rows])) }
    download(JSON.stringify(payload, null, 2), `${baseName}.json`, 'application/json;charset=utf-8')
    return totalRows
  }

  if (format === 'xml') {
    const contents = data.length === 1
      ? serializeXml(data[0].rows)
      : serializeMasterXml(data.map(({ name, rows }) => ({ name, rows })))
    download(contents, `${baseName}.xml`, 'application/xml;charset=utf-8')
    return totalRows
  }

  const contents = data.length === 1 ? serializeCsv(data[0].rows) : serializeMasterCsv(data.map(({ name, rows }) => ({ name, rows })))
  download(contents, `${baseName}.csv`, 'text/csv;charset=utf-8')
  return totalRows
}

export async function exportAdminImportBatch(batch: AdminImportBatch, format: AdminImportExportFormat): Promise<void> {
  const detail = await getAdminImportBatch(batch.id)
  const rows = rowsFromBatch(detail)
  if (!rows.length) throw new Error('Este lote não possui registros para exportar.')

  const baseName = safeFileName(`${detail.entidade}_${detail.id}`)
  if (format === 'xlsx') {
    const xlsx = await import('xlsx')
    const workbook = xlsx.utils.book_new()
    const worksheet = xlsx.utils.json_to_sheet(rows)
    xlsx.utils.book_append_sheet(workbook, worksheet, safeSheetName(detail.entidade))
    xlsx.writeFileXLSX(workbook, `${baseName}.xlsx`, { compression: true })
    return
  }
  if (format === 'json') {
    download(JSON.stringify({ lote: detail.id, entidade: detail.entidade, arquivo: detail.arquivo_nome, registros: rows }, null, 2), `${baseName}.json`, 'application/json;charset=utf-8')
    return
  }
  if (format === 'xml') {
    download(serializeXml(rows), `${baseName}.xml`, 'application/xml;charset=utf-8')
    return
  }
  download(serializeCsv(rows), `${baseName}.csv`, 'text/csv;charset=utf-8')
}
