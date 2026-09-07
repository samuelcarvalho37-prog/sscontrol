import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const releasePath = path.join(root, 'release', 'fab-control.release.json')
const environmentPath = path.join(root, 'release', 'fab-control.environment.local.json')
const backendPath = path.join(root, 'backend', 'apps-script')

function fail(message) {
  console.error(`ERRO: ${message}`)
  process.exit(1)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function read(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function readJson(file) {
  return JSON.parse(read(file))
}

function gitCheckIgnore(relativePath) {
  return spawnSync('git', ['check-ignore', '-q', '--', relativePath], {
    cwd: root,
    stdio: 'ignore',
  }).status === 0
}

function gitIsTracked(relativePath) {
  return spawnSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
    cwd: root,
    stdio: 'ignore',
  }).status === 0
}

function requireChecks(checks, names, expected = 'approved') {
  for (const name of names) {
    assert(checks?.[name] === expected, `evidência ${name} deve ser ${expected}`)
  }
}

const manifest = readJson(releasePath)
const environment = readJson(environmentPath)
const expectedRelease = manifest.release

assert(manifest.manifestVersion === 2, 'manifestVersion deve ser 2')
assert(/^\d+\.\d+\.\d+$/.test(expectedRelease), 'release semântica inválida')

for (const [name, version] of Object.entries(manifest.components || {})) {
  assert(version === expectedRelease, `${name} = ${version}; esperado ${expectedRelease}`)
}

for (const packagePath of ['frontend/package.json', 'frontend-gestor/package.json']) {
  const packageJson = readJson(path.join(root, packagePath))
  assert(packageJson.version === expectedRelease, `${packagePath} fora da release`)
}

const config = read(path.join(backendPath, '00_Config.js'))
const releaseMatch = config.match(/const FAB_RELEASE_VERSION = "([^"]+)";/)
assert(releaseMatch?.[1] === expectedRelease, 'FAB_RELEASE_VERSION divergente')

for (const field of [
  'RELEASE_VERSION',
  'API_VERSION',
  'SCHEMA_VERSION',
  'CONTRACT_VERSION',
  'FRONTEND_VERSION',
]) {
  assert(
    config.includes(`${field}: FAB_RELEASE_VERSION`),
    `campo central ausente em 00_Config.js: ${field}`,
  )
}

const db = read(path.join(backendPath, '02_Db.js'))
for (const key of [
  'release.version',
  'app.version',
  'api.version',
  'schema.version',
  'contract.version',
  'frontend.version',
]) {
  assert(db.includes(`chave:"${key}"`), `chave ausente em 02_Db.js: ${key}`)
}

const sourceFiles = fs
  .readdirSync(backendPath)
  .filter((name) => name.endsWith('.js') || name === 'appsscript.json')
  .sort()

assert(sourceFiles.length === 35, `quantidade de fontes backend = ${sourceFiles.length}; esperado 35`)
assert(
  !fs.readdirSync(backendPath).some((name) => name.endsWith('.gs')),
  'arquivo .gs ativo encontrado',
)

for (const name of sourceFiles.filter((name) => name.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', path.join(backendPath, name)], {
    stdio: 'pipe',
  })
}

JSON.parse(read(path.join(backendPath, 'appsscript.json')))
execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'pipe' })

const material = sourceFiles
  .map((name) => {
    const canonical =
      name === 'appsscript.json'
        ? name
        : `${path.basename(name, path.extname(name))}.script`
    const hash = crypto
      .createHash('sha256')
      .update(read(path.join(backendPath, name)), 'utf8')
      .digest('hex')
      .toUpperCase()
    return { canonical, hash }
  })
  .sort((a, b) => a.canonical.localeCompare(b.canonical))
  .map(({ canonical, hash }) => `${canonical}\n${hash}\n`)
  .join('')

const aggregate = crypto
  .createHash('sha256')
  .update(material, 'utf8')
  .digest('hex')
  .toUpperCase()

const target = manifest.target || {}
assert(target.backendSourceSha256 === aggregate, 'SHA256 agregado do backend divergente')
assert(target.environment === 'homologation', 'destino não identificado como homologação')
assert(
  Number.isInteger(target.immutableAppsScriptVersion) && target.immutableAppsScriptVersion > 0,
  'versão imutável do Apps Script inválida',
)
assert(target.deploymentId && target.deploymentId !== 'HEAD', 'deployment imutável ausente')
assert(/^[0-9a-f]{7,40}$/i.test(target.sourceGitCommit || ''), 'commit-fonte inválido')
assert(target.spreadsheetId, 'planilha canária ausente')

const production = manifest.productionBaseline || {}
assert(production.release === '1.3.1', 'baseline de produção deve permanecer em 1.3.1')
assert(production.health === 'approved-unchanged', 'saúde da produção não confirmada')
assert(production.deploymentId !== target.deploymentId, 'canário reutiliza deployment de produção')
assert(production.spreadsheetId !== target.spreadsheetId, 'canário reutiliza planilha de produção')

for (const relativePath of [
  'backend/apps-script/.clasp.json',
  'backend/apps-script/.clasp.canary.json',
  'release/fab-control.environment.local.json',
]) {
  assert(gitCheckIgnore(relativePath), `${relativePath} não está protegido pelo .gitignore`)
  assert(!gitIsTracked(relativePath), `${relativePath} está rastreado pelo Git`)
}

