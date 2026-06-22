#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installeur en une commande pour Arterio sur Windows Server - WSL2 + Docker
  Engine + toute la stack docker-compose + un certificat Let's Encrypt
  automatique.

.DESCRIPTION
  Idempotent : relancer ce script ignore les etapes deja terminees (drapeaux
  de fonctionnalites WSL, distro deja installee, Docker deja installe,
  certificat deja obtenu). Si un redemarrage Windows est necessaire
  (premiere activation de WSL), le script s'arrete et vous demande de le
  relancer apres redemarrage - il reprendra exactement ou il s'est arrete.

  Docker tourne *a l'interieur* d'une distro WSL2 Ubuntu (Docker Engine
  natif, pas Docker Desktop) - aucune question de licence, fonctionne sur
  Windows Server, et les conteneurs redemarrent automatiquement avec l'OS
  via systemd + `restart: unless-stopped`.

.PARAMETER Domain
  Nom de domaine public pointant vers ce serveur (enregistrement A/AAAA).
  Obligatoire pour le certificat Let's Encrypt - sans lui, certificat
  auto-signe uniquement.

.PARAMETER Email
  Adresse de contact pour les notifications d'expiration Let's Encrypt.

.PARAMETER DistroName
  Distro WSL a utiliser/creer. Par defaut : Ubuntu-22.04.

.PARAMETER SkipCertificate
  Demarre la stack avec un certificat auto-signe uniquement (ex. pour un
  deploiement interne/LAN sans domaine public).

.EXAMPLE
  .\install.ps1 -Domain collection.magalerie.com -Email admin@magalerie.com
