# Arterio — Fonctionnalités

Ce document résume comment chaque fonctionnalité marche et comment elles s'articulent entre elles.
**Focus principal : l'autocomplétion (sans IA et avec IA)**, qui est le système le plus complexe de la plateforme — le reste est résumé plus brièvement en fin de document.

---

## 1. Autocomplétion SANS IA — sources « Wiki »

Ces sources sont **gratuites, sans clé obligatoire, toujours disponibles** (sauf WikiArt qui demande une clé optionnelle). Elles ne font *aucun appel à un modèle de langage* — ce sont des recherches directes dans des bases de données structurées.

### 1.1 Enrichissement artiste (automatique à la création)

Fichier : `apps/api/src/modules/artists/artist-enrichment.service.ts`

Quand un artiste est créé (ou via `POST /artists/:id/enrich`), le service lance une chaîne en cascade :

1. **Recherche Wikidata** (`wbsearchentities`) sur le nom complet — ne retient un résultat que si sa description contient un terme du monde de l'art (peintre, sculpteur, etc.), pour éviter les homonymes (ex. un peintre local "Carrey Georges" qui matcherait sur l'acteur Jim Carrey). Si le nom est au format "NOM Prénom", un essai inversé "Prénom NOM" est aussi tenté.
2. **Entité Wikidata complète** (requêtes SPARQL) : dates de naissance/mort, nationalité, mouvement artistique (avec libellé dans les 6 langues), identifiants ULAN/VIAF, image, signature, œuvres notables, influences. Récupère aussi les **sitelinks Wikipédia** par langue (le titre exact de la page, pas une nouvelle recherche par nom — pour éviter de retomber sur une mauvaise page).
3. **Biographies Wikipédia** : un appel à l'API REST Wikipédia par langue disponible (`fr`, `en`, `it`, `es`, `de`, `nl`), via le sitelink exact trouvé à l'étape 2.
4. **Si Wikidata ne trouve rien** : bascule sur une **chaîne de musées** (Met, AIC, WikiArt, Europeana, Rijksmuseum, Harvard, Smithsonian — keyless ou avec clé optionnelle dans Réglages → API externes), qui confirment juste l'identité (nom/dates/nationalité/image), sans biographie. **Dernier recours** (`apps/api/src/common/gallery-site-scraper.util.ts`) : pour les artistes contemporains/régionaux absents de Wikidata et de tous les musées, deux sites de galerie sans API publique (i-CAC, Artmajeur) sont scrapés via une URL slug devinée à partir du nom, validée par une vérification stricte (chaque mot du nom doit apparaître dans la page) avant d'être retenue. Artsper a été testé et exclu (bloque les requêtes HTTP simples, code 403) — aucune tentative de contournement. Règle stricte respectée : un résultat scrapé n'est **jamais** repassé dans un appel IA pour "correction" — il suit le même flux `scrape → extraction → validation → fusion` que les musées, jamais `scrape → IA`.
5. Un **cache de limitation de débit** (`MAX_CONCURRENT_ENRICHMENTS = 3`) évite que l'import d'un fichier de centaines d'artistes ne sature les sockets sortants du conteneur et ne fasse échouer les vraies requêtes API en parallèle.

**Traduction automatique des biographies manquantes** : une fois qu'au moins une langue a une biographie (souvent une seule, ex. le français), le service traduit cette biographie vers toutes les autres langues supportées via le fournisseur IA configuré (`translateMissingBiographies`) — **c'est le seul point où l'enrichissement "sans IA" appelle quand même l'IA**, et uniquement pour combler les langues vides, jamais pour écraser une biographie déjà saisie manuellement.

### 1.2 Recherche d'images « Wiki » (boutons dédiés)

Fichiers : `apps/api/src/common/commons-image-search.util.ts`, `wikiart-api.util.ts`, bouton frontend `apps/web/src/components/shared/image-search-buttons.tsx`.

