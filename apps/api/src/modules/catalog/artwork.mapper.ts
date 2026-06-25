import type { ArtworkView, LocalizedText, Currency } from '@arterio/shared';
import type { CryptoService } from '../../core/crypto/crypto.service';

/** Prisma artwork shape with the relations we select. */
type ArtworkWithRelations = {
  id: string;
  inventoryNumber: string;
  accessionNumber: string | null;
  title: unknown;
  description: unknown;
  artistId: string | null;
  attribution: string | null;
  authentication: string;
  dateText: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  heightCm: number | null;
  widthCm: number | null;
  depthCm: number | null;
  weightKg: number | null;
  dimensionsNote: string | null;
  framed: boolean;
  hasCertificate: boolean;
  hasInvoice: boolean;
  status: string;
  condition: string;
  acquisitionMethod: string;
  acquisitionDate: Date | null;
  paymentMethod: string | null;
  collectionId: string | null;
  currentLocationId: string | null;
  dominantColors: string[];
  isFavorite: boolean;
  qrSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
  artist: { fullName: string } | null;
  collection: { name: string; color: string | null } | null;
  technique: { name: string } | null;
  support: { name: string } | null;
  movement: { name: string } | null;
  category: { name: string } | null;
  currentLocation: { name: string } | null;
  valuation: {
    currency: string;
    purchasePriceEnc: string | null;
    currentValueEnc: string | null;
    insuranceValueEnc: string | null;
    valuationSource: string | null;
  } | null;
  tags: { tag: { name: string } }[];
  media?: { id: string; storageKey: string }[];
  _count?: { media: number };
};

export function toArtworkView(
  a: ArtworkWithRelations,
  opts: { crypto: CryptoService; canViewValuation: boolean },
): ArtworkView {
  // Relative paths, not absolute URLs: the API's own host (often `localhost`
  // server-side, or a different port than the web app) is meaningless to the
  // browser. The frontend resolves these against the host it actually used to
  // reach the API — see apps/web/src/lib/api/client.ts.
  const imageUrl = a.media?.[0] ? `/uploads/${a.media[0].storageKey}` : null;
  const media = (a.media ?? []).map((m) => ({ id: m.id, url: `/uploads/${m.storageKey}` }));
  return {
    id: a.id,
    inventoryNumber: a.inventoryNumber,
    accessionNumber: a.accessionNumber,
    title: (a.title ?? {}) as LocalizedText,
    description: (a.description ?? {}) as LocalizedText,
    artistId: a.artistId,
    artistName: a.artist?.fullName ?? null,
    attribution: a.attribution,
    authentication: a.authentication as ArtworkView['authentication'],
    movementName: a.movement?.name ?? null,
    categoryName: a.category?.name ?? null,
    techniqueName: a.technique?.name ?? null,
    supportName: a.support?.name ?? null,
    dateText: a.dateText,
    yearFrom: a.yearFrom,
    yearTo: a.yearTo,
    heightCm: a.heightCm,
    widthCm: a.widthCm,
    depthCm: a.depthCm,
    weightKg: a.weightKg,
    dimensionsNote: a.dimensionsNote,
    framed: a.framed,
    status: a.status as ArtworkView['status'],
    condition: a.condition as ArtworkView['condition'],
    acquisitionMethod: a.acquisitionMethod as ArtworkView['acquisitionMethod'],
    acquisitionDate: a.acquisitionDate?.toISOString() ?? null,
    paymentMethod: a.paymentMethod,
    collectionId: a.collectionId,
    collectionName: a.collection?.name ?? null,
    collectionColor: a.collection?.color ?? null,
    currentLocationId: a.currentLocationId,
    currentLocationName: a.currentLocation?.name ?? null,
    hasCertificate: a.hasCertificate,
    hasInvoice: a.hasInvoice,
    valuation:
      a.valuation && opts.canViewValuation
        ? {
            currency: a.valuation.currency as Currency,
            purchasePrice: opts.crypto.decryptNumber(a.valuation.purchasePriceEnc),
            currentValue: opts.crypto.decryptNumber(a.valuation.currentValueEnc),
            insuranceValue: opts.crypto.decryptNumber(a.valuation.insuranceValueEnc),
            valuationSource: a.valuation.valuationSource,
          }
        : null,
    dominantColors: a.dominantColors ?? [],
    tags: a.tags.map((t) => t.tag.name),
    primaryImageUrl: imageUrl,
    thumbnailUrl: imageUrl,
    imageCount: a._count?.media ?? 0,
    media,
    isFavorite: a.isFavorite,
    qrSlug: a.qrSlug,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export const ARTWORK_INCLUDE = {
  artist: { select: { fullName: true } },
  collection: { select: { name: true, color: true } },
  technique: { select: { name: true } },
  support: { select: { name: true } },
  movement: { select: { name: true } },
  category: { select: { name: true } },
  currentLocation: { select: { name: true } },
  valuation: true,
  tags: { include: { tag: { select: { name: true } } } },
  media: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, storageKey: true } },
  _count: { select: { media: true } },
} as const;