#>
[CmdletBinding()]
param(
  [string]$Domain,
  [string]$Email,
  [string]$DistroName = 'Ubuntu-22.04',
  [switch]$SkipCertificate
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$MarkerDir = Join-Path $RepoRoot 'infra\windows\.state'
New-Item -ItemType Directory -Force -Path $MarkerDir | Out-Null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK : $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    ATTENTION : $msg" -ForegroundColor Yellow }
function Test-Marker($name) { Test-Path (Join-Path $MarkerDir $name) }
function Set-Marker($name)  { New-Item -ItemType File -Force -Path (Join-Path $MarkerDir $name) | Out-Null }

if (-not $SkipCertificate -and (-not $Domain -or -not $Email)) {
  throw "Indiquez -Domain et -Email (ou -SkipCertificate pour un deploiement auto-signe/interne). Exemple :`n  .\install.ps1 -Domain collection.exemple.com -Email admin@exemple.com"
}

# -----------------------------------------------------------------------------
# 1. Prerequis WSL2
# -----------------------------------------------------------------------------
Write-Step 'Verification des prerequis WSL2'

$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
$vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform

if ($wslFeature.State -ne 'Enabled' -or $vmpFeature.State -ne 'Enabled') {
  Write-Host '    Activation des fonctionnalites Windows WSL + Virtual Machine Platform...'
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
  Set-Marker 'features-enabled-pending-reboot'
  Write-Warn2 'Un redemarrage est necessaire pour terminer l''activation de WSL2.'
  Write-Warn2 'Redemarrez le serveur, puis relancez exactement la meme commande - elle continuera automatiquement.'
  exit 0
}
Write-Ok 'WSL + Virtual Machine Platform sont actives'

# wsl.exe doit etre dans le PATH et supporter les sous-commandes modernes
try { wsl --status *> $null } catch { throw 'wsl.exe introuvable. Installez "Sous-systeme Windows pour Linux" depuis le Microsoft Store/Fonctionnalites facultatives, redemarrez, puis relancez.' }

wsl --update --web-download *> $null
wsl --set-default-version 2 | Out-Null
Write-Ok 'Noyau WSL2 a jour, version par defaut reglee sur 2'

# -----------------------------------------------------------------------------
# 2. Distro Ubuntu (root utilise partout - aucun assistant interactif requis)
# -----------------------------------------------------------------------------
Write-Step "Verification de la distro WSL '$DistroName'"

$existing = (wsl -l -q) -replace "`0", '' | ForEach-Object { $_.Trim() }
if ($existing -notcontains $DistroName) {
  Write-Host "    Installation de $DistroName (sans lancement, sans configuration interactive)..."
  wsl --install -d $DistroName --no-launch
  # Le premier demarrage a besoin d'un instant pour decompresser le rootfs.
  Start-Sleep -Seconds 5
  wsl -d $DistroName -u root -- true
}
Write-Ok "$DistroName est installee"

# Active systemd dans la distro - necessaire pour que dockerd tourne comme
# un vrai service en arriere-plan qui survit a `wsl --shutdown` / redemarrage.
$wslConf = wsl -d $DistroName -u root -- cat /etc/wsl.conf 2>$null
if ($wslConf -notmatch 'systemd\s*=\s*true') {
  Write-Host '    Activation de systemd dans la distro...'
  wsl -d $DistroName -u root -- bash -c "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
  wsl --shutdown
  Start-Sleep -Seconds 5
  wsl -d $DistroName -u root -- true
}
Write-Ok 'systemd active dans WSL'

# -----------------------------------------------------------------------------
# 3. Docker Engine (dans WSL - PAS Docker Desktop)
# -----------------------------------------------------------------------------
Write-Step 'Verification de Docker Engine dans WSL'

$dockerCheck = wsl -d $DistroName -u root -- bash -c "command -v docker" 2>$null
if (-not $dockerCheck) {
  Write-Host '    Installation de Docker Engine + plugin compose (get.docker.com)...'
  wsl -d $DistroName -u root -- bash -c "curl -fsSL https://get.docker.com | sh"
}
wsl -d $DistroName -u root -- systemctl enable docker | Out-Null
wsl -d $DistroName -u root -- systemctl start docker
$dockerVersion = wsl -d $DistroName -u root -- docker --version
Write-Ok "Docker pret ($dockerVersion)"

# -----------------------------------------------------------------------------
# 4. .env - genere des secrets forts au premier lancement, jamais ecrase apres
# -----------------------------------------------------------------------------
Write-Step 'Preparation du .env'

function New-RandomBase64([int]$bytes) {
  $buf = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buf)
  [Convert]::ToBase64String($buf)
}