assert(environment.environment === 'homologation', 'ambiente local divergente')
assert(environment.release === expectedRelease, 'release do ambiente local divergente')
assert(environment.isolatedFromProduction === true, 'isolamento local não confirmado')
assert(environment.immutableAppsScriptVersion === target.immutableAppsScriptVersion, 'versão local divergente')
assert(environment.deploymentId === target.deploymentId, 'deployment local divergente')
assert(environment.sourceGitCommit === target.sourceGitCommit, 'commit local divergente')
assert(environment.backendSourceSha256 === aggregate, 'hash local divergente')
assert(environment.spreadsheetId === target.spreadsheetId, 'planilha local divergente')
assert(
  environment.webAppUrl?.includes(`/s/${target.deploymentId}/exec`),
  'URL canária local inválida',
)
assert(
  environment.production?.deploymentId === production.deploymentId &&
    environment.production?.spreadsheetId === production.spreadsheetId,
  'referência local de produção divergente',
)

const publicChecks = [
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
  'adminImportEndpointDeclared',
  'adminImportRequiresAuthentication',
  'entityActionEndpointDeclared',
  'entityActionRequiresAuthentication',
  'governanceEndpointsDeclared',
  'governanceEndpointsRequireAuthentication',
  'restoreEndpointsDeclared',
  'restoreEndpointsRequireAuthentication',
  'unknownLoginRejected',
  'recoveryNonEnumeration',
  'usersRequiresAuthentication',
  'invalidPermissionTokenRejected',
]
requireChecks(environment.checks, publicChecks)
requireChecks(environment.checks, ['operatorFrontendBuild', 'managerFrontendBuild'])

const internalAuthenticatedChecks = [
  'internalCatalogAuthenticatedRead',
  'internalCatalogAuthenticatedDraftSave',
  'internalCatalogAuthenticatedValidation',
  'internalCatalogAuthenticatedPublish',
  'internalCatalogAuthenticatedRollback',
  'maintenanceWindowClosedAfterValidation',
  'maintenanceSessionRejectedAfterWindowClose',
]
requireChecks(environment.checks, internalAuthenticatedChecks)

const canary = manifest.canaryEvidence || {}
assert(canary.environment === 'isolated', 'manifesto não confirma isolamento do canário')
assert(canary.release === expectedRelease, 'release da evidência canária divergente')
assert(canary.backendSourceSha256 === aggregate, 'hash da evidência canária divergente')
assert(canary.immutableAppsScriptVersion === target.immutableAppsScriptVersion, 'versão da evidência divergente')
assert(canary.sourceGitCommit === target.sourceGitCommit, 'commit da evidência divergente')
assert(canary.deploymentId === target.deploymentId, 'deployment da evidência divergente')
assert(canary.spreadsheetId === target.spreadsheetId, 'planilha da evidência divergente')
requireChecks(canary.checks, publicChecks)
requireChecks(canary.checks, internalAuthenticatedChecks)
assert(canary.checks?.declaredSheets === 48, 'quantidade de abas declaradas divergente')
assert(canary.checks?.productionDeploymentUnchanged === 'approved', 'produção não foi reconfirmada')

const authenticatedChecks = [
  'permanentAdminLogin',
  'authenticatedAdminRead',
  'authenticatedPermissionMatrixRead',
  'authenticatedConfigurationStateRead',
  'configurationSchemaSeeded',
  'authenticatedImportCatalogRead',
  'importSchemaSeeded',
  'remoteLogout',
  'revokedTokenRejected',
]

if (manifest.status === 'canary-published-authenticated-validation-pending') {
  assert(manifest.promotionEligible === false, 'candidato pendente não pode ser promovível')
  requireChecks(environment.checks, authenticatedChecks, 'pending')
  requireChecks(canary.checks, authenticatedChecks, 'pending')
} else if (manifest.status === 'canary-homologated') {
  assert(manifest.promotionEligible === true, 'canário homologado deve ser promovível')
  requireChecks(environment.checks, authenticatedChecks)
  requireChecks(canary.checks, authenticatedChecks)
} else {
  fail(`status de release não reconhecido: ${manifest.status}`)
}

const candidate = manifest.candidateEvidence || {}
assert(candidate.environment === 'isolated', 'candidato não está isolado')
assert(candidate.release === expectedRelease, 'release do candidato divergente')
requireChecks(candidate, [
  'javascriptSyntax',
  'authenticationContract',
  'adminIdentityContract',
  'configurationEngineContract',
  'configurationEngineE2E',
  'motorCommercialAccessContract',
  'motorCommercialAccessE2E',
  'motorInternalMaintenanceAccessE2E',
  'motorInternalCatalogContract',
  'motorInternalCatalogVersioningE2E',
  'adminImportContract',
  'adminImportE2E',
  'productionBootstrapContract',
  'operatorFrontendBuild',
  'managerFrontendBuild',
])
assert(
  candidate.motorInternalAccessGenerator?.startsWith('approved-'),
  'gerador assinado do motor sem evidência aprovada',
)
assert(
  candidate.motorInternalCatalogAuthenticatedE2E?.startsWith('approved-'),
  'catálogo interno sem evidência autenticada aprovada',
)
assert(
  candidate.motorInternalMaintenanceRevocation?.startsWith('approved-'),
  'revogação da manutenção interna sem evidência aprovada',
)
assert(
  candidate.remoteCanary === (manifest.promotionEligible ? 'approved' : 'public-contract-approved'),
  'evidência remota do canário divergente',
)

console.log('VALIDAÇÃO LOCAL DO CANÁRIO APROVADA — VALIDADOR V2.0')
console.log(`Release: ${expectedRelease}`)
console.log(`Apps Script imutável: @${target.immutableAppsScriptVersion}`)
console.log(`SHA256 agregado do backend: ${aggregate}`)
console.log('Isolamento entre produção e homologação: aprovado')
console.log('Contrato público, proteção de acesso e builds: aprovados')
if (!manifest.promotionEligible) {
  console.log('Promoção para produção: bloqueada até concluir o login administrativo remoto')
} else {
  console.log('Promoção para produção: elegível, mas não executada')
}
