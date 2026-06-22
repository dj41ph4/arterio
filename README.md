<div align="center">

# ◆ Arterio

**The professional art collection management platform.**
For museums, galleries, foundations, private collectors and auction houses.

</div>

---

Arterio is a SaaS platform for cataloguing, valuing, tracking and exhibiting works of
art at institutional scale — designed to rival the tools used by Sotheby's, Christie's
and national museums, with an interface inspired by Apple, Notion, Figma and Linear.

> **Status — Phase 1 (Foundation).** This repository currently contains the full
> architecture, design system, domain model, the core application shell and the
> centrepiece data grid running against a swappable data layer. Modules are built on a
> modular core so additional features slot in without touching the kernel. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Tech stack

| Layer            | Choice                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Frontend         | Next.js 15 (App Router) · React 19 · TypeScript                    |
| UI               | Tailwind CSS · shadcn-style primitives · Framer Motion · Radix     |
| Data grid        | TanStack Table + TanStack Virtual (virtualised, Excel-like)        |
| State / data     | TanStack Query · Zustand · swappable repository layer              |
| i18n             | next-intl — EN · FR · IT · ES · DE · NL                            |
| Backend          | NestJS (Node) · TypeScript · modular DDD                           |
| ORM / DB         | Prisma · PostgreSQL                                                 |
| Cache / queues   | Redis (BullMQ)                                                      |
| Search           | Elasticsearch (full-text + faceted + future similar-image)         |
| Storage          | S3-compatible (MinIO / AWS / Wasabi / Synology)                    |
| Auth             | JWT + refresh · MFA (TOTP) · WebAuthn/Passkeys · OAuth · RBAC/ABAC |
| Infra            | Docker · Docker Compose · Nginx reverse proxy                      |
| AI (later)       | Provider-agnostic, disabled by default (Anthropic Claude ready)    |

Runs on Windows, Linux, Docker, a VPS, cloud, or a Synology NAS.

## Monorepo layout

```
arterio/
├─ apps/
│  ├─ web/          Next.js front-end (the product UI)
│  └─ api/          NestJS back-end (REST + GraphQL, OpenAPI)
├─ packages/
│  ├─ database/     Prisma schema, client, migrations, seed
│  ├─ shared/       Cross-cutting types, DTOs, domain constants, i18n message types
│  └─ config/       Shared tsconfig / eslint
├─ infra/           docker-compose, Dockerfiles, Nginx, TLS
└─ docs/            Architecture, ADRs, roadmap, security model
```

## Quick start (local, web app)

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Run the web app with the built-in mock data layer (no DB needed yet)
npm run dev:web
# → http://localhost:3000
```

## Full stack (with infrastructure)

```bash
# Start Postgres, Redis, Elasticsearch, MinIO, Nginx
cp .env.example .env        # then edit secrets
npm run infra:up

# Prepare the database
npm run db:generate
npm run db:migrate
npm run db:seed

# Run API + web
npm run dev:api             # http://localhost:4000  (Swagger at /docs)
npm run dev:web             # http://localhost:3000
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, module map, decisions
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased delivery plan
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model & controls
- [`docs/adr/`](docs/adr) — architecture decision records

## License

Proprietary — © Arterio. All rights reserved.
