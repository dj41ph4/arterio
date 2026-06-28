import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type ArtworkQuery } from '@arterio/shared';
import { ArtworkService } from './artwork.service';
import { ListArtworksQueryDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';
import { UPLOAD_DIR } from '../../core/config/paths';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@ApiTags('artworks')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('artworks')
export class ArtworkController {
  constructor(private readonly artworks: ArtworkService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List artworks (filtered, sorted, paginated)' })
  list(@CurrentUser() user: AuthUser, @Query() q: ListArtworksQueryDto) {
    const query: ArtworkQuery = {
      search: q.search,
      status: q.status,
      collectionId: q.collectionId,
      artistId: q.artistId,
      exhibitionId: q.exhibitionId,
      locationId: q.locationId,
      favorite: q.favorite,
      sort: q.sortField ? { field: q.sortField, dir: q.sortDir ?? 'asc' } : undefined,
      locale: q.locale as ArtworkQuery['locale'],
      cursor: q.cursor ?? null,
      limit: q.limit,
    };
    return this.artworks.list(user, query);
  }

  @Get('facets/all')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Facet counts for filters (status, condition, collection)' })
  facets(@CurrentUser() user: AuthUser) {
    return this.artworks.facets(user);
  }

  @Get('trash')
  @RequirePermissions(PERMISSIONS.ARTWORK_DELETE)
  @ApiOperation({ summary: 'List soft-deleted artworks' })
  listTrash(@CurrentUser() user: AuthUser) {
    return this.artworks.listTrash(user);
  }

  @Post(':id/restore')
  @RequirePermissions(PERMISSIONS.ARTWORK_DELETE)
  @ApiOperation({ summary: 'Restore an artwork from the trash' })
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.artworks.restore(user, id);
  }

  @Delete(':id/purge')
  @RequirePermissions(PERMISSIONS.ARTWORK_DELETE)
  @ApiOperation({ summary: 'Permanently delete an artwork already in the trash — cannot be undone' })
  async purge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.artworks.purge(user, id);
    return { ok: true };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Create an artwork' })
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.artworks.create(user, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Get a single artwork' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.artworks.getById(user, id);
  }

  @Patch(':id/favorite')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Toggle favorite' })
  async favorite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('value') value: boolean,
  ) {
    await this.artworks.setFavorite(user, id, value);
    return { ok: true };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Update an artwork' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.artworks.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_DELETE)
  @ApiOperation({ summary: 'Delete an artwork' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.artworks.remove(user, id);
    return { ok: true };
  }

  @Patch(':id/location')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Move an artwork to a new location, recording it in the movement history' })
  moveLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { locationId: string | null; reason?: string },
  ) {
    return this.artworks.moveLocation(user, id, body.locationId, body.reason);
  }

  @Post(':id/media')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Upload an image for an artwork (becomes the primary thumbnail if first)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${randomBytes(16).toString('hex')}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
          cb(new BadRequestException('Unsupported image type'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadMedia(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.artworks.attachMedia(user, id, file);
  }

  @Post(':id/media/from-url')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Download an image found by AI autofill and attach it as artwork media' })
  attachMediaFromUrl(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body('url') url: string) {
    if (!url) throw new BadRequestException('Missing url');
    return this.artworks.attachMediaFromUrl(user, id, url);
  }

  @Delete(':id/media/:mediaId')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Remove an uploaded image from an artwork' })
  removeMedia(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.artworks.removeMedia(user, id, mediaId);
  }
}
