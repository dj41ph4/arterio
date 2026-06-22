import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import type { CreateDocumentDto, UpdateDocumentDto } from './dto';

const KNOWN_TYPES = ['invoice', 'certificate', 'report', 'insurance'] as const;
type DocType = (typeof KNOWN_TYPES)[number];

function resolveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = Object.values(value as Record<string, unknown>).find((x) => typeof x === 'string' && x);
    return (v as string) ?? '';
  }
  return '';
}

type DocumentRow = {
  id: string;
  title: string;
  type: string;
  createdAt: Date;
  artwork: { title: unknown } | null;
  versions: { sizeBytes: number | null }[];
};

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.document.findMany({
      where: { organizationId: user.organizationId },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map((d) => this.toView(d as DocumentRow)) };
  }

  async create(user: AuthUser, dto: CreateDocumentDto) {
    const created = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        title: dto.title,
        type: this.clampType(dto.type),
        artworkId: dto.artworkId || null,
      },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
    });
    return this.toView(created as DocumentRow);
  }

  async update(user: AuthUser, id: string, dto: UpdateDocumentDto) {
    await this.assertExists(user, id);
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: this.clampType(dto.type) }),
        ...(dto.artworkId !== undefined && { artworkId: dto.artworkId || null }),
      },
      include: {
        artwork: { select: { title: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { sizeBytes: true } },
      },
    });
    return this.toView(updated as DocumentRow);
  }

  async remove(user: AuthUser, id: string) {
    await this.assertExists(user, id);
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  private async assertExists(user: AuthUser, id: string) {
    const row = await this.prisma.document.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  private clampType(type?: string): DocType {
    return (KNOWN_TYPES as readonly string[]).includes(type ?? '') ? (type as DocType) : 'report';
  }

  private toView(d: DocumentRow) {
    const bytes = d.versions[0]?.sizeBytes ?? 0;
    return {
      id: d.id,
      title: d.title,
      type: this.clampType(d.type),
      linkedTo: d.artwork ? resolveText(d.artwork.title) : 'Collection',
      uploadedAt: d.createdAt.toISOString().slice(0, 10),
      sizeKb: Math.round(bytes / 1024),
    };
  }
}
