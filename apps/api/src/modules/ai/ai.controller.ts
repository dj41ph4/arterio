import { Body, Controller, Inject, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

/** Lets the frontend show/hide "AI autocomplete" buttons without duplicating the enabled-check logic. */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('ai')
export class AiController {
  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  @Post('autofill/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'AI-suggested artwork fields from title + artist name (OpenRouter-backed)' })
  async autofillArtwork(
    @CurrentUser() user: AuthUser,
    @Body() body: { title?: string; artistName?: string; locale?: Locale },
  ) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('AI is not configured for this organization');
    }
    return this.ai.autofillArtwork({
      title: body.title,
      artistName: body.artistName,
      locale: body.locale ?? 'en',
      organizationId: user.organizationId,
    });
  }

  @Post('autofill/artist')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'AI-suggested artist bio/dates/nationality from a full name (OpenRouter-backed)' })
  async autofillArtist(@CurrentUser() user: AuthUser, @Body() body: { fullName: string; locale?: Locale }) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('AI is not configured for this organization');
    }
    return this.ai.autofillArtist({
      fullName: body.fullName,
      locale: body.locale ?? 'en',
      organizationId: user.organizationId,
    });
  }
}
