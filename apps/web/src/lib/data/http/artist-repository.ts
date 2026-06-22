import { apiFetch } from '@/lib/api/client';
import type { ArtistQuery, ArtistRepository, ArtistUpdateInput, ArtistView, AutoMergeReport, Paginated } from '../artist-repository';

interface BackendArtistRow {
  id: string;
  fullName: string;
  sortName: string | null;
  nationality: string | null;
  birthDate: string | null;
  deathDate: string | null;
  biography: Record<string, string>;
  externalIds: Record<string, string>;
  movement: { id: string; name: string; label?: Record<string, string> } | null;
  thumbnail: string | null;
  notableWorks: string[];
  influencedBy: string[];
  _count?: { artworks: number };
  artworks?: Array<{ id: string }>;
}

function toExternalUrls(externalIds: Record<string, string>) {
  return {
    wikidata: externalIds.wikidata ? `https://www.wikidata.org/wiki/${externalIds.wikidata}` : undefined,
    ulan: externalIds.ulan ? `https://vocab.getty.edu/ulan/${externalIds.ulan}` : undefined,
    viaf: externalIds.viaf ? `https://viaf.org/viaf/${externalIds.viaf}` : undefined,
  };
}

function toArtistView(row: BackendArtistRow): ArtistView {
  return {
    id: row.id,
    fullName: row.fullName,
    sortName: row.sortName ?? row.fullName,
    nationality: row.nationality ?? undefined,
    birthDate: row.birthDate ?? undefined,
    deathDate: row.deathDate ?? undefined,
    biography: row.biography ?? {},
    movement: row.movement ?? undefined,
    externalIds: row.externalIds ?? {},
    externalUrls: toExternalUrls(row.externalIds ?? {}),
    thumbnail: row.thumbnail ?? undefined,
    notableWorks: row.notableWorks ?? [],
    influencedBy: row.influencedBy ?? [],
    artworkCount: row._count?.artworks ?? row.artworks?.length ?? 0,
    artworkIds: row.artworks?.map((a) => a.id) ?? [],
  };
}

export class HttpArtistRepository implements ArtistRepository {
  async list(query: ArtistQuery): Promise<Paginated<ArtistView>> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    const res = await apiFetch<{ data: BackendArtistRow[]; nextCursor: string | null }>(
      `/artists${qs ? `?${qs}` : ''}`,
    );
    return { data: res.data.map(toArtistView), nextCursor: res.nextCursor };
  }

  async getById(id: string): Promise<ArtistView | null> {
    try {
      const row = await apiFetch<BackendArtistRow>(`/artists/${id}`);
      return toArtistView(row);
    } catch {
      return null;
    }
  }

  async add(artist: ArtistView): Promise<ArtistView> {
    const row = await apiFetch<BackendArtistRow>('/artists', {
      method: 'POST',
      body: JSON.stringify({
        fullName: artist.fullName,
        sortName: artist.sortName,
        nationality: artist.nationality,
        birthDate: artist.birthDate,
        deathDate: artist.deathDate,
      }),
    });
    // Live-enrich immediately so biography/external IDs are populated server-side too.
    try {
      await apiFetch(`/artists/${row.id}/enrich`, { method: 'POST' });
      const enriched = await apiFetch<BackendArtistRow>(`/artists/${row.id}`);
      return toArtistView(enriched);
    } catch {
      return toArtistView(row);
    }
  }

  async update(id: string, patch: ArtistUpdateInput): Promise<ArtistView> {
    const row = await apiFetch<BackendArtistRow>(`/artists/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    return toArtistView(row);
  }

  async remove(id: string, force?: boolean): Promise<void> {
    await apiFetch(`/artists/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
  }

  async enrich(id: string): Promise<ArtistView> {
    await apiFetch(`/artists/${id}/enrich`, { method: 'POST' });
    const row = await apiFetch<BackendArtistRow>(`/artists/${id}`);
    return toArtistView(row);
  }

  async autoMerge(): Promise<AutoMergeReport> {
    return apiFetch<AutoMergeReport>('/artists/merge/auto', { method: 'POST' });
  }
}
