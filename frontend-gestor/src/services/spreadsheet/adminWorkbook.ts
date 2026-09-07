import type { WorkBook, WorkSheet } from 'xlsx'
import type {
  AdminImportModel,
  AdminImportRow,
  ParsedAdminWorkbook,
} from '../../types/imports'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
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
    throw new Error('Selecione um arquivo .xlsx, .xls ou .csv.')
  }
  if (file.size <= 0) throw new Error('O arquivo selecionado está vazio.')
  if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 8 MB.')
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
  xlsx.writeFileXLSX(workbook, `modelo_fab_control_${model.tipo}.xlsx`, { compression: true })
}
