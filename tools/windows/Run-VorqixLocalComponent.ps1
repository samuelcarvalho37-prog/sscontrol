param([Parameter(Mandatory=$true)][string]$EnvironmentRoot,[Parameter(Mandatory=$true)][ValidateSet('API','Operador','Gestor','Administrador','Producao')][string]$Component)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
$paths=Get-VorqixLocalPaths $EnvironmentRoot
if($Component -eq 'API'){
  $protected=Import-Clixml -LiteralPath (Join-Path $paths.Runtime 'runtime-environment.xml')
  foreach($key in $protected.Keys){[Environment]::SetEnvironmentVariable($key,[Net.NetworkCredential]::new('',$protected[$key]).Password,'Process')}
  if($env:DATABASE_URL -notmatch '/vorqix_hml_\d{8}_\d{6}$'){throw 'Este inicializador aceita somente o banco de homologacao.'}
  $env:APP_RELEASE_VERSION='1.4.0';$env:API_VERSION='2.0.0';$env:SCHEMA_VERSION='postgres-0061';$env:CONTRACT_VERSION='2.0.0';$env:FRONTEND_VERSION='1.4.0'
  $env:CORS_ALLOWED_ORIGINS='http://127.0.0.1:5183,http://127.0.0.1:5184,http://127.0.0.1:5185,http://127.0.0.1:5186'
  Set-Location (Join-Path $paths.Repository 'backend\node-api')
  & $paths.Node --enable-source-maps dist/server.js
}else{
  $env:VITE_API_BASE_URL='http://127.0.0.1:3334';$env:VITE_API_TRANSPORT='node';$env:VITE_DEV_TENANT_SLUG='fab-control-homologacao-000000000000'
  if($Component -eq 'Operador'){$port=5183;Set-Location (Join-Path $paths.Repository 'frontend')}
  else{Set-Location (Join-Path $paths.Repository 'frontend-gestor');switch($Component){'Gestor'{$port=5184;$env:VITE_PORTAL_PROFILE='GESTOR'}'Administrador'{$port=5185;$env:VITE_PORTAL_PROFILE='ADMIN'}'Producao'{$port=5186;$env:VITE_PORTAL_PROFILE='SHARED'}}}
  & $paths.Node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $port --strictPort
}
exit $LASTEXITCODE
