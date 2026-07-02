# La recherche web d'Arterio — comment des IA « sans internet » font quand même de la recherche

Ce document explique précisément comment le pipeline d'autofill donne un accès web
réel aux modèles d'IA **gratuits ou sans outil de recherche** (Mistral, modèles
`:free` d'OpenRouter, Gemini, etc.), sans payer un seul appel d'API de recherche.

Fichiers pivots :

| Fichier | Rôle |
|---|---|
| `apps/api/src/common/free-web-search.util.ts` | Scraping DDG (texte + images), Wikidata, Wikipedia, construction du contexte |
| `apps/api/src/common/gallery-site-scraper.util.ts` | `BROWSER_HEADERS`, `fetchHtml`, scrapers de galeries |
| `apps/api/src/common/download-image.util.ts` | Téléchargement d'images avec camouflage navigateur, garde SSRF |
| `apps/api/src/common/ai-filler.util.ts` | Filtre anti-« réponse de remplissage » |
| `apps/api/src/common/translate.util.ts` | Traductions gratuites + validation de biographie |
| `apps/api/src/modules/ai/ai.controller.ts` | Orchestration : contexte → IA → mapping DB → images |
| `apps/api/src/modules/ai/mistral.provider.ts` | Injection du contexte + filet de secours `web_search` natif |

---

## 1. Le subterfuge central : c'est le **serveur** qui surfe, pas l'IA

Un LLM sans outil web ne peut que **halluciner** des faits sur un artiste régional.
Plutôt que d'acheter un plugin de recherche (le plugin « web » d'OpenRouter facture
chaque recherche, même sur les modèles `:free` — source récurrente d'erreurs 402),
Arterio inverse le problème :

```
1. Le serveur NestJS scrape DuckDuckGo + Wikidata + Wikipedia (gratuit, sans clé)
2. Il lit les pages trouvées et en extrait le texte brut
3. Il colle tout ça dans le message utilisateur envoyé au LLM :
   « Web search results for artist "X": [1] … [2] … Page excerpts: … »
4. Le LLM ne "cherche" rien — il ne fait que LIRE et extraire en JSON
```

Du point de vue du modèle, c'est une simple tâche d'extraction de texte. Du point
de vue du résultat, c'est une recherche web complète. **N'importe quel modèle de
chat gratuit devient un modèle « avec internet ».**

