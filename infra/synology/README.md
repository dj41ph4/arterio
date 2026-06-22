# Arterio — Déploiement Synology DSM via GitHub + Container Manager

Ce guide met en place un circuit complet, sans jamais utiliser SSH :

```
Vous écrivez du code  →  git push sur GitHub  →  GitHub Actions construit
les images Docker  →  publiées sur ghcr.io (le « hub »)  →  le NAS les
télécharge et redémarre via Container Manager.
```

Le NAS n'a **jamais besoin du code source** (apps/, packages/, etc.) — juste
de ce dossier `infra/synology/` (docker-compose.yml + nginx/ + .env) et des
images déjà construites. C'est ce qui corrige le problème initial : plus
besoin de copier tout le dépôt sur le NAS, et les mises à jour se font en
quelques clics dans Container Manager au lieu de reconstruire l'application
sur le matériel (souvent peu puissant) du NAS.

## Vue d'ensemble — à faire une seule fois

1. Créer le dépôt GitHub et y pousser le code (10 min).
2. Vérifier que GitHub Actions a bien construit et publié les images.
3. Rendre les images téléchargeables depuis le NAS.
4. Préparer le dossier sur le NAS et créer le projet dans Container Manager.
5. Obtenir le certificat Let's Encrypt.

Ensuite, chaque mise à jour ne demande que l'étape **"Mettre à jour"** plus
bas — quelques clics, aucune ligne de commande compliquée.

---

## 1. Créer le dépôt GitHub et y pousser le code

