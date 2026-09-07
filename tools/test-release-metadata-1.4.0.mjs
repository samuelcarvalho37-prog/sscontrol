import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FALHA: ${message}`)
    process.exit(1)
  }
}

const release = '1.4.0'
const config = fs.readFileSync(path.join(root, 'backend/apps-script/00_Config.js'), 'utf8')
const operatorPackage = readJson('frontend/package.json')
const managerPackage = readJson('frontend-gestor/package.json')
const manifest = readJson('release/fab-control.release.json')
const snapshot = readJson('release/spreadsheet-schema.snapshot.json')

assert(config.includes(`const FAB_RELEASE_VERSION = "${release}";`), 'backend fora da versão 1.4.0')
assert(operatorPackage.version === release, 'frontend do operador fora da versão 1.4.0')
assert(managerPackage.version === release, 'frontend do gestor fora da versão 1.4.0')
assert(manifest.release === release, 'manifesto fora da versão 1.4.0')
assert(
  ['canary-published-authenticated-validation-pending', 'canary-homologated'].includes(manifest.status),
  'status canário incorreto',
)
assert(
  manifest.promotionEligible === (manifest.status === 'canary-homologated'),
  'elegibilidade incompatível com o status do canário',
)

for (const [component, version] of Object.entries(manifest.components)) {
  assert(version === release, `componente fora da versão 1.4.0: ${component}`)
}

const production = manifest.productionBaseline
const target = manifest.target
assert(production.release === '1.3.1', 'produção não permaneceu em 1.3.1')
assert(production.health === 'approved-unchanged', 'produção não foi reconfirmada')
assert(production.deploymentId !== target.deploymentId, 'deployment canário não está isolado')
assert(production.spreadsheetId !== target.spreadsheetId, 'planilha canária não está isolada')
assert(target.immutableAppsScriptVersion === 39, 'versão imutável canária incorreta')
assert(target.deploymentId !== 'HEAD', 'deployment canário não pode usar HEAD')
assert(target.sourceGitCommit === 'ef422af', 'commit-fonte canário incorreto')
assert(
  manifest.candidateEvidence?.gestorAdminStartupContract === 'approved',
  'contrato de pré-carregamento Gestor/Admin ausente',
)
assert(
  manifest.candidateEvidence?.gestorAdminStartupVisual?.startsWith('approved-'),
  'validação visual do pré-carregamento Gestor/Admin ausente',
)
assert(
  manifest.candidateEvidence?.managerWorkCenterContract?.startsWith('approved-'),
  'contrato da Central de trabalho do Gestor ausente',
)
assert(
  manifest.candidateEvidence?.managerPerformanceContract?.startsWith('approved-'),
  'contrato de desempenho técnico do Gestor ausente',
)
assert(
  manifest.candidateEvidence?.continuousLiveRefreshContract?.startsWith('approved-'),
  'contrato de sincronização contínua ausente',
)
assert(
  manifest.candidateEvidence?.managerTechnicalRankings?.startsWith('approved-'),
  'rankings técnicos do Gestor ausentes',
)
assert(
  manifest.candidateEvidence?.completedActionReadOnlyAudit?.startsWith('approved-'),
  'auditoria de ações concluídas ausente',
)
assert(
  manifest.candidateEvidence?.canaryAdminRecovery === 'approved-first-access-required',
  'recuperação controlada do Administrador ausente',
)
assert(
  manifest.candidateEvidence?.canaryMaintenanceVisual?.startsWith('approved-'),
  'validação visual do modo de manutenção ausente',
)
assert(
  manifest.candidateEvidence?.managerQrAssetDossier?.startsWith('approved-'),
  'dossiê QR técnico do Gestor ausente',
)
assert(
  manifest.candidateEvidence?.managerParameterActionRequest?.startsWith('approved-'),
  'solicitação de ação por parâmetro ausente',
)
assert(
  manifest.candidateEvidence?.adminChecklistRequestPrefill?.startsWith('approved-'),
  'preenchimento assistido do checklist no Admin ausente',
)

assert(manifest.candidateEvidence?.motorCommercialAccessContract === 'approved', 'contrato comercial do motor ausente')
assert(manifest.candidateEvidence?.motorCommercialAccessE2E === 'approved', 'E2E comercial do motor ausente')
assert(manifest.candidateEvidence?.motorInternalMaintenanceAccessE2E === 'approved', 'E2E interno do motor ausente')
assert(manifest.candidateEvidence?.motorInternalCatalogContract === 'approved', 'catálogo interno do motor ausente')
assert(manifest.candidateEvidence?.motorInternalCatalogVersioningE2E === 'approved', 'versionamento interno do catálogo ausente')
assert(
  manifest.candidateEvidence?.motorInternalAccessGenerator?.startsWith('approved-'),
  'gerador assinado do motor ausente',
)
assert(
  manifest.candidateEvidence?.motorInternalCatalogAuthenticatedE2E?.startsWith('approved-'),
  'E2E autenticado do catálogo interno ausente',
)
assert(
  manifest.candidateEvidence?.motorInternalMaintenanceRevocation?.startsWith('approved-'),
  'revogação da manutenção interna ausente',
)

const checks = manifest.canaryEvidence?.checks
for (const check of [
  'health',
  'bootstrap',
  'userAdminEndpointDeclared',
  'permissionsEndpointDeclared',
  'companyProfileEndpointsDeclared',
  'companyProfileRequiresAuthentication',
  'configurationEngineEndpointDeclared',
  'configurationEngineRequiresAuthentication',
  'commercialAccessEndpointDeclared',
  'commercialAccessRequiresAuthentication',
  'maintenanceExchangeClosedByDefault',
  'maintenanceAccessEndpointHiddenFromBootstrap',
  'internalCatalogRequiresAuthentication',
  'internalCatalogHiddenFromBootstrap',
  'internalCatalogEditorRequiresAuthentication',
  'internalCatalogEditorHiddenFromBootstrap',
  'internalCatalogAuthenticatedRead',
  'internalCatalogAuthenticatedDraftSave',
  'internalCatalogAuthenticatedValidation',
  'internalCatalogAuthenticatedPublish',
  'internalCatalogAuthenticatedRollback',
  'maintenanceWindowClosedAfterValidation',
  'maintenanceSessionRejectedAfterWindowClose',
  'adminImportEndpointDeclared',
  'adminImportRequiresAuthentication',
  'manualRegistrationEndpointDeclared',
  'manualRegistrationRequiresAuthentication',
  'entityActionEndpointDeclared',
  'entityActionRequiresAuthentication',
  'checklistBuilderEndpointsDeclared',
  'interventionEndpointsDeclared',
  'interventionEndpointsRequireAuthentication',
  'governanceEndpointsDeclared',
  'governanceEndpointsRequireAuthentication',
  'restoreEndpointsDeclared',
  'restoreEndpointsRequireAuthentication',
  'unknownLoginRejected',
  'recoveryNonEnumeration',
  'usersRequiresAuthentication',
  'invalidPermissionTokenRejected',
  'productionDeploymentUnchanged',
  'gestorAssetDossierEndpointDeclared',
  'gestorParameterActionEndpointDeclared',
  'gestorAssetDossierRequiresAuthentication',
]) {
  assert(checks?.[check] === 'approved', `evidência pública ausente: ${check}`)
}

for (const check of [
  'permanentAdminLogin',
  'authenticatedAdminRead',
  'authenticatedPermissionMatrixRead',
  'authenticatedConfigurationStateRead',
  'configurationSchemaSeeded',
  'authenticatedImportCatalogRead',
  'importSchemaSeeded',
  'remoteLogout',
  'revokedTokenRejected',
]) {
  const expected = manifest.promotionEligible ? 'approved' : 'pending'
  assert(checks?.[check] === expected, `evidência autenticada deveria ser ${expected}: ${check}`)
}

assert(snapshot.release === release, 'snapshot fora da versão 1.4.0')
assert(snapshot.schemaVersion === release, 'schema fora da versão 1.4.0')
assert(snapshot.declaredSheetCount === 48, 'quantidade de abas alterada')

console.log('TESTE DOS METADADOS DA RELEASE 1.4.0 APROVADO')
console.log('Canário publicado e isolado; elegibilidade segue o gate autenticado')
