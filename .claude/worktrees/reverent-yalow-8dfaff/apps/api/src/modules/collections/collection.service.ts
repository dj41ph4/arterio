import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../common/types';
import type { CreateCollectionDto, UpdateCollectionDto } from './dto';

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

type CollectionRow = {
  id: string;
  name: string;
  label: unknown;
  description: unknown;
  color: string | null;
  parentId: string | null;
  _count: { artworks: number };
};

@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.collection.findMany({
      where: { organizationId: user.organizationId },
      include: { _count: { select: { artworks: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toView(r as CollectionRow));
  }

  async create(user: AuthUser, dto: CreateCollectionDto) {
    const created = await this.prisma.collection.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        label: { default: dto.name },
        description: dto.description ? { default: dto.description } : {},
        color: dto.color ?? null,
        parentId: dto.parentId || null,
      },
      include: { _count: { select: { artworks: true } } },
    });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'collection.create',
      resource: 'collection',
      resourceId: created.id,
      metadata: { name: dto.name },
    });
    return this.toView(created as CollectionRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateCollectionDto) {
    const existing = await this.assertExists(user, id);
    const description = (existing.description as Record<string, unknown>) ?? {};
    const updated = await this.prisma.collection.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name, label: { default: dto.name } }),
        ...(dto.description !== undefined && {
          description: dto.description ? { ...description, default: dto.description } : {},
        }),
        ...(dto.color !== undefined && { color: dto.color || null }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId || null }),
      },
      include: { _count: { select: { artworks: true } } },
    });
    return this.toView(updated as CollectionRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    // Artworks in this collection are unlinked, never deleted alongside it.
    await this.prisma.artwork.updateMany({ where: { collectionId: id, organizationId: user.organizationId }, data: { collectionId: null } });
    await this.prisma.collection.update({ where: { id }, data: { parentId: null } }).catch(() => undefined);
    await this.prisma.collection.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await this.prisma.collection.delete({ where: { id } });
    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'collection.delete',
      resource: 'collection',
      resourceId: id,
    });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.collection.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Collection not found');
    return row;
  }

  private toView(c: CollectionRow) {
    return {
      id: c.id,
      name: c.name,
      description: resolveText(c.description) || undefined,
      color: c.color ?? '#6366f1',
      parentId: c.parentId,
      artworkCount: c._count.artworks,
    };
  }
}
