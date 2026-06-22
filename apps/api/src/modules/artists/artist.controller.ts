import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { ArtistService } from './artist.service';
import { CreateArtistDto, ListArtistsQueryDto, UpdateArtistDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('artists')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('artists')
export class ArtistController {
  constructor(private readonly artists: ArtistService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List artists' })
  list(@CurrentUser() user: AuthUser, @Query() q: ListArtistsQueryDto) {
    return this.artists.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Get artist with artworks and enrichment data' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.artists.getById(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Create artist — auto-enriches from Wikipedia/Wikidata' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateArtistDto) {
    return this.artists.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Update artist metadata' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateArtistDto,
  ) {
    return this.artists.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({
    summary: 'Delete an artist',
    description: 'Refuses if the artist still has artworks attached unless force=true, which unlinks the artworks (sets artistId to null) before deleting.',
  })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('force') force?: string) {
    return this.artists.remove(user, id, force === 'true');
  }

  @Post('merge/auto')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({
    summary: 'Auto-merge near-duplicate artists',
    description:
      'Groups artists sharing a core name, verifies each group against Wikidata to ' +
      'rule out homonyms, and merges the ones that resolve to exactly one unambiguous ' +
      'art-world person. Ambiguous or unverifiable groups are reported, never guessed.',
  })
  mergeAuto(@CurrentUser() user: AuthUser) {
    return this.artists.autoMergeDuplicates(user);
  }

  @Post(':id/enrich')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({
    summary: 'Re-fetch biographical data from Wikipedia & Wikidata',
    description:
      'Queries Wikipedia REST API and Wikidata SPARQL (no API key required). ' +
      'Stores multilingual biographies, birth/death dates, nationality, ' +
      'movement, and external IDs (ULAN, VIAF). Manual edits are never overwritten.',
  })
  enrich(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.artists.enrich(user, id);
  }
}
