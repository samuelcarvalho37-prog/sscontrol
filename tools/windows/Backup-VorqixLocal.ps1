[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentRoot,[switch]$VerifyRestore)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
$paths=Get-VorqixLocalPaths $EnvironmentRoot
$protected=Import-Clixml -LiteralPath (Join-Path $paths.Runtime 'runtime-environment.xml')
$runtimeUrl=[uri][Net.NetworkCredential]::new('',$protected['DATABASE_URL']).Password
if($runtimeUrl.Host -ne '127.0.0.1' -or $runtimeUrl.AbsolutePath -notmatch '^/vorqix_hml_\d{8}_\d{6}$'){throw 'Banco de homologacao local obrigatorio.'}
$credential=Import-Clixml -LiteralPath (Join-Path $paths.Root 'work\postgres-admin.credential.xml')
$password=[Net.NetworkCredential]::new('',$credential).Password
$previous=$env:VORQIX_BACKUP_URL
try{
  $env:VORQIX_BACKUP_URL='postgresql://vorqix_local_admin:'+ [uri]::EscapeDataString($password)+'@127.0.0.1:5432'+$runtimeUrl.AbsolutePath
  $arguments=@((Join-Path $PSScriptRoot 'backup-local.mjs'),$paths.Root)
  if($VerifyRestore){$arguments+='--verify-restore'}
  & $paths.Node @arguments
  if($LASTEXITCODE -ne 0){throw 'Falha no backup; nenhum dado da origem foi substituido.'}
}finally{$env:VORQIX_BACKUP_URL=$previous}
