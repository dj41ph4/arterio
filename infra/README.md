# Arterio — Infrastructure & déploiement

Tout ce qu'il faut pour faire tourner Arterio sur **Linux, un VPS, le cloud, ou un NAS Synology**.

## Stack

`docker-compose.yml` démarre :

| Service        | Image                          | Rôle                              |
| -------------- | ------------------------------ | ---------------------------------- |
| postgres       | postgres:16-alpine             | Source de vérité                   |
| redis          | redis:7-alpine                 | Cache, files d'attente, rate-limit |
| elasticsearch  | elasticsearch:8.15             | Recherche full-text & facettée     |
| minio          | minio/minio                    | Stockage médias/docs compatible S3 |
| api            | (construit) NestJS             | API REST/GraphQL                   |
| web            | (construit) Next.js standalone | Front-end                          |
| nginx          | nginx:1.27-alpine               | Reverse proxy TLS, rate limiting   |

## Démarrage rapide

```bash
cp ../.env.example ../.env      # puis éditez les secrets (mot de passe DB, clés JWT, etc.)
cd infra
docker compose up -d
docker compose exec api npm run migrate:deploy --workspace=@arterio/database
```

App : `https://localhost` · Doc API : `https://localhost/api/docs` · Console MinIO : `:9001`.

Aucun compte n'est créé automatiquement : la première visite de l'app affiche
un assistant de configuration pour créer l'organisation et l'administrateur
avec le mot de passe de votre choix (`POST /setup`, une seule fois, refusé
si une organisation existe déjà).

Pour un jeu de données de démonstration en local **à la place** de
l'assistant (ils s'excluent mutuellement — le seed crée déjà une
organisation, ce qui désactive l'assistant) :
`docker compose exec api npm run seed --workspace=@arterio/database`.

## TLS

Déposez `fullchain.pem` + `privkey.pem` dans `nginx/certs/`, ou montez-y votre répertoire
Let's Encrypt `live`. Pour des tests locaux, générez une paire auto-signée (voir
`nginx/certs/.gitkeep`). Le bloc serveur HTTP gère déjà le défi ACME et force le HTTPS.

## Windows Server

Installeur complet en une commande : [`windows/install.ps1`](windows/install.ps1) — WSL2 +
Docker Engine natif + toute la stack + Let's Encrypt automatique avec
renouvellement, sans question de licence Docker Desktop. Voir
[`windows/README.md`](windows/README.md).

```powershell
cd infra\windows
.\install.ps1 -Domain collection.magalerie.com -Email admin@magalerie.com
```

## NAS Synology

Méthode recommandée (sans SSH, mises à jour en deux clics) : GitHub Actions
construit les images et les publie sur GitHub Container Registry, le NAS ne
télécharge que les images déjà prêtes — voir
[`synology/README.md`](synology/README.md) pour le guide complet.

## Notes de production

- Définissez des `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY` forts.
- Mettez Elasticsearch derrière des identifiants et ajustez `ES_JAVA_OPTS` à la RAM disponible.
- Activez des sauvegardes planifiées et **chiffrées** (`pg_dump` + miroir MinIO) vers une cible distante.
- Faites passer tout le trafic par la config TLS Nginx ; n'exposez jamais Postgres/Redis/ES publiquement.
