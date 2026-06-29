import { BadRequestException, Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';
import { ReportsService } from './reports.service';
import type { ReportType } from './report-pdf.util';

const VALID_TYPES: ReportType[] = ['catalogue', 'insurance', 'conservation', 'financial'];

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':type/pdf')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Download a generated PDF report (catalogue, insurance, conservation, financial)' })
  async downloadPdf(@CurrentUser() user: AuthUser, @Param('type') type: string, @Res() res: Response) {
    if (!VALID_TYPES.includes(type as ReportType)) {
      throw new BadRequestException(`Unknown report type "${type}"`);
    }
    const pdf = await this.reports.generatePdf(user, type as ReportType);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="arterio-${type}-${date}.pdf"`);
    res.send(pdf);
  }
}
