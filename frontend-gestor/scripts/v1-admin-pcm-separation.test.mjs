import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = async path => readFile(new URL(path, import.meta.url), 'utf8')

test('ADMIN fica sem atalhos operacionais e mantém analytics somente leitura', async () => {
  const workspace = await source('../src/components/AdminWorkspace.tsx')
  const page = await source('../src/pages/AdminPage.tsx')
  assert.match(workspace, /ADMIN_MAINTENANCE_MODULES = new Set/)
  for (const module of ['structure', 'assets', 'checklists', 'maintenance', 'inventory', 'workforce', 'operations']) {
    assert.match(workspace, new RegExp(`'${module}'`))
  }
  assert.match(workspace, /if \(ADMIN_MAINTENANCE_MODULES\.has\(moduleId\)\) return false/)
  assert.match(page, /tab === 'analytics' \? <AdminAnalyticsWorkspace/)
  assert.doesNotMatch(page, /<PcmDashboard/)
  assert.doesNotMatch(page, /Programação, intervenções e OS/)
})

test('PCM recebe navegação própria para reutilizar configurações do domínio de manutenção', async () => {
  const app = await source('../src/app/App.tsx')
  const navigation = await source('../src/components/AppNavigation.tsx')
  const workspace = await source('../src/components/PcmMaintenanceWorkspace.tsx')
  assert.match(app, /canManageMaintenance = \['PCM', 'GESTOR'\]/)
  assert.match(app, /section === 'maintenance' && canManageMaintenance/)
  assert.match(navigation, /id: 'maintenance' as const, label: 'Manutenção'/)
  assert.match(navigation, /if \(item\.id === 'maintenance'\) return canManageMaintenance/)
  assert.match(workspace, /AdminCatalogWorkspace scope="maintenance"/)
  assert.match(workspace, /AdminChecklistBuilder .*allowCustomValidators=\{false\}/)
  assert.match(workspace, /showImports=\{false\}/)
  assert.match(workspace, /AdminTechnicalStructure/)
  assert.match(workspace, /scope="assets"/)
  assert.match(workspace, /scope="inventory"/)
})

test('checklist do PCM não consulta diretório administrativo de usuários', async () => {
  const builder = await source('../src/components/AdminChecklistBuilder.tsx')
  assert.match(builder, /allowCustomValidators \? listAdminUsers/)
  assert.match(builder, /allowCustom=\{allowCustomValidators\}/)
})

test('ADMIN homologa planos sem criar, editar ou administrar o fluxo de manutenção', async () => {
  const workspace = await source('../src/components/AdminWorkspace.tsx')
  const page = await source('../src/pages/AdminPage.tsx')
  const catalog = await source('../src/components/AdminCatalogWorkspace.tsx')
  assert.match(workspace, /id: 'plan-approvals'.*Homologação de planos/)
  assert.match(workspace, /module\.id !== 'plan-approvals' \|\| session\.user\.capacidades\?\.includes\('maintenance\.plans\.publish'\)/)
  assert.match(page, /tab === 'plan-approvals'[\s\S]*approvalOnly/)
  assert.match(catalog, /approvalOnly \? \['planos' as AdminEntity\]/)
  assert.match(catalog, /!approvalOnly \? <button className="primary-button"[\s\S]*Novo/)
  assert.match(catalog, /approvalOnly \? 'Homologar e publicar plano'/)
  assert.match(catalog, /!approvalOnly && canDeleteSelected/)
  assert.match(catalog, /const editingReadOnly = approvalOnly \|\|/)
})

test('sucesso da análise limpa o foco residual para não reabrir o modal após refresh', async () => {
  const workspace = await source('../src/pages/GestorAnalyticsWorkspace.tsx')
  const app = await source('../src/app/App.tsx')
  const successHandler = workspace.slice(
    workspace.indexOf('onChanged={async () => {'),
    workspace.indexOf('</TechnicalAnalysisDialog>', workspace.indexOf('onChanged={async () => {')),
  )
  assert.match(successHandler, /setSelectedOccurrence\(null\)/)
  assert.match(successHandler, /onClearFocusOccurrence\?\.\(\)/)
  assert.match(successHandler, /await load\(undefined, true\)/)
  assert.match(app, /onClearFocusOccurrence=\{\(\) => setAnalyticsFocusOccurrence\(''\)\}/)
})

test('admin não é destinatário de ocorrência operacional e o PCM é o destinatário', async () => {
  const service = await source('../../backend/node-api/src/modules/monitoring/monitoring.service.ts')
  const occurrence = service.slice(service.indexOf("type: 'OCCURRENCE_REPORTED'"), service.indexOf("type: 'OCCURRENCE_REPORTED'") + 1400)
  assert.match(occurrence, /roles: \[\]/)
  assert.match(occurrence, /roleCodes: \['PCM'\]/)
  assert.doesNotMatch(occurrence, /roles: \['ADMIN'\]/)
  assert.match(service, /TECHNICAL_ANALYSIS_SENT_TO_PCM/)
})
