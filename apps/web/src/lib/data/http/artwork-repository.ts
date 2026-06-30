import type { ArtworkQuery, ArtworkView, Paginated } from '@arterio/shared';
import { apiFetch, API_BASE_URL, ApiError, toMediaUrl } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import type { ArtworkFacets, ArtworkRepository, DashboardStats } from '../types';

/** Resolves the relative media paths returned by the API to absolute URLs. */
function fixMedia(a: ArtworkView): ArtworkView {
  return {
    ...a,
    primaryImageUrl: toMediaUrl(a.primaryImageUrl),
    thumbnailUrl: toMediaUrl(a.thumbnailUrl),
    media: a.media.map((m) => ({ ...m, url: toMediaUrl(m.url) })),
  };
}

function toQueryString(query: ArtworkQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.collectionId?.length) params.set('collectionId', query.collectionId.join(','));
  if (query.artistId?.length) params.set('artistId', query.artistId.join(','));
  if (query.exhibitionId) params.set('exhibitionId', query.exhibitionId);
  if (query.locationId) params.set('locationId', query.locationId);
  if (query.favorite) params.set('favorite', 'true');
  if (query.sort) {
    params.set('sortField', query.sort.field);
    params.set('sortDir', query.sort.dir);
  }
  if (query.locale) params.set('locale', query.locale);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  return params.toString();
}

export class HttpArtworkRepository implements ArtworkRepository {
  async list(query: ArtworkQuery): Promise<Paginated<ArtworkView>> {
    const qs = toQueryString(query);
    const page = await apiFetch<Paginated<ArtworkView>>(`/artworks${qs ? `?${qs}` : ''}`);
    return { ...page, items: page.items.map(fixMedia) };
  }

  async getById(id: string): Promise<ArtworkView | null> {
    try {
      const a = await apiFetch<ArtworkView>(`/artworks/${id}`);
      return fixMedia(a);
    } catch {
      return null;
    }
  }

  async facets(): Promise<ArtworkFacets> {
    return apiFetch<ArtworkFacets>('/artworks/facets/all');
  }

  async stats(): Promise<DashboardStats> {
    const [{ items, total }, facets] = await Promise.all([
      this.list({ limit: 200 }),
      this.facets(),
    ]);

    const totalInsuredValue = items.reduce((sum, a) => sum + (a.valuation?.insuranceValue ?? 0), 0);
    const byCollection = facets.collection.map((c) => ({
      id: c.value,
      name: c.label,
      color: c.color ?? '#888',
      count: c.count,
      value: items
        .filter((a) => a.collectionId === c.value)
        .reduce((s, a) => s + (a.valuation?.insuranceValue ?? 0), 0),
    }));

    return {
      totalArtworks: total,
      totalInsuredValue,
      currency: 'EUR',
      collections: facets.totalCollections ?? facets.collection.length,
      artists: facets.totalArtists ?? facets.artist.length,
      onLoan: items.filter((a) => a.status === 'on_loan').length,
      onExhibition: items.filter((a) => a.status === 'on_exhibition').length,
      needsRestoration: items.filter(
        (a) => a.status === 'in_restoration' || a.condition === 'poor' || a.condition === 'critical',
      ).length,
      byStatus: facets.status.map((s) => ({ key: s.value, count: s.count })),
      byCollection,
      byCondition: facets.condition.map((c) => ({ key: c.value, count: c.count })),
      recentlyAdded: [...items]
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 6),
      alerts: [],
    };
  }

  async toggleFavorite(id: string, value: boolean): Promise<void> {
    await apiFetch(`/artworks/${id}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    });
  }

  async update(id: string, patch: Partial<ArtworkView>): Promise<ArtworkView> {
    const a = await apiFetch<ArtworkView>(`/artworks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return fixMedia(a);
  }

  async create(input: Partial<ArtworkView>): Promise<ArtworkView> {
    const a = await apiFetch<ArtworkView>('/artworks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return fixMedia(a);
  }

  async remove(id: string): Promise<void> {
    await apiFetch(`/artworks/${id}`, { method: 'DELETE' });
  }

  async uploadMedia(id: string, file: File): Promise<ArtworkView> {
    const { accessToken } = useAuthStore.getState();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE_URL}/artworks/${id}/media`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, body.message ?? res.statusText);
    }
    return fixMedia(await res.json());
  }

  async attachMediaFromUrl(id: string, url: string): Promise<ArtworkView> {
    const a = await apiFetch<ArtworkView>(`/artworks/${id}/media/from-url`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    return fixMedia(a);
  }

  async removeMedia(id: string, mediaId: string): Promise<ArtworkView> {
    const a = await apiFetch<ArtworkView>(`/artworks/${id}/media/${mediaId}`, { method: 'DELETE' });
    return fixMedia(a);
  }
}
