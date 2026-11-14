Set-StrictMode -Version Latest
function Get-VorqixLocalPaths {
  param([Parameter(Mandatory=$true)][string]$EnvironmentRoot)
  $root=(Resolve-Path -LiteralPath $EnvironmentRoot -ErrorAction Stop).Path
  $repo=Split-Path (Split-Path $PSScriptRoot)
  $runtime=Join-Path $root 'work\homologacao'
  if(-not(Test-Path -LiteralPath (Join-Path $runtime 'runtime-environment.xml'))){throw 'Configuracao protegida da homologacao nao encontrada.'}
  [pscustomobject]@{Root=$root;Repository=$repo;Runtime=$runtime;Node=(Join-Path $root 'work\tools\node-v24.22.1-win-x64\node.exe');Postgres=(Join-Path $root 'work\tools\postgresql16\pgsql\bin');Data=(Join-Path $root 'work\pgdata')}
}
function Test-VorqixPort {
  param([int]$Port)
  $client=New-Object Net.Sockets.TcpClient
  try{$task=$client.ConnectAsync('127.0.0.1',$Port);return ($task.Wait(350) -and $client.Connected)}catch{return $false}finally{$client.Dispose()}
}
function Test-VorqixApi {
  try{$result=Invoke-RestMethod 'http://127.0.0.1:3334/health/ready' -TimeoutSec 3;return ($result.ok -eq $true -and $result.data.app -eq 'fab-control-api' -and $result.data.database.ready -eq $true)}catch{return $false}
}
function Test-VorqixWeb {
  param([int]$Port)
  try{$result=Invoke-WebRequest "http://127.0.0.1:$Port/" -TimeoutSec 3 -UseBasicParsing;return ($result.StatusCode -eq 200 -and $result.Content -match '(?i)<title>[^<]*VORQIX')}catch{return $false}
}
function Wait-VorqixReady {
  param([Parameter(Mandatory=$true)][scriptblock]$Check,[int]$Seconds=90,[string]$Name='Componente')
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  do{if(& $Check){return};Start-Sleep -Milliseconds 600}while([DateTime]::UtcNow -lt $deadline)
  throw "$Name nao ficou pronto em $Seconds segundos. Consulte os logs locais; nenhum processo desconhecido foi encerrado."
}
Export-ModuleMember -Function Get-VorqixLocalPaths,Test-VorqixPort,Test-VorqixApi,Test-VorqixWeb,Wait-VorqixReady
