# Arterio — Déploiement Synology DSM via GitHub + Container Manager

Ce guide met en place un circuit complet, sans jamais utiliser SSH :

```
Vous écrivez du code  →  git push sur GitHub  →  GitHub Actions construit
une image Docker unique  →  publiée sur Docker Hub  →  Watchtower la
télécharge et redémarre le conteneur sur le NAS automatiquement.
```

Le NAS n'a **jamais besoin du code source** (apps/, packages/, etc.) — juste
de `docker-compose.yml` (ce dossier) et de l'image déjà construite. La base
de données est un fichier **SQLite** dans le dossier mappé `./data` — aucun
Postgres/Redis/Elasticsearch/MinIO/nginx à installer à côté.

## 1. Docker Hub + dépôt GitHub (une seule fois)

**Docker Hub** — sur **hub.docker.com**, créez un jeton d'accès :
**Account Settings → Security → New Access Token** (permissions "Read &
Write"). Copiez-le, vous ne le reverrez plus.

Sur **github.com**, dans **Settings → Secrets and variables → Actions**,
créez deux secrets :
- `DOCKERHUB_USERNAME` = votre pseudo Docker Hub
- `DOCKERHUB_TOKEN` = le jeton copié juste avant

Puis `git push` votre dépôt vers GitHub. À chaque push sur `main`,
`.github/workflows/docker-publish.yml` construit l'image `arterio` et la
publie sur Docker Hub (`hub.docker.com/r/<votre-pseudo>/arterio`). Vérifiez
dans l'onglet **Actions** du dépôt que le run se termine en vert.

Un dépôt Docker Hub créé automatiquement est public par défaut — le NAS
peut faire `docker pull` sans identifiant. Si vous le rendez privé, ajoutez
les identifiants dans **Container Manager → Registre**.

## 2. Déployer sur le NAS

Via **File Station**, créez un dossier (ex. `/volume1/docker/arterio`) et
uploadez-y `docker-compose.yml` (celui de ce dossier — l'image unique, pas
`docker-compose.split.yml`).

Dans **Container Manager → Projet → Créer**, indiquez ce dossier. DSM y
trouve le `docker-compose.yml` et lance :
- `app` — l'image unique (API + Web dans le même conteneur), port **3000**.
- `watchtower` — surveille Docker Hub et redéploie automatiquement dès
  qu'une nouvelle image `:latest` est publiée (donc plus rien à faire sur
  le NAS après un `git push`).

## 3. Reverse proxy (optionnel, recommandé pour un nom de domaine public)

Pointez votre reverse proxy (DSM → **Panneau de configuration → Portail
d'applications → Reverse proxy**, ou tout autre) vers le port **3000**,
c'est tout — un seul hôte, un seul conteneur. Le serveur web relaie
lui-même les appels API en interne (`localhost`), il n'y a pas de seconde
règle de proxy à créer ni de CORS à configurer.

Pour des secrets de production (recommandé), ajoutez dans le
`docker-compose.yml`, sous `app: environment:` :
```yaml
JWT_ACCESS_SECRET: <valeur aléatoire longue>
JWT_REFRESH_SECRET: <autre valeur aléatoire longue>
DATA_ENCRYPTION_KEY: <32 octets en base64>
```
Sans ça, des valeurs de développement sont utilisées (suffisant pour
tester, à éviter en production exposée sur internet).

## 4. Créer le compte administrateur

Aucun compte n'est créé automatiquement. Ouvrez `http://IP-DU-NAS:3000` (ou
votre domaine) : la **première visite** affiche l'assistant de
configuration (nom d'organisation, votre nom, e-mail, mot de passe), puis
vous connecte directement. Si quelqu'un d'autre visite le site avant vous,
c'est cette personne qui créera le compte — allez-y en premier.

## Mettre à jour

Rien à faire : `git push` sur `main` → l'image Docker Hub `latest` est
republiée → Watchtower la détecte (poll toutes les 2 minutes) et recrée le
conteneur `app` automatiquement. Aucune perte de données — `./data`
(base SQLite + médias) n'est jamais touché par une mise à jour d'image.

**Sauvegarde** : le dossier `./data` est tout ce qu'il faut sauvegarder.
L'appli a aussi son propre export depuis **Réglages → Sauvegarde** (JSON ou
.zip complet avec les médias).

## Dépannage

| Symptôme | Vérification |
|---|---|
| L'Action GitHub échoue (rouge) | Onglet Actions → cliquez le run pour voir le détail — le plus souvent une erreur de compilation TypeScript, à corriger comme un bug normal. |
| Page blanche / erreur 500 derrière un reverse proxy | Vérifiez que le reverse proxy pointe bien sur le port **3000** du conteneur `app` (pas 4000) — c'est le web qui sert tout, y compris l'API en interne. |
| `Failed to fetch` / erreur CORS dans la console | N'arrive qu'en déploiement éclaté (API sur un autre domaine/serveur) — voir `APP_URL`/`CORS_ORIGINS` dans `docker-compose.split.yml`. Avec l'image unique (`docker-compose.yml`), ça ne devrait jamais arriver. |
| Watchtower ne redéploie pas | Le label `com.centurylinklabs.watchtower.enable: 'true'` doit être sur le conteneur `app`. Dépôt Docker Hub privé : ajoutez `REPO_USER`/`REPO_PASS` au service `watchtower`. |
