# ADR-0001 — Unified TypeScript monorepo (NestJS + Next.js)

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

The brief allows the backend to be **ASP.NET Core 9** or **Node.js NestJS**, with the
frontend fixed to React / Next.js / TypeScript. We must choose one and structure the repo.

Local environment available at bootstrap: Node 25, npm 11, git. No .NET SDK, no Docker
daemon, no global-package install rights (OS-restricted).

## Decision

Use a **single TypeScript monorepo** with **NestJS** (API) and **Next.js** (web), managed
by **npm workspaces** (+ optional Turborepo for task caching). Prisma + PostgreSQL for
persistence.

## Rationale

1. **One language, shared types.** DTOs, domain enums, validation schemas and i18n message
   types are shared via `packages/shared` between API and web — no drift, no duplicated
   contracts, faster refactors.
2. **Maintainability & hiring.** A single-language stack lowers cognitive load and lets the
   same engineers move across the stack — directly serving the "maintainability" mandate.
3. **Ecosystem fit.** NestJS brings opinionated DDD-friendly modules, DI, guards,
   interceptors, OpenAPI and first-class class-validator — a strong match for the security
   and modularity requirements.
4. **Environment pragmatics.** No .NET SDK is present and global installs are blocked;
   npm workspaces need no extra global tooling, so the project bootstraps cleanly on this
   machine and on a Synology NAS / VPS.
5. **AI path.** The future AI layer (Anthropic Claude) and most ML tooling have first-class
   JS/TS SDKs, keeping the provider-agnostic AI module in the same language.

## Consequences

- We forgo ASP.NET Core's raw throughput edge; mitigated by offloading heavy work to BullMQ
  workers, Redis caching and Elasticsearch, which keeps the Node API I/O-bound and fast.
- CPU-heavy tasks (image processing, PDF, OCR) run in worker processes / native libs
  (`sharp`, `pdf-lib`, etc.), not on the request thread.
- Everything is containerised; the absence of a local Docker daemon only affects local infra
  convenience, not the delivered artifacts (Compose + Dockerfiles are provided).

## Alternatives considered

- **ASP.NET Core 9 API + Next.js web.** Excellent performance and tooling, but a two-language
  split, no shared contracts, no local SDK, and higher maintenance surface for a small team.
