# Arterio — Architecture

> A reference-quality, modular, secure-by-default platform for institutional art
> collection management. This document is the single source of truth for *how* the
> system is built and *why*.

## 1. Guiding principles

1. **Robustness & maintainability first.** Clean architecture, DDD boundaries, SOLID,
   explicit module contracts. The kernel is small; capabilities are modules.
2. **Secure by default.** Encryption at rest for sensitive fields/documents, least
   privilege (RBAC + ABAC), immutable audit trail, no sensitive data in clear text.
3. **Performance at scale.** Designed for 100 000+ artworks and millions of images:
   virtualised UI, cursor pagination, Redis caching, Elasticsearch for search.
4. **Exceptional UX.** Autosave, undo/redo, drag-and-drop, instant search, micro-
   animations, skeletons everywhere, dark/light + custom accent, full keyboard control.
5. **Multilingual to the core.** EN · FR · IT · ES · DE · NL. UI strings *and* user
   content (titles, descriptions, biographies) are translatable.
6. **AI-ready, AI-off.** Every AI touch-point exists behind a provider-agnostic
   interface and feature flag. Shipping with `AI_ENABLED=false` changes nothing
   functionally; turning it on lights up enrichment features.
7. **Modular by construction.** New modules (3D viewer, mapping, workflow engine…)
   register against the core without modifying it — the "open/closed" rule at the app
   level.

## 2. High-level topology

```
                         ┌───────────────────────────┐
                         │          Nginx            │  TLS termination, HTTP/2,
                         │     (reverse proxy)       │  gzip/brotli, rate-limit
                         └─────────────┬─────────────┘
                  ┌────────────────────┼────────────────────┐
                  ▼                                          ▼
        ┌───────────────────┐                    ┌────────────────────┐
        │   web (Next.js)   │  ── REST/GraphQL ─▶ │    api (NestJS)    │
        │  SSR/RSC + PWA    │                    │  modular DDD core  │
        └───────────────────┘                    └─────────┬──────────┘
                                                            │
         ┌──────────────┬───────────────┬──────────────────┼───────────────┐
         ▼              ▼               ▼                  ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────────┐
   │PostgreSQL│   │  Redis   │   │Elasticsearch │   │ S3 (MinIO)│   │ Worker (Bull)│
   │ (source  │   │ (cache,  │   │ (full-text,  │   │  (media,  │   │ async jobs:  │
   │ of truth)│   │  queues) │   │   facets)    │   │ documents)│   │ import, OCR, │
   └──────────┘   └──────────┘   └──────────────┘   └───────────┘   │ thumbnails…) │
                                                                    └──────────────┘
```

PostgreSQL is the single source of truth. Elasticsearch is a derived read index kept in
sync via domain events. S3 stores binaries; the DB stores references + metadata.

## 3. Frontend architecture (`apps/web`)

- **Next.js 15 App Router** with React Server Components for fast first paint and SEO of
  public catalogue pages; Client Components for the interactive grid and editors.
- **Design system** built on CSS custom properties (`packages`/`apps/web/src/styles`):
  semantic tokens (`--background`, `--foreground`, `--primary`, …) drive light/dark and a
  user-selectable **accent color**. shadcn-style primitives wrap Radix for accessibility.
- **Motion**: Framer Motion for page/element transitions, shared-layout animations on the
  grid → detail navigation, and micro-interactions. Respects `prefers-reduced-motion`.
- **Data layer** (`src/lib/data`): a **repository interface** (`ArtworkRepository`,
  `CollectionRepository`, …). Two implementations:
  - `mock/` — in-memory realistic dataset (lets the UI run with zero backend).
  - `http/` — talks to the NestJS API (TanStack Query for caching/optimistic updates).
  A single switch (`NEXT_PUBLIC_DATA_SOURCE`) selects the implementation. UI never imports
  a concrete repo — only the interface — so the swap is invisible to screens.
- **Grid**: TanStack Table (headless) + TanStack Virtual for row/column virtualisation —
  Airtable/Notion-class: reorder, freeze, resize, hide, sort, filter, group, inline edit,
  fill, multi-select, context menu, color rules, aggregations.
- **State**: TanStack Query for server state; Zustand for ephemeral UI state (grid view
  config, selection, command palette). Undo/redo via a command stack in the editor store.
- **i18n**: next-intl with message catalogues per locale; locale in the URL segment
  (`/[locale]/…`). Number/date/currency formatting via `Intl`.
- **PWA**: installable, offline shell, background sync queue for edits (Phase 3).

## 4. Backend architecture (`apps/api`)

NestJS organised by **bounded context**, each a self-contained module:

