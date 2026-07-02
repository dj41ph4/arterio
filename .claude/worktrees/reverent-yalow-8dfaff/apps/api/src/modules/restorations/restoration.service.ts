import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../common/types';
import type { CreateRestorationDto, UpdateRestorationDto } from './dto';

type RestorationRow = {
  id: string;
  artworkId: string;
  status: string;
  title: string;
  diagnosis: unknown;
  treatment: unknown;
  conservator: string | null;
  costEnc: string | null;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  artwork: { title: unknown; inventoryNumber: string } | null;
};

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

@Injectable()
export class RestorationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, artworkId?: string) {
    const rows = await this.prisma.restoration.findMany({
      where: {
        organizationId: user.organizationId,
        ...(artworkId ? { artworkId } : {}),
      },
      include: { artwork: { select: { title: true, inventoryNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map((r) => this.toView(r as RestorationRow)) };
  }

  async create(user: AuthUser, dto: CreateRestorationDto) {
    const artwork = await this.prisma.artwork.findFirst({
      where: { id: dto.artworkId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!artwork) throw new NotFoundException('Artwork not found');

    const created = await this.prisma.restoration.create({
      data: {
        organizationId: user.organizationId,
        artworkId: dto.artworkId,
        title: dto.title,
        status: 'proposed',
        diagnosis: dto.diagnosis ? { default: dto.diagnosis } : {},
        treatment: dto.treatment ? { default: dto.treatment } : {},
        conservator: dto.conservator ?? null,
        costEnc: dto.cost != null ? this.crypto.encryptNumber(dto.cost) : null,
        currency: dto.currency ?? 'EUR',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        beforeMediaIds: [],
        afterMediaIds: [],
      },
      include: { artwork: { select: { title: true, inventoryNumber: true } } },
    });

    // A restoration in progress is exactly what the artwork status enum means by "in_restoration".
    await this.prisma.artwork.update({ where: { id: dto.artworkId }, data: { status: 'in_restoration' } });

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'restoration.create',
      resource: 'restoration',
      resourceId: created.id,
      metadata: { artworkId: dto.artworkId, title: dto.title },
    });

    return this.toView(created as RestorationRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateRestorationDto) {
    const existing = await this.assertExists(user, id);
    const diagnosis = (existing.diagnosis as Record<string, unknown>) ?? {};
    const treatment = (existing.treatment as Record<string, unknown>) ?? {};

    const updated = await this.prisma.restoration.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.diagnosis !== undefined && { diagnosis: dto.diagnosis ? { ...diagnosis, default: dto.diagnosis } : {} }),
        ...(dto.treatment !== undefined && { treatment: dto.treatment ? { ...treatment, default: dto.treatment } : {} }),
        ...(dto.conservator !== undefined && { conservator: dto.conservator || null }),
        ...(dto.cost !== undefined && { costEnc: this.crypto.encryptNumber(dto.cost) }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
      },
      include: { artwork: { select: { title: true, inventoryNumber: true } } },
    });

    // Completing the restoration returns the artwork to active circulation.
    if (dto.status === 'completed') {
      await this.prisma.artwork.update({ where: { id: existing.artworkId }, data: { status: 'active' } });
    }

    await this.audit.log({
      organizationId: user.organizationId,
      actorId: user.sub,
      action: 'restoration.update',
      resource: 'restoration',
      resourceId: id,
      metadata: { status: dto.status },
    });

    return this.toView(updated as RestorationRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.restoration.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.restoration.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Restoration not found');
    return row;
  }

  private toView(r: RestorationRow) {
    return {
      id: r.id,
      artworkId: r.artworkId,
      artworkTitle: r.artwork ? resolveText(r.artwork.title) || r.artwork.inventoryNumber : '—',
      status: r.status as 'proposed' | 'in_progress' | 'completed',
      title: r.title,
      diagnosis: resolveText(r.diagnosis),
      treatment: resolveText(r.treatment),
      conservator: r.conservator,
      cost: this.crypto.decryptNumber(r.costEnc),
      currency: r.currency,
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
