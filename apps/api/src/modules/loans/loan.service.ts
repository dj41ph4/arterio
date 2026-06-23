import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import type { CreateLoanDto, UpdateLoanDto } from './dto';

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

type LoanRow = {
  id: string;
  direction: string;
  status: string;
  counterparty: string;
  startDate: Date | null;
  endDate: Date | null;
  returnedAt: Date | null;
  items: { artwork: { title: unknown; artist: { fullName: string } | null } }[];
};

@Injectable()
export class LoanService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, artworkId?: string) {
    const rows = await this.prisma.loan.findMany({
      where: {
        organizationId: user.organizationId,
        ...(artworkId ? { items: { some: { artworkId } } } : {}),
      },
      include: {
        items: {
          take: 1,
          include: { artwork: { select: { title: true, artist: { select: { fullName: true } } } } },
        },
      },
      orderBy: { startDate: 'desc' },
    });
    return { data: rows.map((l) => this.toView(l as LoanRow)) };
  }

  async create(user: AuthUser, dto: CreateLoanDto) {
    const reference = dto.reference?.trim() || `LOAN-${Date.now().toString(36).toUpperCase()}`;
    const created = await this.prisma.loan.create({
      data: {
        organizationId: user.organizationId,
        reference,
        counterparty: dto.counterparty,
        direction: dto.direction === 'incoming' ? 'incoming' : 'outgoing',
        contactInfo: {},
        conditions: {},
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        ...(dto.artworkIds?.length
          ? {
              items: {
                create: dto.artworkIds.map((artworkId) => ({
                  artworkId,
                  conditionOut: {},
                  conditionIn: {},
                })),
              },
            }
          : {}),
      },
      include: {
        items: { take: 1, include: { artwork: { select: { title: true, artist: { select: { fullName: true } } } } } },
      },
    });
    return this.toView(created as LoanRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateLoanDto) {
    await this.assertExists(user, id);
    const updated = await this.prisma.loan.update({
      where: { id },
      data: {
        ...(dto.counterparty !== undefined && { counterparty: dto.counterparty }),
        ...(dto.status !== undefined && {
          status: dto.status,
          ...(dto.status === 'returned' ? { returnedAt: new Date() } : {}),
        }),
        ...(dto.direction !== undefined && { direction: dto.direction }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
      },
      include: {
        items: { take: 1, include: { artwork: { select: { title: true, artist: { select: { fullName: true } } } } } },
      },
    });
    return this.toView(updated as LoanRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.loan.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.loan.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Loan not found');
    return row;
  }

  private toView(l: LoanRow) {
    const first = l.items[0]?.artwork;
    return {
      id: l.id,
      artworkTitle: first ? resolveText(first.title) : '—',
      artist: first?.artist?.fullName ?? '',
      direction: l.direction === 'incoming' ? ('in' as const) : ('out' as const),
      counterparty: l.counterparty,
      startDate: l.startDate ? l.startDate.toISOString().slice(0, 10) : '',
      endDate: l.endDate ? l.endDate.toISOString().slice(0, 10) : '',
      status: this.viewStatus(l),
    };
  }

  private viewStatus(l: LoanRow): 'pending' | 'active' | 'returned' | 'overdue' {
    if (l.status === 'returned' || l.returnedAt) return 'returned';
    if (l.endDate && l.endDate < new Date()) return 'overdue';
    if (l.status === 'requested' || l.status === 'planned' || l.status === 'pending') return 'pending';
    return 'active';
  }
}
