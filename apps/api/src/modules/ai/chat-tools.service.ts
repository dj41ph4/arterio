import { Injectable } from '@nestjs/common';
import type { Locale } from '@arterio/shared';
import { ARTWORK_STATUS, CONDITION_RATING, PERMISSIONS, resolveLocalized } from '@arterio/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { AuthUser } from '../../common/types';
import type { ChatToolCall, ChatToolDef } from './ai.types';

/** What one executed tool call feeds back: `payload` goes to the model as the tool message, `summary` goes to the UI trace. */
export interface ExecutedTool {
  summary: string;
  payload: unknown;
}

/** Filters shared by search_artworks / artwork_stats / sum_valuation — every value is validated server-side, never trusted. */
interface ArtworkFilters {
  text?: string;
  artistName?: string;
  status?: string[];
  condition?: string[];
  collectionName?: string;
  locationName?: string;
  favorite?: boolean;
}

const FILTER_PROPERTIES = {
  text: { type: 'string', description: 'Free text matched against artwork title, inventory number and artist attribution.' },
  artistName: { type: 'string', description: 'Artist name (partial match).' },
  status: { type: 'array', items: { type: 'string', enum: [...ARTWORK_STATUS] }, description: 'Artwork statuses to include.' },
  condition: { type: 'array', items: { type: 'string', enum: [...CONDITION_RATING] }, description: 'Condition ratings to include.' },
  collectionName: { type: 'string', description: 'Collection name (partial match).' },
  locationName: { type: 'string', description: 'Storage location name (partial match).' },
  favorite: { type: 'boolean', description: 'Only favorite artworks.' },
} as const;

const MAX_ROWS = 25;

/**
 * Tool registry + executors for the "Parle à ta collection" assistant.
 * Every executor runs with the calling user's AuthUser and the same org/
 * permission scoping as the REST endpoints — the model only ever sees data
 * this user could already read. Valuation tools are not even ADVERTISED to
 * the model unless the user holds VALUATION_READ (and the handler re-checks).
 */
@Injectable()
export class ChatToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  listTools(user: AuthUser): ChatToolDef[] {
    const tools: ChatToolDef[] = [
      {
        name: 'search_artworks',
        description:
          'Search artworks in the collection by any combination of filters. Returns up to 25 compact rows (id, title, artist, status, condition, location, year). Use this to find or count specific works.',
        parameters: { type: 'object', properties: { ...FILTER_PROPERTIES, limit: { type: 'number', description: `Max rows (default ${MAX_ROWS}).` } } },
      },
      {
        name: 'artwork_stats',
        description:
          'Exact counts of artworks grouped by one dimension. Use for "how many …" questions — the counts are computed by the database, never estimate them yourself.',
        parameters: {
          type: 'object',
          properties: {
            groupBy: { type: 'string', enum: ['status', 'condition', 'artist', 'collection', 'location'], description: 'Dimension to group by.' },
            ...FILTER_PROPERTIES,
          },
          required: ['groupBy'],
        },
      },
      {
        name: 'get_artwork',
        description: 'Full detail of ONE artwork, looked up by id, inventory number or title. Includes current location, active loans and exhibitions.',
        parameters: { type: 'object', properties: { ref: { type: 'string', description: 'Artwork id, inventory number, or (part of) its title.' } }, required: ['ref'] },
      },
      {
        name: 'list_loans',
        description: 'List loans (outgoing = lent to someone, incoming = borrowed). Includes counterparty, dates, status and the artworks concerned.',
        parameters: {
          type: 'object',
          properties: {
            active: { type: 'boolean', description: 'Only loans currently out (not returned).' },
            direction: { type: 'string', enum: ['outgoing', 'incoming'] },
          },
        },
      },
      {
        name: 'list_exhibitions',
        description: 'List exhibitions with venue, dates, status and artwork count.',
        parameters: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status (e.g. planned, current, past).' } } },
      },
      {
        name: 'locations_overview',
        description: 'All storage locations with the number of artworks currently in each.',
        parameters: { type: 'object', properties: {} },
      },
    ];

