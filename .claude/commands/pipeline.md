---
description: Orchestrateur en boucle — 4 agents résolvent le pipeline autofill (DDG → IA → champs → images) jusqu'à résolution vérifiée
argument-hint: "[cible optionnelle, ex: 'images oeuvres' ou 'DDG mistral']"
---

# /pipeline — Orchestrateur de résolution du pipeline autofill

Tu es **l'ORCHESTRATEUR**. Ton rôle : coordonner 4 agents spécialisés en boucle
jusqu'à ce que le pipeline autofill soit **vérifiablement résolu**. Les agents ne
s'arrêtent que quand TU déclares « c'est bon » — c.-à-d. quand le critère de
succès ci-dessous passe pour de vrai, pas sur une impression.

Cible de cette exécution (si l'utilisateur en a donné une) : **$ARGUMENTS**
Sans cible précise, traite tout le pipeline de bout en bout.

## Le système sous test

Pipeline d'autofill IA d'Arterio (NestJS `apps/api`) :
`recherche web (DDG/Wikidata/Wikipedia) → contexte → LLM (focus **Mistral**) →
parsing JSON → mapping champs en base → recherche + attachement d'images`.

Fichiers pivots :
- `apps/api/src/common/free-web-search.util.ts` — DDG (GET, sélecteurs cascade, fallback lite), Wikidata, Wikipedia
- `apps/api/src/common/download-image.util.ts` — download avec headers navigateur, garde SSRF
- `apps/api/src/modules/ai/ai.controller.ts` — `runArtwork/ArtistAutofillCore`, `findPhoto`, `attachArtworkPhoto`, `buildArtwork/ArtistPatch`, boucles bulk
- `apps/api/src/modules/ai/mistral.provider.ts` — provider prioritaire de l'utilisateur ; web_search natif en filet de secours quand contexte vide
- `apps/api/src/modules/catalog/artwork.service.ts` — `attachMediaFromUrl` (gère les chemins `/uploads/` locaux)

## Les 4 agents (subagent_type: Explore pour le diagnostic, general-purpose si un agent doit écrire un patch)

1. **AGENT-RECHERCHE** — grounding web. DDG renvoie-t-il vraiment des résultats
   (GET vs lite, sélecteurs, rate-limit) ? Wikidata/Wikipedia complètent-ils ?
   Écrit et exécute un harnais Node qui appelle réellement `searchWeb`,
   `buildArtworkSearchContext`, `buildArtistSearchContext` sur des cas connus
   (ex: « Abie Loy Kemarre » / « Bush Medicine Leaves », un artiste belge régional).
2. **AGENT-IA** — liaison LLM, **focus Mistral**. Le `searchContext` arrive-t-il
   au modèle ? Le filet de secours web_search se déclenche-t-il quand le contexte
   est vide ? Le JSON est-il bien extrait ? Cas providers désactivés.
3. **AGENT-CHAMPS** — parsing + mapping DB. `techniqueName`, `tags`, `movement`,
   `heightCm/widthCm` (coercition string→number) arrivent-ils réellement en base ?
   Vérifie via une requête Prisma après un autofill simulé.
4. **AGENT-IMAGES** — recherche + attachement. `findPhoto`/`attachArtworkPhoto`
   trouvent-ils et téléchargent-ils une image pour une œuvre ET un artiste ?
   Le `MediaAsset` est-il créé ? Le chemin `/uploads/` est-il servi ? Teste le
   download réel d'une URL de galerie protégée par hotlink.

## Protocole de boucle (répéter jusqu'à succès)

Pour chaque itération N :

1. **Lancer les 4 agents en parallèle** (un seul message, 4 appels Agent). Donne
   à chacun l'état courant + les findings des itérations précédentes. Chaque agent
   DIAGNOSTIQUE, propose des correctifs **précis** (fichier + lignes + edit exact),
   et **exécute un test concret** qui prouve/réfute le problème dans son domaine.
2. **Collecter** les rapports. Toi seul écris dans les fichiers : applique les
   correctifs proposés en série (évite que 4 agents éditent les mêmes fichiers).
3. **Vérifier** — voir critère de succès. Lance-le pour de vrai.
4. **Décider** :
   - Tous les critères passent → **STOP**. Déclare « pipeline résolu » avec le
     détail de ce qui a été prouvé. Commit + push.
   - Sinon → itération N+1, en passant aux agents ce qui échoue encore et pourquoi.
5. **Garde-fou anti-boucle-infinie** : à l'itération 4, si ça ne converge pas,
   arrête-toi et remonte à l'utilisateur les blocages durs (ex: rate-limit DDG
   côté réseau, clé API absente) qui ne se règlent pas par le code.

## Critère de succès (doit TOUT passer, sinon on reboucle)

- [ ] `cd apps/api && npx tsc -p tsconfig.build.json --noEmit` → 0 erreur
- [ ] Un harnais Node exécuté prouve que `buildArtworkSearchContext` ET
      `buildArtistSearchContext` renvoient un contexte non-vide sur au moins un
      cas connu (sinon : diagnostic réseau/rate-limit explicite, pas un code cassé)
- [ ] Le harnais prouve que `downloadImageToUploads` réussit sur une URL d'image
      réelle (headers navigateur → pas de 403)
- [ ] Revue du code confirmant que le bulk œuvre ET le bulk artiste appellent bien
      la recherche d'image, et que technique/tags/movement sont mappés
- [ ] Aucune régression : les 3 chemins (single artwork, single artist, bulk)
      restent cohérents

## Règles

- Reste sur `main` (l'utilisateur pousse en direct). Commit seulement quand le
  critère passe.
- Les agents Explore sont read-only : idéal pour diagnostiquer + écrire des
  harnais de test dans le scratchpad. C'est TOI qui appliques les edits.
- Chaque itération doit produire une **preuve exécutée**, jamais « ça devrait
  marcher ». Si un blocage est réseau/clé (hors code), dis-le clairement et
  n'entre pas en boucle dessus.
- À la fin, un résumé : ce qui était cassé, ce qui est prouvé résolu, ce qui
  reste dépendant de l'environnement.
