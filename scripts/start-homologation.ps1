[CmdletBinding()]
param(
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentFile = Join-Path $repositoryRoot 'release\fab-control.environment.local.json'
$runtimeDirectory = Join-Path $repositoryRoot '.homologation-runtime'
$productionDeploymentId = 'AKfycbx1wac0-NkUEhbR4XB7OiR1e3ug8p7MRBM2wM-0jH7_zhIub6EdENfBoJPGQh5UzKb1Iw'

if (-not (Test-Path -LiteralPath $environmentFile)) {
  throw 'Metadados locais do ambiente de homologação não foram encontrados.'
}

$environment = Get-Content -LiteralPath $environmentFile -Raw | ConvertFrom-Json
$apiUrl = [string]$environment.webAppUrl

if (
  [string]$environment.environment -ne 'homologation' -or
  $environment.isolatedFromProduction -ne $true -or
  [string]::IsNullOrWhiteSpace($apiUrl) -or
  $apiUrl.Contains($productionDeploymentId)
) {
  throw 'Inicialização recusada: o ambiente informado não é o canário isolado.'
}

$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

$applications = @(
  @{
    Name = 'Operador'
    Port = 5173
    Directory = Join-Path $repositoryRoot 'frontend'
    PortalProfile = ''
  },
  @{
    Name = 'Gestor'
    Port = 5174
    Directory = Join-Path $repositoryRoot 'frontend-gestor'
    PortalProfile = 'GESTOR'
  },
  @{
    Name = 'Administrador'
    Port = 5175
    Directory = Join-Path $repositoryRoot 'frontend-gestor'
    PortalProfile = 'ADMIN'
  }
)

function Get-PortOwner {
  param([int]$Port)

  return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Stop-ExpectedViteProcess {
  param(
    [int]$ProcessId,
    [string]$ExpectedDirectory
  )

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  $normalizedDirectory = $ExpectedDirectory.ToLowerInvariant()
  $commandLine = [string]$process.CommandLine

  if (
    -not $process -or
    -not $commandLine.ToLowerInvariant().Contains($normalizedDirectory) -or
    -not $commandLine.ToLowerInvariant().Contains('vite')
  ) {
    throw "A porta está ocupada por outro aplicativo e não será encerrada: PID $ProcessId."
  }

  Stop-Process -Id $ProcessId -Force
}

$previousApiUrl = $env:VITE_API_BASE_URL
$previousPortalProfile = $env:VITE_PORTAL_PROFILE
$started = @()

try {
  foreach ($application in $applications) {
    $portOwner = Get-PortOwner -Port $application.Port
    if ($portOwner) {
      if (-not $Restart) {
        $started += [pscustomobject]@{
          Perfil = $application.Name
          Endereco = "http://127.0.0.1:$($application.Port)/"
          Estado = 'Já estava ativo'
        }
        continue
      }

      Stop-ExpectedViteProcess `
        -ProcessId $portOwner.OwningProcess `
        -ExpectedDirectory $application.Directory

      $deadline = [DateTime]::UtcNow.AddSeconds(12)
      while ((Get-PortOwner -Port $application.Port) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
      }
      if (Get-PortOwner -Port $application.Port) {
        throw "A porta $($application.Port) não foi liberada."
      }
    }

    $env:VITE_API_BASE_URL = $apiUrl
    $env:VITE_PORTAL_PROFILE = $application.PortalProfile

    $safeName = $application.Name.ToLowerInvariant()
    $standardOutput = Join-Path $runtimeDirectory "$safeName.stdout.log"
    $standardError = Join-Path $runtimeDirectory "$safeName.stderr.log"

    Start-Process `
      -FilePath $npmCommand `
      -ArgumentList @(
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        [string]$application.Port,
        '--strictPort'
      ) `
      -WorkingDirectory $application.Directory `
      -WindowStyle Hidden `
      -RedirectStandardOutput $standardOutput `
      -RedirectStandardError $standardError | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
      try {
        $response = Invoke-WebRequest `
          -Uri "http://127.0.0.1:$($application.Port)/" `
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
      throw "O portal $($application.Name) não respondeu na porta $($application.Port)."
    }

    $started += [pscustomobject]@{
      Perfil = $application.Name
      Endereco = "http://127.0.0.1:$($application.Port)/"
      Estado = 'Ativo no canário'
    }
  }
} finally {
  $env:VITE_API_BASE_URL = $previousApiUrl
  $env:VITE_PORTAL_PROFILE = $previousPortalProfile
}

$started | Format-Table -AutoSize
