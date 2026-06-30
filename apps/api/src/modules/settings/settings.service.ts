import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { CERTS_DIR, CUSTOM_CERT_PATH, CUSTOM_KEY_PATH } from '../../core/config/paths';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../common/types';
import type { CreateApiKeyDto, UpdateOAuthProviderDto, UpdateOrganizationDto, WipeCategory } from './dto';

export const EXTERNAL_SOURCES = ['europeana', 'rijksmuseum', 'harvard', 'smithsonian'] as const;
export type ExternalSourceKey = (typeof EXTERNAL_SOURCES)[number];

export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type OAuthProviderKey = (typeof OAUTH_PROVIDERS)[number];

interface AiOrgSettings {
  enabled?: boolean;
  openrouterApiKeyEnc?: string;
  models?: string[];
  wikiartApiKeyEnc?: string;
  geminiApiKeyEnc?: string;
  artsyApiKeyEnc?: string;
  mistralApiKeyEnc?: string;
  /** Fallback order between configured providers, e.g. ['openrouter', 'mistral', 'gemini'] — any permutation of any subset. */
  providerOrder?: string[];
  /** 'parallel' (default): every configured OpenRouter model queried at once and merged. 'fallback': tried one at a time, cheaper. */
  multiModelMode?: 'parallel' | 'fallback';
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async getOrganization(user: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const externalSources = (settings.externalSources as Record<string, string>) ?? {};
    return {
      id: org.id,
      name: org.name,
      legalName: org.legalName,
      defaultLocale: org.defaultLocale,
      notifications: settings.notifications ?? {},
      // Never return the secrets themselves — just whether each is configured.
      externalSources: Object.fromEntries(EXTERNAL_SOURCES.map((k) => [k, Boolean(externalSources[k])])),
    };
  }

  /** Encrypts and stores third-party API keys used by artist-enrichment fallback providers. */
  async updateExternalSources(user: AuthUser, input: Partial<Record<ExternalSourceKey, string>>) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const existing = (settings.externalSources as Record<string, string>) ?? {};

    const next = { ...existing };
    for (const key of EXTERNAL_SOURCES) {
      const value = input[key];
      if (value === undefined) continue; // not submitted — keep existing
      if (value === '') delete next[key]; // explicit clear
      else next[key] = this.crypto.encrypt(value);
    }

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { settings: { ...settings, externalSources: next } },
    });

    return this.getOrganization(user);
  }