```
src/
├─ core/                  cross-cutting: config, prisma, redis, s3, search, crypto,
│                         audit, i18n, events, health, guards, interceptors
├─ modules/
│  ├─ auth/               login, refresh, MFA/TOTP, WebAuthn, OAuth, sessions
│  ├─ iam/                users, roles, permissions (RBAC), policies (ABAC), invites
│  ├─ organizations/      multi-tenant orgs, members, settings, branding
│  ├─ catalog/            artworks, artists, collections, categories, techniques
│  ├─ media/              uploads, derivatives (webp/thumbnails), EXIF, galleries
│  ├─ documents/          invoices, certificates, reports, versioning
│  ├─ locations/          buildings, rooms, walls, storage, movement history
│  ├─ loans/              loans, transport, insurance, calendar
│  ├─ exhibitions/        temporary/permanent exhibitions, catalog generation
│  ├─ conservation/       restoration history, before/after, expertise, e-signature
│  ├─ workflow/           configurable state machines (acquisition, loan, sale…)
│  ├─ search/             Elasticsearch indexing + query
│  ├─ reporting/          dashboards, KPIs, PDF catalogues
│  ├─ notifications/      email/push/webhook/Slack/Discord/Teams/Telegram
│  ├─ import-export/      Excel/CSV/ODS/XML/JSON/Access/SQLite/PDF + mapping presets
│  ├─ standards/          CIDOC-CRM, LIDO, Dublin Core, IIIF mappers
│  └─ ai/                 provider-agnostic enrichment (disabled by default)
└─ main.ts
```

- **CQRS where it earns its keep** (reporting, import pipelines, search projections) —
  not dogmatically everywhere.
- **Repository pattern** over Prisma keeps the domain testable and the ORM swappable.
- **Domain events** (`ArtworkCreated`, `ArtworkUpdated`, `DocumentSigned`…) drive search
  re-indexing, audit entries, notifications and webhooks via the worker.
- **OpenAPI/Swagger** generated from decorators at `/docs`; optional **GraphQL** gateway
  for flexible read queries. Public + private API keys with scoped rate limits.

## 5. Data model (overview)

Full schema lives in [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma).
Highlights:

- **Multi-tenancy**: every domain row carries `organizationId`; row-level scoping enforced
  in the repository layer and (optionally) Postgres RLS.
- **Translatable content**: a generic `Translation` pattern — long-form, language-keyed
  fields (`title`, `description`, `biography`) stored as `Json` keyed by locale, with a
  resolved fallback chain (`requested → org default → en`).
- **Artwork** carries the full art-domain field set (inventory no., artist, technique,
  support, dimensions, provenance, valuations, insurance, condition, location, status…).
- **Audit**: append-only `AuditLog` with hash-chaining (`prevHash`→`hash`) for a
  certifiable, tamper-evident trail (institutional requirement).
- **Workflow**: `WorkflowDefinition` + `WorkflowInstance` model configurable state
  machines without code changes.

## 6. Security model

See [`docs/SECURITY.md`](SECURITY.md). Summary: TLS-only, JWT access + rotating refresh
tokens, MFA/TOTP/WebAuthn, Argon2id password hashing, AES-256-GCM for sensitive fields &
documents, RBAC + ABAC, CSRF/XSS/SQLi protections, rate-limiting & brute-force lockout,
hash-chained immutable audit log, encrypted backups, secret management via env/Vault.

## 7. Internationalization

- Supported: **en, fr, it, es, de, nl**. `en` is the development + fallback locale.
- UI strings: per-locale JSON catalogues (`apps/web/messages/*.json`) — typed.
- User content: language-keyed JSON columns; editors expose a per-field language switcher.
- API negotiates locale via `Accept-Language` / `?locale=`; errors are localised.

## 8. AI readiness (off by default)

- A single `AiService` interface in `modules/ai` with operations: `describe`, `tag`,
  `ocr`, `detectSignature`, `compare`, `findSimilar`, `suggestFields`, `classify`.
- Implementations: `AnthropicProvider` (Claude, default when enabled), `NullProvider`
  (active when `AI_ENABLED=false` — returns "not available", never throws).
- Vision/embeddings for similar-image search index into a `pgvector`/Elasticsearch dense
  vector field; wiring is present, population deferred until AI is enabled.
- No AI call happens, and no AI dependency is required, while the flag is off.

## 9. Performance

- Cursor-based pagination + Elasticsearch for list/search; virtualised rendering keeps the
  grid smooth at 100k rows.
- Redis caches hot reads, view configs and session data; BullMQ offloads heavy work
  (imports, OCR, thumbnailing, PDF generation, re-indexing).
- Image pipeline produces WebP/AVIF derivatives + responsive thumbnails on upload; IIIF
  tiles for deep zoom.

## 10. Decisions log

Architecture Decision Records live in [`docs/adr/`](adr). Key ones:

- [ADR-0001](adr/0001-stack-and-monorepo.md) — Unified TypeScript monorepo (NestJS + Next.js).
- ADR-0002 — Translatable-content strategy (language-keyed JSON + fallback chain).
- ADR-0003 — Provider-agnostic, flag-gated AI layer.
