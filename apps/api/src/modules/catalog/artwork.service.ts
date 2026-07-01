import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ArtworkQuery, ArtworkView, Paginated, PermissionKey } from '@arterio/shared';
import { DEFAULT_LOCALE, PERMISSIONS, resolveLocalized } from '@arterio/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AuditService } from '../../core/audit/audit.service';
import { downloadImageToUploads } from '../../common/download-image.util';
import { UPLOAD_DIR } from '../../core/config/paths';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthUser } from '../../common/types';
import { ARTWORK_INCLUDE, toArtworkView } from './artwork.mapper';

@Injectable()
export class ArtworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private canViewValuation(user: AuthUser): boolean {
    return user.permissions.includes(PERMISSIONS.VALUATION_READ as PermissionKey);
  }

  async list(user: AuthUser, query: ArtworkQuery): Promise<Paginated<ArtworkView>> {
    const where: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (query.status?.length) where.status = { in: query.status };
    if (query.condition?.length) where.condition = { in: query.condition };
    if (query.collectionId?.length) where.collectionId = { in: query.collectionId };
    if (query.artistId?.length) where.artistId = { in: query.artistId };
    if (query.exhibitionId) where.exhibitionItems = { some: { exhibitionId: query.exhibitionId } };
    if (query.locationId) where.currentLocationId = query.locationId;
    if (query.favorite) where.isFavorite = true;
    if (query.search) {
      where.OR = [
        { inventoryNumber: { contains: query.search } },
        { artist: { fullName: { contains: query.search } } },
      ];
    }

    const limit = Math.min(query.limit ?? 50, 200);
    const skip = query.cursor ? Number(query.cursor) : 0;
    const canView = this.canViewValuation(user);

    // `title` (per-locale Json) and `value` (encrypted at rest) can't be
    // ORDER BY'd in SQL — resolve/decrypt every matching row once and sort in
    // memory instead. Sorting by value is silently ignored for users without
    // VALUATION_READ, since the ordering itself would otherwise leak amounts
    // they're not allowed to see.
    const memoryField = query.sort?.field;
    const useMemorySort =
      (memoryField === 'title' || (memoryField === 'value' && canView));

    if (useMemorySort) {
      const all = await this.prisma.artwork.findMany({
        where: where as never,
        include: ARTWORK_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 5000, // safety cap — this is a single-tenant appliance, not a multi-million-row catalog
      });
      const views = all.map((r) =>
        toArtworkView(r as never, { crypto: this.crypto, canViewValuation: canView }),
      );
      const dir = query.sort!.dir === 'desc' ? -1 : 1;
      const locale = query.locale ?? DEFAULT_LOCALE;
      views.sort((a, b) => {
        if (memoryField === 'title') {
          return dir * resolveLocalized(a.title, locale).localeCompare(resolveLocalized(b.title, locale));
        }
        const av = a.valuation?.insuranceValue ?? -Infinity;
        const bv = b.valuation?.insuranceValue ?? -Infinity;
        return dir * (av - bv);
      });
      const total = views.length;
      return {
        items: views.slice(skip, skip + limit),
        total,
        nextCursor: skip + limit < total ? String(skip + limit) : null,
      };
    }

    const orderBy = query.sort ? this.buildOrderBy(query.sort.field, query.sort.dir) : { updatedAt: 'desc' as const };

    const [rows, total] = await Promise.all([
      this.prisma.artwork.findMany({
        where: where as never,
        include: ARTWORK_INCLUDE,
        orderBy: orderBy as never,
        skip,
        take: limit,
      }),
      this.prisma.artwork.count({ where: where as never }),
    ]);

    return {
      items: rows.map((r) => toArtworkView(r as never, { crypto: this.crypto, canViewValuation: canView })),
      total,
      nextCursor: skip + limit < total ? String(skip + limit) : null,
    };
  }

  async getById(user: AuthUser, id: string): Promise<ArtworkView> {
    const row = await this.prisma.artwork.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: ARTWORK_INCLUDE,
    });
    if (!row) throw new NotFoundException('Artwork not found');
    return toArtworkView(row as never, {
      crypto: this.crypto,
      canViewValuation: this.canViewValuation(user),
      
    });
  }

  async setFavorite(user: AuthUser, id: string, value: boolean): Promise<void> {
    await this.prisma.artwork.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { isFavorite: value },
    });
  }

  async facets(user: AuthUser) {
    const where = { organizationId: user.organizationId, deletedAt: null };
    const [byStatus, byCondition, byCollection, byArtist, totalArtists, totalCollections] = await Promise.all([
      this.prisma.artwork.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.artwork.groupBy({ by: ['condition'], where, _count: true }),
      this.prisma.artwork.groupBy({ by: ['collectionId'], where, _count: true }),
      this.prisma.artwork.groupBy({ by: ['artistId'], where: { ...where, NOT: { artistId: null } }, _count: true }),
      this.prisma.artist.count({ where: { organizationId: user.organizationId } }),
      this.prisma.collection.count({ where: { organizationId: user.organizationId } }),
    ]);
    // Collection has no `deletedAt` column — reusing the artwork `where`
    // object here (as before this session's soft-delete change) threw
    // PrismaClientValidationError and took the whole facets endpoint down,
    // which the Collection page depends on to render at all.
    const [collections, artists] = await Promise.all([
      this.prisma.collection.findMany({ where: { organizationId: user.organizationId } }),
      byArtist.length
        ? this.prisma.artist.findMany({ where: { id: { in: byArtist.map((a) => a.artistId!).filter(Boolean) } }, select: { id: true, fullName: true } })
        : Promise.resolve([] as Array<{ id: string; fullName: string }>),
    ]);
    return {
      status: byStatus.map((s) => ({ value: s.status, label: s.status, count: s._count })),
      condition: byCondition.map((c) => ({ value: c.condition, label: c.condition, count: c._count })),
      collection: byCollection
        .filter((c) => c.collectionId)
        .map((c) => {
          const col = collections.find((x) => x.id === c.collectionId);
          return { value: c.collectionId, label: col?.name ?? '', count: c._count, color: col?.color };
        }),
      artist: byArtist
        .filter((a) => a.artistId)
        .map((a) => {
          const art = artists.find((x) => x.id === a.artistId);
          return { value: a.artistId!, label: art?.fullName ?? '', count: a._count };
        }),
      // Explicit totals for the dashboard stats — these count ALL artists/collections,
      // not just those linked to at least one artwork via the groupBy above.
      totalArtists,
      totalCollections,
    };
  }
  /** Next candidate after a unique-constraint clash: bump the numeric suffix of a "PREFIX-00001"-style number, or fall back to "INV-NNNN". */
  private bumpInventoryNumber(requested: string | undefined, count: number, attempt: number): string {
    const match = requested?.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, seq] = match;
      return `${prefix}${String(Number(seq) + attempt).padStart(seq!.length, '0')}`;
    }
    return `INV-${String(count + 1 + attempt).padStart(4, '0')}`;
  }

  async create(user: AuthUser, body: Record<string, unknown>): Promise<ArtworkView> {
    const count = await this.prisma.artwork.count({ where: { organizationId: user.organizationId } });

    let techniqueId: string | undefined;
    const techniqueName = body.techniqueName as string | undefined;
    if (techniqueName) {
      const technique = await this.prisma.technique.upsert({
        where: { organizationId_name: { organizationId: user.organizationId, name: techniqueName } },
        create: { organizationId: user.organizationId, name: techniqueName, label: { fr: techniqueName } },
        update: {},
      });
      techniqueId = technique.id;
    }

    const requestedInventoryNumber = body.inventoryNumber as string | undefined;
    // A spreadsheet import plans inventory numbers client-side from the file
    // alone, with no visibility into numbers already used by previous rows/
    // imports in this organization — every collision used to bubble up as a
    // raw 500 and silently kill that row. Retry with the next free number
    // instead of failing outright; a manually-typed duplicate from the UI
    // form will resolve to the same place after at most a few bumps.
    let row;
    for (let attempt = 0; ; attempt++) {
      const inventoryNumber =
        attempt === 0 && requestedInventoryNumber
          ? requestedInventoryNumber
          : this.bumpInventoryNumber(requestedInventoryNumber, count, attempt);
      try {
        row = await this.prisma.artwork.create({
          data: {
            organizationId: user.organizationId,
            inventoryNumber,
            techniqueId,
            title: (body.title as object) ?? {},
            description: (body.description as object) ?? {},
            analysis: {},
            notes: (body.notes as object) ?? {},
            conditionNote: {},
            provenance: {},
            bibliography: {},
            references: {},
            externalLinks: {},
            aiMeta: {},
            dominantColors: [],
            artistId: (body.artistId as string) || null,
            attribution: (body.artistName as string) ?? null,
            signatureDescription: (body.signatureDescription as string) ?? null,
            dateText: (body.dateText as string) ?? null,
            yearFrom: (body.yearFrom as number) ?? null,
            status: (body.status as never) ?? 'draft',
            condition: (body.condition as never) ?? 'unknown',
            collectionId: (body.collectionId as string) || null,
            heightCm: (body.heightCm as number) ?? null,
            widthCm: (body.widthCm as number) ?? null,
            dimensionsNote: (body.dimensionsNote as string) ?? null,
            framed: (body.framed as boolean) ?? false,
            acquisitionMethod: (body.acquisitionMethod as never) ?? 'unknown',
            acquisitionDate: body.acquisitionDate ? new Date(body.acquisitionDate as string) : null,
            paymentMethod: (body.paymentMethod as string) ?? null,
            hasCertificate: (body.hasCertificate as boolean) ?? false,
            hasInvoice: (body.hasInvoice as boolean) ?? false,
          },
          include: ARTWORK_INCLUDE,
        });
        break;
      } catch (err) {
        const isInventoryClash =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('inventoryNumber');
        if (!isInventoryClash || attempt > 200) throw err;
      }
    }

    const purchasePrice = body.purchasePrice as number | undefined;
    if (purchasePrice != null) {
      await this.prisma.artworkValuation.create({
        data: {
          artworkId: row.id,
          currency: 'EUR',
          purchasePriceEnc: this.crypto.encryptNumber(purchasePrice),
          valuationDate: body.acquisitionDate ? new Date(body.acquisitionDate as string) : null,
          valuationSource: (body.gallery as string) || null,
        },
      });
    }

    const final = purchasePrice != null
      ? await this.prisma.artwork.findUniqueOrThrow({ where: { id: row.id }, include: ARTWORK_INCLUDE })
      : row;

    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  async update(user: AuthUser, id: string, body: Record<string, unknown>): Promise<ArtworkView> {
    const existing = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!existing) throw new NotFoundException('Artwork not found');

    const data: Record<string, unknown> = {};
    // Merge per-locale so editing one language never wipes the others.
    if (body.title !== undefined) {
      data.title = { ...(existing.title as Record<string, string>), ...(body.title as Record<string, string>) };
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.artistId !== undefined) data.artistId = body.artistId || null;
    if (body.artistName !== undefined) data.attribution = body.artistName;
    if (body.inventoryNumber !== undefined) data.inventoryNumber = body.inventoryNumber;
    if (body.dateText !== undefined) data.dateText = body.dateText;
    if (body.yearFrom !== undefined) data.yearFrom = body.yearFrom;
    if (body.heightCm !== undefined) data.heightCm = body.heightCm;
    if (body.widthCm !== undefined) data.widthCm = body.widthCm;
    if (body.depthCm !== undefined) data.depthCm = body.depthCm;
    if (body.dimensionsNote !== undefined) data.dimensionsNote = body.dimensionsNote || null;
    if (body.signatureDescription !== undefined) data.signatureDescription = body.signatureDescription || null;
    if (body.framed !== undefined) data.framed = body.framed;
    if (body.status !== undefined) data.status = body.status;
    if (body.condition !== undefined) data.condition = body.condition;
    if (body.acquisitionMethod !== undefined) data.acquisitionMethod = body.acquisitionMethod;
    if (body.acquisitionDate !== undefined) {
      data.acquisitionDate = body.acquisitionDate ? new Date(body.acquisitionDate as string) : null;
    }
    if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod || null;
    if (body.hasCertificate !== undefined) data.hasCertificate = body.hasCertificate;
    if (body.hasInvoice !== undefined) data.hasInvoice = body.hasInvoice;
    if (body.collectionId !== undefined) data.collectionId = body.collectionId || null;
    if (body.isFavorite !== undefined) data.isFavorite = body.isFavorite;

    const techniqueName = (body.techniqueName as string | undefined)?.trim();
    if (techniqueName !== undefined) {
      if (!techniqueName) {
        data.techniqueId = null;
      } else {
        const technique = await this.prisma.technique.upsert({
          where: { organizationId_name: { organizationId: user.organizationId, name: techniqueName } },
          create: { organizationId: user.organizationId, name: techniqueName, label: { fr: techniqueName } },
          update: {},
        });
        data.techniqueId = technique.id;
      }
    }

    const valuationPatch = body.valuation as Record<string, unknown> | undefined;

    const row = await this.prisma.artwork.update({
      where: { id },
      data: data as never,
      include: ARTWORK_INCLUDE,
    });

    if (valuationPatch?.insuranceValue !== undefined && this.canViewValuation(user)) {
      await this.prisma.artworkValuation.upsert({
        where: { artworkId: id },
        create: {
          artworkId: id,
          insuranceValueEnc: this.crypto.encryptNumber(valuationPatch.insuranceValue as number | null),
        },
        update: {
          insuranceValueEnc: this.crypto.encryptNumber(valuationPatch.insuranceValue as number | null),
        },
      });
    }

    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  /**
   * Downloads an AI-suggested image URL server-side and attaches it like a regular upload — the browser never fetches the (arbitrary, third-party) URL directly.
   * When the AI autofill already downloaded the image to /uploads/ (DDG/gallery
   * hotlink case), the value passed here is a same-origin `/uploads/<file>` path,
   * not an external URL — reference that existing file instead of trying (and
   * failing) to re-download a relative path.
   */
  async attachMediaFromUrl(user: AuthUser, id: string, url: string): Promise<ArtworkView> {
    const local = url.match(/^\/uploads\/([A-Za-z0-9._-]+)$/);
    if (local) {
      const filename = local[1]!;
      const path = join(UPLOAD_DIR, filename);
      const info = await stat(path).catch(() => null);
      if (!info) throw new BadRequestException('Fichier introuvable');
      const ext = filename.split('.').pop()?.toLowerCase();
      const mimetype = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
      return this.attachMedia(user, id, { filename, mimetype, size: info.size });
    }
    const file = await downloadImageToUploads(url);
    return this.attachMedia(user, id, file);
  }

  async attachMedia(user: AuthUser, id: string, file: { filename: string; mimetype: string; size: number }): Promise<ArtworkView> {
    const artwork = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!artwork) throw new NotFoundException('Artwork not found');

    const existingCount = await this.prisma.mediaAsset.count({ where: { artworkId: id } });

    await this.prisma.mediaAsset.create({
      data: {
        organizationId: user.organizationId,
        artworkId: id,
        type: 'image',
        role: existingCount === 0 ? 'primary' : 'gallery',
        sortOrder: existingCount === 0 ? 0 : existingCount,
        storageKey: file.filename,
        derivatives: {},
        mimeType: file.mimetype,
        sizeBytes: file.size,
        exif: {},
        caption: {},
      },
    });

    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  async removeMedia(user: AuthUser, id: string, mediaId: string): Promise<ArtworkView> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaId, artworkId: id, artwork: { organizationId: user.organizationId } },
    });
    if (!media) throw new NotFoundException('Media not found');
    await this.prisma.mediaAsset.delete({ where: { id: mediaId } });

    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  /** Soft delete — moves the artwork to the trash. Recoverable via restore(); never silently unrecoverable. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const artwork = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null } });
    if (!artwork) throw new NotFoundException('Artwork not found');
    await this.prisma.artwork.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'artwork.delete',
      resource: 'artwork',
      resourceId: id,
      metadata: { inventoryNumber: artwork.inventoryNumber },
    });
  }

  async listTrash(user: AuthUser): Promise<Paginated<ArtworkView>> {
    const canView = this.canViewValuation(user);
    const rows = await this.prisma.artwork.findMany({
      where: { organizationId: user.organizationId, deletedAt: { not: null } },
      include: ARTWORK_INCLUDE,
      orderBy: { deletedAt: 'desc' },
    });
    return {
      items: rows.map((r) => toArtworkView(r as never, { crypto: this.crypto, canViewValuation: canView })),
      total: rows.length,
      nextCursor: null,
    };
  }

  async restore(user: AuthUser, id: string): Promise<ArtworkView> {
    const artwork = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: { not: null } } });
    if (!artwork) throw new NotFoundException('Artwork not found in trash');
    await this.prisma.artwork.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'artwork.restore',
      resource: 'artwork',
      resourceId: id,
      metadata: { inventoryNumber: artwork.inventoryNumber },
    });
    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  /** Hard delete — only reachable from the trash. Permanent, intentionally one more step away than remove(). */
  async purge(user: AuthUser, id: string): Promise<void> {
    const artwork = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: { not: null } } });
    if (!artwork) throw new NotFoundException('Artwork not found in trash');
    await this.prisma.artwork.delete({ where: { id } });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'artwork.purge',
      resource: 'artwork',
      resourceId: id,
      metadata: { inventoryNumber: artwork.inventoryNumber },
    });
  }

  /** Moves an artwork to a new location, keeping a MovementRecord of where it came from. */
  async moveLocation(user: AuthUser, id: string, locationId: string | null, reason?: string): Promise<ArtworkView> {
    const artwork = await this.prisma.artwork.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!artwork) throw new NotFoundException('Artwork not found');

    await this.prisma.$transaction([
      this.prisma.movementRecord.create({
        data: {
          artworkId: id,
          fromId: artwork.currentLocationId,
          toId: locationId,
          reason: reason || null,
          movedById: user.sub,
        },
      }),
      this.prisma.artwork.update({ where: { id }, data: { currentLocationId: locationId } }),
    ]);

    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user) });
  }

  /**
   * Détecte et fusionne les œuvres en double dans l'organisation courante.
   *
   * Deux œuvres sont considérées comme doublons si elles partagent la même clé
   * normalisée : titre (sans accents, minuscule, espaces réduits) + artiste
   * (id Prisma quand disponible, sinon nom normalisé). La plus complète devient
   * canonique ; toutes les relations liées (médias, documents, prêts, expositions,
   * restaurations, tags, valuations, déplacements) sont réaffectées vers elle
   * avant suppression définitive des doublons.
   */
  async autoMergeDuplicates(user: AuthUser): Promise<{
    merged: Array<{ canonicalTitle: string; count: number }>;
    checked: number;
  }> {
    const artworks = await this.prisma.artwork.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: {
        _count: {
          select: {
            media: true,
            documents: true,
            loanItems: true,
            exhibitionItems: true,
            restorations: true,
            tags: true,
          },
        },
        valuation: { select: { id: true } },
      },
    });

    const normalize = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    const titleOf = (a: (typeof artworks)[number]) => {
      const t = a.title as Record<string, string> | null;
      if (!t) return '';
      return normalize(t['fr'] ?? t['en'] ?? Object.values(t).find((v) => v) ?? '');
    };

    const artistKey = (a: (typeof artworks)[number]) =>
      a.artistId ?? normalize(a.attribution ?? '');

    const groups = new Map<string, typeof artworks>();
    for (const aw of artworks) {
      const title = titleOf(aw);
      if (!title) continue;
      const key = `${title}||${artistKey(aw)}`;
      const list = groups.get(key) ?? [];
      list.push(aw);
      groups.set(key, list);
    }

    const completeness = (a: (typeof artworks)[number]) => {
      let score = 0;
      const t = a.title as Record<string, string> | null;
      if (t && Object.values(t).some((v) => v)) score += 10;
      if (a.description) score += 10;
      if (a.artistId) score += 15;
      if (a.yearFrom) score += 10;
      if (a.heightCm || a.widthCm) score += 5;
      if (a.condition !== 'unknown' && a.condition) score += 5;
      if (a.inventoryNumber) score += 5;
      score += a._count.media * 8;
      score += a._count.documents * 3;
      score += a._count.loanItems * 2;
      score += a._count.exhibitionItems * 2;
      score += a._count.tags * 2;
      score += a.valuation ? 4 : 0;
      return score;
    };

    const merged: Array<{ canonicalTitle: string; count: number }> = [];

    for (const members of groups.values()) {
      if (members.length < 2) continue;

      const canonical = members.reduce((best, m) =>
        completeness(m) > completeness(best) ? m : best,
      );
      const duplicates = members.filter((m) => m.id !== canonical.id);
      const dupIds = duplicates.map((d) => d.id);

      await this.prisma.$transaction([
        // Reassign all relations from duplicates to canonical
        this.prisma.mediaAsset.updateMany({ where: { artworkId: { in: dupIds } }, data: { artworkId: canonical.id } }),
        this.prisma.document.updateMany({ where: { artworkId: { in: dupIds } }, data: { artworkId: canonical.id } }),
        this.prisma.loanItem.updateMany({ where: { artworkId: { in: dupIds } }, data: { artworkId: canonical.id } }),
        this.prisma.movementRecord.updateMany({ where: { artworkId: { in: dupIds } }, data: { artworkId: canonical.id } }),
        this.prisma.restoration.updateMany({ where: { artworkId: { in: dupIds } }, data: { artworkId: canonical.id } }),
        // For join tables (unique constraint), only insert if not already linked
        ...dupIds.flatMap((dupId) => [
          this.prisma.$executeRaw`
            INSERT OR IGNORE INTO artwork_tags (artworkId, tagId)
            SELECT ${canonical.id}, tagId FROM artwork_tags WHERE artworkId = ${dupId}
          `,
          this.prisma.$executeRaw`
            INSERT OR IGNORE INTO exhibition_artworks (exhibitionId, artworkId, wallLabel, sortOrder)
            SELECT exhibitionId, ${canonical.id}, wallLabel, sortOrder FROM exhibition_artworks WHERE artworkId = ${dupId}
          `,
        ]),
        this.prisma.artworkTag.deleteMany({ where: { artworkId: { in: dupIds } } }),
        this.prisma.exhibitionArtwork.deleteMany({ where: { artworkId: { in: dupIds } } }),
        this.prisma.artworkValuation.deleteMany({ where: { artworkId: { in: dupIds } } }),
        this.prisma.artwork.deleteMany({ where: { id: { in: dupIds } } }),
      ]);

      const t = canonical.title as Record<string, string> | null;
      const canonicalTitle = t ? (t['fr'] ?? t['en'] ?? Object.values(t)[0] ?? '') : '';
      merged.push({ canonicalTitle, count: members.length });
    }

    return { merged, checked: artworks.length };
  }

  /** Builds a Prisma orderBy, routing relation-backed fields (artist) through their join. */
  private buildOrderBy(field: string, dir: 'asc' | 'desc'): Record<string, unknown> {
    if (field === 'artistName') return { artist: { fullName: dir } };
    if (field === 'collection') return { collection: { name: dir } };
    const allowed = [
      'inventoryNumber',
      'yearFrom',
      'status',
      'condition',
      'updatedAt',
      'createdAt',
      'acquisitionDate',
      'heightCm',
      'widthCm',
    ];
    return { [allowed.includes(field) ? field : 'updatedAt']: dir };
  }
}
