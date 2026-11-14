[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
$paths=Get-VorqixLocalPaths $EnvironmentRoot
$mutex=New-Object Threading.Mutex($false,'Local\VORQIX-Homologacao-Startup')
$locked=$false
$result=[ordered]@{started_at=[DateTime]::UtcNow.ToString('o');ok=$false;components=@();message=$null}
try{
  try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked){Write-Output 'A inicializacao do VORQIX ja esta em andamento.';return}
  if(-not(Test-Path -LiteralPath $paths.Node)){throw 'Node.js local nao encontrado.'}
  $pgReady=Join-Path $paths.Postgres 'pg_isready.exe'
  & $pgReady -h 127.0.0.1 -p 5432 *> $null
  if($LASTEXITCODE -ne 0){
    if(-not(Test-VorqixPort 5432)){
      & (Join-Path $paths.Postgres 'pg_ctl.exe') -D $paths.Data -l (Join-Path $paths.Root 'work\postgresql.log') -w -t 180 start
      if($LASTEXITCODE -ne 0){throw 'Nao foi possivel iniciar o banco local. Os arquivos foram preservados.'}
    }
    Wait-VorqixReady -Seconds 180 -Name PostgreSQL -Check {& $pgReady -h 127.0.0.1 -p 5432 *> $null;return $LASTEXITCODE -eq 0}
  }
  $components=@(@{Name='API';Port=3334},@{Name='Operador';Port=5183},@{Name='Gestor';Port=5184},@{Name='Administrador';Port=5185},@{Name='Producao';Port=5186})
  $shell=(Get-Process -Id $PID).Path
  foreach($component in $components){
    if(-not(Test-VorqixPort $component.Port)){
      $runner=Join-Path $PSScriptRoot 'Run-VorqixLocalComponent.ps1'
      Start-Process -FilePath $shell -WindowStyle Hidden -ArgumentList @('-NoProfile','-File',('"'+$runner+'"'),'-EnvironmentRoot',('"'+$paths.Root+'"'),'-Component',$component.Name) -RedirectStandardOutput (Join-Path $paths.Runtime "launch-$($component.Name).log") -RedirectStandardError (Join-Path $paths.Runtime "launch-$($component.Name)-error.log")|Out-Null
    }
  }
  Wait-VorqixReady -Name API -Check {Test-VorqixApi}
  foreach($component in $components|Where-Object {$_.Name -ne 'API'}){Wait-VorqixReady -Name $component.Name -Check {Test-VorqixWeb $component.Port};$result.components+=@{name=$component.Name;port=$component.Port;ready=$true}}
  $result.ok=$true;$result.message='API, banco e interfaces prontos.'
  $today=Get-Date -Format yyyyMMdd
  $backups=Get-ChildItem (Join-Path $paths.Runtime 'backups') -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name.StartsWith($today) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'complete.json'))}
  if(-not $backups){& (Join-Path $PSScriptRoot 'Backup-VorqixLocal.ps1') -EnvironmentRoot $paths.Root}
  Write-Output 'VORQIX pronto: http://127.0.0.1:5186/ (perfis) e http://127.0.0.1:5185/ (TI).'
}catch{$result.ok=$false;$result.message=$_.Exception.Message;throw}
finally{if($locked){$result['finished_at']=[DateTime]::UtcNow.ToString('o');$result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $paths.Runtime 'startup-status.json');$mutex.ReleaseMutex()};$mutex.Dispose()}
