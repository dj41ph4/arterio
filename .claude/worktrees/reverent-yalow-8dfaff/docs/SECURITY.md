# Arterio — Security model

Security is a first-class architectural concern, not a bolt-on. Target posture: suitable
for public institutions handling high-value cultural assets.

## Transport & network
- **HTTPS only.** Nginx terminates TLS (modern config: TLS 1.2/1.3, HSTS, OCSP stapling).
- HTTP→HTTPS redirect; secure, `HttpOnly`, `SameSite` cookies for refresh tokens.
- Strict security headers (CSP, X-Frame-Options/`frame-ancestors`, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy) via Nginx + Next.js/Helmet.

## Authentication
- **JWT access tokens** (short-lived, 15 min) + **rotating refresh tokens** (server-side,
  revocable, stored hashed). Refresh-token reuse detection invalidates the family.
- **MFA**: TOTP (RFC 6238) and **WebAuthn/Passkeys** (phishing-resistant). Recovery codes.
- **OAuth** (Google, Microsoft/Entra) for SSO.
- **Argon2id** password hashing (tuned memory/time/parallelism).
- **Brute-force protection**: progressive throttling + account lockout, per-IP and
  per-account rate limits backed by Redis.

## Authorization
- **RBAC**: roles → permissions (e.g. `artwork:read`, `artwork:update`, `loan:approve`).
- **ABAC**: attribute policies (e.g. "registrars may edit only artworks in their
  collection", "valuations visible only to finance role").
- Multi-tenant isolation: every query scoped by `organizationId`; optional Postgres RLS.

## Data protection
- **AES-256-GCM** encryption for sensitive fields (valuations, insurance, provenance notes)
  and stored documents; keys from env/Vault, **rotatable** (envelope encryption).
- Encrypted, versioned **backups**; encrypted media + documents at rest in S3 (SSE).
- **No sensitive data in clear text** in logs, exports, or error responses.

## Application hardening
- **SQL injection**: Prisma parameterised queries only; no raw string interpolation.
- **XSS**: React auto-escaping, sanitised rich text, strict CSP.
- **CSRF**: double-submit token + `SameSite` cookies for state-changing requests.
- **Rate limiting / DDoS**: Nginx + API throttler; per-API-key quotas; Redis counters.
- **Input validation**: `class-validator`/Zod DTOs at every boundary.
- **Dependency hygiene**: lockfile, `npm audit` in CI, Renovate-style updates.

## Auditability
- **Append-only, hash-chained `AuditLog`**: each entry stores `prevHash` and a computed
  `hash` over its canonical content → tamper-evident, certifiable for public institutions.
- Every security-relevant action logged with actor, IP, user agent, before/after diff.
- Active sessions list with remote logout; full login history.

## Operational
- Secrets via environment / Vault; never committed (`.env` git-ignored).
- Automatic key rotation hooks; least-privilege service credentials.
- Intrusion signals (anomalous login, refresh reuse) emit alerts to the notifications bus.

## Responsible disclosure
Report vulnerabilities to `security@arterio.app`. Do not open public issues for security
matters.
