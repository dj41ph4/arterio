import { ForbiddenException, Injectable } from '@nestjs/common';
import { PERMISSIONS, type PermissionKey } from '@arterio/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { AuthUser } from '../../common/types';
import { buildReportPdf, type ReportArtworkRow, type ReportType } from './report-pdf.util';

const VALUATION_REPORTS: ReportType[] = ['insurance', 'financial'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async generatePdf(user: AuthUser, type: ReportType): Promise<Buffer> {
    const canViewValuation = user.permissions.includes(PERMISSIONS.VALUATION_READ as PermissionKey);
    if (VALUATION_REPORTS.includes(type) && !canViewValuation) {
      throw new ForbiddenException("Permission 'valuation:read' requise pour ce rapport.");
    }

    const org = await this.prisma.organization.findUnique({ where: { id: user.organizationId } });
    const rows = await this.prisma.artwork.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      include: {
        artist: { select: { fullName: true } },
        technique: { select: { name: true } },
        collection: { select: { name: true } },
        valuation: true,
      },
      orderBy: { inventoryNumber: 'asc' },
      take: 5000, // single-tenant appliance safety cap, same as the artwork list endpoint
    });

    const artworks: ReportArtworkRow[] = rows.map((a) => ({
      inventoryNumber: a.inventoryNumber,
      title: a.title,
      artistName: a.artist?.fullName ?? null,
      yearFrom: a.yearFrom,
      techniqueName: a.technique?.name ?? null,
      heightCm: a.heightCm,
      widthCm: a.widthCm,
      status: a.status,
      condition: a.condition,
      collectionName: a.collection?.name ?? null,
      purchasePrice: canViewValuation ? this.crypto.decryptNumber(a.valuation?.purchasePriceEnc ?? null) : null,
      currentValue: canViewValuation ? this.crypto.decryptNumber(a.valuation?.currentValueEnc ?? null) : null,
      insuranceValue: canViewValuation ? this.crypto.decryptNumber(a.valuation?.insuranceValueEnc ?? null) : null,
      currency: a.valuation?.currency ?? 'EUR',
    }));

    return buildReportPdf(type, org?.name ?? 'Arterio', artworks);
  }
}
