<#
.SYNOPSIS
  Renouvelle le certificat Let's Encrypt si necessaire, le copie dans le
  point de montage de nginx, puis recharge nginx. Appele deux fois par jour
  par la tache planifiee "Arterio - Certbot Renew" creee par install.ps1 -
  certbot ne renouvelle que si le certificat expire dans moins de 30 jours,
  donc lancer ceci souvent ne pose aucun probleme.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DistroName,
  [Parameter(Mandatory)][string]$RepoPath
)

$ErrorActionPreference = 'Stop'
$wslRepoPath = (wsl -d $DistroName -u root -- wslpath -a "$RepoPath").Trim()
$logFile = Join-Path $RepoPath 'infra\windows\.state\renew.log'

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 's'), $msg
  Add-Content -Path $logFile -Value $line
}

try {
  $cmd = "cd '$wslRepoPath' && docker compose -f infra/docker-compose.yml run --rm certbot renew --quiet && docker compose -f infra/docker-compose.yml exec nginx nginx -s reload"
  $output = wsl -d $DistroName -u root -- bash -c $cmd 2>&1
  Log "Verification de renouvellement terminee (code $LASTEXITCODE)"
  if ($output) { Log $output }
} catch {
  Log "Verification de renouvellement ECHOUEE : $_"
}
