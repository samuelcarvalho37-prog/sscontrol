import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')

const analytics = read(
  'frontend-gestor/src/pages/GestorAnalyticsWorkspace.tsx',
)
const decision = read(
  'frontend-gestor/src/pages/GestorDecisionWorkspace.tsx',
)
const review = read(
  'frontend-gestor/src/components/ActionReviewDialog.tsx',
)
const notifications = read(
  'frontend-gestor/src/components/NotificationCenter.tsx',
)
const styles = read('frontend-gestor/src/styles/global.css')
const assetSearch = read(
  'frontend-gestor/src/components/AssetSearchSelect.tsx',
)

for (const period of ['15 min', '1 hora', '6 horas', '24 horas']) {
  assert.match(
    analytics,
    new RegExp(`label: '${period}'`),
    `Período técnico ausente: ${period}`,
  )
}

assert.doesNotMatch(
  analytics,
  /placeholder="TAG, equipamento ou localização"/,
  'A busca de ativos não pode aparecer duplicada dentro da biblioteca.',
)
assert.doesNotMatch(
  analytics,
  /className="manager-library-list"/,
  'A biblioteca não deve repetir o catálogo em uma faixa horizontal.',
)
assert.match(
  analytics,
  /manager-library-layout manager-library-layout--filter-only/,
  'A ficha do ativo deve ocupar toda a largura e depender do filtro principal.',
)
assert.match(
  assetSearch,
  /const PAGE_SIZE = 20/,
  'O seletor deve carregar o catálogo progressivamente em lotes de 20.',
)
assert.doesNotMatch(
  assetSearch,
  /<datalist/,
  'O seletor de ativos não pode depender do menu nativo inconsistente do navegador.',
)
for (const field of ['Responsável', 'Local', 'Início']) {
  assert.match(
    analytics,
    new RegExp(`<span>${field}</span>`),
    `Filtro de campo ausente: ${field}`,
  )
}

assert.match(
  decision,
  /aria-pressed=\{priority === 'CRITICAL_OR_OVERDUE'\}/,
  'O resumo de críticos deve funcionar como filtro.',
)
assert.match(
  decision,
  /setActiveView\('all'\)/,
  'O resumo de pendências deve restaurar a fila completa.',
)

assert.match(
  review,
  /review-checklist-evidence-list/,
  'As evidências do checklist devem ser consultáveis por item.',
)
assert.match(
  review,
  /target="_blank"/,
  'Arquivos de evidência devem abrir em uma consulta separada.',
)

assert.match(
  notifications,
  />Central operacional</,
  'O diálogo deve ser identificado como Central Operacional.',
)
assert.match(
  styles,
  /\.manager-notification-center\s*\{[\s\S]*?width: min\(1120px, 100%\);/,
  'A Central Operacional deve usar uma área imersiva.',
)
assert.match(
  styles,
  /@media \(max-width: 1100px\)[\s\S]*?\.manager-library-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  'Ativos e dossiê devem empilhar em tablet e mobile.',
)
assert.match(
  styles,
  /\.manager-qr-empty svg\s*\{[\s\S]*?max-width: 30px;/,
  'Ícones vazios do dossiê QR devem permanecer compactos.',
)
assert.match(
  styles,
  /\.manager-qr-dialog > footer > span svg\s*\{[\s\S]*?max-width: 20px;/,
  'O ícone de confirmação de leitura deve permanecer compacto.',
)
assert.match(
  styles,
  /\.manager-analytics-workspace\s*\{[\s\S]*?overflow-x: clip;/,
  'O workspace técnico deve impedir vazamento horizontal.',
)

console.log('CONTRATO RESPONSIVO FINAL DO GESTOR APROVADO')
console.log('Ativos, períodos, filtros, evidências, QR e Central Operacional conferidos')
