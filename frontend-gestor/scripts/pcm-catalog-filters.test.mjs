import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
const { filterPcmCatalog } = await vite.ssrLoadModule('/src/components/pcmCatalogFilters.ts')
test.after(() => vite.close())
const rows = [
  { id: 'a', nome: 'Câmara fria', status: 'PARADO', criticidade: 'CRITICA', saude_pct: 90 },
  { id: 'b', nome: 'Bomba sanitária', status: 'OPERANDO', criticidade: 'MEDIA', saude_pct: 0 },
  { id: 'c', nome: 'Câmara quente', status: 'PARADO', criticidade: 'ALTA', saude_pct: 97 },
  { id: 'd', nome: 'Motor', status: 'OPERANDO', criticidade: 'BAIXA', saude_pct: null },
  { id: 'e', nome: 'Motor reserva', status: 'OPERANDO', criticidade: 'BAIXA' },
]
const ids = result => result.map(row => row.id)
const rule = (value, operator = 'eq', order = '') => ({ value, operator, order })
test('combina status, texto sem acento e limite numérico', () => {
  assert.deepEqual(ids(filterPcmCatalog(rows, { nome: rule('CAMARA', 'contains'), status: rule('PARADO'), saude_pct: rule('95', 'lt') })), ['a'])
})
test('zero é um valor e ausência não é zero', () => {
  assert.deepEqual(ids(filterPcmCatalog(rows, { saude_pct: rule('0') })), ['b'])
  assert.deepEqual(ids(filterPcmCatalog(rows, { saude_pct: rule('90,5', 'gt') })), ['c'])
  assert.deepEqual(ids(filterPcmCatalog(rows, { saude_pct: rule('0', 'gte') })), ['a', 'b', 'c'])
})
test('ordena criticidade semanticamente e preserva a lista original', () => {
  assert.deepEqual(ids(filterPcmCatalog(rows, { criticidade: rule('', 'eq', 'desc') })), ['a', 'c', 'b', 'd', 'e'])
  assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd', 'e'])
})
test('ordena saúde com valores ausentes ao final nas duas direções', () => {
  assert.deepEqual(ids(filterPcmCatalog(rows, { saude_pct: rule('', 'eq', 'asc') })), ['b', 'a', 'c', 'd', 'e'])
  assert.deepEqual(ids(filterPcmCatalog(rows, { saude_pct: rule('', 'eq', 'desc') })), ['c', 'a', 'b', 'd', 'e'])
})
test('filtra e ordena relações pelo nome exibido em vez de UUID', () => {
  const linked = [{ id: '1', ativo_id: 'uuid-a' }, { id: '2', ativo_id: 'uuid-b' }]
  const names = { 'uuid-a': 'EQ-1 · Compressor', 'uuid-b': 'EQ-2 · Bomba' }
  assert.deepEqual(ids(filterPcmCatalog(linked, { ativo_id: rule('compressor', 'contains') }, (row, key) => key === 'ativo_id' ? names[row[key]] : row[key])), ['1'])
})
test('limpar filtros restaura ordem e comparação inválida não inclui registros', () => {
  assert.deepEqual(ids(filterPcmCatalog(rows, {})), ids(rows))
  assert.deepEqual(filterPcmCatalog(rows, { saude_pct: rule('inválido', 'gt') }), [])
  assert.deepEqual(ids(filterPcmCatalog(rows, { status: rule('PARADO', 'neq') })), ['b', 'd', 'e'])
})
