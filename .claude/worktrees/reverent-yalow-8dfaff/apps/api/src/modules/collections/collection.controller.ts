import { Body, Controller, Delete, Param, Patch, Post, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { CollectionService } from './collection.service';
import { CreateCollectionDto, UpdateCollectionDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('collections')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('collections')
export class CollectionController {
  constructor(private readonly collections: CollectionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List collections with artwork counts' })
  list(@CurrentUser() user: AuthUser) {
    return this.collections.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Create a collection' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCollectionDto) {
    return this.collections.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Update a collection' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Delete a collection — its artworks are unlinked, never deleted' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.collections.remove(user, id);
  }
}
