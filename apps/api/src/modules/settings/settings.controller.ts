import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { SettingsService } from './settings.service';
import { MigrationService } from './migration.service';
import { CreateApiKeyDto, UpdateAiModelsDto, UpdateExternalSourcesDto, UpdateOAuthProviderDto, UpdateOrganizationDto, WipeDataDto } from './dto';
import type { OAuthProviderKey } from './settings.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly migration: MigrationService,
  ) {}

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

  @Get('ai-models')
  @ApiOperation({ summary: 'Up to 3 OpenRouter free models chosen for AI enrichment, tried in order' })
  getAiModels(@CurrentUser() user: AuthUser) {
    return this.settings.getAiModels(user);
  }

  @Patch('ai-models')
  @ApiOperation({ summary: 'Set the (up to 3) OpenRouter models to use, in priority order' })
  updateAiModels(@CurrentUser() user: AuthUser, @Body() dto: UpdateAiModelsDto) {
    return this.settings.updateAiModels(user, dto.models);
  }

  @Get('oauth')
  @ApiOperation({ summary: 'Whether each OAuth provider (Google, Microsoft) is configured' })
  getOAuthProviders(@CurrentUser() user: AuthUser) {
    return this.settings.getOAuthProviders(user);
  }

  @Patch('oauth/:provider')
  @ApiOperation({ summary: 'Configure an OAuth provider client id/secret for sign-in' })
  updateOAuthProvider(
    @CurrentUser() user: AuthUser,
    @Param('provider') provider: OAuthProviderKey,
    @Body() dto: UpdateOAuthProviderDto,
  ) {
    return this.settings.updateOAuthProvider(user, provider, dto);
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Recent audit trail entries, most recent first' })
  getAuditLog(@CurrentUser() user: AuthUser) {
    return this.settings.getAuditLog(user);
  }

  @Get('audit-log/verify')
  @ApiOperation({ summary: 'Recomputes the hash chain to prove the audit trail has not been tampered with' })
  verifyAuditLog(@CurrentUser() user: AuthUser) {
    return this.settings.verifyAuditLog(user);
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

  @Get('migration/export')
  @ApiOperation({
    summary: 'Download everything (data + media/document files) as a single .zip',
    description: 'Full portable export for moving this installation to another server.',
  })
  async exportMigration(@CurrentUser() user: AuthUser, @Res() res: Response) {
    await this.migration.exportMigration(user, res);
  }

  @Post('migration/import')
  @ApiOperation({
    summary: 'Restore a .zip produced by migration/export — always creates a new organization',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, _file, cb) => cb(null, `arterio-import-${randomBytes(8).toString('hex')}.zip`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
          cb(new BadRequestException('Expected a .zip file'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async importMigration(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      return await this.migration.importMigration(file.path);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
}
