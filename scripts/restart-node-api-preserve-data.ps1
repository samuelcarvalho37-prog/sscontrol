[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDirectory = Join-Path $repositoryRoot 'backend\node-api'
$runtimeDirectory = Join-Path $repositoryRoot '.homologation-runtime\node'
$databaseRecord = Join-Path $env:LOCALAPPDATA 'FabControl\last-node-api-test-db.txt'
$runtimeCredentialStore = Join-Path $env:LOCALAPPDATA 'FabControl\node-api-dev-credential.xml'

foreach ($requiredPath in @($databaseRecord, $runtimeCredentialStore)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Dependência local não encontrada: $requiredPath"
  }
}

$databaseName = (Get-Content -LiteralPath $databaseRecord -Raw).Trim()
if ($databaseName -notmatch '^fab_control_node_test_[0-9]{8}_[0-9]{6}$') {
  throw 'O registro do banco local não possui um nome de homologação válido.'
}

$runtimeSecurePassword = Import-Clixml -LiteralPath $runtimeCredentialStore
$runtimeCredential = [System.Net.NetworkCredential]::new('', $runtimeSecurePassword)
$runtimePasswordEncoded = [Uri]::EscapeDataString($runtimeCredential.Password)
$databaseUrl = "postgresql://fab_control_api_local:${runtimePasswordEncoded}@127.0.0.1:55432/${databaseName}"

$portOwner = Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($portOwner) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($portOwner.OwningProcess)"
  $commandLine = [string]$process.CommandLine
  if (-not $process -or -not $commandLine.Contains('dist/server.js')) {
    throw "A porta 3333 está ocupada por um processo não reconhecido: PID $($portOwner.OwningProcess)."
  }

  Stop-Process -Id $portOwner.OwningProcess -Force
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (
    (Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue) -and
    [DateTime]::UtcNow -lt $deadline
  ) {
    Start-Sleep -Milliseconds 200
  }
}

if (Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue) {
  throw 'A porta 3333 não foi liberada.'
}

$environmentValues = [ordered]@{
  NODE_ENV = 'development'
  HOST = '127.0.0.1'
  PORT = '3333'
  LOG_LEVEL = 'info'
  TRUST_PROXY = 'false'
  BODY_LIMIT_BYTES = '1048576'
  CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175'
  OPENAPI_ENABLED = 'true'
  STORAGE_LOCAL_ROOT = (Join-Path $runtimeDirectory 'private-storage')
  STORAGE_MAX_EVIDENCE_BYTES = '6291456'
  DATABASE_URL = $databaseUrl
  DATABASE_SSL_MODE = 'disable'
  DATABASE_POOL_MAX = '10'
  DATABASE_IDLE_TIMEOUT_MS = '30000'
  DATABASE_CONNECTION_TIMEOUT_MS = '5000'
  DATABASE_STATEMENT_TIMEOUT_MS = '15000'
  DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001'
  APP_ENVIRONMENT = 'HOMOLOGATION'
  APP_RELEASE_VERSION = '1.4.0'
  API_VERSION = '2.0.0'
  SCHEMA_VERSION = 'postgres-0017'
  CONTRACT_VERSION = '2.0.0'
  FRONTEND_VERSION = '1.4.0'
  AUTH_SESSION_HOURS = '8'
  AUTH_FIRST_ACCESS_MINUTES = '15'
  AUTH_MAINTENANCE_SESSION_MINUTES = '30'
  AUTH_MAX_FAILED_ATTEMPTS = '5'
  AUTH_LOCK_MINUTES = '15'
  AUTH_RECOVERY_COOLDOWN_MINUTES = '10'
  AUTH_PASSWORD_PEPPER = 'local-test-password-pepper-never-used-in-production'
  AUTH_RECOVERY_HMAC_SECRET = 'local-test-recovery-secret-never-used-in-production'
  AUTH_MAINTENANCE_HMAC_SECRET = 'local-test-maintenance-secret-never-used-in-production'
}

foreach ($entry in $environmentValues.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$standardOutput = Join-Path $runtimeDirectory "api.restart.$timestamp.stdout.log"
$standardError = Join-Path $runtimeDirectory "api.restart.$timestamp.stderr.log"
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source

$apiProcess = Start-Process -FilePath $nodeCommand `
  -ArgumentList @('--enable-source-maps', 'dist/server.js') `
  -WorkingDirectory $apiDirectory `
  -WindowStyle Hidden `
  -RedirectStandardOutput $standardOutput `
  -RedirectStandardError $standardError `
  -PassThru

$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(35)
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $response = Invoke-WebRequest `
      -Uri 'http://127.0.0.1:3333/health/ready' `
      -UseBasicParsing `
      -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 350
  }
}

if (-not $ready) {
  throw "A API não iniciou. Consulte: $standardError"
}

[pscustomobject]@{
  ProcessId = $apiProcess.Id
  Ready = $ready
  Database = $databaseName
  SeedExecutado = $false
  CredenciaisAlteradas = $false
  StandardOutput = $standardOutput
  StandardError = $standardError
}
