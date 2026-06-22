import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import type { CreateExhibitionDto, UpdateExhibitionDto } from './dto';

// Deterministic accent colour from the id, so each exhibition keeps a stable
// colour without storing one (the UI uses it for the timeline bars).
const PALETTE = ['#0ea5e9', '#8b5cf6', '#b45309', '#ec4899', '#10b981', '#ef4444', '#f59e0b', '#6366f1'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Resolve a localized Json field to a plain string (first non-empty value). */
function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

@Injectable()
export class ExhibitionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.exhibition.findMany({
      where: { organizationId: user.organizationId },
      include: { _count: { select: { items: true } } },
      orderBy: { startDate: 'desc' },
    });
    return { data: rows.map((e) => this.toView(e)) };
  }

  async create(user: AuthUser, dto: CreateExhibitionDto) {
    const created = await this.prisma.exhibition.create({
      data: {
        organizationId: user.organizationId,
        title: { default: dto.title },
        kind: dto.kind ?? 'temporary',
        description: dto.city ? { city: dto.city } : {},
        venue: dto.venue ?? null,
        curator: dto.curator ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        ...(dto.artworkIds?.length
          ? {
              items: {
                create: dto.artworkIds.map((artworkId, i) => ({
                  artworkId,
                  wallLabel: {},
                  sortOrder: i,
                })),
              },
            }
          : {}),
      },
      include: { _count: { select: { items: true } } },
    });
    return this.toView(created);
  }

  async update(user: AuthUser, id: string, dto: UpdateExhibitionDto) {
    const existing = await this.assertExists(user, id);
    const description = (existing.description as Record<string, unknown>) ?? {};
    const updated = await this.prisma.exhibition.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: { default: dto.title } }),
        ...(dto.venue !== undefined && { venue: dto.venue || null }),
        ...(dto.city !== undefined && { description: { ...description, city: dto.city || undefined } }),
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.curator !== undefined && { curator: dto.curator || null }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
      },
      include: { _count: { select: { items: true } } },
    });
    return this.toView(updated);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.exhibition.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.exhibition.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!row) throw new NotFoundException('Exhibition not found');
    return row;
  }

  private toView(e: {
    id: string;
    title: unknown;
    venue: string | null;
    description: unknown;
    startDate: Date | null;
    endDate: Date | null;
    _count: { items: number };
  }) {
    const description = (e.description as Record<string, unknown>) ?? {};
    return {
      id: e.id,
      title: resolveText(e.title),
      venue: e.venue ?? '',
      city: typeof description.city === 'string' ? description.city : '',
      startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : '',
      endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : '',
      artworkCount: e._count.items,
      color: colorFor(e.id),
    };
  }
}
