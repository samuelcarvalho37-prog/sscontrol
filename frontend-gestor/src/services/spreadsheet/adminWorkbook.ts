import type { WorkBook, WorkSheet } from 'xlsx'
import type {
  AdminImportModel,
  AdminImportRow,
  ParsedAdminWorkbook,
} from '../../types/imports'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.json']
type XlsxModule = typeof import('xlsx')

function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function assertSpreadsheetFile(file: File): void {
  if (!ALLOWED_EXTENSIONS.includes(fileExtension(file.name))) {
    throw new Error('Selecione um arquivo .xlsx, .xls, .csv ou .json.')
  }
  if (file.size <= 0) throw new Error('O arquivo selecionado está vazio.')
  if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 8 MB.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonPrimitive(value: unknown, field: string, rowNumber: number): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  throw new Error(`O campo “${field}” da linha ${rowNumber} deve conter um valor simples, sem objetos ou listas aninhados.`)
}

function parsedJsonRows(fileName: string, sheetName: string, source: unknown): ParsedAdminWorkbook {
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error(`A seção “${sheetName}” deve ser uma lista JSON de registros.`)
  }
  if (!source.every(isRecord)) {
    throw new Error(`A seção “${sheetName}” deve conter somente objetos JSON, um por registro.`)
  }
  const records = source as Record<string, unknown>[]

  const headers = [...new Set(records.flatMap((record) => Object.keys(record).filter((key) => key !== '__linha')))]
  if (headers.length === 0) throw new Error(`A seção “${sheetName}” não possui campos.`)

  const rows = records.map((record, index) => {
    const row = Object.fromEntries(headers.map((header) => [header, jsonPrimitive(record[header] ?? null, header, index + 1)])) as ParsedAdminWorkbook['rows'][number]
    row.__linha = index + 2
    return row
  })

  return { fileName, sheetNames: [sheetName], selectedSheet: sheetName, headers, rows }
}

function safeJsonSheetName(fileName: string): string {
  const name = fileName.replace(/\.json$/iu, '').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31)
  return name || 'Dados'
}

async function parseAdminJson(file: File, selectedSheet?: string): Promise<ParsedAdminWorkbook> {
  let data: unknown
  try {
    data = JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error('O arquivo JSON não está válido. Revise vírgulas, aspas e chaves.')
  }

  if (Array.isArray(data)) return parsedJsonRows(file.name, safeJsonSheetName(file.name), data)

  if (!isRecord(data)) throw new Error('O JSON deve ser uma lista de registros ou um objeto com abas de dados.')

  const wrappedRows = ['records', 'registros', 'data', 'dados', 'rows']
    .map((key) => data[key])
    .find(Array.isArray)
  if (wrappedRows) return parsedJsonRows(file.name, selectedSheet ?? 'Dados', wrappedRows)

  const tabContainer = isRecord(data.cadastros)
    ? data.cadastros
    : isRecord(data.abas)
      ? data.abas
      : isRecord(data.sheets)
        ? data.sheets
        : data
  const entries = Object.entries(tabContainer).filter(([, value]) => Array.isArray(value))
  if (entries.length === 0) {
    throw new Error('Não encontrei listas de registros. Use uma lista de objetos ou um objeto com listas por aba.')
  }

  const sheetNames = entries.map(([name]) => name)
  const selectedName = selectedSheet
    ? sheetNames.find((name) => name.toLocaleLowerCase('pt-BR') === selectedSheet.toLocaleLowerCase('pt-BR'))
    : sheetNames[0]
  if (!selectedName) throw new Error(`A seção “${selectedSheet}” não foi encontrada no JSON.`)

  const parsed = parsedJsonRows(file.name, selectedName, tabContainer[selectedName])
  return { ...parsed, sheetNames }
}

