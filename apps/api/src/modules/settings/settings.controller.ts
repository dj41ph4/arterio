import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { SettingsService } from './settings.service';
import { CreateApiKeyDto, UpdateExternalSourcesDto, UpdateOrganizationDto, WipeDataDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('organization')
  @ApiOperation({ summary: 'Organization profile + notification preferences' })
  getOrganization(@CurrentUser() user: AuthUser) {
    return this.settings.getOrganization(user);
  }

  @Patch('organization')
  @ApiOperation({ summary: 'Update organization profile / notification preferences' })
  updateOrganization(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganizationDto) {
    return this.settings.updateOrganization(user, dto);
  }

  @Patch('external-sources')
  @ApiOperation({ summary: 'Configure third-party API keys used by artist-enrichment fallback providers' })
  updateExternalSources(@CurrentUser() user: AuthUser, @Body() dto: UpdateExternalSourcesDto) {
    return this.settings.updateExternalSources(user, dto);
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'List API keys (secrets never returned after creation)' })
  listApiKeys(@CurrentUser() user: AuthUser) {
    return this.settings.listApiKeys(user);
  }

  @Post('api-keys')
  @ApiOperation({ summary: 'Create an API key — the secret is shown once' })
  createApiKey(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.settings.createApiKey(user, dto);
  }

  @Delete('api-keys/:id')
  @ApiOperation({ summary: 'Revoke an API key' })
  revokeApiKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settings.revokeApiKey(user, id);
  }

  @Post('danger-zone/wipe')
  @ApiOperation({
    summary: 'Permanently delete all data of the selected categories for this organization',
    description: 'Irreversible. Nullifies/cascades dependent records before deleting (e.g. unlinks artworks before deleting artists/collections/locations).',
  })
  wipeData(@CurrentUser() user: AuthUser, @Body() dto: WipeDataDto) {
    return this.settings.wipeData(user, dto.categories);
  }

  @Get('backup')
  @ApiOperation({ summary: 'Download a full JSON backup of the organization data' })
  async exportBackup(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const backup = await this.settings.exportBackup(user);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="arterio-backup-${date}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  }
}
