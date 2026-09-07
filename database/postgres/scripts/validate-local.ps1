param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 55432,
  [string]$DatabaseUser = 'postgres',
  [string]$CredentialStore = (Join-Path $env:LOCALAPPDATA 'FabControl\postgres-dev-credential.xml')
)

$ErrorActionPreference = 'Stop'

$psql = Join-Path $PostgresBin 'psql.exe'
$createdb = Join-Path $PostgresBin 'createdb.exe'

if (-not (Test-Path -LiteralPath $psql)) {
  throw "psql nao encontrado em $psql."
}

if (-not (Test-Path -LiteralPath $createdb)) {
  throw "createdb nao encontrado em $createdb."
}

if (-not (Test-Path -LiteralPath $CredentialStore)) {
  throw "Credencial local protegida nao encontrada em $CredentialStore."
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$postgresDirectory = Split-Path -Parent $scriptDirectory
$migrationDirectory = Join-Path $postgresDirectory 'migrations'
$contractFile = Join-Path $postgresDirectory 'tests\001_schema_contract.sql'
$databaseName = 'fab_control_schema_test_' + (Get-Date -Format 'yyyyMMdd_HHmmss')

$securePassword = Import-Clixml -LiteralPath $CredentialStore
$credential = [System.Net.NetworkCredential]::new('', $securePassword)
$env:PGPASSWORD = $credential.Password

try {
  & $createdb `
    -h $HostName `
    -p $Port `
    -U $DatabaseUser `
    --encoding=UTF8 `
    $databaseName

  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar o banco isolado de validacao.'
  }

  $migrations = Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' |
    Sort-Object Name

  if ($migrations.Count -eq 0) {
    throw "Nenhuma migracao encontrada em $migrationDirectory."
  }

  foreach ($migration in $migrations) {
    Write-Host "Aplicando $($migration.Name)"

    & $psql `
      -X `
      -q `
      -h $HostName `
      -p $Port `
      -U $DatabaseUser `
      -d $databaseName `
      -v ON_ERROR_STOP=1 `
      -f $migration.FullName

    if ($LASTEXITCODE -ne 0) {
      throw "Migracao invalida: $($migration.Name)."
    }
  }

  & $psql `
    -X `
    -h $HostName `
    -p $Port `
    -U $DatabaseUser `
    -d $databaseName `
    -v ON_ERROR_STOP=1 `
    -f $contractFile

  if ($LASTEXITCODE -ne 0) {
    throw 'Contrato relacional reprovado.'
  }

  Write-Host "Validacao concluida em $databaseName."
  Write-Host 'O banco de teste foi preservado para inspecao; nenhuma base existente foi removida.'
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