function csvDelimiter(source: string): string {
  const candidates = [',', ';', '\t']
  let quoted = false
  let firstRecord = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && (character === '\r' || character === '\n')) {
      break
    } else {
      firstRecord += character
    }
  }
  const counts = candidates.map((delimiter) => {
    let count = 0
    quoted = false
    for (let index = 0; index < firstRecord.length; index += 1) {
      const character = firstRecord[index]
      if (character === '"') {
        if (quoted && firstRecord[index + 1] === '"') index += 1
        else quoted = !quoted
      } else if (!quoted && character === delimiter) count += 1
    }
    return count
  })
  const bestIndex = counts.reduce((best, count, index) => count > counts[best] ? index : best, 0)
  return candidates[bestIndex]
}

function parseCsvRows(source: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
    } else if (character === '\r' || character === '\n') {
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
      if (character === '\r' && source[index + 1] === '\n') index += 1
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error('O CSV contém aspas sem fechamento. Confira a linha indicada e exporte o arquivo novamente.')
  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

async function parseAdminCsv(file: File, selectedSheet?: string): Promise<ParsedAdminWorkbook> {
  const source = (await file.text()).replace(/^\uFEFF/u, '')
  const matrix = parseCsvRows(source, csvDelimiter(source))
  if (!matrix.length) throw new Error('O CSV está vazio.')
  const headers = matrix[0].map((value) => value.trim())
  if (headers.some((header) => !header)) throw new Error('O CSV possui cabeçalho vazio. Baixe o modelo do cadastro e preencha novamente.')
  const masterColumn = headers.findIndex((header) => normalizedCsvHeader(header) === 'cadastro')
  const sheetNames = masterColumn >= 0
    ? [...new Set(matrix.slice(1).map((row) => row[masterColumn]?.trim()).filter((value): value is string => Boolean(value)))]
    : [file.name.replace(/\.csv$/iu, '') || 'Dados']
  const selectedName = selectedSheet
    ? sheetNames.find((name) => name.toLocaleLowerCase('pt-BR') === selectedSheet.toLocaleLowerCase('pt-BR'))
    : sheetNames[0]
  if (!selectedName) throw new Error(`A seção “${selectedSheet}” não foi encontrada no CSV.`)
  const dataHeaders = masterColumn >= 0 ? headers.filter((_, index) => index !== masterColumn) : headers
  const rows = matrix.slice(1).reduce<ParsedAdminWorkbook['rows']>((result, sourceRow, offset) => {
    if (masterColumn >= 0 && sourceRow[masterColumn]?.trim() !== selectedName) return result
    const row = Object.fromEntries(dataHeaders.map((header) => {
      const sourceIndex = headers.indexOf(header)
      return [header, sourceRow[sourceIndex] ?? '']
    })) as ParsedAdminWorkbook['rows'][number]
    row.__linha = offset + 2
    if (Object.values(row).some((value) => value !== '' && value !== null)) result.push(row)
    return result
  }, [])
  if (!rows.length) throw new Error(`A seção “${selectedName}” não possui registros para importar.`)
  return { fileName: file.name, sheetNames, selectedSheet: selectedName, headers: dataHeaders, rows }
}

function normalizedCsvHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '')
}

function assertNoFormulas(sheet: WorkSheet, xlsx: XlsxModule): void {
  const reference = sheet['!ref']
  if (!reference) return
  const range = xlsx.utils.decode_range(reference)
  if (range.e.r - range.s.r > 5_000) {
    throw new Error('A planilha possui linhas demais para uma importação administrativa.')
  }
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = xlsx.utils.encode_cell({ r: row, c: column })
      const cell = sheet[address]
      if (cell?.f) {
        throw new Error(`A célula ${address} contém fórmula. Use somente valores no modelo de importação.`)
      }
    }
  }
}

