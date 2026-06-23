import { z } from 'zod';
import type { LocalizedText, Locale } from '../i18n/locales';
import {
  ACQUISITION_METHOD,
  ARTWORK_STATUS,
  AUTHENTICATION_STATUS,
  CONDITION_RATING,
  CURRENCY,
  type AcquisitionMethod,
  type ArtworkStatus,
  type AuthenticationStatus,
  type ConditionRating,
  type Currency,
} from './enums';

/**
 * ArtworkView — the read model returned by the API and produced by the mock
 * repository. Localized fields are already-stored language maps; the UI resolves
 * them against the active locale. This is the contract the grid + detail render.
 */
export interface ArtworkView {
  id: string;
  inventoryNumber: string;
  accessionNumber?: string | null;

  title: LocalizedText;
  description?: LocalizedText;

  artistId?: string | null;
  artistName?: string | null;
  attribution?: string | null;
  authentication: AuthenticationStatus;

  movementName?: string | null;
  categoryName?: string | null;
  techniqueName?: string | null;
  supportName?: string | null;

  dateText?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;

  heightCm?: number | null;
  widthCm?: number | null;
  depthCm?: number | null;
  weightKg?: number | null;
  dimensionsNote?: string | null;
  framed?: boolean;

  status: ArtworkStatus;
  condition: ConditionRating;
  acquisitionMethod: AcquisitionMethod;
  acquisitionDate?: string | null;
  paymentMethod?: string | null;

  collectionId?: string | null;
  collectionName?: string | null;
  collectionColor?: string | null;

  currentLocationId?: string | null;
  currentLocationName?: string | null;
  hasCertificate?: boolean;
  hasInvoice?: boolean;

  /** Present only when the requesting user holds `valuation:read`. */
  valuation?: {
    currency: Currency;
    currentValue?: number | null;
    insuranceValue?: number | null;
    purchasePrice?: number | null;
    valuationSource?: string | null;
  } | null;

  dominantColors: string[];
  tags: string[];
  primaryImageUrl?: string | null;
  thumbnailUrl?: string | null;
  imageCount: number;
  media: { id: string; url: string }[];

  isFavorite: boolean;
  qrSlug?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  /** Opaque cursor for the next page; null when exhausted. */
  nextCursor: string | null;
}

export interface ArtworkQuery {
  search?: string;
  status?: ArtworkStatus[];
  condition?: ConditionRating[];
  collectionId?: string[];
  artistId?: string[];
  yearFrom?: number;
  yearTo?: number;
  favorite?: boolean;
  sort?: { field: string; dir: 'asc' | 'desc' };
  /** Used to resolve localized fields (e.g. title) when sorting by them. */
  locale?: Locale;
  cursor?: string | null;
  limit?: number;
}

/** Zod schema for create/update payloads — reused by API DTOs and web forms. */
export const localizedTextSchema = z.record(z.string()).default({});

export const artworkUpsertSchema = z.object({
  inventoryNumber: z.string().min(1).max(64),
  accessionNumber: z.string().max(64).optional().nullable(),
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  artistId: z.string().cuid().optional().nullable(),
  attribution: z.string().max(256).optional().nullable(),
  authentication: z.enum(AUTHENTICATION_STATUS).default('unverified'),
  categoryId: z.string().cuid().optional().nullable(),
  techniqueId: z.string().cuid().optional().nullable(),
  supportId: z.string().cuid().optional().nullable(),
  movementId: z.string().cuid().optional().nullable(),
  collectionId: z.string().cuid().optional().nullable(),
  dateText: z.string().max(128).optional().nullable(),
  yearFrom: z.number().int().optional().nullable(),
  yearTo: z.number().int().optional().nullable(),
  heightCm: z.number().nonnegative().optional().nullable(),
  widthCm: z.number().nonnegative().optional().nullable(),
  depthCm: z.number().nonnegative().optional().nullable(),
  weightKg: z.number().nonnegative().optional().nullable(),
  status: z.enum(ARTWORK_STATUS).default('draft'),
  condition: z.enum(CONDITION_RATING).default('unknown'),
  acquisitionMethod: z.enum(ACQUISITION_METHOD).default('unknown'),
  acquisitionDate: z.string().datetime().optional().nullable(),
  currency: z.enum(CURRENCY).default('EUR'),
  tags: z.array(z.string()).default([]),
});

export type ArtworkUpsertInput = z.infer<typeof artworkUpsertSchema>;
