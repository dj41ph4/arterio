# Arterio — Delivery roadmap

A platform of this scope ships in disciplined phases. Each phase is independently
demonstrable and production-grade — no throwaway prototypes. The modular core means later
phases add modules without rewriting earlier ones.

## Phase 1 — Foundation (current)
- [x] Monorepo, tooling, CI-ready scripts, environment contract
- [x] Architecture, security model, ADRs
- [x] Comprehensive Prisma domain model + seed
- [x] Design system: tokens, dark/light, custom accent, motion, primitives
- [x] i18n scaffolding for 6 languages
- [x] App shell: sidebar, top bar, command palette, skeletons
- [x] Centrepiece **data grid** (virtualised, Airtable-class) on a swappable data layer
- [x] Artwork detail, dashboard, auth screens (UI)
- [ ] NestJS API foundation: auth, IAM, catalog CRUD, OpenAPI
- [ ] Docker Compose + Nginx infra

## Phase 2 — Cataloguing core
- Full artwork CRUD wired to the API; autosave, undo/redo, optimistic updates
- Media pipeline: upload, WebP/AVIF derivatives, EXIF, deep zoom, gallery, crop/rotate
- Documents: invoices/certificates/reports with versioning
- Import engine: Excel/CSV/ODS/XML/JSON/Access/SQLite with column auto-mapping + presets
- Export engine: Excel/CSV/PDF/Word/JSON/XML, QR codes
- Elasticsearch-backed instant search + smart filters + saved views

## Phase 3 — Institutional operations
- Locations & interactive building map; movement history
- Loans, transport, insurance with calendar + alerts
- Exhibitions (temporary/permanent) + auto-generated exhibition catalogues
- Conservation/restoration history with before/after comparison
- Configurable workflow engine (acquisition, restoration, loan, sale, deaccession)
- Premium PDF generation (museum / Sotheby's / Christie's style)
- Alerts engine (insurance expiry, restoration due, loan return)
- PWA + offline sync

## Phase 4 — Intelligence & interoperability (AI enabled here)
- AI enrichment: description, tagging, classification, OCR, signature/style analysis
- Similar-image search (vision embeddings)
- Duplicate detection, field auto-completion
- Standards import/export: CIDOC-CRM, LIDO, Dublin Core, IIIF
- Decision dashboard: financial + heritage KPIs
- Public + private API with SDK, webhooks, GraphQL

## Phase 5 — Enterprise & scale
- 3D viewer for sculptures/objects
- Advanced RBAC/ABAC policy editor
- Certifiable audit export for public institutions
- HA deployment guides (k8s, Synology, multi-region), DR/backup automation
- Marketplace of optional modules