function parseSheet(
  fileName: string,
  workbook: WorkBook,
  sheetName: string,
  xlsx: XlsxModule,
): ParsedAdminWorkbook {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('A aba selecionada não foi encontrada.')
  assertNoFormulas(sheet, xlsx)

  const matrix = xlsx.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })
  const headerIndex = matrix.findIndex((row) => row.some((value) => text(value) !== ''))
  if (headerIndex < 0) throw new Error('A aba selecionada está vazia.')

  const rawHeaders = matrix[headerIndex].map(text)
  const columns = rawHeaders
    .map((header, index) => ({ header, index }))
    .filter((column) => column.header !== '')
  if (!columns.length) throw new Error('A aba não possui cabeçalhos válidos.')

  const rows = matrix.slice(headerIndex + 1).reduce<AdminImportRow[]>((result, sourceRow, offset) => {
    const row = Object.fromEntries(
      columns.map(({ header, index }) => [header, sourceRow[index] ?? '']),
    ) as AdminImportRow
    row.__linha = headerIndex + offset + 2
    const populated = columns.some(({ header }) => text(row[header]) !== '')
    if (populated) result.push(row)
    return result
  }, [])
  if (!rows.length) throw new Error('A aba não possui linhas preenchidas para importar.')

  return {
    fileName,
    sheetNames: workbook.SheetNames.slice(),
    selectedSheet: sheetName,
    headers: columns.map((column) => column.header),
    rows,
  }
}

export async function parseAdminWorkbook(
  file: File,
  selectedSheet?: string,
): Promise<ParsedAdminWorkbook> {
  assertSpreadsheetFile(file)
  if (fileExtension(file.name) === '.json') return parseAdminJson(file, selectedSheet)
  if (fileExtension(file.name) === '.csv') return parseAdminCsv(file, selectedSheet)
  const xlsx = await import('xlsx')
  const workbook = xlsx.read(await file.arrayBuffer(), {
    cellDates: true,
    cellFormula: true,
    raw: false,
  })
  if (!workbook.SheetNames.length) throw new Error('O arquivo não possui abas.')
  const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
    ? selectedSheet
    : workbook.SheetNames[0]
  return parseSheet(file.name, workbook, sheetName, xlsx)
}

function safeWorksheetName(name: string): string {
  return name.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Modelo'
}

export async function downloadAdminImportTemplate(model: AdminImportModel): Promise<void> {
  const xlsx = await import('xlsx')
  const headers = model.campos.map((field) => field.chave)
  const example = model.campos.map((field) => field.exemplo ?? '')
  const worksheet = xlsx.utils.aoa_to_sheet([headers, example])
  worksheet['!cols'] = model.campos.map((field) => ({ wch: Math.max(14, field.chave.length + 3) }))
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, worksheet, safeWorksheetName(model.nome))
  xlsx.writeFileXLSX(workbook, `modelo_vorqix_${model.tipo}.xlsx`, { compression: true })
}

export async function downloadAdminImportMasterTemplate(models: AdminImportModel[]): Promise<void> {
  if (!models.length) throw new Error('Nenhum modelo de importação está disponível.')

  const xlsx = await import('xlsx')
  const workbook = xlsx.utils.book_new()
  const usedNames = new Set<string>()

  for (const model of models) {
    const baseName = safeWorksheetName(model.nome)
    let sheetName = baseName
    let suffix = 2
    while (usedNames.has(sheetName.toLocaleLowerCase('pt-BR'))) {
      const marker = ` (${suffix})`
      sheetName = `${baseName.slice(0, 31 - marker.length)}${marker}`
      suffix += 1
    }
    usedNames.add(sheetName.toLocaleLowerCase('pt-BR'))

    const headers = model.campos.map((field) => field.chave)
    const example = model.campos.map((field) => field.exemplo ?? '')
    const worksheet = xlsx.utils.aoa_to_sheet([headers, example])
    worksheet['!cols'] = model.campos.map((field) => ({ wch: Math.max(14, field.chave.length + 3) }))
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName)
  }

  xlsx.writeFileXLSX(workbook, 'modelo_mestre_vorqix.xlsx', { compression: true })
}
