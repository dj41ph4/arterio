import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { SearchService } from './search.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

const LOCALES: Locale[] = ['en', 'fr', 'it', 'es', 'de', 'nl'];

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Unified instant search — artworks, artists, documents (incl. OCR text), exhibitions' })
  run(@CurrentUser() user: AuthUser, @Query('q') q?: string, @Query('locale') locale?: string) {
    const loc: Locale = LOCALES.includes(locale as Locale) ? (locale as Locale) : 'fr';
    return this.search.search(user, q ?? '', loc);
  }
}
