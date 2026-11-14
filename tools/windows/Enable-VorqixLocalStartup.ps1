[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EnvironmentRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
$paths=Get-VorqixLocalPaths $EnvironmentRoot
$shell=(Get-Process -Id $PID).Path
$runner=Join-Path $PSScriptRoot 'Start-VorqixLocal.ps1'
$folder=[Environment]::GetFolderPath('Startup')
$shortcutPath=Join-Path $folder 'VORQIX Homologacao.lnk'
$wsh=New-Object -ComObject WScript.Shell
$shortcut=$wsh.CreateShortcut($shortcutPath)
if((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Description -ne 'Inicializacao local VORQIX de homologacao, somente usuario atual.'){throw 'Ja existe um atalho de inicializacao com este nome; preservado para revisao.'}
$shortcut.TargetPath=$shell
$shortcut.Arguments='-NoProfile -WindowStyle Hidden -File "'+$runner+'" -EnvironmentRoot "'+$paths.Root+'"'
$shortcut.WorkingDirectory=$paths.Repository
$shortcut.WindowStyle=7
$shortcut.Description='Inicializacao local VORQIX de homologacao, somente usuario atual.'
$shortcut.Save()
Write-Output 'Inicio automatico configurado apenas ao entrar neste usuario do Windows. Nenhuma senha, permissao de rede ou politica de seguranca foi alterada.'
Write-Output ('Para desativar, remova o atalho VORQIX Homologacao da pasta Inicializar: '+$folder)
