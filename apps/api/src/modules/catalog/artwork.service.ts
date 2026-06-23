import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ArtworkQuery, ArtworkView, Paginated, PermissionKey } from '@arterio/shared';
import { DEFAULT_LOCALE, PERMISSIONS, resolveLocalized } from '@arterio/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { AuthUser } from '../../common/types';
import type { Env } from '../../core/config/configuration';
import { ARTWORK_INCLUDE, toArtworkView } from './artwork.mapper';

@Injectable()
export class ArtworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private canViewValuation(user: AuthUser): boolean {
    return user.permissions.includes(PERMISSIONS.VALUATION_READ as PermissionKey);
  }

  private apiOrigin(): string {
    return `http://localhost:${this.config.get('PORT', { infer: true })}`;
  }

  async list(user: AuthUser, query: ArtworkQuery): Promise<Paginated<ArtworkView>> {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (query.status?.length) where.status = { in: query.status };
    if (query.condition?.length) where.condition = { in: query.condition };
    if (query.collectionId?.length) where.collectionId = { in: query.collectionId };
    if (query.artistId?.length) where.artistId = { in: query.artistId };
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
        toArtworkView(r as never, { crypto: this.crypto, canViewValuation: canView, apiOrigin: this.apiOrigin() }),
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
      items: rows.map((r) => toArtworkView(r as never, { crypto: this.crypto, canViewValuation: canView, apiOrigin: this.apiOrigin() })),
      total,
      nextCursor: skip + limit < total ? String(skip + limit) : null,
    };
  }

  async getById(user: AuthUser, id: string): Promise<ArtworkView> {
    const row = await this.prisma.artwork.findFirst({
      where: { id, organizationId: user.organizationId },
      include: ARTWORK_INCLUDE,
    });
    if (!row) throw new NotFoundException('Artwork not found');
    return toArtworkView(row as never, {
      crypto: this.crypto,
      canViewValuation: this.canViewValuation(user),
      apiOrigin: this.apiOrigin(),
    });
  }

  async setFavorite(user: AuthUser, id: string, value: boolean): Promise<void> {
    await this.prisma.artwork.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { isFavorite: value },
    });
  }

  async facets(user: AuthUser) {
    const where = { organizationId: user.organizationId };
    const [byStatus, byCondition, byCollection] = await Promise.all([
      this.prisma.artwork.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.artwork.groupBy({ by: ['condition'], where, _count: true }),
      this.prisma.artwork.groupBy({ by: ['collectionId'], where, _count: true }),
    ]);
    const collections = await this.prisma.collection.findMany({ where });
    return {
      status: byStatus.map((s) => ({ value: s.status, label: s.status, count: s._count })),
      condition: byCondition.map((c) => ({ value: c.condition, label: c.condition, count: c._count })),
      collection: byCollection
        .filter((c) => c.collectionId)
        .map((c) => {
          const col = collections.find((x) => x.id === c.collectionId);
          return { value: c.collectionId, label: col?.name ?? '', count: c._count, color: col?.color };
        }),
      artist: [],
    };
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

    const row = await this.prisma.artwork.create({
      data: {
        organizationId: user.organizationId,
        inventoryNumber: (body.inventoryNumber as string) ?? `INV-${String(count + 1).padStart(4, '0')}`,
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
        dateText: (body.dateText as string) ?? null,
        yearFrom: (body.yearFrom as number) ?? null,
        status: (body.status as never) ?? 'draft',
        condition: (body.condition as never) ?? 'unknown',
        collectionId: (body.collectionId as string) || null,
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

    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user), apiOrigin: this.apiOrigin() });
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
    if (body.artistName !== undefined) data.attribution = body.artistName;
    if (body.inventoryNumber !== undefined) data.inventoryNumber = body.inventoryNumber;
    if (body.dateText !== undefined) data.dateText = body.dateText;
    if (body.yearFrom !== undefined) data.yearFrom = body.yearFrom;
    if (body.heightCm !== undefined) data.heightCm = body.heightCm;
    if (body.widthCm !== undefined) data.widthCm = body.widthCm;
    if (body.depthCm !== undefined) data.depthCm = body.depthCm;
    if (body.status !== undefined) data.status = body.status;
    if (body.condition !== undefined) data.condition = body.condition;
    if (body.collectionId !== undefined) data.collectionId = body.collectionId || null;
    if (body.isFavorite !== undefined) data.isFavorite = body.isFavorite;

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
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user), apiOrigin: this.apiOrigin() });
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
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user), apiOrigin: this.apiOrigin() });
  }

  async removeMedia(user: AuthUser, id: string, mediaId: string): Promise<ArtworkView> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaId, artworkId: id, artwork: { organizationId: user.organizationId } },
    });
    if (!media) throw new NotFoundException('Media not found');
    await this.prisma.mediaAsset.delete({ where: { id: mediaId } });

    const final = await this.prisma.artwork.findUniqueOrThrow({ where: { id }, include: ARTWORK_INCLUDE });
    return toArtworkView(final as never, { crypto: this.crypto, canViewValuation: this.canViewValuation(user), apiOrigin: this.apiOrigin() });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.artwork.deleteMany({ where: { id, organizationId: user.organizationId } });
  }

  /** Builds a Prisma orderBy, routing relation-backed fields (artist) through their join. */
  private buildOrderBy(field: string, dir: 'asc' | 'desc'): Record<string, unknown> {
    if (field === 'artistName') return { artist: { fullName: dir } };
    const allowed = [
      'inventoryNumber',
      'yearFrom',
      'status',
      'condition',
      'updatedAt',
      'createdAt',
      'acquisitionDate',
    ];
    return { [allowed.includes(field) ? field : 'updatedAt']: dir };
  }
}