    if (user.permissions.includes(PERMISSIONS.VALUATION_READ)) {
      tools.push({
        name: 'sum_valuation',
        description:
          'Exact total of a monetary field over the matching artworks, computed by the server. Use for any "total value / worth" question. Returns total, currency, how many artworks have a value and how many are missing one.',
        parameters: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['currentValue', 'purchasePrice', 'insuranceValue'], description: 'Which valuation field to sum.' },
            ...FILTER_PROPERTIES,
          },
          required: ['field'],
        },
      });
    }
    return tools;
  }

  async execute(user: AuthUser, locale: Locale, call: ChatToolCall): Promise<ExecutedTool> {
    let args: Record<string, unknown>;
    try {
      args = call.argumentsJson ? (JSON.parse(call.argumentsJson) as Record<string, unknown>) : {};
    } catch {
      return { summary: `${call.name}: arguments illisibles`, payload: { error: 'invalid_arguments' } };
    }
    try {
      switch (call.name) {
        case 'search_artworks':
          return await this.searchArtworks(user, locale, args);
        case 'artwork_stats':
          return await this.artworkStats(user, args);
        case 'get_artwork':
          return await this.getArtwork(user, locale, args);
        case 'list_loans':
          return await this.listLoans(user, locale, args);
        case 'list_exhibitions':
          return await this.listExhibitions(user, locale, args);
        case 'locations_overview':
          return await this.locationsOverview(user);
        case 'sum_valuation':
          if (!user.permissions.includes(PERMISSIONS.VALUATION_READ)) {
            return { summary: 'sum_valuation: refusé', payload: { error: 'permission_denied' } };
          }
          return await this.sumValuation(user, args);
        default:
          return { summary: `${call.name}: outil inconnu`, payload: { error: 'unknown_tool' } };
      }
    } catch (e) {
      return { summary: `${call.name}: erreur`, payload: { error: 'tool_failed', detail: e instanceof Error ? e.message : String(e) } };
    }
  }

  // ---------------------------------------------------------------- helpers

  private parseFilters(args: Record<string, unknown>): ArtworkFilters {
    const arr = (v: unknown, allowed: readonly string[]): string[] | undefined => {
      if (!Array.isArray(v)) return undefined;
      const valid = v.filter((x): x is string => typeof x === 'string' && allowed.includes(x));
      return valid.length ? valid : undefined;
    };
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return {
      text: str(args.text),
      artistName: str(args.artistName),
      status: arr(args.status, ARTWORK_STATUS),
      condition: arr(args.condition, CONDITION_RATING),
      collectionName: str(args.collectionName),
      locationName: str(args.locationName),
      favorite: typeof args.favorite === 'boolean' ? args.favorite : undefined,
    };
  }

  private buildWhere(user: AuthUser, f: ArtworkFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (f.status?.length) where.status = { in: f.status };
    if (f.condition?.length) where.condition = { in: f.condition };
    if (f.artistName) where.artist = { fullName: { contains: f.artistName } };
    if (f.collectionName) where.collection = { name: { contains: f.collectionName } };
    if (f.locationName) where.currentLocation = { name: { contains: f.locationName } };
    if (f.favorite) where.isFavorite = true;
    return where;
  }

  /** Title is a per-locale Json column (SQLite: no Json filtering) — text matching happens in memory over a capped candidate set. */
  private matchesText(row: { title: unknown; inventoryNumber: string; attribution: string | null; artist: { fullName: string } | null }, text: string): boolean {
    const needle = text.toLowerCase();
    const titleValues = Object.values((row.title ?? {}) as Record<string, string>).map((v) => String(v).toLowerCase());
    return (
      titleValues.some((t) => t.includes(needle)) ||
      row.inventoryNumber.toLowerCase().includes(needle) ||
      (row.attribution ?? '').toLowerCase().includes(needle) ||
      (row.artist?.fullName ?? '').toLowerCase().includes(needle)
    );
  }

  // ------------------------------------------------------------------ tools

  private async searchArtworks(user: AuthUser, locale: Locale, args: Record<string, unknown>): Promise<ExecutedTool> {
    const f = this.parseFilters(args);
    const limit = Math.min(Math.max(Number(args.limit) || MAX_ROWS, 1), MAX_ROWS);
    const rows = await this.prisma.artwork.findMany({
      where: this.buildWhere(user, f) as never,
      include: { artist: { select: { fullName: true } }, currentLocation: { select: { name: true } }, collection: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: f.text ? 500 : limit,
    });
    const filtered = f.text ? rows.filter((r) => this.matchesText(r, f.text!)) : rows;
    const total = f.text ? filtered.length : await this.prisma.artwork.count({ where: this.buildWhere(user, f) as never });
    const items = filtered.slice(0, limit).map((r) => ({
      id: r.id,
      title: resolveLocalized((r.title ?? {}) as Record<string, string>, locale) || r.inventoryNumber,
      inventoryNumber: r.inventoryNumber,
      artist: r.artist?.fullName ?? r.attribution ?? null,
      status: r.status,
      condition: r.condition,
      location: r.currentLocation?.name ?? null,
      collection: r.collection?.name ?? null,
      year: r.yearFrom,
    }));
    return { summary: `search_artworks : ${total} œuvre(s) trouvée(s)`, payload: { total, returned: items.length, items } };
  }

  private async artworkStats(user: AuthUser, args: Record<string, unknown>): Promise<ExecutedTool> {
    const f = this.parseFilters(args);
    const where = this.buildWhere(user, f) as never;
    const groupBy = String(args.groupBy ?? 'status');

    // Prisma's groupBy generic rejects a dynamic `by` column — one explicit
    // branch per dimension keeps the types honest.
    let raw: Array<{ key: string | null; count: number }>;
    let labels = new Map<string, string>();
    if (groupBy === 'status') {
      const g = await this.prisma.artwork.groupBy({ by: ['status'], where, _count: true });
      raw = g.map((r) => ({ key: r.status, count: r._count }));
    } else if (groupBy === 'condition') {
      const g = await this.prisma.artwork.groupBy({ by: ['condition'], where, _count: true });
      raw = g.map((r) => ({ key: r.condition, count: r._count }));
    } else if (groupBy === 'artist') {
      const g = await this.prisma.artwork.groupBy({ by: ['artistId'], where, _count: true });
      raw = g.map((r) => ({ key: r.artistId, count: r._count }));
      const ids = raw.map((r) => r.key).filter((k): k is string => Boolean(k));
      const artists = ids.length ? await this.prisma.artist.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
      labels = new Map(artists.map((a) => [a.id, a.fullName]));
    } else if (groupBy === 'collection') {
      const g = await this.prisma.artwork.groupBy({ by: ['collectionId'], where, _count: true });
      raw = g.map((r) => ({ key: r.collectionId, count: r._count }));
      const ids = raw.map((r) => r.key).filter((k): k is string => Boolean(k));
      const cols = ids.length ? await this.prisma.collection.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      labels = new Map(cols.map((c) => [c.id, c.name]));
    } else if (groupBy === 'location') {
      const g = await this.prisma.artwork.groupBy({ by: ['currentLocationId'], where, _count: true });
      raw = g.map((r) => ({ key: r.currentLocationId, count: r._count }));
      const ids = raw.map((r) => r.key).filter((k): k is string => Boolean(k));
      const locs = ids.length ? await this.prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      labels = new Map(locs.map((l) => [l.id, l.name]));
    } else {
      return { summary: 'artwork_stats: dimension inconnue', payload: { error: 'invalid_groupBy' } };
    }

    const counts = raw
      .map((r) => ({ value: r.key ? (labels.get(r.key) ?? r.key) : '(aucun)', count: r.count }))
      .sort((a, b) => b.count - a.count);
    const total = counts.reduce((s, c) => s + c.count, 0);
    return { summary: `artwork_stats par ${groupBy} : ${total} œuvre(s)`, payload: { groupBy, total, counts } };
  }

  private async getArtwork(user: AuthUser, locale: Locale, args: Record<string, unknown>): Promise<ExecutedTool> {
    const ref = String(args.ref ?? '').trim();
    if (!ref) return { summary: 'get_artwork: référence manquante', payload: { error: 'missing_ref' } };
    const include = {
      artist: { select: { fullName: true } },
      collection: { select: { name: true } },
      technique: { select: { name: true } },
      support: { select: { name: true } },
      currentLocation: { select: { name: true } },
      valuation: true,
      tags: { include: { tag: { select: { name: true } } } },
    };
    const base = { organizationId: user.organizationId, deletedAt: null };
    let row = await this.prisma.artwork.findFirst({ where: { ...base, OR: [{ id: ref }, { inventoryNumber: ref }] }, include });
    if (!row) {
      const candidates = await this.prisma.artwork.findMany({ where: base, include, orderBy: { updatedAt: 'desc' }, take: 500 });
      row = candidates.find((r) => this.matchesText({ ...r, artist: r.artist }, ref)) ?? null;
    }
    if (!row) return { summary: `get_artwork: "${ref}" introuvable`, payload: { error: 'not_found', ref } };

    const canViewValuation = user.permissions.includes(PERMISSIONS.VALUATION_READ);
    const [activeLoans, exhibitions] = await Promise.all([
      this.prisma.loanItem.findMany({
        where: { artworkId: row.id, loan: { status: { in: ['requested', 'approved', 'active', 'overdue'] } } },
        include: { loan: { select: { reference: true, direction: true, status: true, counterparty: true, startDate: true, endDate: true } } },
      }),
      this.prisma.exhibitionArtwork.findMany({
        where: { artworkId: row.id },
        include: { exhibition: { select: { title: true, venue: true, status: true, startDate: true, endDate: true } } },
      }),
    ]);

    const title = resolveLocalized((row.title ?? {}) as Record<string, string>, locale);
    const description = resolveLocalized((row.description ?? {}) as Record<string, string>, locale);
    const payload: Record<string, unknown> = {
      id: row.id,
      inventoryNumber: row.inventoryNumber,
      title,
      artist: row.artist?.fullName ?? row.attribution ?? null,
      status: row.status,
      condition: row.condition,
      technique: row.technique?.name ?? null,
      support: row.support?.name ?? null,
      dateText: row.dateText,
      year: row.yearFrom,
      dimensions: row.heightCm && row.widthCm ? `${row.heightCm} × ${row.widthCm} cm` : (row.dimensionsNote ?? null),
      signature: row.signatureDescription,
      framed: row.framed,
      collection: row.collection?.name ?? null,
      location: row.currentLocation?.name ?? null,
      acquisitionMethod: row.acquisitionMethod,
      acquisitionDate: row.acquisitionDate?.toISOString().slice(0, 10) ?? null,
      tags: row.tags.map((t) => t.tag.name),
      description: description ? description.slice(0, 400) : null,
      activeLoans: activeLoans.map((li) => ({
        reference: li.loan.reference,
        direction: li.loan.direction,
        status: li.loan.status,
        counterparty: li.loan.counterparty,
        endDate: li.loan.endDate?.toISOString().slice(0, 10) ?? null,
      })),
      exhibitions: exhibitions.map((ea) => ({
        title: resolveLocalized((ea.exhibition.title ?? {}) as Record<string, string>, locale),
        venue: ea.exhibition.venue,
        status: ea.exhibition.status,
      })),
    };
    if (canViewValuation && row.valuation) {
      payload.valuation = {
        currency: row.valuation.currency,
        purchasePrice: this.crypto.decryptNumber(row.valuation.purchasePriceEnc),
        currentValue: this.crypto.decryptNumber(row.valuation.currentValueEnc),
        insuranceValue: this.crypto.decryptNumber(row.valuation.insuranceValueEnc),
      };
    }
    return { summary: `get_artwork : « ${title || row.inventoryNumber} »`, payload };
  }

  private async listLoans(user: AuthUser, locale: Locale, args: Record<string, unknown>): Promise<ExecutedTool> {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (args.active === true) where.status = { in: ['requested', 'approved', 'active', 'overdue'] };
    if (args.direction === 'outgoing' || args.direction === 'incoming') where.direction = args.direction;
    const loans = await this.prisma.loan.findMany({
      where: where as never,
      include: { items: { include: { artwork: { select: { title: true, inventoryNumber: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: MAX_ROWS,
    });
    const items = loans.map((l) => ({
      reference: l.reference,
      direction: l.direction,
      status: l.status,
      counterparty: l.counterparty,
      startDate: l.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: l.endDate?.toISOString().slice(0, 10) ?? null,
      artworks: l.items.map((i) => resolveLocalized((i.artwork.title ?? {}) as Record<string, string>, locale) || i.artwork.inventoryNumber),
    }));
    return { summary: `list_loans : ${items.length} prêt(s)`, payload: { count: items.length, items } };
  }

  private async listExhibitions(user: AuthUser, locale: Locale, args: Record<string, unknown>): Promise<ExecutedTool> {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (typeof args.status === 'string' && args.status.trim()) where.status = args.status.trim();
    const rows = await this.prisma.exhibition.findMany({
      where: where as never,
      include: { _count: { select: { items: true } } },
      orderBy: { startDate: 'desc' },
      take: MAX_ROWS,
    });
    const items = rows.map((e) => ({
      title: resolveLocalized((e.title ?? {}) as Record<string, string>, locale),
      venue: e.venue,
      status: e.status,
      startDate: e.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: e.endDate?.toISOString().slice(0, 10) ?? null,
      artworkCount: e._count.items,
    }));
    return { summary: `list_exhibitions : ${items.length} exposition(s)`, payload: { count: items.length, items } };
  }

  private async locationsOverview(user: AuthUser): Promise<ExecutedTool> {
    const [locations, counts] = await Promise.all([
      this.prisma.location.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true, kind: true, parentId: true, parent: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.artwork.groupBy({
        by: ['currentLocationId'],
        where: { organizationId: user.organizationId, deletedAt: null, NOT: { currentLocationId: null } },
        _count: true,
      }),
    ]);
    const byId = new Map(counts.map((c) => [c.currentLocationId, c._count]));
    const items = locations.map((l) => ({
      name: l.name,
      kind: l.kind,
      parent: l.parent?.name ?? null,
      artworkCount: byId.get(l.id) ?? 0,
    }));
    return { summary: `locations_overview : ${items.length} emplacement(s)`, payload: { count: items.length, items } };
  }

  private async sumValuation(user: AuthUser, args: Record<string, unknown>): Promise<ExecutedTool> {
    const field = String(args.field ?? 'currentValue');
    const column = ({ currentValue: 'currentValueEnc', purchasePrice: 'purchasePriceEnc', insuranceValue: 'insuranceValueEnc' } as Record<string, string>)[field];
    if (!column) return { summary: 'sum_valuation: champ inconnu', payload: { error: 'invalid_field' } };
    const f = this.parseFilters(args);
    let rows = await this.prisma.artwork.findMany({
      where: this.buildWhere(user, f) as never,
      include: { valuation: true, artist: { select: { fullName: true } } },
      take: 5000,
    });
    if (f.text) rows = rows.filter((r) => this.matchesText(r, f.text!));

    let total = 0;
    let counted = 0;
    const currencies = new Map<string, number>();
    for (const r of rows) {
      const enc = (r.valuation as Record<string, unknown> | null)?.[column] as string | null | undefined;
      const value = enc ? this.crypto.decryptNumber(enc) : null;
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        total += value;
        counted++;
        const cur = r.valuation?.currency ?? 'EUR';
        currencies.set(cur, (currencies.get(cur) ?? 0) + 1);
      }
    }
    const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';
    return {
      summary: `sum_valuation (${field}) : ${counted}/${rows.length} œuvre(s) valorisée(s)`,
      payload: {
        field,
        total: Math.round(total * 100) / 100,
        currency,
        mixedCurrencies: currencies.size > 1,
        artworksWithValue: counted,
        artworksMissingValue: rows.length - counted,
      },
    };
  }
}
