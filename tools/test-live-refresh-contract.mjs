import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(`Contrato de sincronização inválido: ${message}`)
}

const hook = read('frontend-gestor/src/hooks/useAutoRefresh.ts')
const managerSurfaces = [
  'frontend-gestor/src/pages/GestorDecisionWorkspace.tsx',
  'frontend-gestor/src/pages/GestorAnalyticsWorkspace.tsx',
  'frontend-gestor/src/pages/AssetsPage.tsx',
  'frontend-gestor/src/components/NotificationCenter.tsx',
]
const adminSurfaces = [
  'frontend-gestor/src/pages/AdminPage.tsx',
  'frontend-gestor/src/components/AdminInterventionsWorkspace.tsx',
  'frontend-gestor/src/components/AdminTechnicalStructure.tsx',
  'frontend-gestor/src/components/AdminImportCenter.tsx',
  'frontend-gestor/src/components/AdminCatalogWorkspace.tsx',
  'frontend-gestor/src/components/AdminBackupWorkspace.tsx',
  'frontend-gestor/src/components/AdminGovernanceWorkspace.tsx',
  'frontend-gestor/src/components/AdminDocumentsWorkspace.tsx',
  'frontend-gestor/src/components/AdminChecklistBuilder.tsx',
  'frontend-gestor/src/components/AdminAnalyticsWorkspace.tsx',
]
const operatorApp = read('frontend/src/app/App.tsx')
const operatorHome = read('frontend/src/pages/OperatorHome.tsx')

assert(hook.includes('runningRef'), 'o atualizador permite requisições concorrentes')
assert(hook.includes("document.visibilityState !== 'visible'"), 'a aba oculta continua consultando a API')
assert(hook.includes('!navigator.onLine'), 'o atualizador ignora o estado offline')
assert(hook.includes("window.addEventListener('focus'"), 'o retorno à janela não sincroniza os dados')
assert(hook.includes("window.addEventListener('online'"), 'a reconexão não sincroniza os dados')
assert(hook.includes('window.setInterval'), 'não existe atualização periódica controlada')

for (const path of [...managerSurfaces, ...adminSurfaces]) {
  assert(
    read(path).includes('useAutoRefresh'),
    `${path} ainda depende exclusivamente de atualização manual`,
  )
}

assert(operatorApp.includes('12_000'), 'a fila do Operador não possui ciclo curto de sincronização')
assert(operatorApp.includes("'visibilitychange'"), 'a fila do Operador não sincroniza ao voltar para a aba')
assert(operatorApp.includes("'online'"), 'a fila do Operador não sincroniza após reconexão')
assert(
  operatorHome.includes('Fila ao vivo') && !operatorHome.includes('Atualizar fila'),
  'a tela principal do Operador ainda exige recarga manual',
)

console.log('CONTRATO DE SINCRONIZAÇÃO CONTÍNUA APROVADO')
console.log(`${managerSurfaces.length} superfícies do Gestor e ${adminSurfaces.length} superfícies do Admin protegidas`)
console.log('Operador sincroniza por intervalo, foco, visibilidade e reconexão')
