# Arterio — CLAUDE.md

Art collection management SaaS platform. Commercial-grade, not an MVP.
Monorepo: NestJS API + Next.js 15 frontend + Prisma/PostgreSQL.

## Architecture

```
arterio/
├── apps/
│   ├── api/          NestJS 10, DDD modules, AES-256-GCM, JWT + refresh
│   └── web/          Next.js 15.3.9 App Router, RSC, TanStack Table/Virtual
├── packages/
│   ├── database/     Prisma schema + seed (PostgreSQL)
│   └── shared/       Domain types, Zod schemas, RBAC constants, i18n locales
└── infra/            Docker Compose, Nginx, Dockerfiles
```

## Dev commands

```bash
npm run dev:web        # Next.js on :3000
npm run dev:api        # NestJS on :4000 (ts-node-dev)
npm run infra:up       # Docker Compose (Postgres, Redis, ES, MinIO, Nginx)
```

Install: `npm install` from root (npm workspaces — no pnpm needed).

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

### Data layer (frontend)
`src/lib/data/artwork-repository.ts` — `ArtworkRepository` interface + `MockArtworkRepository`.
`src/lib/data/artist-repository.ts` — same pattern for artists.
Switch to HTTP implementation by swapping the singleton at the bottom of each file.
Mock data is deterministic (mulberry32 PRNG seeded with `20260620`).

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
- `apps/api/src/modules/ai/` — provider-agnostic interface (`AiProvider`), `NullProvider` (default), `AnthropicProvider` stub

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
- RBAC via `@RequirePermissions(PERMISSIONS.*)` decorator + guard
- Helmet + CORS in `main.ts`; rate-limit zones in `nginx/conf.d/default.conf`

### Prisma
Schema: `packages/database/prisma/schema.prisma`
Generate: `cd packages/database && npx prisma generate`
Migrate: `npx prisma migrate dev`
Seed: `npx prisma db seed` (idempotent, creates demo org + admin user + sample artworks)

## Env vars

Copy `.env.example` → `.env`. Critical values for local dev are defaulted — change in production:

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | local postgres | |
| `JWT_ACCESS_SECRET` | dev placeholder | **must change in prod** |
| `JWT_REFRESH_SECRET` | dev placeholder | **must change in prod** |
| `DATA_ENCRYPTION_KEY` | dev placeholder | **must change in prod** |
| `AI_ENABLED` | `false` | set to `true` to enable AI features |
| `ANTHROPIC_API_KEY` | — | required only when `AI_ENABLED=true` |
| `AI_MODEL` | `claude-opus-4-8` | any Anthropic model ID |

## Docker

```bash
docker compose -f infra/docker-compose.yml up -d
```

Services: `postgres:16`, `redis:7`, `elasticsearch:8.15`, `minio`, `api:4000`, `web:3000`, `nginx:80/443`.
Nginx reverse-proxies `/api/*` → api, everything else → web.
Health checks on all services; `api` and `web` depend on `postgres`.
