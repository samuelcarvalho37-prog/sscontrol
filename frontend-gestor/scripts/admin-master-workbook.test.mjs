import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
const { parseAdminWorkbook } = await vite.ssrLoadModule('/src/services/spreadsheet/adminWorkbook.ts')
test.after(() => vite.close())

function spreadsheet(sheets) {
  const workbook = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  return new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'master.xlsx')
}

test('mestre aceita aba com cabeçalho vazio de dados sem remover os cadastros preenchidos', async () => {
  const file = spreadsheet({ Plantas: [['tag', 'nome'], ['PLT-01', 'Planta']], Materiais: [['sku', 'nome'], ['', '']], Reservado: [] })
  const parsed = await Promise.all(['Plantas', 'Materiais', 'Reservado'].map(name => parseAdminWorkbook(file, name, { allowEmpty: true })))
  assert.deepEqual(parsed.map(sheet => sheet.rows.length), [1, 0, 0])
  await assert.rejects(() => parseAdminWorkbook(file, 'Materiais'), /linhas preenchidas/)
})

test('planilha acima de cinco mil linhas não é truncada', async () => {
  const file = spreadsheet({ Componentes: [['ativo_id', 'tag', 'nome'], ...Array.from({ length: 6001 }, (_, index) => ['EQ-01', `CMP-${index}`, `Componente ${index}`])] })
  const result = await parseAdminWorkbook(file)
  assert.equal(result.rows.length, 6001)
  assert.equal(result.rows.at(-1).tag, 'CMP-6000')
})

test('mestre preserva bloqueio de fórmulas mesmo com abas opcionais vazias', async () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['tag', 'nome'], ['PLT-01', 'Planta']])
  sheet.B2 = { t: 's', v: 'Planta', f: 'CONCAT("Plan","ta")' }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Plantas')
  const file = new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'formula.xlsx')
  await assert.rejects(() => parseAdminWorkbook(file, 'Plantas', { allowEmpty: true }), /B2 contém fórmula/)
})

test('JSON mestre aceita listas opcionais vazias mantendo o modo individual estrito', async () => {
  const file = new File([JSON.stringify({ Plantas: [{ tag: 'PLT-01', nome: 'Planta' }], Materiais: [] })], 'master.json')
  assert.equal((await parseAdminWorkbook(file, 'Materiais', { allowEmpty: true })).rows.length, 0)
  assert.equal((await parseAdminWorkbook(file, 'Plantas', { allowEmpty: true })).rows.length, 1)
  await assert.rejects(() => parseAdminWorkbook(file, 'Materiais'), /lista JSON/)
})
