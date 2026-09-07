param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 55432,
  [string]$DatabaseAdminUser = 'postgres',
  [string]$AdminCredentialStore = (Join-Path $env:LOCALAPPDATA 'FabControl\postgres-dev-credential.xml'),
  [string]$RuntimeCredentialStore = (Join-Path $env:LOCALAPPDATA 'FabControl\node-api-dev-credential.xml')
)

$ErrorActionPreference = 'Stop'

$createdb = Join-Path $PostgresBin 'createdb.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

foreach ($executable in @($createdb, $psql)) {
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Dependencia local nao encontrada em $executable."
  }
}

if (-not (Test-Path -LiteralPath $AdminCredentialStore)) {
  throw "Credencial administrativa protegida nao encontrada em $AdminCredentialStore."
}

$apiDirectory = Split-Path -Parent $PSScriptRoot
$repositoryDirectory = Split-Path -Parent (Split-Path -Parent $apiDirectory)
$contractFile = Join-Path $repositoryDirectory 'database\postgres\tests\001_schema_contract.sql'
$databaseName = 'fab_control_node_test_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
$runtimeUser = 'fab_control_api_local'
$runtimePasswordBytes = [byte[]]::new(36)
$randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomNumberGenerator.GetBytes($runtimePasswordBytes)
$randomNumberGenerator.Dispose()
$runtimePassword = [Convert]::ToBase64String($runtimePasswordBytes)

$adminSecurePassword = Import-Clixml -LiteralPath $AdminCredentialStore
$adminCredential = [System.Net.NetworkCredential]::new('', $adminSecurePassword)
$adminPassword = $adminCredential.Password
$adminPasswordEncoded = [Uri]::EscapeDataString($adminPassword)
$runtimePasswordEncoded = [Uri]::EscapeDataString($runtimePassword)
$adminUrl = "postgresql://${DatabaseAdminUser}:${adminPasswordEncoded}@${HostName}:${Port}/${databaseName}"
$runtimeUrl = "postgresql://${runtimeUser}:${runtimePasswordEncoded}@${HostName}:${Port}/${databaseName}"

$credentialDirectory = Split-Path -Parent $RuntimeCredentialStore
if (-not (Test-Path -LiteralPath $credentialDirectory)) {
  New-Item -ItemType Directory -Path $credentialDirectory | Out-Null
}

$env:PGPASSWORD = $adminPassword

