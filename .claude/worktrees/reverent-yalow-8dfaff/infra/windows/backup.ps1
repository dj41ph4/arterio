<#
.SYNOPSIS
  Sauvegarde la base Postgres dans infra\windows\backups\, horodatee.
  Peut etre lance a tout moment, la stack reste en fonctionnement.

.PARAMETER Keep
  Nombre de sauvegardes recentes a conserver (les plus anciennes sont
  supprimees). Par defaut : 14.
#>
[CmdletBinding()]
param(
  [string]$DistroName = 'Ubuntu-22.04',
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$wslRepoPath = (wsl -d $DistroName -u root -- wslpath -a "$RepoPath").Trim()
$backupDir = Join-Path $RepoPath 'infra\windows\backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$sqlFile = "arterio_$stamp.sql"
$wslBackupDir = "infra/windows/backups"

Write-Host "==> Sauvegarde de la base vers $sqlFile"
$cmd = "cd '$wslRepoPath' && docker compose -f infra/docker-compose.yml exec -T postgres sh -c 'pg_dump -U `"`$POSTGRES_USER`" `"`$POSTGRES_DB`"' > $wslBackupDir/$sqlFile"
wsl -d $DistroName -u root -- bash -c $cmd
if ($LASTEXITCODE -ne 0) { throw 'pg_dump a echoue - la stack est-elle bien demarree ? (docker compose -f infra/docker-compose.yml ps)' }

$sizeKb = [math]::Round((Get-Item (Join-Path $backupDir $sqlFile)).Length / 1KB, 1)
Write-Host "    OK : $sqlFile ($sizeKb Ko)" -ForegroundColor Green

# Retention - garde les N sauvegardes les plus recentes
$old = Get-ChildItem $backupDir -Filter 'arterio_*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
foreach ($f in $old) { Remove-Item $f.FullName -Force; Write-Host "    Ancienne sauvegarde supprimee : $($f.Name)" }

Write-Host "`nRestauration avec :" -ForegroundColor Cyan
Write-Host "  wsl -d $DistroName -u root -- bash -c `"cd $wslRepoPath && cat infra/windows/backups/$sqlFile | docker compose -f infra/docker-compose.yml exec -T postgres sh -c 'psql -U `$POSTGRES_USER `$POSTGRES_DB'`""