Sur **github.com**, cliquez sur **New repository** :
- Nom : `arterio`
- Visibilité : **Private** (recommandé — c'est le code source de votre produit)
- Ne cochez **aucune** case d'initialisation (pas de README, pas de .gitignore)
- Cliquez **Create repository**

Sur votre machine de développement (PowerShell, dans le dossier du projet) :

```powershell
cd C:\Users\dj41ph4\Documents\DEV\ARTERIO\arterio
git init
git add .
git commit -m "Premier envoi"
git branch -M main
git remote add origin https://github.com/dj41ph4/arterio.git
git push -u origin main
```

GitHub vous demandera de vous authentifier au premier `push` (un navigateur
s'ouvrira, ou utilisez un *Personal Access Token* à la place du mot de passe
si demandé).

## 2. Vérifier que les images se sont construites

Sur la page de votre dépôt GitHub, onglet **Actions** : vous devez voir un
run **"Build and publish Docker images"** qui se termine en vert (✅), en
général en 3-5 minutes. C'est `.github/workflows/docker-publish.yml` qui
construit `arterio-api` et `arterio-web` et les publie sur **ghcr.io**.

À chaque `git push` sur `main` à partir de maintenant, ce workflow se
relance automatiquement et republie des images à jour — c'est tout le but
de l'opération.

## 3. Rendre les images téléchargeables depuis le NAS

Sur GitHub, allez sur votre profil → onglet **Packages** : vous devez voir
`arterio-api` et `arterio-web`. Par défaut ils sont **privés**, ce qui
empêche le NAS de les télécharger sans authentification. Deux options :

### Option A — rendre les images publiques (le plus simple, recommandé)

Pour chacun des deux paquets : ouvrez-le → **Package settings** (en bas de
la page) → **Change visibility** → **Public** → confirmez. Le NAS pourra
alors faire `docker pull` sans aucun identifiant. Le code source, lui,
reste privé — seules les images compilées sont publiques (pas vos secrets,
ils ne sont jamais dans l'image).

### Option B — garder les images privées (plus de configuration)

Créez un *Personal Access Token* (GitHub → Settings → Developer settings →
Personal access tokens → Tokens (classic) → scope `read:packages`
uniquement). Puis, dans **Container Manager → Registre → Ajouter** :
- URL : `https://ghcr.io`
- Nom d'utilisateur : `dj41ph4`
- Mot de passe : le token créé

## 4. Préparer le dossier sur le NAS

Via **File Station**, créez le dossier `/volume1/docker/arterio` et
uploadez-y **uniquement** le contenu de `infra/synology/` de votre dépôt :

```
arterio/
├── docker-compose.yml
├── .env                  ← renommez .env.example en .env et remplissez les secrets
└── nginx/
    ├── nginx.conf
    ├── conf.d/default.conf
    ├── certs/            (vide pour l'instant)
    ├── letsencrypt/      (vide)
    └── www/              (vide)
```

Pour le `.env` : copiez `.env.example` → `.env`, puis remplissez au moins
`POSTGRES_PASSWORD`, `S3_SECRET_KEY`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY` avec des valeurs aléatoires
fortes (ouvrez le fichier avec l'éditeur de texte de File Station). Mettez
aussi `APP_URL=https://votre-domaine.com` et `WEBAUTHN_RP_ID=votre-domaine.com`.

## 5. Créer le projet dans Container Manager

**Projet → Créer**, donnez le chemin `/volume1/docker/arterio` (celui que
vous venez de remplir) — Container Manager y trouvera le `docker-compose.yml`
existant avec tous ses fichiers voisins déjà en place, donc tous les chemins
relatifs (`./nginx/...`, `.env`) se résolvent correctement cette fois.

Démarrez le projet. `postgres`, `redis`, `elasticsearch`, `minio` démarrent
tout de suite ; `nginx` a besoin d'un certificat avant de pouvoir démarrer —
voir l'étape suivante.

Une fois `postgres` prêt, ouvrez le **Terminal** du projet et lancez les
migrations (la base est vide, sans aucun compte — voir la note ci-dessous) :

```sh
docker compose exec -T api npm run migrate:deploy --workspace=@arterio/database
```

## 6. Certificat Let's Encrypt

Utilisez le **Terminal** intégré de Container Manager (clic sur le projet →
icône terminal, le même outil que dans votre capture d'écran). D'abord un
certificat temporaire auto-signé pour que nginx puisse démarrer :

```sh
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem \
  -subj "/CN=votre-domaine.com"
docker compose up -d
```

Puis le vrai certificat (DNS du domaine doit déjà pointer vers l'IP publique
du NAS, ports 80/443 ouverts sur votre routeur vers le NAS) :

```sh
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d votre-domaine.com --email vous@exemple.com --agree-tos --non-interactive \
  --deploy-hook "cp -L /etc/letsencrypt/live/votre-domaine.com/fullchain.pem /etc/nginx/certs/fullchain.pem && cp -L /etc/letsencrypt/live/votre-domaine.com/privkey.pem /etc/nginx/certs/privkey.pem"
docker compose exec nginx nginx -s reload
```

Renouvellement : planifiez ces deux mêmes commandes (`certbot renew` à la
place de `certonly`) deux fois par jour dans **Panneau de configuration →
Planificateur de tâches → Créer → Tâche déclenchée → Script défini par
l'utilisateur**, en lançant :

```sh
cd /volume1/docker/arterio && docker compose run --rm certbot renew --quiet && docker compose exec nginx nginx -s reload
```

## 7. Créer le compte administrateur

Aucun compte n'est créé automatiquement — la base est vide. Ouvrez
`https://votre-domaine.com` dans un navigateur : la **première visite**
affiche un assistant qui vous demande le nom de votre organisation, votre
nom, votre e-mail et le mot de passe de votre choix, puis vous connecte
directement. Si quelqu'un d'autre visite le site avant vous, c'est cette
personne qui créera le compte — assurez-vous d'y aller en premier juste
après cette étape.

## Mettre à jour

C'est l'opération que vous referez à chaque nouvelle version :

1. Sur votre machine de dev : codez, puis `git push` (sur `main`).
2. Attendez ~5 minutes que l'onglet **Actions** de GitHub passe au vert.
3. Sur le NAS, ouvrez le **Terminal** du projet (Container Manager) et lancez :
   ```sh
   docker compose pull
   docker compose up -d
   ```
   `pull` télécharge les nouvelles images `latest` depuis ghcr.io, `up -d`
   recrée uniquement les conteneurs dont l'image a changé (`api`, `web`) —
   Postgres/Redis/Elasticsearch/MinIO ne sont pas touchés, aucune perte de
   données.
4. Si une nouvelle migration de base de données est nécessaire, lancez aussi :
   ```sh
   docker compose exec -T api npm run migrate:deploy --workspace=@arterio/database
   ```
   (additif uniquement — ne réinitialise jamais les données existantes).

**Sauvegarde avant mise à jour (recommandé) :**

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > sauvegarde_$(date +%Y%m%d_%H%M%S).sql
```

## Dépannage

| Symptôme | Vérification |
|---|---|
| `Failed to load .../.env` | Le `.env` doit être directement à côté du `docker-compose.yml`, pas dans un sous-dossier — voir l'arborescence à l'étape 4. |
| Le paquet ghcr.io refuse le téléchargement | Le paquet est encore privé (étape 3) — rendez-le public, ou ajoutez les identifiants dans Container Manager → Registre. |
| nginx ne démarre pas | Un fichier `fullchain.pem`/`privkey.pem` doit exister dans `nginx/certs/` avant le premier démarrage — voir étape 6. |
| L'Action GitHub échoue (rouge) | Cliquez sur le run dans l'onglet Actions pour voir le détail de l'erreur — le plus souvent une erreur de compilation TypeScript, à corriger comme un bug normal. |
