import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ArtistEnrichmentService } from './artist-enrichment.service';
import type { AuthUser } from '../../common/types';
import type { CreateArtistDto, ListArtistsQueryDto, UpdateArtistDto } from './dto';
import type { Locale } from '@arterio/shared';

@Injectable()
export class ArtistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: ArtistEnrichmentService,
  ) {}

  async list(user: AuthUser, q: ListArtistsQueryDto) {
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const items = await this.prisma.artist.findMany({
      where: {
        organizationId: user.organizationId,
        ...(q.search ? { fullName: { contains: q.search } } : {}),
      },
      include: { movement: true, _count: { select: { artworks: true } } },
      orderBy: { sortName: 'asc' },
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    return {
      data,
      nextCursor: hasMore ? data[data.length - 1]?.id : null,
    };
  }

  async getById(user: AuthUser, id: string) {
    const artist = await this.prisma.artist.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        movement: true,
        artworks: {
          take: 12,
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, yearFrom: true, technique: { select: { name: true } } },
        },
        _count: { select: { artworks: true } },
      },
    });
    if (!artist) throw new NotFoundException('Artist not found');
    return artist;
  }

  async create(user: AuthUser, dto: CreateArtistDto) {
    const artist = await this.prisma.artist.create({
      data: {
        organizationId: user.organizationId,
        fullName: dto.fullName,
        sortName: dto.sortName ?? this.toSortName(dto.fullName),
        nationality: dto.nationality,
        birthDate: dto.birthDate,
        deathDate: dto.deathDate,
        movementId: dto.movementId,
        biography: {},
        externalIds: {},
      },
    });

    // Fire-and-forget enrichment in the background
    this.triggerEnrichment(user, artist.id, artist.fullName).catch(() => {/* no-op */});

    return artist;
  }

  async update(user: AuthUser, id: string, dto: UpdateArtistDto) {
    const artist = await this.assertExists(user, id);

    if (dto.resetEnrichment) {
      return this.prisma.artist.update({
        where: { id },
        data: { biography: {}, thumbnail: null, movementId: null, externalIds: {}, notableWorks: [], influencedBy: [] },
      });
    }

    return this.prisma.artist.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && {
          fullName: dto.fullName,
          sortName: dto.sortName ?? this.toSortName(dto.fullName),
        }),
        ...(dto.nationality !== undefined && { nationality: dto.nationality || null }),
        ...(dto.birthDate !== undefined && { birthDate: dto.birthDate || null }),
        ...(dto.deathDate !== undefined && { deathDate: dto.deathDate || null }),
        ...(dto.movementId !== undefined && { movementId: dto.movementId || null }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail || null }),
        ...(dto.biography !== undefined && {
          biography: { ...(artist.biography as Record<string, string>), ...dto.biography },
        }),
      },
    });
  }

  async remove(user: AuthUser, id: string, force = false) {
    const artist = await this.prisma.artist.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { _count: { select: { artworks: true } } },
    });
    if (!artist) throw new NotFoundException('Artist not found');
    if (artist._count.artworks > 0 && !force) {
      throw new BadRequestException(
        `Cannot delete "${artist.fullName}" — ${artist._count.artworks} artwork(s) still reference it`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.artwork.updateMany({ where: { artistId: id }, data: { artistId: null } }),
      this.prisma.artist.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  /**
   * Manually trigger (or re-trigger) Wikipedia + Wikidata enrichment.
   * Results are stored back in the DB so subsequent calls are instant.
   */
  async enrich(user: AuthUser, id: string, locale?: Locale) {
    const artist = await this.assertExists(user, id);
    const result = await this.enrichment.enrich(artist.fullName, user.organizationId);

    // Merge biographies into existing JSON (don't overwrite manually edited ones)
    const existing = (artist.biography as Record<string, string>) ?? {};
    const merged: Record<string, string> = { ...result.biographies, ...existing };
    // But respect manually-empty values: only add if key didn't exist
    for (const [lang, text] of Object.entries(result.biographies ?? {})) {
      if (!existing[lang]) merged[lang] = text as string;
    }

    const externalIds: Record<string, string> = {
      ...((artist.externalIds as Record<string, string>) ?? {}),
    };
    if (result.wikidata?.qid) externalIds['wikidata'] = result.wikidata.qid;
    if (result.wikidata?.ulanId) externalIds['ulan'] = result.wikidata.ulanId;
    if (result.wikidata?.viafId) externalIds['viaf'] = result.wikidata.viafId;
    if (result.fallback) {
      externalIds['source'] = result.fallback.source;
      if (result.fallback.sourceUrl) externalIds[result.fallback.source] = result.fallback.sourceUrl;
    }

    const movementId =
      artist.movementId ??
      (await this.resolveMovementId(user, result.wikidata?.movement, result.wikidata?.movementLabels));

    await this.prisma.artist.update({
      where: { id },
      data: {
        biography: merged,
        externalIds,
        thumbnail: result.thumbnail ?? result.wikidata?.imageUrl ?? result.fallback?.imageUrl ?? artist.thumbnail,
        notableWorks: result.wikidata?.notableWorkIds?.length
          ? result.wikidata.notableWorkIds
          : (artist.notableWorks as string[] | undefined) ?? [],
        influencedBy: result.wikidata?.influencedByLabels?.length
          ? result.wikidata.influencedByLabels
          : (artist.influencedBy as string[] | undefined) ?? [],
        ...(movementId ? { movementId } : {}),
        ...(result.wikidata?.nationality && this.looksLikeRawQid(artist.nationality)
          ? { nationality: result.wikidata.nationality }
          : result.fallback?.nationality && this.looksLikeRawQid(artist.nationality)
            ? { nationality: result.fallback.nationality }
            : {}),
        ...(result.wikidata?.birthDate && !artist.birthDate
          ? { birthDate: result.wikidata.birthDate }
          : result.fallback?.birthDate && !artist.birthDate
            ? { birthDate: result.fallback.birthDate }
            : {}),
        ...(result.wikidata?.deathDate && !artist.deathDate
          ? { deathDate: result.wikidata.deathDate }
          : result.fallback?.deathDate && !artist.deathDate
            ? { deathDate: result.fallback.deathDate }
            : {}),
      },
    });

    return {
      enriched: true,
      wikidata: result.wikidata,
      fallback: result.fallback ?? null,
      biographiesAdded: Object.keys(result.biographies ?? {}).length,
      thumbnail: result.thumbnail,
      externalUrls: result.externalUrls,
    };
  }

  /** Finds or creates the ArtMovement matching a Wikidata movement label, with its name in every supported locale. */
  private async resolveMovementId(
    user: AuthUser,
    movementLabel: string | undefined,
    movementLabels?: Partial<Record<Locale, string>>,
  ): Promise<string | undefined> {
    if (!movementLabel) return undefined;
    const label = { en: movementLabel, ...movementLabels };
    const movement = await this.prisma.artMovement.upsert({
      where: { organizationId_name: { organizationId: user.organizationId, name: movementLabel } },
      create: { organizationId: user.organizationId, name: movementLabel, label },
      update: { label },
    });
    return movement.id;
  }

  /**
   * Finds near-duplicate artist records (same person, messy data entry —
   * extra co-signers, stray letters, leaked technique words) and merges them.
   *
   * A group only auto-merges when a quick Wikidata lookup on the shared
   * "core name" resolves to exactly one unambiguous art-world person — if the
   * name is ambiguous (several distinct homonyms) the group is left alone and
   * reported, never guessed. Each merge carries a confidence score so the
   * decision is auditable, not a black box.
   */
  async autoMergeDuplicates(user: AuthUser) {
    const artists = await this.prisma.artist.findMany({
      where: { organizationId: user.organizationId },
      include: { _count: { select: { artworks: true } } },
    });

    const groups = new Map<string, typeof artists>();
    for (const artist of artists) {
      const key = this.coreNameKey(artist.fullName);
      const list = groups.get(key) ?? [];
      list.push(artist);
      groups.set(key, list);
    }

    const merged: Array<{ canonicalName: string; mergedNames: string[]; confidence: number; wikidataQid: string | null }> = [];
    const flagged: Array<{ names: string[]; reason: string }> = [];

    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const coreName = members
        .slice()
        .sort((a, b) => a.fullName.length - b.fullName.length)[0]!
        .fullName.split(/\s+/)
        .slice(0, 2)
        .join(' ');

      const match = await this.enrichment.checkArtMatch(coreName);

      if (match?.ambiguous) {
        flagged.push({
          names: members.map((m) => m.fullName),
          reason: `"${coreName}" matches several distinct art-world homonyms on Wikidata — needs manual review`,
        });
        continue;
      }
      if (!match) {
        flagged.push({
          names: members.map((m) => m.fullName),
          reason: `"${coreName}" has no Wikidata corroboration — merge needs manual confirmation`,
        });
        continue;
      }

      const confidence = match.exact ? 90 : 80;
      const canonical = members.reduce((best, m) =>
        m._count.artworks > best._count.artworks ? m : best,
      );
      const duplicates = members.filter((m) => m.id !== canonical.id);

      await this.prisma.$transaction([
        this.prisma.artwork.updateMany({
          where: { artistId: { in: duplicates.map((d) => d.id) } },
          data: { artistId: canonical.id },
        }),
        this.prisma.artist.update({
          where: { id: canonical.id },
          data: {
            fullName: match.label,
            externalIds: {
              ...((canonical.externalIds as Record<string, string>) ?? {}),
              wikidata: match.qid,
            },
          },
        }),
        this.prisma.artist.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } }),
      ]);

      merged.push({
        canonicalName: match.label,
        mergedNames: members.map((m) => m.fullName),
        confidence,
        wikidataQid: match.qid,
      });
      this.triggerEnrichment(user, canonical.id, match.label).catch(() => {/* no-op */});
      void key;
    }

    return { merged, flagged };
  }

  private coreNameKey(fullName: string): string {
    // Split on whitespace AND on a trailing "+" glued to a word (e.g. "Pierre+ Yves") —
    // the "+ co-signer" convention in the source data doesn't always have a leading space.
    const tokens = fullName.trim().split(/\s+|(?<=\S)\+/).map((t) => t.trim()).filter(Boolean);
    const core = tokens.slice(0, 2);
    // Sort the two name tokens alphabetically so "Lastname Firstname" and a
    // previously-merged "Firstname Lastname" (after a Wikidata-label rename)
    // land in the same group regardless of word order.
    const normalized = core
      .map((t) =>
        t
          .toUpperCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, ''),
      )
      .sort();
    return normalized.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async assertExists(user: AuthUser, id: string) {
    const artist = await this.prisma.artist.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!artist) throw new NotFoundException('Artist not found');
    return artist;
  }

  private async triggerEnrichment(user: AuthUser, id: string, fullName: string) {
    const result = await this.enrichment.enrich(fullName, user.organizationId);
    if (!result.wikidata && !result.fallback && !Object.keys(result.biographies ?? {}).length) return;

    const externalIds: Record<string, string> = {};
    if (result.wikidata?.qid) externalIds['wikidata'] = result.wikidata.qid;
    if (result.wikidata?.ulanId) externalIds['ulan'] = result.wikidata.ulanId;
    if (result.wikidata?.viafId) externalIds['viaf'] = result.wikidata.viafId;
    if (result.fallback) {
      externalIds['source'] = result.fallback.source;
      if (result.fallback.sourceUrl) externalIds[result.fallback.source] = result.fallback.sourceUrl;
    }
    const movementId = await this.resolveMovementId(user, result.wikidata?.movement, result.wikidata?.movementLabels);

    await this.prisma.artist.update({
      where: { id },
      data: {
        biography: result.biographies as object,
        externalIds,
        thumbnail: result.thumbnail ?? result.wikidata?.imageUrl ?? result.fallback?.imageUrl,
        notableWorks: result.wikidata?.notableWorkIds ?? [],
        influencedBy: result.wikidata?.influencedByLabels ?? [],
        ...(movementId ? { movementId } : {}),
        ...(result.wikidata?.nationality
          ? { nationality: result.wikidata.nationality }
          : result.fallback?.nationality
            ? { nationality: result.fallback.nationality }
            : {}),
        ...(result.wikidata?.birthDate
          ? { birthDate: result.wikidata.birthDate }
          : result.fallback?.birthDate
            ? { birthDate: result.fallback.birthDate }
            : {}),
        ...(result.wikidata?.deathDate
          ? { deathDate: result.wikidata.deathDate }
          : result.fallback?.deathDate
            ? { deathDate: result.fallback.deathDate }
            : {}),
      },
    });
  }

  private toSortName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return fullName;
    const last = parts.pop()!;
    return `${last}, ${parts.join(' ')}`;
  }

  /** True when empty, or a leftover raw Wikidata QID from a since-fixed SPARQL bug — both are safe to overwrite. */
  private looksLikeRawQid(value: string | null): boolean {
    return !value || /^Q\d+$/.test(value);
  }
}
