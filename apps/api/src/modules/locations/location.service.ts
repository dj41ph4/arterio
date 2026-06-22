import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import type { CreateLocationDto, UpdateLocationDto } from './dto';

type LocationRow = {
  id: string;
  name: string;
  mapMeta: unknown;
  _count: { currentArtworks: number };
};

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.location.findMany({
      where: { organizationId: user.organizationId },
      include: { _count: { select: { currentArtworks: true } } },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((l) => this.toView(l as LocationRow)) };
  }

  async create(user: AuthUser, dto: CreateLocationDto) {
    const created = await this.prisma.location.create({
      data: {
        organizationId: user.organizationId,
        name: dto.room,
        kind: 'room',
        mapMeta: { building: dto.building ?? '', floor: dto.floor ?? '', capacity: dto.capacity ?? 0 },
      },
      include: { _count: { select: { currentArtworks: true } } },
    });
    return this.toView(created as LocationRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateLocationDto) {
    const existing = await this.assertExists(user, id);
    const meta = (existing.mapMeta as Record<string, unknown>) ?? {};
    const updated = await this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.room !== undefined && { name: dto.room }),
        mapMeta: {
          ...meta,
          ...(dto.building !== undefined && { building: dto.building }),
          ...(dto.floor !== undefined && { floor: dto.floor }),
          ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        },
      },
      include: { _count: { select: { currentArtworks: true } } },
    });
    return this.toView(updated as LocationRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.location.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.location.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Location not found');
    return row;
  }

  private toView(l: LocationRow) {
    const meta = (l.mapMeta as Record<string, unknown>) ?? {};
    return {
      id: l.id,
      building: typeof meta.building === 'string' ? meta.building : '',
      floor: typeof meta.floor === 'string' ? meta.floor : '',
      room: l.name,
      artworkCount: l._count.currentArtworks,
      capacity: typeof meta.capacity === 'number' ? meta.capacity : 0,
    };
  }
}
