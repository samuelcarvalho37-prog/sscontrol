param([string]$RepositoryUrl="https://github.com/NMCSDEV02/fab-control-cmms.git")
$ErrorActionPreference="Stop"
git init
git branch -M main
git remote remove origin 2>$null
git remote add origin $RepositoryUrl
git add .
git commit -m "chore: initialize FAB Control CMMS structure"
git push -u origin main
git checkout -b dev
git push -u origin dev
Write-Host "Estrutura enviada. Branch atual: dev"