try {
  Write-Host "[1/6] Criando banco isolado $databaseName..."
  & $createdb `
    -h $HostName `
    -p $Port `
    -U $DatabaseAdminUser `
    --encoding=UTF8 `
    $databaseName

  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar o banco isolado da API.'
  }

  $env:NODE_ENV = 'test'
  $env:HOST = '127.0.0.1'
  $env:PORT = '3333'
  $env:LOG_LEVEL = 'silent'
  $env:TRUST_PROXY = 'false'
  $env:BODY_LIMIT_BYTES = '1048576'
  $env:CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
  $env:OPENAPI_ENABLED = 'false'
  $env:DATABASE_URL = $adminUrl
  $env:DATABASE_SSL_MODE = 'disable'
  $env:DATABASE_POOL_MAX = '4'
  $env:DATABASE_IDLE_TIMEOUT_MS = '5000'
  $env:DATABASE_CONNECTION_TIMEOUT_MS = '5000'
  $env:DATABASE_STATEMENT_TIMEOUT_MS = '15000'
  $env:DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001'
  $env:APP_ENVIRONMENT = 'DEVELOPMENT'
  $env:APP_RELEASE_VERSION = '1.4.0'
  $env:API_VERSION = '2.0.0'
  $env:SCHEMA_VERSION = 'postgres-0017'
  $env:CONTRACT_VERSION = '2.0.0'
  $env:FRONTEND_VERSION = '1.4.0'
  $env:AUTH_SESSION_HOURS = '8'
  $env:AUTH_FIRST_ACCESS_MINUTES = '15'
  $env:AUTH_MAINTENANCE_SESSION_MINUTES = '30'
  $env:AUTH_MAX_FAILED_ATTEMPTS = '5'
  $env:AUTH_LOCK_MINUTES = '15'
  $env:AUTH_RECOVERY_COOLDOWN_MINUTES = '10'
  $env:AUTH_PASSWORD_PEPPER = 'local-test-password-pepper-never-used-in-production'
  $env:AUTH_RECOVERY_HMAC_SECRET = 'local-test-recovery-secret-never-used-in-production'
  $env:AUTH_MAINTENANCE_HMAC_SECRET = 'local-test-maintenance-secret-never-used-in-production'

  Write-Host '[2/6] Aplicando migracoes...'
  & $npm run db:migrate
  if ($LASTEXITCODE -ne 0) {
    throw 'As migracoes da API falharam.'
  }

  $createRuntimeRole = @'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'fab_control_api_local'
  ) THEN
    CREATE ROLE fab_control_api_local
      LOGIN
      INHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$$;
'@

  Write-Host '[3/6] Preparando usuario runtime restrito...'
  & $psql `
    -X `
    -q `
    -h $HostName `
    -p $Port `
    -U $DatabaseAdminUser `
    -d $databaseName `
    -v ON_ERROR_STOP=1 `
    -c $createRuntimeRole

  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao preparar o usuario restrito da API.'
  }

  $escapedRuntimePassword = $runtimePassword.Replace("'", "''")
  $runtimeGrantSql = @"
ALTER ROLE fab_control_api_local PASSWORD '$escapedRuntimePassword';
GRANT fab_control_runtime TO fab_control_api_local;
"@

  $runtimeGrantSql | & $psql `
    -X `
    -q `
    -h $HostName `
    -p $Port `
    -U $DatabaseAdminUser `
    -d $databaseName `
    -v ON_ERROR_STOP=1 `
    -f -

  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao proteger o usuario restrito da API.'
  }

  Write-Host '[4/6] Validando contrato relacional...'
  & $psql `
    -X `
    -q `
    -h $HostName `
    -p $Port `
    -U $DatabaseAdminUser `
    -d $databaseName `
    -v ON_ERROR_STOP=1 `
    -f $contractFile

  if ($LASTEXITCODE -ne 0) {
    throw 'O contrato relacional foi reprovado.'
  }

  $runtimePassword |
    ConvertTo-SecureString -AsPlainText -Force |
    Export-Clixml -LiteralPath $RuntimeCredentialStore

  $databaseRecord = Join-Path $credentialDirectory 'last-node-api-test-db.txt'
  Set-Content -LiteralPath $databaseRecord -Value $databaseName -Encoding Ascii

  $env:TEST_DATABASE_URL = $runtimeUrl
  $env:TEST_MIGRATION_DATABASE_URL = $adminUrl
  $env:DATABASE_URL = $runtimeUrl

  Write-Host '[5/6] Executando testes da API...'
  & $npm test
  if ($LASTEXITCODE -ne 0) {
    throw 'Os testes da API falharam.'
  }

  $env:DEMO_ADMIN_PASSWORD = "Test!$([Guid]::NewGuid().ToString('N'))"
  $env:DEMO_QUALITY_PASSWORD = "Test!$([Guid]::NewGuid().ToString('N'))"
  $env:DEMO_SAFETY_PASSWORD = "Test!$([Guid]::NewGuid().ToString('N'))"
  $env:DEMO_MAINTENANCE_PASSWORD = "Test!$([Guid]::NewGuid().ToString('N'))"
  $env:DEMO_OPERATOR_PASSWORD = "Test!$([Guid]::NewGuid().ToString('N'))"

  Write-Host '[6/6] Validando seed idempotente em duas execucoes...'
  1..2 | ForEach-Object {
    & $npm run seed:homologation
    if ($LASTEXITCODE -ne 0) {
      throw "A carga de homologacao falhou na execucao $_."
    }
  }

  Write-Host "Validacao Node.js concluida em $databaseName."
  Write-Host 'Testes e carga idempotente de homologacao foram aprovados.'
  Write-Host 'O banco foi preservado e a senha local foi protegida pelo Windows.'
}
finally {
  @(
    'PGPASSWORD',
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'TEST_MIGRATION_DATABASE_URL',
    'AUTH_PASSWORD_PEPPER',
    'AUTH_RECOVERY_HMAC_SECRET',
    'AUTH_MAINTENANCE_HMAC_SECRET',
    'DEMO_ADMIN_PASSWORD',
    'DEMO_QUALITY_PASSWORD',
    'DEMO_SAFETY_PASSWORD',
    'DEMO_MAINTENANCE_PASSWORD',
    'DEMO_OPERATOR_PASSWORD'
  ) | ForEach-Object {
    Remove-Item "Env:$_" -ErrorAction SilentlyContinue
  }
}
