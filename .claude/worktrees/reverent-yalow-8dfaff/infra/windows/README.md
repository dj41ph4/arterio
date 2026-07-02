# Arterio — Installeur Windows Server

Un seul script monte toute la stack (Postgres, Redis, Elasticsearch, MinIO,
API, Web, Nginx) sur un serveur Windows Server, avec une terminaison TLS
Nginx adossée à un vrai certificat **Let's Encrypt** qui se renouvelle
automatiquement. Pas de Docker Desktop, pas de question de licence : Docker
tourne nativement dans une distro WSL2 Ubuntu, la méthode supportée et
sans souci de licence pour faire tourner des conteneurs Linux sur Windows
Server.

## Prérequis

- Windows Server 2019 ou 2022 (ou Windows 10/11 Pro — même script).
- Accès administrateur (le script doit être lancé en élevé).
- Accès Internet (pour récupérer le noyau WSL, le rootfs Ubuntu, Docker, et
  les images des conteneurs Arterio).
- Pour le vrai certificat : un **enregistrement A** du domaine pointant vers
  l'IP publique de ce serveur, et les **ports 80 + 443 joignables depuis
  Internet** (le script ouvre le pare-feu Windows ; s'il y a un
  routeur/groupe de sécurité cloud devant ce serveur, ouvrez-les là aussi).
- Ce dépôt déjà présent sur le serveur (copiez-le, ou faites un `git
  clone`) — l'installeur se trouve dans `infra/windows/install.ps1`.

## Lancement

Ouvrez une invite PowerShell **élevée** :

```powershell
cd C:\chemin\vers\arterio\infra\windows
.\install.ps1 -Domain collection.magalerie.com -Email admin@magalerie.com
```

Pas encore de domaine public (déploiement interne/LAN) ? Sautez l'étape du
certificat — vous aurez un certificat auto-signé (le navigateur affichera
un avertissement, c'est normal) :

```powershell
.\install.ps1 -SkipCertificate
```

### S'il demande un redémarrage

Le tout premier lancement active les fonctionnalités Windows "Sous-système
Windows pour Linux" et "Virtual Machine Platform", ce qui nécessite un
redémarrage. Le script vous le signale et s'arrête proprement —
**redémarrez, puis relancez exactement la même commande.** Tout ce qui est
déjà fait (fonctionnalités, distro WSL, Docker, `.env`, certificats) est
détecté et ignoré ; il reprend juste où il s'est arrêté.

## Ce qu'il met en place

1. WSL2 + une distro Ubuntu 22.04, avec systemd activé (nécessaire pour que
   Docker tourne comme un vrai service en arrière-plan).
2. Docker Engine + le plugin Compose, installés dans cette distro.
3. `.env` à la racine du dépôt, généré une seule fois avec des secrets
   aléatoires forts (clés de signature JWT, clé de chiffrement AES-256,
   mots de passe DB/MinIO). **Ce fichier n'est jamais régénéré lors d'un
   relancement** — sauvegardez-le.
4. Toute la stack `docker-compose.yml`, construite et démarrée.
5. Les migrations de la base — aucun compte de démo n'est créé. La
   **première visite** du site affiche un assistant de configuration où
   vous créez vous-même l'organisation et le compte administrateur, avec le
   mot de passe de votre choix.
6. Un vrai certificat Let's Encrypt via le défi HTTP-01 webroot (conteneur
   `certbot`), installé dans `infra/nginx/certs/`, avec Nginx rechargé
   pour le prendre en compte.