$envPath = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envPath)) {
  Write-Host '    Generation du .env avec des secrets aleatoires...'
  $example = Get-Content (Join-Path $RepoRoot '.env.example') -Raw

  $appUrl = if ($SkipCertificate) { 'http://localhost' } else { "https://$Domain" }
  $replacements = @{
    'NODE_ENV=development'                                   = 'NODE_ENV=production'
    'APP_URL=http://localhost:3000'                          = "APP_URL=$appUrl"
    'API_URL=http://localhost:4000'                          = "API_URL=$appUrl/api"
    'POSTGRES_PASSWORD=change-me-in-production'              = "POSTGRES_PASSWORD=$(New-RandomBase64 24)"
    'S3_SECRET_KEY=change-me-in-production'                  = "S3_SECRET_KEY=$(New-RandomBase64 24)"
    'JWT_ACCESS_SECRET=replace-with-strong-random-secret'    = "JWT_ACCESS_SECRET=$(New-RandomBase64 48)"
    'JWT_REFRESH_SECRET=replace-with-another-strong-random-secret' = "JWT_REFRESH_SECRET=$(New-RandomBase64 48)"
    'DATA_ENCRYPTION_KEY=replace-with-base64-32-byte-key'    = "DATA_ENCRYPTION_KEY=$(New-RandomBase64 32)"
    'WEBAUTHN_RP_ID=localhost'                               = "WEBAUTHN_RP_ID=$(if ($SkipCertificate) { 'localhost' } else { $Domain })"
    'WEBAUTHN_ORIGIN=http://localhost:3000'                  = "WEBAUTHN_ORIGIN=$appUrl"
  }
  # DATABASE_URL reutilise le meme mot de passe Postgres genere ci-dessus.
  $pgPassword = $replacements['POSTGRES_PASSWORD=change-me-in-production'].Split('=', 2)[1]
  $replacements['DATABASE_URL=postgresql://arterio:change-me-in-production@localhost:5432/arterio?schema=public'] = `
    "DATABASE_URL=postgresql://arterio:$pgPassword@postgres:5432/arterio?schema=public"

  foreach ($key in $replacements.Keys) { $example = $example.Replace($key, $replacements[$key]) }
  Set-Content -Path $envPath -Value $example -NoNewline
  Write-Ok '.env genere - sauvegardez ce fichier, il ne sera plus jamais regenere'
} else {
  Write-Ok '.env existe deja, laisse tel quel'
}

# -----------------------------------------------------------------------------
# 5. Resoudre le chemin du depot depuis WSL
# -----------------------------------------------------------------------------
$wslRepoPath = (wsl -d $DistroName -u root -- wslpath -a "$RepoRoot").Trim()
function Invoke-Wsl([string]$cmd) {
  wsl -d $DistroName -u root -- bash -c "cd '$wslRepoPath' && $cmd"
  if ($LASTEXITCODE -ne 0) { throw "Commande echouee dans WSL ($LASTEXITCODE) : $cmd" }
}

# -----------------------------------------------------------------------------
# 6. Certificat de demarrage (auto-signe temporaire pour que nginx puisse demarrer)
# -----------------------------------------------------------------------------
$certDir = Join-Path $RepoRoot 'infra\nginx\certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
if (-not (Test-Path (Join-Path $certDir 'fullchain.pem'))) {
  Write-Step 'Generation d''un certificat auto-signe temporaire (pour que nginx puisse demarrer)'
  $cn = if ($Domain) { $Domain } else { 'localhost' }
  Invoke-Wsl "openssl req -x509 -nodes -newkey rsa:2048 -days 1 -keyout infra/nginx/certs/privkey.pem -out infra/nginx/certs/fullchain.pem -subj '/CN=$cn'"
  Write-Ok 'Certificat temporaire cree'
}

# -----------------------------------------------------------------------------
# 7. Demarrage de la stack
# -----------------------------------------------------------------------------
Write-Step 'Construction et demarrage de la stack Arterio (quelques minutes la premiere fois)'
Invoke-Wsl 'docker compose -f infra/docker-compose.yml up -d --build'
Write-Ok 'Stack demarree'

Write-Step 'Attente que Postgres soit pret'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  $status = wsl -d $DistroName -u root -- bash -c "cd '$wslRepoPath' && docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U arterio" 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'Postgres n''est pas devenu pret a temps - verifiez : wsl docker compose -f infra/docker-compose.yml logs postgres' }
Write-Ok 'Postgres pret'

Write-Step 'Execution des migrations de la base + seed'
Invoke-Wsl 'docker compose -f infra/docker-compose.yml exec -T api npm run migrate:deploy --workspace=@arterio/database'
Invoke-Wsl 'docker compose -f infra/docker-compose.yml exec -T api npm run seed --workspace=@arterio/database'
Write-Ok 'Base de donnees prete (organisation de demo + administrateur crees)'

# -----------------------------------------------------------------------------
# 8. Vrai certificat Let's Encrypt
# -----------------------------------------------------------------------------
if (-not $SkipCertificate) {
  Write-Step "Demande du certificat Let's Encrypt pour $Domain"

  $resolved = $null
  try { $resolved = (Resolve-DnsName -Name $Domain -Type A -ErrorAction Stop | Select-Object -First 1).IPAddress } catch {}
  if (-not $resolved) {
    Write-Warn2 "Impossible de resoudre $Domain - verifiez que son enregistrement DNS A pointe vers l'IP publique de ce serveur avant de continuer."
    Write-Warn2 'On continue malgre tout ; la demande de certificat echouera simplement si le DNS n''est pas encore pret (relancez plus tard, c''est idempotent).'
  }

  $deployHook = "cp -L /etc/letsencrypt/live/$Domain/fullchain.pem /etc/nginx/certs/fullchain.pem && cp -L /etc/letsencrypt/live/$Domain/privkey.pem /etc/nginx/certs/privkey.pem"
  $certbotCmd = "docker compose -f infra/docker-compose.yml run --rm certbot certonly --webroot -w /var/www/certbot -d $Domain --email $Email --agree-tos --non-interactive --deploy-hook `"$deployHook`""
  Invoke-Wsl $certbotCmd
  Invoke-Wsl 'docker compose -f infra/docker-compose.yml exec nginx nginx -s reload'
  Write-Ok 'Vrai certificat obtenu et nginx recharge'
} else {
  Write-Warn2 'Let''s Encrypt ignore - la stack tourne avec le certificat auto-signe temporaire.'
}

