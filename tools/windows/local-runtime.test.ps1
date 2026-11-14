param([Parameter(Mandatory=$true)][string]$EnvironmentRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalRuntime.psm1') -Force
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1'|ForEach-Object {
  $tokens=$null;$parseErrors=$null
  [Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$parseErrors)|Out-Null
  if($parseErrors.Count){throw ('Erro de sintaxe em '+$_.Name)}
}
$paths=Get-VorqixLocalPaths $EnvironmentRoot
if($paths.Repository -ne (Split-Path (Split-Path $PSScriptRoot))){throw 'Repositorio derivado incorretamente'}
$refused=$false
try{Get-VorqixLocalPaths (Join-Path $EnvironmentRoot '__ambiente_inexistente__')|Out-Null}catch{$refused=$true}
if(-not $refused){throw 'Ambiente inexistente deveria ser recusado'}
$timedOut=$false
try{Wait-VorqixReady -Name Teste -Seconds 0 -Check {$false}}catch{$timedOut=$true}
if(-not $timedOut){throw 'Prazo de prontidao nao foi respeitado'}
Wait-VorqixReady -Name Teste -Seconds 0 -Check {$true}
Write-Output 'PASS: sintaxe, caminhos, recusa de ambiente e prazo de prontidao.'
