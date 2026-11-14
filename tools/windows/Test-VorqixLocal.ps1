[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
$paths=Get-VorqixLocalPaths $EnvironmentRoot
$apiReady=Test-VorqixApi
$schema=$null
if($apiReady){$schema=(Invoke-RestMethod 'http://127.0.0.1:3334/health/ready' -TimeoutSec 3).data.schema_version}
$interfaces=@(5183,5184,5185,5186)|ForEach-Object {[pscustomobject]@{port=$_;ready=(Test-VorqixWeb $_)}}
$backups=Get-ChildItem (Join-Path $paths.Runtime 'backups') -Directory -ErrorAction SilentlyContinue|Sort-Object Name -Descending
$lastComplete=$null;$lastRestored=$null
foreach($folder in $backups){$marker=Join-Path $folder.FullName 'complete.json';if(Test-Path -LiteralPath $marker){try{$data=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json;if(-not $lastComplete){$lastComplete=$data};if($data.restore_verified -and -not $lastRestored){$lastRestored=$data}}catch{}}}
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'VORQIX Homologacao.lnk'
$backupFresh=$lastComplete -and ([DateTime]::UtcNow-([DateTime]$lastComplete.completed_at).ToUniversalTime()).TotalHours -le 36
$restoreRecent=$lastRestored -and ([DateTime]::UtcNow-([DateTime]$lastRestored.completed_at).ToUniversalTime()).TotalDays -le 7
$checks=[ordered]@{checked_at=[DateTime]::UtcNow.ToString('o');api_ready=$apiReady;schema=$schema;interfaces=$interfaces;backup_completed_at=if($lastComplete){$lastComplete.completed_at}else{$null};backup_fresh=[bool]$backupFresh;restore_verified_at=if($lastRestored){$lastRestored.completed_at}else{$null};restore_recent=[bool]$restoreRecent;start_at_user_login=(Test-Path -LiteralPath $startup);ok=($apiReady -and @($interfaces|Where-Object {-not $_.ready}).Count -eq 0 -and $backupFresh -and $restoreRecent)}
$checks|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $paths.Runtime 'diagnostic-status.json')
$checks|ConvertTo-Json -Depth 5