# -----------------------------------------------------------------------------
# 9. Taches planifiees - persistance au demarrage + renouvellement du certificat
# -----------------------------------------------------------------------------
Write-Step 'Enregistrement des taches planifiees Windows'

$startupAction = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $DistroName -u root -- true"
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupTrigger.Delay = 'PT30S'
$startupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBattery -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Arterio - WSL Autostart' -Action $startupAction -Trigger $startupTrigger -Settings $startupSettings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Ok 'WSL demarrera automatiquement avec Windows (les conteneurs reprennent via la politique de redemarrage de Docker)'

if (-not $SkipCertificate) {
  $renewScript = Join-Path $PSScriptRoot 'renew-cert.ps1'
  $renewAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$renewScript`" -DistroName $DistroName -RepoPath `"$RepoRoot`""
  $renewTrigger1 = New-ScheduledTaskTrigger -Daily -At 3am
  $renewTrigger2 = New-ScheduledTaskTrigger -Daily -At 3pm
  Register-ScheduledTask -TaskName 'Arterio - Certbot Renew' -Action $renewAction -Trigger @($renewTrigger1, $renewTrigger2) -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Write-Ok 'Renouvellement du certificat planifie deux fois par jour (recommandation Let''s Encrypt)'
}

$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -DistroName $DistroName -RepoPath `"$RepoRoot`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName 'Arterio - Daily Backup' -Action $backupAction -Trigger $backupTrigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Ok 'Sauvegarde quotidienne de la base planifiee a 02h00 (conservee 14 jours, voir infra\windows\backups\)'

# -----------------------------------------------------------------------------
# 10. Pare-feu
# -----------------------------------------------------------------------------
Write-Step 'Ouverture des ports pare-feu 80/443'
foreach ($port in 80, 443) {
  $name = "Arterio HTTP(S) $port"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
  }
}
Write-Ok 'Regles pare-feu en place'

# -----------------------------------------------------------------------------
# Termine
# -----------------------------------------------------------------------------
$url = if ($SkipCertificate) { 'https://localhost (auto-signe - le navigateur affichera un avertissement, c''est normal)' } else { "https://$Domain" }
Write-Host "`n================================================================"  -ForegroundColor Green
Write-Host " Arterio fonctionne : $url"                                           -ForegroundColor Green
Write-Host " Documentation API :  $url/api/docs"                                 -ForegroundColor Green
Write-Host " Admin par defaut :   admin@arterio.app / changez le mot de passe a la premiere connexion" -ForegroundColor Green
Write-Host " Secrets :            $envPath  (sauvegardez ce fichier, il est gitignore)" -ForegroundColor Green
Write-Host " Journaux :           wsl -d $DistroName -u root -- bash -c `"cd $wslRepoPath && docker compose -f infra/docker-compose.yml logs -f`"" -ForegroundColor Green
Write-Host "================================================================`n"  -ForegroundColor Green
