import type { ArtworkQuery, ArtworkView, Paginated } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import type { ArtworkFacets, ArtworkRepository, DashboardStats } from '../types';
import { MOCK_ARTWORKS, MOCK_ARTISTS, MOCK_COLLECTIONS } from './dataset';

// Mutable working copy so favorite/edit mutations persist within the session.
let DATA: ArtworkView[] = [...MOCK_ARTWORKS];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function matches(a: ArtworkView, q: ArtworkQuery): boolean {
  if (q.search) {
    const needle = q.search.toLowerCase();
    const haystack = [
      a.inventoryNumber,
      resolveLocalized(a.title, 'en'),
      a.artistName ?? '',
      a.techniqueName ?? '',
      a.collectionName ?? '',
      a.dateText ?? '',
      ...a.tags,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (q.status?.length && !q.status.includes(a.status)) return false;
  if (q.condition?.length && !q.condition.includes(a.condition)) return false;
  if (q.collectionId?.length && !q.collectionId.includes(a.collectionId ?? '')) return false;
  if (q.artistId?.length && !q.artistId.includes(a.artistId ?? '')) return false;
  if (q.favorite && !a.isFavorite) return false;
  if (q.yearFrom != null && (a.yearFrom ?? 0) < q.yearFrom) return false;
  if (q.yearTo != null && (a.yearFrom ?? 9999) > q.yearTo) return false;
  return true;
}

function compare(a: ArtworkView, b: ArtworkView, field: string): number {
  const get = (x: ArtworkView): string | number => {
    switch (field) {
      case 'title':
        return resolveLocalized(x.title, 'en');
      case 'artistName':
        return x.artistName ?? '';
      case 'yearFrom':
        return x.yearFrom ?? 0;
      case 'value':
        return x.valuation?.currentValue ?? 0;
      case 'insuranceValue':
        return x.valuation?.insuranceValue ?? 0;
      case 'updatedAt':
        return x.updatedAt;
      case 'status':
        return x.status;
      case 'condition':
        return x.condition;
      default:
        return x.inventoryNumber;
    }
  };
  const va = get(a);
  const vb = get(b);
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb));
}

export class MockArtworkRepository implements ArtworkRepository {
  async list(query: ArtworkQuery): Promise<Paginated<ArtworkView>> {
    await delay(180);
    let rows = DATA.filter((a) => matches(a, query));

    if (query.sort) {
      const dir = query.sort.dir === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => compare(a, b, query.sort!.field) * dir);
    }

    const total = rows.length;
    const limit = query.limit ?? 50;
    const start = query.cursor ? Number(query.cursor) : 0;
    const slice = rows.slice(start, start + limit);
    const nextCursor = start + limit < total ? String(start + limit) : null;

