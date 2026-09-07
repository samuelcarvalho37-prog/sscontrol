[CmdletBinding()]
param(
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiDirectory = Join-Path $repositoryRoot 'backend\node-api'
$runtimeDirectory = Join-Path $repositoryRoot '.homologation-runtime\node'
$databaseRecord = Join-Path $env:LOCALAPPDATA 'FabControl\last-node-api-test-db.txt'
$runtimeCredentialStore = Join-Path $env:LOCALAPPDATA 'FabControl\node-api-dev-credential.xml'
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source

foreach ($requiredPath in @($databaseRecord, $runtimeCredentialStore)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Dependência local não encontrada: $requiredPath. Execute backend/node-api/scripts/test-local.ps1 primeiro."
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

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

function New-HomologationPassword {
  $bytes = [byte[]]::new(18)
  $randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $randomNumberGenerator.GetBytes($bytes)
  } finally {
    $randomNumberGenerator.Dispose()
  }
  $random = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'b').TrimEnd('=')
  return "Hml!9${random}"
}

function Get-PortOwner {
  param([Parameter(Mandatory)][int]$Port)

  return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Stop-ExpectedLocalProcess {
  param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][string]$ExpectedFragment
  )

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  $commandLine = [string]$process.CommandLine
  $normalizedCommandLine = $commandLine.Replace('\', '/').ToLowerInvariant()
  $normalizedExpectedFragment = $ExpectedFragment.Replace('\', '/').ToLowerInvariant()
  if (-not $process -or -not $normalizedCommandLine.Contains($normalizedExpectedFragment)) {
    throw "A porta está ocupada por outro aplicativo e não será encerrada: PID $ProcessId."
  }
  Stop-Process -Id $ProcessId -Force
}

function Ensure-PortAvailable {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$ExpectedFragment
  )

  $owner = Get-PortOwner -Port $Port
  if (-not $owner) { return }
  if (-not $Restart) {
    throw "A porta $Port já está em uso. Execute novamente com -Restart para reiniciar somente processos reconhecidos."
  }

  Stop-ExpectedLocalProcess -ProcessId $owner.OwningProcess -ExpectedFragment $ExpectedFragment
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ((Get-PortOwner -Port $Port) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-PortOwner -Port $Port) {
    throw "A porta $Port não foi liberada."
  }
}

function Wait-HttpEndpoint {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [int]$TimeoutSeconds = 35
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
    } catch {
      Start-Sleep -Milliseconds 350
    }
  }
  throw "O endpoint não respondeu dentro do prazo: $Uri"
}

