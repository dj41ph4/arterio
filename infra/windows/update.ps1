<#
.SYNOPSIS
  Met a jour en toute securite une stack Arterio deja installee : sauvegarde
  d'abord la base, recupere le nouveau code (si c'est un depot git),
  reconstruit uniquement les images api/web, applique les migrations Prisma
  en attente, puis redemarre.

.DESCRIPTION
  Ce qui n'est JAMAIS touche :
    - .env (vos secrets) - jamais regenere, jamais ecrase.
    - Les volumes de donnees Postgres/Redis/Elasticsearch/MinIO - seules les
      images api/web sont reconstruites ; les services de donnees continuent
      de tourner sans etre touches.
    - Les donnees existantes - `prisma migrate deploy` applique uniquement
      les nouvelles migrations, il ne reinitialise et ne re-seed jamais la
      base (contrairement a `migrate dev`).

  Une sauvegarde de la base est prise automatiquement avant toute autre
  action. Si une migration echoue en cours de route, restaurez avec la
  commande affichee par infra\windows\backup.ps1 (le meme fichier est reutilise).

.PARAMETER SkipGitPull
  A utiliser si vous deployez en copiant les fichiers manuellement (pas de
  dossier .git) - le script ignorera l'etape `git pull` et reconstruira/
  migrera simplement ce qui se trouve actuellement sur le disque.
#>
[CmdletBinding()]
param(
  [string]$DistroName = 'Ubuntu-22.04',
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [switch]$SkipGitPull
)

$ErrorActionPreference = 'Stop'
function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK : $msg" -ForegroundColor Green }

$wslRepoPath = (wsl -d $DistroName -u root -- wslpath -a "$RepoPath").Trim()
function Invoke-Wsl([string]$cmd) {
  wsl -d $DistroName -u root -- bash -c "cd '$wslRepoPath' && $cmd"
  if ($LASTEXITCODE -ne 0) { throw "Commande echouee dans WSL ($LASTEXITCODE) : $cmd" }
}

# -----------------------------------------------------------------------------
# 1. Sauvegarde d'abord - toujours, sans exception
# -----------------------------------------------------------------------------
Write-Step 'Sauvegarde de la base avant toute modification'
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
& $backupScript -DistroName $DistroName -RepoPath $RepoPath
Write-Ok 'Sauvegarde terminee'

# -----------------------------------------------------------------------------
# 2. Recuperation du nouveau code
# -----------------------------------------------------------------------------
if (-not $SkipGitPull) {
  if (Test-Path (Join-Path $RepoPath '.git')) {
    Write-Step 'Recuperation du dernier code'
    Push-Location $RepoPath
    try { git pull --ff-only } finally { Pop-Location }
    Write-Ok 'Code mis a jour'
  } else {
    Write-Host "    Aucun dossier .git trouve - git pull ignore. Copiez/ecrasez vous-meme les fichiers mis a jour avant de lancer ce script, ou relancez avec -SkipGitPull pour ne plus voir ce message." -ForegroundColor Yellow
  }
} else {
  Write-Host '    -SkipGitPull active - utilisation de ce qui est actuellement sur le disque' -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# 3. Reconstruction des images api/web et redemarrage
#    (postgres/redis/elasticsearch/minio ne sont pas touches - pas de contexte
#    de build, meme tag d'image, compose laisse tourner un conteneur sain inchange)
# -----------------------------------------------------------------------------
Write-Step 'Reconstruction et redemarrage des conteneurs applicatifs'
Invoke-Wsl 'docker compose -f infra/docker-compose.yml up -d --build api web nginx'
Write-Ok 'Conteneurs redemarres'

Write-Step 'Attente du redemarrage de l''API'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  $code = wsl -d $DistroName -u root -- bash -c "cd '$wslRepoPath' && docker compose -f infra/docker-compose.yml exec -T api wget -qO- -T 2 http://localhost:4000/api/v1/health" 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "    ATTENTION : l'API n'a pas repondu au controle de sante a temps. Verifiez : wsl docker compose -f infra/docker-compose.yml logs api" -ForegroundColor Yellow
} else {
  Write-Ok 'API operationnelle'
}

# -----------------------------------------------------------------------------
# 4. Application des migrations en attente - additif uniquement, ne reinitialise jamais les donnees
# -----------------------------------------------------------------------------
Write-Step 'Application des migrations de la base (additif - ne reinitialise jamais les donnees existantes)'
Invoke-Wsl 'docker compose -f infra/docker-compose.yml exec -T api npm run migrate:deploy --workspace=@arterio/database'
Write-Ok 'Migrations appliquees'

Write-Host "`n================================================================" -ForegroundColor Green
Write-Host " Mise a jour terminee." -ForegroundColor Green
Write-Host " La sauvegarde prise avant la mise a jour se trouve dans infra\windows\backups\ -" -ForegroundColor Green
Write-Host " conservez-la jusqu'a ce que vous ayez confirme que tout fonctionne bien." -ForegroundColor Green
Write-Host "================================================================`n" -ForegroundColor Green
