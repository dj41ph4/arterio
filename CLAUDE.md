# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Arterio — CLAUDE.md

Art collection management SaaS platform. Commercial-grade, not an MVP.
Monorepo: NestJS API + Next.js 15 frontend + Prisma/SQLite.

## Architecture

```
arterio/
├── apps/
│   ├── api/          NestJS 10, DDD modules, AES-256-GCM, JWT + refresh
│   └── web/          Next.js 15.3.9 App Router, RSC, TanStack Table/Virtual
├── packages/
│   ├── database/     Prisma schema + seed (SQLite, single-file)
│   └── shared/       Domain types, Zod schemas, RBAC constants, i18n locales
└── infra/            Docker Dockerfiles, Synology docker-compose
```

## Dev commands

```bash
npm run dev:web        # Next.js on :3000
npm run dev:api         # NestJS on :4000 (ts-node-dev)
npm run build           # build all workspaces (--if-present)
npm run build:web       # build only @arterio/web
npm run build:api       # build only @arterio/api
npm run lint            # lint all workspaces
npm run typecheck       # typecheck all workspaces
npm run db:generate     # prisma generate (packages/database)
npm run db:migrate      # prisma migrate dev — NOTE: no migration files exist; see Database section
npm run db:seed         # tsx prisma/seed.ts — idempotent demo org + admin + sample artworks
```

Install: `npm install` from root (npm workspaces — no pnpm needed).

To typecheck a single workspace directly (faster than the aggregate `typecheck` script):
```bash
cd apps/api && npx tsc -p tsconfig.build.json   # API
cd apps/web && npx tsc --noEmit                  # Web
cd packages/database && npx tsc                 # database (after `prisma generate`)
```

## Database — SQLite, not Postgres

The platform deliberately ships as a **self-hosted appliance** with **zero external
database server**. `packages/database/prisma/schema.prisma` uses `provider = "sqlite"`.

- **No Prisma migration files exist.** The schema is created/synced with
  `prisma db push` (idempotent, safe to re-run) rather than `prisma migrate`. The API
  Docker image runs `db push` on every container boot before starting Nest — a fresh
  install "just works" with no manual migration step. Don't add a `migrations/`
  folder without updating both the Docker boot command and this convention.
- **All domain enums are `String` fields, not native Prisma enums** (SQLite has no
  native enum type). The allowed values live as `const` arrays in
  `packages/shared/src/domain/enums.ts` — application code never imports an enum type
  from `@arterio/database`/`@prisma/client`, it validates against those shared arrays.
  Keep it that way; don't reintroduce a Prisma `enum` block.
- Local dev default: `DATABASE_URL=file:./dev.db`. In the Docker image it's baked to
  `file:/data/arterio.db`, with uploaded media at `/data/uploads` (`UPLOAD_DIR` env) —
  one mapped volume (`/data`) holds everything persistent.
- `generator client` sets `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` for
  the Alpine runtime image alongside local dev.

## Key conventions

### Path aliases
`@/*` maps to `apps/web/src/*` — defined in `apps/web/tsconfig.json`.

### i18n
Six locales: `en fr it es de nl`. Route prefix: `/[locale]/...`
Messages in `apps/web/messages/{locale}.json`. Add keys to **all 6** files simultaneously.
`next-intl` via plugin in `next.config.mjs`. `setRequestLocale(locale)` in every server page.

### Theming
CSS custom properties in `apps/web/src/styles/globals.css`.
Never use hard-coded Tailwind colour classes — use `text-[var(--foreground)]` etc.
Dark/light handled by `next-themes`. Accent colour via Zustand store in `ui-store.ts`.

### Data layer (frontend) — swappable mock ↔ HTTP
Selection is driven by `process.env.NEXT_PUBLIC_DATA_SOURCE` (`'http'` → real API,
anything else → mock). Two patterns coexist:
- **Repository pattern** (artworks, artists): `src/lib/data/index.ts` and
  `artist-repository.ts` export a singleton chosen between `HttpXRepository`
  (`lib/data/http/`) and `MockXRepository` (`lib/data/mock/`) behind a shared
  interface. `collection-repository.ts` is **mock-only so far** — no backend module.
- **Inline view pattern** (exhibitions, loans, locations, documents): the view
  component itself has a local `const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http'`,
  calls `apiFetch()` directly when true, and falls back to a hardcoded `DEMO_*` array
  in the same file otherwise. Follow this lighter pattern for a remaining demo screen
  unless you're also refactoring it into a proper `lib/data/` repository.