function Assert-AdminBootstrap {
  param(
    [Parameter(Mandatory)][string]$EmployeeNumber,
    [Parameter(Mandatory)][string]$Password
  )

  $loginBody = @{
    matricula = $EmployeeNumber
    senha = $Password
  } | ConvertTo-Json
  $login = Invoke-RestMethod `
    -Method Post `
    -Uri 'http://127.0.0.1:3333/v1/auth/login' `
    -ContentType 'application/json' `
    -Body $loginBody `
    -TimeoutSec 10
  $token = [string]$login.data.access_token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'A API não devolveu a sessão administrativa de homologação.'
  }

  $capabilities = @($login.data.user.capacidades)
  $requiredCapabilities = @(
    'admin.identity.read',
    'admin.identity.manage',
    'admin.governance.read',
    'admin.governance.manage',
    'admin.configuration.manage'
  )
  $missingCapabilities = @($requiredCapabilities | Where-Object { $_ -notin $capabilities })
  if ($missingCapabilities.Count -gt 0) {
    throw "O Administrador de homologação não recebeu: $($missingCapabilities -join ', ')."
  }

  $headers = @{ Authorization = "Bearer $token" }
  $bootstrapEndpoints = @(
    '/v1/admin/commercial-access',
    '/v1/admin/company',
    '/v1/admin/users?limite=500',
    '/v1/admin/permissions'
  )
  foreach ($endpoint in $bootstrapEndpoints) {
    $response = Invoke-WebRequest `
      -Uri "http://127.0.0.1:3333$endpoint" `
      -Headers $headers `
      -UseBasicParsing `
      -TimeoutSec 10
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "O pré-carregamento administrativo falhou em $endpoint."
    }
  }
}

$passwords = [ordered]@{
  Administrador = New-HomologationPassword
  Qualidade = New-HomologationPassword
  Seguranca = New-HomologationPassword
  Manutencao = New-HomologationPassword
  Operador = New-HomologationPassword
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
  DEMO_ADMIN_PASSWORD = $passwords.Administrador
  DEMO_QUALITY_PASSWORD = $passwords.Qualidade
  DEMO_SAFETY_PASSWORD = $passwords.Seguranca
  DEMO_MAINTENANCE_PASSWORD = $passwords.Manutencao
  DEMO_OPERATOR_PASSWORD = $passwords.Operador
}

$previousEnvironment = @{}
foreach ($entry in $environmentValues.GetEnumerator()) {
  $previousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
}

try {
  & $npmCommand run seed:homologation --prefix $apiDirectory
  if ($LASTEXITCODE -ne 0) { throw 'A carga de homologação Node falhou.' }

  $applications = @(
    [ordered]@{ Name = 'API Node'; Port = 3333; Directory = $apiDirectory; Fragment = 'dist\server.js'; Type = 'api' },
    [ordered]@{ Name = 'Operador'; Port = 5173; Directory = (Join-Path $repositoryRoot 'frontend'); Fragment = 'vite'; Type = 'web'; Profile = '' },
    [ordered]@{ Name = 'Gestor'; Port = 5174; Directory = (Join-Path $repositoryRoot 'frontend-gestor'); Fragment = 'vite'; Type = 'web'; Profile = 'GESTOR' },
    [ordered]@{ Name = 'Administrador'; Port = 5175; Directory = (Join-Path $repositoryRoot 'frontend-gestor'); Fragment = 'vite'; Type = 'web'; Profile = 'ADMIN' }
  )

  foreach ($application in $applications) {
    Ensure-PortAvailable -Port $application.Port -ExpectedFragment $application.Fragment
  }

  $apiOut = Join-Path $runtimeDirectory 'api.stdout.log'
  $apiErr = Join-Path $runtimeDirectory 'api.stderr.log'
  Start-Process -FilePath $nodeCommand `
    -ArgumentList @('--enable-source-maps', 'dist/server.js') `
    -WorkingDirectory $apiDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput $apiOut `
    -RedirectStandardError $apiErr | Out-Null
  Wait-HttpEndpoint -Uri 'http://127.0.0.1:3333/health/ready'
  Assert-AdminBootstrap `
    -EmployeeNumber 'USR-ADMIN-DEMO' `
    -Password $passwords.Administrador

  foreach ($application in ($applications | Where-Object Type -eq 'web')) {
    $env:VITE_API_BASE_URL = 'http://127.0.0.1:3333'
    $env:VITE_API_TRANSPORT = 'node'
    $env:VITE_PORTAL_PROFILE = $application.Profile
    $safeName = $application.Name.ToLowerInvariant()
    Start-Process -FilePath $npmCommand `
      -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', [string]$application.Port, '--strictPort') `
      -WorkingDirectory $application.Directory `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $runtimeDirectory "$safeName.stdout.log") `
      -RedirectStandardError (Join-Path $runtimeDirectory "$safeName.stderr.log") | Out-Null
    Wait-HttpEndpoint -Uri "http://127.0.0.1:$($application.Port)/"
  }

  $credentialDocument = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    database = $databaseName
    profiles = @(
      [ordered]@{ profile = 'Administrador'; url = 'http://127.0.0.1:5175/'; employee_number = 'USR-ADMIN-DEMO'; password = $passwords.Administrador },
      [ordered]@{ profile = 'Qualidade'; url = 'http://127.0.0.1:5174/'; employee_number = 'USR-QUAL-DEMO'; password = $passwords.Qualidade },
      [ordered]@{ profile = 'Segurança'; url = 'http://127.0.0.1:5174/'; employee_number = 'USR-SEG-DEMO'; password = $passwords.Seguranca },
      [ordered]@{ profile = 'Manutenção'; url = 'http://127.0.0.1:5174/'; employee_number = 'USR-MAN-DEMO'; password = $passwords.Manutencao },
      [ordered]@{ profile = 'Operador'; url = 'http://127.0.0.1:5173/'; employee_number = 'USR-OPE-DEMO'; password = $passwords.Operador }
    )
  }
  $credentialPath = Join-Path $runtimeDirectory 'access.local.json'
  $credentialDocument | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $credentialPath -Encoding utf8

  Write-Host ''
  Write-Host "Homologação Node/PostgreSQL ativa no banco $databaseName."
  $credentialDocument.profiles | Format-Table profile, url, employee_number, password -AutoSize
  Write-Host "Credenciais locais ignoradas pelo Git: $credentialPath"
} finally {
  foreach ($entry in $previousEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_API_TRANSPORT -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_PORTAL_PROFILE -ErrorAction SilentlyContinue
}