Le prompt verrouille ensuite l'IA sur ces sources (règle *STRICT SOURCING* dans
chaque provider) : *« use ONLY facts explicitly stated in the search results…
If nothing useful, return {} »*. Sans ce verrou, le modèle « complèterait » avec sa
mémoire d'entraînement — presque toujours fausse pour un artiste peu connu
(confusions d'homonymes, dates inventées).

---

## 2. DuckDuckGo texte — scraper un moteur sans API

DDG n'a pas d'API de recherche publique. On exploite ses **deux frontends
sans JavaScript**, prévus pour les vieux navigateurs :

### 2.1 Endpoint principal : `html.duckduckgo.com/html/`

`searchWebUncached()` :

- **GET, pas POST** — les heuristiques anti-bot de DDG tolèrent mieux un GET
  (un navigateur qui suit un lien fait un GET).
- **Headers de navigateur complets** (`BROWSER_HEADERS`) : `User-Agent` Chrome
  réaliste, `Accept`, `Accept-Language`… Sans eux, DDG renvoie 403 ou une page vide.
- **Parseur en cascade** (`parseDdgHtml`) : DDG change son markup sans prévenir,
  donc on essaie 4 jeux de sélecteurs CSS successifs
  (`.result`/`.result__a`, `.web-result`, `[data-result="web"]`, `.links_main`)
  et on garde le premier qui produit des résultats.
- Les liens sortants de DDG sont des redirections
  (`//duckduckgo.com/l/?uddg=<url-encodée>`) — on **désencapsule** le paramètre
  `uddg` pour retrouver l'URL réelle.

### 2.2 Fallback : `lite.duckduckgo.com/lite/`

Si le HTML principal renvoie autre chose que 200, zéro résultat parsé (markup
changé ou CAPTCHA), ou une exception → `ddgLiteSearch()` tente la version « lite »,
un frontend encore plus rudimentaire avec son propre markup (`a.result-link`).
Deux frontends = deux chances qu'au moins un passe.

### 2.3 Anti-rate-limit

- **Cache TTL 5 min** par requête (`TtlCache`) — absorbe les double-clics et le
  mode bulk qui re-traite le même artiste.
- **300 ms de pause entre chaque requête** d'un même contexte, et un espacement
  plus large (400–1200 ms) entre items en mode bulk — une rafale parallèle
  déclenche la détection de bot de DDG.
- Tout échec retourne `[]`, jamais d'exception : la recherche est un **bonus**,
  jamais une dépendance dure. Si DDG est bloqué (réseau d'entreprise, IP grillée),
  le pipeline continue avec Wikidata/Wikipedia.

---

## 3. DDG Images — le vol de jeton `vqd`

DDG images n'a pas d'API non plus, mais son frontend JS appelle un endpoint JSON
interne, `duckduckgo.com/i.js`, protégé par un **jeton de session `vqd`**.
`ddgImageSearch()` reproduit ce que fait le navigateur :

```
1. GET https://duckduckgo.com/?q=<query>&iax=images&ia=images   (page HTML normale)
2. Extraire le jeton du HTML :   regex  vqd=["']?([\d-]+)
3. GET https://duckduckgo.com/i.js?l=fr-fr&o=json&q=<query>&vqd=<jeton>
   → JSON propre : { results: [{ image, url, title, width, height }] }
```

Chaque candidate est ensuite **validée par une requête HEAD** (`isLikelyRealImage`,
timeout 4 s, headers navigateur) : content-type image, pas de 404 — on ne renvoie
jamais une URL morte à l'utilisateur. Cache 10 min.

---

## 4. Wikimedia (Wikidata + Wikipedia) — la politique User-Agent

Wikimedia throttle agressivement (HTTP 429) toute requête **sans User-Agent
descriptif** — c'est documenté dans leur politique. C'était la cause du bug
« l'autofill ne remplit plus rien » : les appels partaient sans UA, prenaient 429,
et le contexte arrivait vide au LLM qui, à cause du STRICT SOURCING, renvoyait `{}`.

Tous les appels passent maintenant par `wikimediaFetch()` :

- **User-Agent conforme** : `Arterio/1.0 (https://github.com/dj41ph4/arterio; art
  collection manager) node-fetch` — nom d'appli + URL de contact, exactement le
  format demandé par la policy.
- **Retry unique sur 429/503** avec backoff randomisé (600–1100 ms) — le throttling
  Wikimedia est un burst-limit court, pas un ban.

Ce que Wikimedia fournit :

- **`fetchWikidataArtistFacts`** : `wbsearchentities` pour trouver le QID (avec un
  filtre « cette entité est-elle un acteur du monde de l'art ? » sur la description,
  en 6 langues, comparaison **tout en minuscules**), puis une requête **SPARQL**
  pour les faits scalaires : naissance, décès, nationalité, mouvement, portrait P18.
  Le bloc est étiqueté `[WIKIDATA VERIFIED — Qxxx]` dans le contexte, et le prompt
  dit au modèle de traiter ce bloc comme autoritaire.
- **`fetchWikipediaFull`** : recherche + extrait **intégral** d'article dans les
  6 locales de l'app, garde le plus long (≤ 4 000 caractères).

---

## 5. Lecture des pages trouvées

Une liste d'URLs ne suffit pas — le LLM a besoin du **texte** des pages.
`fetchPageText()` télécharge chaque page (via `fetchHtml` + headers navigateur),
la passe à cheerio, **supprime `script/style/nav/footer/header`**, aplatit les
espaces et tronque à un budget de caractères. Cache 10 min.

Budgets asymétriques : les pages de **maisons de ventes** (drouot, artprice,
invaluable…) reçoivent un budget 2–4× plus grand — ce sont elles qui contiennent
les descriptions de lot (dimensions, édition, signature, technique).

---

## 6. Construction du contexte

### Artiste — `buildArtistSearchContext(fullName, officialWebsite?)`

5 requêtes DDG séquentielles, nom **dans les deux sens** (`"Berthe Dubail" OR
"Dubail Berthe"` — les catalogues de ventes inversent souvent) :

1. le nom seul (meilleur taux de hit toutes catégories)
2. `site:artsper.com OR site:kazoart.com OR site:artmajeur.com` (galeries en ligne)
3. `site:artprice.com OR site:interencheres.com OR site:drouot.com` (ventes)
4. `site:data.bnf.fr OR site:wikiart.org OR site:magnumphotos.com` (autorités)
5. `<nom> galerie exposition artiste biographie`

Puis : lecture des 7 premières pages dédupliquées + Wikipedia intégral + faits
Wikidata + **site officiel de l'artiste** s'il est connu (découvert par
`findArtistOfficialWebsite`, qui exclut les domaines encyclopédiques/marchands/
réseaux sociaux pour ne garder que les vrais sites personnels). Le tout assemblé,
Wikidata **en tête** (source la plus fiable), plafonné à ~14 000 caractères.

**Point clé** : si DDG renvoie 0 partout, on tente **quand même**
Wikidata + Wikipedia — un artiste connu est rempli même avec DDG mort.

### Œuvre — `buildArtworkSearchContext(artistName, title)`

3 requêtes, leçon apprise en testant sur la collection réelle : les grosses
requêtes `site:A OR site:B OR site:C OR …` sont **peu fiables sur DDG** (ignorées
ou sur-filtrées). Donc :

1. `"artiste" "titre"` nu — trouve galeries, ventes, sites officiels, musées
2. spécialistes estampes/ventes (`gazette-drouot`, `amorosart`, `michelfillion`…)
3. bases artiste (`artprice`, `artnet`, `wikiart`) — donne l'identité de l'artiste
   même quand l'œuvre précise n'a aucune trace en ligne

### Le retour au LLM

Le bloc final est concaténé au message utilisateur du provider. Chez Mistral
(`mistral.provider.ts`) :

```ts
const webSearch = !input.searchContext;   // filet de secours
```

Si le contexte gratuit est **vide** (DDG bloqué ET Wikimedia KO), on active alors
la recherche `web_search` **native** de Mistral (API Conversations) — payante mais
rare, uniquement en dernier recours. Si le contexte existe, on reste sur le
chat-completion classique : zéro coût de recherche.

---

## 7. Téléchargement d'images — contourner la protection hotlink

Les sites de galeries/ventes renvoient **403** à un `fetch` nu (protection
anti-hotlink). `download-image.util.ts` se déguise en navigateur :

```ts
const DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 … Chrome/125 …',   // un vrai Chrome
  Accept: 'image/avif,image/webp,…',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  Referer: 'https://www.google.com/',            // « je viens de Google Images »
};
```

Le `Referer: google.com` est le subterfuge décisif : la plupart des protections
hotlink whitelistent les moteurs de recherche pour rester indexées.

Garde-fous :

- **HEAD d'abord** (4 s) pour valider sans télécharger, GET ensuite (15 s).
- **Garde SSRF** (`isPrivateAddress`) : refuse les URLs résolvant vers des IP
  privées — le serveur ne peut pas être utilisé pour sonder le LAN.
- MIME whitelist (jpeg/png/webp/gif), taille plafonnée, nom de fichier haché.
- Les images DDG/IA sont téléchargées dans `/uploads/` **côté serveur** puis
  attachées (`MediaAsset` pour une œuvre, `thumbnail` pour un artiste) — le
  navigateur du client n'a jamais à toucher le site source.

---

## 8. Filtres qualité en sortie du LLM

Même bien sourcé, un LLM produit du bruit. Deux filtres :

- **`stripFillerFields`** (`ai-filler.util.ts`) : supprime tout champ dont la
  valeur est un aveu d'échec (« Non disponible », « No information found »,
  « Aucune information »…) — mais **seulement si la valeur fait < 160 caractères** :
  une vraie biographie qui contient « no information survives about his youth »
  en milieu de phrase est du contenu, pas un refus.
- **`isRealBiography`** (`translate.util.ts`) : une bio est réelle si ≥ 80
  caractères, pas un pattern de refus en tête (« Je n'ai pas pu… », « Sorry… »),
  et contient une année OU plusieurs phrases. Les ouvertures type « This artist… »
  ne sont rejetées que si le texte est court **et sans année** (les traducteurs
  rendent « Cet artiste » par « This artist » — il ne faut pas jeter les
  traductions anglaises légitimes).

Côté nombres, `parseFloat` sur les dimensions est gardé par un test `isNaN` — une
réponse « hauteur inconnue » ne peut pas écrire `NaN` en base.

---

## 9. Ce qui reste dépendant de l'environnement

- **DDG peut bloquer un réseau entier** (403 sur IP d'entreprise/VPN/datacenter).
  Le code dégrade proprement : fallback lite → Wikidata/Wikipedia → `web_search`
  natif Mistral. Le panneau de debug (Réglages → IA) montre requête par requête
  ce que DDG a renvoyé.
- **Wikimedia 429** malgré l'UA conforme : possible sous très gros bulk ; le retry
  absorbe les bursts courts, le cache (30 min pour Wikidata) absorbe le reste.
- **Art contemporain très régional** : parfois aucune source en ligne à part une
  galerie hotlink-protégée — le Referer Google passe dans la majorité des cas,
  sinon l'upload manuel reste la solution.