- `NEXT_PUBLIC_DATA_SOURCE` is a **build-time** Next.js env var — setting it in
  `docker-compose.yml` at runtime does nothing to an already-built image. The
  production Docker image bakes `NEXT_PUBLIC_DATA_SOURCE=http` via an `ARG` in
  `infra/docker/web.Dockerfile`.
- Mock data is deterministic (mulberry32 PRNG seeded with `20260620`).

### API base URL resolution (browser-side)
`apps/web/src/lib/api/client.ts` does **not** hardcode an API host. If
`NEXT_PUBLIC_API_URL` isn't baked in at build time, the browser derives the API origin
from `window.location` at runtime (same-origin `/api/v1` behind nginx on :80/:443, or
`:4000` direct-port for the bare two-container deploy). This is what lets one Docker
image work on any NAS/LAN IP without a rebuild — don't reintroduce a hardcoded
`localhost:4000` default.

`apps/web/next.config.mjs` has a matching `rewrites()` that forwards `/api/v1/*` and
`/uploads/*` server-side to the API container (`API_INTERNAL_URL`, defaults to
`http://api:4000` — the compose service name) — so a single reverse-proxy entry
pointed at the **web** container alone is enough; the web container does the
internal hand-off to the API container itself. This is the recommended single-domain
deployment and needs no CORS configuration at all, since the browser only ever sees
one origin. A genuinely split deployment (API on a separate host) still works via the
manual API-host override (login screen / first-run setup) — that's the case CORS
below exists for.

### CORS
`apps/api/src/main.ts` auto-allows LAN-private origins (`10.x`, `192.168.x`,
`172.16-31.x`, `localhost`) plus `APP_URL` and any origin listed in `CORS_ORIGINS`
(comma-separated). This exists because the appliance is reached by raw IP on a home
network with no fixed origin knowable ahead of time — don't replace it with a single
hardcoded origin without checking the Synology deployment story first (see Docker
section below).

### Server Components / RSC boundary
Never pass LucideIcon **components** as props across the RSC boundary.
Use string-key registries inside Client Components (see `module-placeholder.tsx`).

### Node 25 localStorage shim
`apps/web/src/instrumentation.ts` patches `globalThis.localStorage` on server startup.
Zustand `persist` uses `skipHydration: true` + `safeStorage` guard.
Do not remove either fix — Node 25 exposes a broken `localStorage` global.

### API structure
- `apps/api/src/core/` — config (Zod env validation), Prisma service, crypto (AES-256-GCM + Argon2id)
- `apps/api/src/common/` — guards (JWT, permissions), decorators (`@CurrentUser`, `@RequirePermissions`)
- `apps/api/src/modules/auth/` — login, refresh token rotation (family-based reuse detection)
- `apps/api/src/modules/catalog/` — artwork CRUD, mapper (decrypts valuations on demand)
- `apps/api/src/modules/artists/` — artist CRUD + Wikipedia/Wikidata enrichment
- `apps/api/src/modules/exhibitions/` `loans/` `locations/` `documents/` — CRUD
  modules that map a flatter frontend view shape onto the underlying Prisma model
  (e.g. `Location.mapMeta` is a Json column holding `building`/`floor`/`capacity` that
  the frontend expects as top-level fields; an exhibition's `color` is a deterministic
  hash of its id, not a stored column). Read the `toView()` mapper in each
  `*.service.ts` before assuming a frontend field is a raw DB column.
- `apps/api/src/modules/settings/` — org settings, API keys, full migration export/import (.zip)
- `apps/api/src/modules/setup/` — first-run wizard (create org + admin, or import a migration .zip)
- `apps/api/src/modules/ai/` — provider-agnostic interface (`AiProvider`), `NullProvider` (default), `AnthropicProvider` stub

### Still mock-only (no backend module)
The **Reports** PDF-generation buttons have no backend yet (Reports' live snapshot
stats *are* real — they reuse the artwork stats endpoint). Collections has a real
NestJS module (`apps/api/src/modules/collections/`) plus `HttpCollectionRepository`
on the frontend — not mock-only anymore. Wiring up Reports follows the same pattern
as `exhibitions`/`loans`/`locations`/`documents`/`collections`: a NestJS CRUD module
gated by `@RequirePermissions`, plus a frontend view using `apiFetch` behind
`NEXT_PUBLIC_DATA_SOURCE === 'http'`.