    return { items: slice, total, nextCursor };
  }

  async getById(id: string): Promise<ArtworkView | null> {
    await delay(120);
    return DATA.find((a) => a.id === id) ?? null;
  }

  async facets(): Promise<ArtworkFacets> {
    await delay(60);
    const countBy = (key: (a: ArtworkView) => string | null | undefined) => {
      const map = new Map<string, number>();
      for (const a of DATA) {
        const k = key(a);
        if (!k) continue;
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return map;
    };

    const statusMap = countBy((a) => a.status);
    const conditionMap = countBy((a) => a.condition);
    const collectionMap = countBy((a) => a.collectionId);
    const artistMap = countBy((a) => a.artistId);

    return {
      status: [...statusMap].map(([value, count]) => ({ value, label: value, count })),
      condition: [...conditionMap].map(([value, count]) => ({ value, label: value, count })),
      collection: MOCK_COLLECTIONS.filter((c) => collectionMap.has(c.id)).map((c) => ({
        value: c.id,
        label: c.name,
        count: collectionMap.get(c.id) ?? 0,
        color: c.color,
      })),
      artist: MOCK_ARTISTS.filter((a) => artistMap.has(a.id))
        .map((a) => ({ value: a.id, label: a.name, count: artistMap.get(a.id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async stats(): Promise<DashboardStats> {
    await delay(140);
    const totalInsuredValue = DATA.reduce(
      (sum, a) => sum + (a.valuation?.insuranceValue ?? 0),
      0,
    );
    const byStatusMap = new Map<string, number>();
    const byConditionMap = new Map<string, number>();
    for (const a of DATA) {
      byStatusMap.set(a.status, (byStatusMap.get(a.status) ?? 0) + 1);
      byConditionMap.set(a.condition, (byConditionMap.get(a.condition) ?? 0) + 1);
    }

    const byCollection = MOCK_COLLECTIONS.map((c) => {
      const rows = DATA.filter((a) => a.collectionId === c.id);
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        count: rows.length,
        value: rows.reduce((s, a) => s + (a.valuation?.insuranceValue ?? 0), 0),
      };
    }).filter((c) => c.count > 0);

    const recentlyAdded = [...DATA]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 6);

    const now = Date.now();
    const alerts: DashboardStats['alerts'] = [
      {
        id: 'al1',
        type: 'insurance_expiring',
        severity: 'critical',
        title: 'Insurance policy expires in 9 days',
        artworkId: DATA[3]?.id,
        dueAt: new Date(now + 9 * 864e5).toISOString(),
      },
      {
        id: 'al2',
        type: 'loan_due',
        severity: 'warning',
        title: 'Outgoing loan returns next week',
        artworkId: DATA[7]?.id,
        dueAt: new Date(now + 6 * 864e5).toISOString(),
      },
      {
        id: 'al3',
        type: 'restoration_due',
        severity: 'info',
        title: 'Condition review scheduled',
        artworkId: DATA[12]?.id,
        dueAt: new Date(now + 21 * 864e5).toISOString(),
      },
    ];

    return {
      totalArtworks: DATA.length,
      totalInsuredValue,
      currency: 'EUR',
      collections: byCollection.length,
      artists: new Set(DATA.map((a) => a.artistId)).size,
      onLoan: DATA.filter((a) => a.status === 'on_loan').length,
      onExhibition: DATA.filter((a) => a.status === 'on_exhibition').length,
      needsRestoration: DATA.filter(
        (a) => a.status === 'in_restoration' || a.condition === 'poor' || a.condition === 'critical',
      ).length,
      byStatus: [...byStatusMap].map(([key, count]) => ({ key, count })),
      byCollection,
      byCondition: [...byConditionMap].map(([key, count]) => ({ key, count })),
      recentlyAdded,
      alerts,
    };
  }

  async toggleFavorite(id: string, value: boolean): Promise<void> {
    await delay(60);
    DATA = DATA.map((a) => (a.id === id ? { ...a, isFavorite: value } : a));
  }

  async update(id: string, patch: Partial<ArtworkView>): Promise<ArtworkView> {
    await delay(120);
    let updated: ArtworkView | undefined;
    DATA = DATA.map((a) => {
      if (a.id !== id) return a;
      updated = { ...a, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    if (!updated) throw new Error('Artwork not found');
    return updated;
  }

  async create(input: Partial<ArtworkView>): Promise<ArtworkView> {
    await delay(200);
    const now = new Date().toISOString();
    const id = `art-${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    const created: ArtworkView = {
      id,
      inventoryNumber: input.inventoryNumber ?? `INV-${String(DATA.length + 1).padStart(4, '0')}`,
      title: input.title ?? { en: 'Untitled' },
      description: input.description ?? {},
      artistId: input.artistId ?? null,
      artistName: input.artistName ?? null,
      attribution: input.attribution ?? null,
      authentication: input.authentication ?? 'unverified',
      movementName: input.movementName ?? null,
      categoryName: input.categoryName ?? null,
      techniqueName: input.techniqueName ?? null,
      supportName: input.supportName ?? null,
      dateText: input.dateText ?? null,
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
      heightCm: input.heightCm ?? null,
      widthCm: input.widthCm ?? null,
      depthCm: input.depthCm ?? null,
      weightKg: input.weightKg ?? null,
      status: input.status ?? 'draft',
      condition: input.condition ?? 'unknown',
      acquisitionMethod: input.acquisitionMethod ?? 'unknown',
      acquisitionDate: input.acquisitionDate ?? null,
      collectionId: input.collectionId ?? null,
      collectionName: input.collectionName ?? null,
      collectionColor: input.collectionColor ?? null,
      currentLocationName: input.currentLocationName ?? null,
      valuation: input.valuation ?? null,
      dominantColors: input.dominantColors ?? [],
      tags: input.tags ?? [],
      primaryImageUrl: input.primaryImageUrl ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      imageCount: input.imageCount ?? 0,
      isFavorite: false,
      qrSlug: null,
      createdAt: now,
      updatedAt: now,
    };
    DATA = [created, ...DATA];
    return created;
  }

  async remove(id: string): Promise<void> {
    await delay(120);
    DATA = DATA.filter((a) => a.id !== id);
  }

  async uploadMedia(id: string, file: File): Promise<ArtworkView> {
    await delay(200);
    const artwork = DATA.find((a) => a.id === id);
    if (!artwork) throw new Error('Artwork not found');
    const url = URL.createObjectURL(file);
    artwork.primaryImageUrl = url;
    artwork.thumbnailUrl = url;
    artwork.imageCount += 1;
    return artwork;
  }
}