7. **Trois tâches planifiées Windows** :
   - `Arterio - WSL Autostart` — réveille la distro WSL 30s après chaque
     démarrage, pour que systemd/Docker reviennent et que vos conteneurs
     reprennent automatiquement (la politique `restart: unless-stopped`
     de Docker fait le reste — rien d'autre n'a besoin de "relancer
     l'application").
   - `Arterio - Certbot Renew` — tourne deux fois par jour, l'intervalle
     recommandé par Let's Encrypt lui-même. `certbot renew` ne fait rien
     si le certificat n'expire pas dans les 30 prochains jours, donc
     l'exécuter souvent ne pose aucun problème.
   - `Arterio - Daily Backup` — sauvegarde la base chaque nuit à 02h00,
     conserve les 14 derniers jours (voir **Mise à jour** ci-dessous).
8. Règles de pare-feu ouvrant les ports TCP 80 et 443 entrants.

## Mise à jour

```powershell
cd infra\windows
.\update.ps1
```

C'est le chemin de mise à jour sûr et répétable — à lancer à chaque
nouvelle version à déployer. Ce qu'il fait, dans l'ordre :

1. **Sauvegarde la base d'abord**, sans condition (`backup.ps1` — un
   `pg_dump` horodaté dans `infra\windows\backups\`, commande de
   restauration affichée à la fin).
2. `git pull` si c'est un dépôt git (passez `-SkipGitPull` si vous déployez
   en copiant les fichiers manuellement).
3. Reconstruit et redémarre **seulement** `api`, `web` et `nginx` —
   Postgres, Redis, Elasticsearch et MinIO continuent de tourner sans être
   touchés, aucun risque pour les données.
4. Attend que le contrôle de santé de l'API passe.
5. Applique les migrations Prisma en attente avec `migrate deploy` —
   additif uniquement, ne réinitialise et ne re-seed jamais les données
   existantes (c'est le rôle de `migrate dev`, que cet installeur n'appelle
   jamais).

**Ce que vous ne perdez pas :** le `.env` (vos secrets) n'est jamais
régénéré ni touché par `update.ps1`, et les volumes de base/médias ne sont
jamais recréés — seuls les conteneurs applicatifs sont reconstruits à
partir du nouveau code. La sauvegarde prise à l'étape 1 est votre filet de
sécurité si une migration de la nouvelle version s'avère problématique ;
restaurez-la avec la commande affichée par `backup.ps1`, ou lancez :

```powershell
wsl -d Ubuntu-22.04 -u root -- bash -c "cd /mnt/c/chemin/vers/arterio && cat infra/windows/backups/arterio_<horodatage>.sql | docker compose -f infra/docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER $POSTGRES_DB'"
```

Pour sauvegarder à la demande (hors mise à jour), lancez `.\backup.ps1`
directement.

## Opérations courantes

Toutes les commandes se lancent depuis une invite PowerShell élevée.

```powershell
# Suivre les journaux
wsl -d Ubuntu-22.04 -u root -- bash -c "cd /mnt/c/chemin/vers/arterio && docker compose -f infra/docker-compose.yml logs -f"

# Redémarrer juste l'API après un changement de config
wsl -d Ubuntu-22.04 -u root -- bash -c "cd /mnt/c/chemin/vers/arterio && docker compose -f infra/docker-compose.yml restart api"

# Forcer une vérification de renouvellement du certificat maintenant
.\renew-cert.ps1 -DistroName Ubuntu-22.04 -RepoPath C:\chemin\vers\arterio

# Sauvegarder la base à la demande
.\backup.ps1

# Déployer une nouvelle version (voir "Mise à jour" ci-dessus)
.\update.ps1
```

## Dépannage

| Symptôme | Vérification |
|---|---|
| Demande de certificat échouée | L'enregistrement DNS A du domaine doit déjà pointer vers l'IP publique de ce serveur, et les ports 80/443 doivent être joignables depuis Internet (groupe de sécurité cloud / routeur, pas seulement le pare-feu Windows). Relancez `install.ps1` — il est idempotent et ne refera que l'étape du certificat si tout le reste tourne déjà. |
| Nginx ne démarre pas | `docker compose logs nginx` — quasiment toujours un fichier manquant/invalide dans `infra/nginx/certs/`. L'installeur laisse toujours une paire valide (auto-signée ou réelle) à cet endroit avant de démarrer Nginx. |
| La stack n'est pas revenue après un redémarrage Windows Update | Vérifiez que la tâche planifiée `Arterio - WSL Autostart` s'est exécutée (Planificateur de tâches → Historique). Si WSL lui-même n'a pas démarré, lancez `wsl -d Ubuntu-22.04 -u root -- true` une fois manuellement et Docker/les conteneurs reprendront. |
| La tâche de renouvellement ne se déclenche pas | Planificateur de tâches → `Arterio - Certbot Renew` → vérifiez le résultat de la dernière exécution. Les journaux se trouvent aussi dans `infra/windows/.state/renew.log`. |

## Désinstallation

```powershell
Unregister-ScheduledTask -TaskName 'Arterio - WSL Autostart' -Confirm:$false
Unregister-ScheduledTask -TaskName 'Arterio - Certbot Renew' -Confirm:$false
Unregister-ScheduledTask -TaskName 'Arterio - Daily Backup' -Confirm:$false
wsl -d Ubuntu-22.04 -u root -- bash -c "cd /mnt/c/chemin/vers/arterio && docker compose -f infra/docker-compose.yml down -v"
wsl --unregister Ubuntu-22.04   # seulement si vous n'avez plus besoin de la distro pour autre chose
```