### AI layer
`AI_ENABLED=false` in `.env` — platform runs fully without any AI config.
`NullAiProvider` is active by default; throws `503` on any operation.
`AnthropicAiProvider` activates when `AI_ENABLED=true` + `ANTHROPIC_API_KEY` is set.
Default model: `claude-opus-4-8` (configurable via `AI_MODEL`).

### Artist enrichment (free, no API key)
`ArtistEnrichmentService` queries:
1. **Wikidata** (`wbsearchentities` → `wbgetentities` + SPARQL) for structured data
2. **Wikipedia REST API** (`/api/rest_v1/page/summary/{title}`) for multilingual bios

Enrichment is fire-and-forget on artist create. Manual `/POST artists/:id/enrich` re-triggers.
Results cache in DB (`biography Json`, `externalIds Json`). Manual edits are never overwritten.

### Security
- JWT access (15 min) + rotating refresh tokens stored as Argon2id hash
- AES-256-GCM field encryption for financial valuations (`*Enc` columns)
- `DATA_ENCRYPTION_KEY` = 32-byte base64 (set a real key in production)
- RBAC via `@RequirePermissions(PERMISSIONS.*)` decorator + guard (permission keys defined in `@arterio/shared`)
- Helmet + CORS in `main.ts`

### Prisma
Schema: `packages/database/prisma/schema.prisma` (provider: sqlite)
Generate: `cd packages/database && npx prisma generate`
Sync schema → DB: `npx prisma db push` (no migration files — see Database section above)
Seed: `npx prisma db seed` (idempotent, creates demo org + admin user + sample artworks)

## Env vars

Copy `.env.example` → `.env` for local dev. Critical values are defaulted — change in production:

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `file:./dev.db` | SQLite file path; Docker bakes `file:/data/arterio.db` |
| `UPLOAD_DIR` | `<cwd>/uploads` | Docker bakes `/data/uploads` (same mapped volume as the DB) |
| `JWT_ACCESS_SECRET` | dev placeholder | **must change in prod** |
| `JWT_REFRESH_SECRET` | dev placeholder | **must change in prod** |
| `DATA_ENCRYPTION_KEY` | dev placeholder | **must change in prod** |
| `APP_URL` | `http://localhost:3000` | canonical origin; also an allowed CORS origin |
| `CORS_ORIGINS` | — | extra comma-separated CORS origins beyond `APP_URL` + auto-allowed LAN |
| `HTTPS_ENABLED` | `false` | API serves HTTPS directly with a self-signed cert generated at every boot — for reverse proxies that connect to the upstream over HTTPS; never persisted, never meant to be trusted directly |
| `AI_ENABLED` | `false` | set to `true` to enable AI features |
| `ANTHROPIC_API_KEY` | — | required only when `AI_ENABLED=true` |
| `AI_MODEL` | `claude-opus-4-8` | any Anthropic model ID |
| `AI_PROVIDER` | `none` | `anthropic` or `openrouter` — OpenRouter's own on/off + key + models are normally set per-org from Settings → AI instead |
| `OPENROUTER_API_KEY` | — | server-wide fallback if an org hasn't set its own key in Settings → AI |
| `OPENROUTER_MODEL` | `openrouter/auto` | comma-separated fallback model list, used if an org hasn't chosen its own |

## Docker / deployment

Two images, built and pushed by `.github/workflows/docker-publish.yml` on every push
to `main`: `docker.io/dj41ph4/arterio-api` and `arterio-web`. The workflow
auto-increments a semver patch tag (`vX.Y.Z`, starting `1.0.0`) shared by both images,
alongside `latest`.

`infra/synology/docker-compose.yml` is intentionally minimal: **api + web +
watchtower**, one bind-mounted `./data:/data` volume on the api service (DB + uploaded
media), no Postgres/Redis/Elasticsearch/MinIO/nginx. Watchtower polls Docker Hub every
2 minutes and redeploys any container labeled
`com.centurylinklabs.watchtower.enable=true` — this is what makes `git push` → live
update on the NAS fully automatic. Don't add services back to this compose file
without strong reason; the explicit goal is "map two ports + one folder, nothing else
to configure."

The API Docker image runs as **root** (no `USER` directive) so it can always write to
a bind-mounted Synology folder without PUID/PGID configuration.

First-run: no seeded demo admin in production images. `GET /api/v1/setup/status` /
`POST /api/v1/setup` (web page `/[locale]/setup`) creates the real org + admin on first
visit, or imports a full migration `.zip` instead.