- **Wikimedia Commons** : recherche par mots-clés (`action=query&list=search&srnamespace=6`) dans l'espace fichiers, filtre sur les extensions image, résout l'URL réelle via `prop=imageinfo`. Keyless, toujours actif.
- **WikiArt** : nécessite une clé `accessCode:secretCode` (Réglages → IA, gratuite sur wikiart.org) — login puis `PaintingSearch`. **Prioritaire sur Commons si la clé est configurée**, car c'est un index dédié à l'art (moins de faux positifs).
- Le bouton **« Wiki »** (visible partout, jamais caché) appelle `POST /ai/images/{artwork,artist}` qui combine WikiArt (si clé) + Commons, déduplique, et renvoie jusqu'à 8 candidats sous forme de vignettes cliquables — **aucun appel IA, aucun coût**.
- Un clic sur une vignette : pour une œuvre, l'ajoute à la galerie (plusieurs images possibles) ; pour un artiste, remplace le champ photo unique.

### 1.3 Import de tableur (sans IA)

Fichier : `apps/web/src/lib/import/`, composant `apps/web/src/components/import/import-modal.tsx`.

- Mapping de colonnes automatique par analyse de l'intitulé + du contenu, avec score de confiance ajustable. Tolère les deux orthographes "œuvre"/"oeuvre" indifféremment (vu en pratique : deux fichiers du même utilisateur n'utilisant pas la même graphie). Champs supplémentaires détectés : valeur actuelle (distincte du prix d'achat — un fichier réel a les deux colonnes), commentaire/notes, biographie d'artiste, URL photo.
- Normalisation déterministe (pas d'IA) : noms d'artistes, dates (formats Excel/texte/plage), méthodes de paiement, booléens (OUI/NON et variantes), prix.
- **Détection de fichier "roster d'artistes"** : si le fichier n'a ni titre, ni technique, ni dimensions, ni numéro d'inventaire — seulement un nom d'artiste + bio/photo (ex. un export "Nom / Bio / Photo") — l'import bascule automatiquement sur un mode dédié qui met à jour les artistes (biographie/photo, jamais d'écrasement d'une valeur déjà présente) sans créer de fausses œuvres vides.
- **Détection de doublons en deux passes** (`apps/web/src/lib/import/normalize.ts`) : une clé exacte (titre + artiste, insensible casse/accents) en première intention, puis un **score de similarité par bigrammes de caractères** (coefficient de Dice, sans IA) si la clé exacte ne matche pas — seuil strict de 85 % sur le titre **et** sur l'artiste simultanément (comparer un seul des deux ferait remonter chaque toile d'un artiste prolifique comme doublon de toutes les autres). Comparée à la fois aux œuvres déjà en base et aux lignes déjà traitées dans le même fichier.
- Génération de numéros d'inventaire manquants à la suite des existants, fusion automatique des artistes en double.
- Quand une ligne porte une bio/photo d'artiste répétée sur chaque œuvre (vu en pratique dans un inventaire réel), elle alimente la fiche artiste correspondante au lieu d'être perdue — toujours sans écraser une valeur déjà renseignée.

---

## 2. Autocomplétion AVEC IA

### 2.1 Architecture des fournisseurs

```
AiProviderChain  (apps/api/src/modules/ai/ai-provider-chain.ts)
  ├── OpenRouterAiProvider   (jusqu'à 3 modèles interrogés EN PARALLÈLE)
  └── GeminiAiProvider       (secours gratuit, Google Search natif)
```

- **`AI_PROVIDER`** (token NestJS injecté partout) est toujours une `AiProviderChain`, sauf si `AI_PROVIDER=anthropic` est forcé par variable d'environnement serveur (cas spécial, remplace toute la chaîne par `AnthropicAiProvider`).
- **Ordre configurable par organisation** (Réglages → IA → « Ordre de priorité ») : `['openrouter','gemini']` par défaut, inversable. Stocké dans `Organization.settings.ai.providerOrder`.
- **Fallback automatique** : la chaîne essaie le 1er fournisseur de l'ordre ; si son résultat n'a **aucune donnée exploitable** (`hasUsableData === false` — couvre uniformément un 402/429/quota épuisé ou juste "rien trouvé"), elle passe au suivant. Pas besoin de parser le code d'erreur précis.
- **Dans OpenRouter lui-même** : les modèles configurés (jusqu'à 3, choisis dans Réglages → IA) sont appelés **simultanément** sur la même recherche (pas l'un après l'autre). Les réponses sont **fusionnées champ par champ** : pour un texte, la réponse la plus longue/complète gagne ; pour les listes (tags), tout est fusionné sans doublon. Ainsi, si un modèle trouve les dimensions et un autre la signature, les deux sont gardées.

### 2.2 Recherche web réelle (pas de la mémoire pure)

- **OpenRouter** : plugin `"web"` (recherche réelle via Exa) activé sur chaque appel d'autofill — sans ça, le modèle ne répond qu'avec ce qu'il a mémorisé à l'entraînement, ce qui est nul pour un artiste régional/une collection privée (d'où les réponses génériques type "nu féminin" avant ce fix).
- **Gemini** : recherche Google Search native (`tools: [{ googleSearch: {} }]`), gratuite dans le palier gratuit, sans frais de plugin supplémentaire.
- **Stratégie de requête documentée dans le prompt système** (validée à la main sur un cas réel, un tableau belge de 1979 en collection privée) : prioriser le site officiel de l'artiste (page "œuvres"/"catalogue raisonné") et les annonces de ventes aux enchères (Artnet, Invaluable, PDF de lots) — ces sources donnent la technique exacte, les dimensions, l'emplacement de la signature, parfois un numéro de catalogue raisonné.

### 2.3 Autofill œuvre — `POST /ai/autofill/artwork`

Entrée : titre + nom d'artiste. Le modèle reçoit une requête de recherche du type `Artiste "Titre" catalogue raisonné dimensions technique signature photo`.

Champs retournés (`ArtworkAutofillResult`) :
- `description`, `techniqueName`, `dateText`, `yearFrom`
- **`heightCm` / `widthCm`** (nombres séparés) **+ `dimensionsNote`** (texte brut) : le prompt exige explicitement que si une dimension type "46x38 cm" est trouvée, elle soit **découpée** en deux nombres (premier = hauteur, second = largeur, conversion pouces→cm si besoin), en plus du texte brut conservé dans la note.
- `signatureDescription` (ex. "signé en bas à droite")
- `condition`, `tags`
- `imageUrl` : seulement si une vraie URL d'image a été vue dans un résultat de recherche — jamais inventée.

**Photo finale** (logique dans `ai.controller.ts` → `findPhoto`) : WikiArt (si clé) → Commons → en dernier recours, l'URL proposée par l'IA, **mais seulement après vérification** (requête HEAD confirmant un vrai `Content-Type: image/*`) — une URL inventée ou morte n'est jamais affichée.

### 2.4 Autofill artiste — `POST /ai/autofill/artist`

Même logique pour `biography`, `nationality`, `birthDate`, `deathDate`, `movement`, `imageUrl` (portrait), avec la même chaîne de vérification photo.

### 2.5 Recherche d'images « IA » (bouton dédié, multi-résultats)

`POST /ai/images/{artwork,artist}/ai` → `AiProvider.findImages()` — un appel dédié, séparé de l'autofill textuel, qui demande explicitement **jusqu'à 6 URLs différentes** trouvées dans les résultats de recherche. Chaque URL candidate est validée (HEAD-check) côté serveur avant d'être renvoyée ; seules les valides sont affichées comme vignettes. Le bouton **« IA »** n'apparaît dans l'UI que si un fournisseur IA est réellement configuré (`useAiAvailable()`), contrairement au bouton « Wiki » toujours visible.

### 2.6 Anti-« fausse réussite » (filler text)

Problème observé : un modèle qui ne trouve rien écrit parfois une phrase *à propos* de ne rien trouver ("The artwork was not found in the search results...") **comme valeur d'un champ**, au lieu de l'omettre — ce qui passait tous les contrôles "champ non vide" et s'affichait comme une vraie description.

Double protection (`apps/api/src/common/ai-filler.util.ts`, partagée par OpenRouter et Gemini) :
1. **Prompt renforcé** : interdiction explicite d'écrire une phrase de ce type comme valeur, obligation d'omettre la clé.
2. **Filtre serveur** (regex FR/EN : "not found", "no information", "n'a pas été trouvé", "aucune information"…) qui supprime ces champs *avant* qu'ils ne soient comptés comme données utilisables — même si le modèle ignore la consigne.

`hasUsableData` (dans `AiAutofillMeta`) n'est `true` que s'il reste au moins un champ réel après ce filtre — c'est ce booléen, pas un simple "200 OK", qui pilote tout (toast succès/erreur côté front, et le fallback vers le fournisseur suivant dans la chaîne).

### 2.7 Configuration (Réglages → IA)

- Bascule globale activé/désactivé par organisation.
- Clé API OpenRouter + jusqu'à 3 modèles (recherche + filtre "gratuits 🆓 seulement" sur le catalogue complet OpenRouter).
- Clé API Gemini (optionnelle).
- Ordre de priorité OpenRouter/Gemini.
- Clé API WikiArt (optionnelle, lien direct vers la page d'inscription gratuite).
- **Tableau d'usage IA** (30 derniers jours) : nombre d'appels par jour (graphique barres), par opération, et **par fournisseur réel** (pas "chain" — chaque tentative dans `AiAttemptLog` porte un champ `provider` pour une attribution correcte même après un fallback).

### 2.8 Où les boutons apparaissent

| Écran | Bouton Wiki | Bouton IA |
|---|---|---|
| Fiche œuvre → onglet Galerie | ✅ | ✅ si IA configurée |
| Modale édition artiste → champ photo | ✅ | ✅ si IA configurée |
| Formulaire création/édition œuvre (texte) | — | ✅ bouton "Sparkles" (autofill complet) |
| Modale ajout artiste (texte) | — | ✅ (enrichissement + IA en complément) |

---

## 3. Interaction entre "sans IA" et "avec IA" — vue d'ensemble

```
                     ┌─────────────────────────┐
Création artiste ──► │  Wikidata + Wikipédia   │── biographies trouvées (langues partielles)
                     └───────────┬─────────────┘
                                 │ langues manquantes
                                 ▼
                     ┌─────────────────────────┐
                     │  Traduction IA (chain)  │── remplit les langues vides, jamais n'écrase
                     └─────────────────────────┘

Bouton "Wiki" image ──► WikiArt (clé) → Commons ──► vignettes, 0 coût IA
Bouton "IA" image   ──► AiProvider.findImages() ──► validation HEAD ──► vignettes

Autofill texte œuvre/artiste ──► AiProviderChain (ordre configurable)
                                    ├─ essai fournisseur #1 (ex. OpenRouter, 3 modèles en parallèle, fusion)
                                    │     └─ si rien d'utilisable → fournisseur #2 (ex. Gemini)
                                    └─ photo associée : WikiArt → Commons → URL IA vérifiée
```

Principe général : **toute IA reste un complément, jamais une dépendance dure**. Si l'IA est désactivée ou non configurée, l'enrichissement Wikidata/Wikipédia/musées et le bouton "Wiki" fonctionnent identiquement ; seul le bouton "IA" et la traduction automatique des biographies disparaissent.

### 3.1 Score de complétude et cache unifié (nouveau)

- **`computeCompletenessScore()`** (`artist-enrichment.service.ts`) — score 0–100 pondéré (nom +20, image +20, biographie +30, dates +20, mouvement +10), calculé à la fin de chaque `enrich()` et exposé dans `ArtistEnrichmentResult.completeness`. **Informationnel uniquement** : n'aiguille aucune décision dans le pipeline existant (pas de régression), mais le signal existe maintenant réellement et peut être affiché ou utilisé pour une future logique de seuils (80 % stop / 50–80 % enrichissement ciblé / <50 % IA) sans tout reconstruire.
- **`TtlCache`** (`apps/api/src/common/ttl-cache.util.ts`) — primitive générique mémoire+TTL, appliquée à la recherche Wikidata par nom et à l'entité Wikidata par QID (10 min) : un import en masse qui crée plusieurs œuvres du même artiste, ou un nouvel essai d'enrichissement juste après création, ne refait plus le même aller-retour réseau. Remplace l'absence totale de cache sur ces deux appels (l'org-settings-cache existant ne couvrait que les réglages IA, pas les lookups Wikidata).

### 3.2 Règles architecturales (déjà respectées, formalisées ici)

- **Scrape ≠ IA** : les sources scrapées (i-CAC, Artmajeur) suivent strictement `scrape → extraction → validation → fusion`. Aucun chemin de code ne repasse un résultat scrapé dans un appel IA pour "correction" — elles sont fusionnées avec la même logique de fallback que les API musées (`fetchFallbackChain`), pas un cas spécial.
- **Sortie IA = proposition, jamais autoritaire sans validation externe** : l'autofill IA ne remplit que des champs vides côté UI (l'utilisateur valide avant sauvegarde), et n'écrase jamais une biographie/valeur déjà saisie manuellement ou trouvée via Wikidata/musée — cohérent sur artiste, œuvre et import tableur.
- **URL image IA = candidate jusqu'à validation HEAD** : déjà systémique sur tous les chemins images IA existants (`isLikelyRealImage` dans `download-image.util.ts`, appelé pour toute URL renvoyée par `findImages`/`findPhoto`, quel que soit l'appelant — œuvre, artiste, ou autofill).
- **Deux rôles IA, pas quatre** : conceptuellement, tous les usages IA se regroupent en *IA Text Engine* (autofill texte œuvre/artiste, traduction de biographie) et *IA Image Engine* (recherche/validation d'URL image) — la chaîne de fournisseurs (`AiProviderChain`) et le cache des réglages org (`org-ai-settings-cache.util.ts`, TTL 5 s) sont déjà partagés entre les deux, il n'y a pas quatre pipelines indépendants à gouverner séparément.

---

## 4. Autres fonctionnalités (résumé court)

- **Catalogue (`catalog`)** — CRUD œuvres, valorisation chiffrée (AES-256-GCM), galerie média, tri par colonne (titre, dimensions, valeur, collection…), corbeille avec restauration.
- **Collections (`collections`)** — regroupements hiérarchiques (parent/enfant), couleur, comptage d'œuvres automatique.
- **Expositions / Prêts / Lieux / Documents / Restaurations** — modules CRUD classiques avec permissions dédiées, rattachés aux œuvres.
- **Rapports (`reports`)** — génération PDF réelle (pdfkit) pour 4 types (catalogue, assurance, conservation, financier), les deux derniers nécessitant la permission `valuation:read`.
- **Réglages** — organisation, membres/rôles, clés API publiques, sources externes (musées), certificat HTTPS, sauvegarde/migration export-import `.zip`.
- **Authentification** — JWT access (15 min) + refresh tokens rotatifs avec détection de réutilisation par famille ; assistant de première installation (création d'organisation ou import de migration).
- **Déploiement** — une seule image Docker (`infra/docker/all-in-one.Dockerfile`) combinant API + Web dans un même conteneur (le web relaie `/api/v1` et `/uploads` vers l'API en interne via `localhost` — zéro CORS, zéro configuration réseau Docker entre conteneurs).
