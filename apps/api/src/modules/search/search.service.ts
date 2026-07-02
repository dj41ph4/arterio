import { Injectable } from '@nestjs/common';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../common/types';

export interface SearchResults {
  artworks: Array<{ id: string; title: string; inventoryNumber: string; artist: string | null; thumbnailUrl: string | null; dominantColors: string[] }>;
  artists: Array<{ id: string; name: string; nationality: string | null; thumbnailUrl: string | null }>;
  documents: Array<{ id: string; title: string; type: string; artworkId: string | null; matchedInOcr: boolean }>;
  exhibitions: Array<{ id: string; title: string; venue: string | null; status: string }>;
}

const PER_GROUP = 5;

/**
 * Unified instant search behind the command palette: artworks, artists,
 * documents (title + OCR text) and exhibitions in one round-trip. Title Json
 * columns can't be LIKE'd on SQLite — candidate rows are matched in memory
 * with the same capped-scan approach as the artwork list.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthUser, q: string, locale: Locale): Promise<SearchResults> {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return { artworks: [], artists: [], documents: [], exhibitions: [] };
    const org = user.organizationId;

    const [artworkRows, artistRows, documentRows, exhibitionRows] = await Promise.all([
      this.prisma.artwork.findMany({
        where: { organizationId: org, deletedAt: null },
        select: {
          id: true,
          title: true,
          inventoryNumber: true,
          attribution: true,
          dominantColors: true,
          artist: { select: { fullName: true } },
          media: { orderBy: { sortOrder: 'asc' }, take: 1, select: { storageKey: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      }),
      this.prisma.artist.findMany({
        where: { organizationId: org, OR: [{ fullName: { contains: q } }, { nationality: { contains: q } }] },
        select: { id: true, fullName: true, nationality: true, thumbnail: true },
        take: PER_GROUP,
      }),
      this.prisma.document.findMany({
        where: { organizationId: org, OR: [{ title: { contains: q } }, { ocrText: { contains: q } }] },
        select: { id: true, title: true, type: true, artworkId: true, ocrText: true },
        orderBy: { createdAt: 'desc' },
        take: PER_GROUP,
      }),
      this.prisma.exhibition.findMany({
        where: { organizationId: org },
        select: { id: true, title: true, venue: true, status: true },
        orderBy: { startDate: 'desc' },
        take: 200,
      }),
    ]);

    const matchesJson = (json: unknown): boolean =>
      Object.values((json ?? {}) as Record<string, string>).some((v) => String(v).toLowerCase().includes(needle));

    const artworks = artworkRows
      .filter(
        (a) =>
          matchesJson(a.title) ||
          a.inventoryNumber.toLowerCase().includes(needle) ||
          (a.attribution ?? '').toLowerCase().includes(needle) ||
          (a.artist?.fullName ?? '').toLowerCase().includes(needle),
      )
      .slice(0, PER_GROUP)
      .map((a) => ({
        id: a.id,
        title: resolveLocalized((a.title ?? {}) as Record<string, string>, locale) || a.inventoryNumber,
        inventoryNumber: a.inventoryNumber,
        artist: a.artist?.fullName ?? a.attribution ?? null,
        thumbnailUrl: a.media[0] ? `/uploads/${a.media[0].storageKey}` : null,
        dominantColors: (a.dominantColors as string[] | null) ?? [],
      }));

    return {
      artworks,
      artists: artistRows.map((a) => ({ id: a.id, name: a.fullName, nationality: a.nationality, thumbnailUrl: a.thumbnail })),
      documents: documentRows.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        artworkId: d.artworkId,
        matchedInOcr: !d.title.toLowerCase().includes(needle) && Boolean(d.ocrText?.toLowerCase().includes(needle)),
      })),
      exhibitions: exhibitionRows
        .filter((e) => matchesJson(e.title) || (e.venue ?? '').toLowerCase().includes(needle))
        .slice(0, PER_GROUP)
        .map((e) => ({
          id: e.id,
          title: resolveLocalized((e.title ?? {}) as Record<string, string>, locale),
          venue: e.venue,
          status: e.status,
        })),
    };
  }
}