/** Org-level OpenRouter setup: on/off switch + (optional) API key + up to 3 model IDs, tried in order. Also an optional WikiArt key, which takes priority over Wikimedia Commons for artwork/artist photos when set. */
  async getAiSettings(user: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const ai = (settings.ai as AiOrgSettings) ?? {};
    return {
      enabled: ai.enabled ?? false,
      hasApiKey: Boolean(ai.openrouterApiKeyEnc),
      models: ai.models ?? [],
      hasWikiArtKey: Boolean(ai.wikiartApiKeyEnc),
      hasGeminiKey: Boolean(ai.geminiApiKeyEnc),
      hasArtsyKey: Boolean(ai.artsyApiKeyEnc),
      hasMistralKey: Boolean(ai.mistralApiKeyEnc),
      providerOrder: ai.providerOrder?.length ? ai.providerOrder : ['openrouter', 'mistral', 'gemini'],
      multiModelMode: ai.multiModelMode === 'fallback' ? 'fallback' : 'parallel',
    };
  }

  /** apiKey/wikiartApiKey/geminiApiKey/mistralApiKey: omit to keep unchanged, send "" to clear (falls back to the matching env var / Wikimedia Commons, respectively). */
  async updateAiSettings(
    user: AuthUser,
    input: {
      enabled?: boolean;
      apiKey?: string;
      models?: string[];
      wikiartApiKey?: string;
      geminiApiKey?: string;
      artsyApiKey?: string;
      mistralApiKey?: string;
      providerOrder?: string[];
      multiModelMode?: 'parallel' | 'fallback';
    },
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const existing = (settings.ai as AiOrgSettings) ?? {};

    const next = { ...existing };
    if (input.enabled !== undefined) next.enabled = input.enabled;
    if (input.apiKey !== undefined) {
      if (input.apiKey === '') delete next.openrouterApiKeyEnc;
      else next.openrouterApiKeyEnc = this.crypto.encrypt(input.apiKey);
    }
    if (input.wikiartApiKey !== undefined) {
      if (input.wikiartApiKey === '') delete next.wikiartApiKeyEnc;
      else next.wikiartApiKeyEnc = this.crypto.encrypt(input.wikiartApiKey);
    }
    if (input.artsyApiKey !== undefined) {
      if (input.artsyApiKey === '') delete next.artsyApiKeyEnc;
      else next.artsyApiKeyEnc = this.crypto.encrypt(input.artsyApiKey);
    }
    if (input.geminiApiKey !== undefined) {
      if (input.geminiApiKey === '') delete next.geminiApiKeyEnc;
      else next.geminiApiKeyEnc = this.crypto.encrypt(input.geminiApiKey);
    }
    if (input.mistralApiKey !== undefined) {
      if (input.mistralApiKey === '') delete next.mistralApiKeyEnc;
      else next.mistralApiKeyEnc = this.crypto.encrypt(input.mistralApiKey);
    }
    if (input.providerOrder !== undefined) {
      const known = ['openrouter', 'gemini', 'mistral'];
      const valid = input.providerOrder.filter((p) => known.includes(p));
      if (valid.length) next.providerOrder = valid;
    }
    if (input.multiModelMode !== undefined) {
      next.multiModelMode = input.multiModelMode === 'fallback' ? 'fallback' : 'parallel';
    }
    if (input.models !== undefined) {
      next.models = input.models.map((m) => m.trim()).filter(Boolean).slice(0, 3);
    }

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { settings: { ...settings, ai: next } },
    });
    return this.getAiSettings(user);
  }

  /** Instance-wide (not per-org — TLS is per-server, not per-tenant) HTTPS certificate, manually uploaded to replace the self-signed default. Takes effect on next restart. */
  async getCertificateInfo() {
    try {
      const pem = await readFile(CUSTOM_CERT_PATH, 'utf8');
      const cert = new X509Certificate(pem);
      return {
        hasCustomCertificate: true,
        subject: cert.subject,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
      };
    } catch {
      return { hasCustomCertificate: false };
    }
  }

  /** Validates the PEM pair forms a working TLS context before writing it — a broken cert would otherwise only surface as a crash on the next restart. */
  async uploadCertificate(certificate: string, privateKey: string) {
    try {
      createSecureContext({ cert: certificate, key: privateKey });
      new X509Certificate(certificate); // throws on malformed PEM
    } catch (err) {
      throw new BadRequestException(`Invalid certificate or key: ${(err as Error).message}`);
    }

    await mkdir(CERTS_DIR, { recursive: true });
    await writeFile(CUSTOM_CERT_PATH, certificate, { mode: 0o600 });
    await writeFile(CUSTOM_KEY_PATH, privateKey, { mode: 0o600 });
    return this.getCertificateInfo();
  }

  async removeCertificate() {
    await rm(CUSTOM_CERT_PATH, { force: true });
    await rm(CUSTOM_KEY_PATH, { force: true });
    return { hasCustomCertificate: false };
  }

  /** Whether each OAuth provider has a client id + secret configured (no secrets returned). */
  async getOAuthProviders(user: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const oauth = (settings.oauth as Record<string, { clientId?: string }>) ?? {};
    return Object.fromEntries(
      OAUTH_PROVIDERS.map((p) => [p, Boolean(oauth[p]?.clientId)]),
    ) as Record<OAuthProviderKey, boolean>;
  }

  /** Encrypts and stores the client secret; the client id is not secret and stored in clear. */
  async updateOAuthProvider(user: AuthUser, provider: OAuthProviderKey, dto: UpdateOAuthProviderDto) {
    if (!OAUTH_PROVIDERS.includes(provider)) {
      throw new NotFoundException(`Unknown OAuth provider "${provider}"`);
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    const oauth = (settings.oauth as Record<string, { clientId?: string; clientSecretEnc?: string }>) ?? {};
    const existing = oauth[provider] ?? {};

    const next = { ...existing };
    if (dto.clientId !== undefined) {
      if (dto.clientId === '') delete next.clientId;
      else next.clientId = dto.clientId;
    }
    if (dto.clientSecret !== undefined) {
      if (dto.clientSecret === '') delete next.clientSecretEnc;
      else next.clientSecretEnc = this.crypto.encrypt(dto.clientSecret);
    }

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { settings: { ...settings, oauth: { ...oauth, [provider]: next } } },
    });

    return this.getOAuthProviders(user);
  }

  async updateOrganization(user: AuthUser, dto: UpdateOrganizationDto) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.defaultLocale !== undefined ? { defaultLocale: dto.defaultLocale as never } : {}),
        ...(dto.notifications !== undefined
          ? { settings: { ...settings, notifications: { ...(settings.notifications as object), ...dto.notifications } } }
          : {}),
      },
    });

    return this.getOrganization(user);
  }

  async listApiKeys(user: AuthUser) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      isPublic: k.isPublic,
      rateLimit: k.rateLimit,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  }

  /** Returns the plaintext secret exactly once — only the hash is ever persisted. */
  async createApiKey(user: AuthUser, dto: CreateApiKeyDto) {
    const secret = randomBytes(24).toString('base64url');
    const prefix = `ak_${secret.slice(0, 8)}`;
    const keyHash = createHash('sha256').update(secret).digest('hex');

    const created = await this.prisma.apiKey.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        keyHash,
        prefix,
        scopes: dto.scopes ?? [],
        isPublic: dto.isPublic ?? false,
      },
    });

    return {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      secret: `${prefix}.${secret}`,
      createdAt: created.createdAt,
    };
  }

  async revokeApiKey(user: AuthUser, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /** Full JSON export of the organization's core records — the manual backup mechanism. */
  /**
   * Permanently deletes data by category for this organization. Always real
   * DB operations (no mock/dev-only path) — works identically whatever the
   * Prisma datasource (SQLite locally, Postgres in prod).
   */
  async wipeData(user: AuthUser, categories: WipeCategory[]) {
    const orgId = user.organizationId;
    const counts: Record<string, number> = {};
    const selected = new Set(categories);

    await this.prisma.$transaction(async (tx) => {
      if (selected.has('documents')) {
        const r = await tx.document.deleteMany({ where: { organizationId: orgId } });
        counts.documents = r.count;
      }
      if (selected.has('restorations')) {
        const r = await tx.restoration.deleteMany({ where: { organizationId: orgId } });
        counts.restorations = r.count;
      }
      if (selected.has('loans')) {
        const r = await tx.loan.deleteMany({ where: { organizationId: orgId } });
        counts.loans = r.count;
      }
      if (selected.has('exhibitions')) {
        const r = await tx.exhibition.deleteMany({ where: { organizationId: orgId } });
        counts.exhibitions = r.count;
      }
      if (selected.has('locations')) {
        await tx.artwork.updateMany({ where: { organizationId: orgId }, data: { currentLocationId: null } });
        await tx.movementRecord.updateMany({ where: { artwork: { organizationId: orgId } }, data: { fromId: null, toId: null } });
        await tx.location.updateMany({ where: { organizationId: orgId }, data: { parentId: null } });
        const r = await tx.location.deleteMany({ where: { organizationId: orgId } });
        counts.locations = r.count;
      }
      if (selected.has('collections')) {
        await tx.artwork.updateMany({ where: { organizationId: orgId }, data: { collectionId: null } });
        const r = await tx.collection.deleteMany({ where: { organizationId: orgId } });
        counts.collections = r.count;
      }
      if (selected.has('artists')) {
        await tx.artwork.updateMany({ where: { organizationId: orgId }, data: { artistId: null } });
        const r = await tx.artist.deleteMany({ where: { organizationId: orgId } });
        counts.artists = r.count;
      }
      if (selected.has('artworks')) {
        const r = await tx.artwork.deleteMany({ where: { organizationId: orgId } });
        counts.artworks = r.count;
      }
    });

    await this.audit.log({
      organizationId: orgId,
      actorId: user.sub,
      action: 'settings.danger_zone_wipe',
      resource: 'organization',
      resourceId: orgId,
      metadata: { categories, deleted: counts },
    });

    return { ok: true, deleted: counts };
  }

  /** Most recent audit entries first — the read side of the hash-chained trail. */
  async getAuditLog(user: AuthUser, limit = 100) {
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId: user.organizationId },
      include: { actor: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      actorName: r.actor?.fullName ?? r.actor?.email ?? 'system',
      metadata: r.metadata,
      ip: r.ip,
      createdAt: r.createdAt,
    }));
  }

  async verifyAuditLog(user: AuthUser) {
    return this.audit.verifyChain(user.organizationId);
  }

  async exportBackup(user: AuthUser) {
    const orgId = user.organizationId;
    const [organization, artists, artworks, collections, movements] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId } }),
      this.prisma.artist.findMany({ where: { organizationId: orgId } }),
      this.prisma.artwork.findMany({ where: { organizationId: orgId }, include: { valuation: true, tags: { include: { tag: true } } } }),
      this.prisma.collection.findMany({ where: { organizationId: orgId } }),
      this.prisma.artMovement.findMany({ where: { organizationId: orgId } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      organization,
      artists,
      artworks,
      collections,
      movements,
    };
  }
}
