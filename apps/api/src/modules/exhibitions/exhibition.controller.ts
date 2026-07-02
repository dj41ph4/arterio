import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { ExhibitionService } from './exhibition.service';
import { CreateExhibitionDto, UpdateExhibitionDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('exhibitions')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('exhibitions')
export class ExhibitionController {
  constructor(private readonly exhibitions: ExhibitionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List exhibitions' })
  list(@CurrentUser() user: AuthUser, @Query('artworkId') artworkId?: string) {
    return this.exhibitions.list(user, artworkId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXHIBITION_MANAGE)
  @ApiOperation({ summary: 'Create an exhibition' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExhibitionDto) {
    return this.exhibitions.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXHIBITION_MANAGE)
  @ApiOperation({ summary: 'Update an exhibition' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateExhibitionDto) {
    return this.exhibitions.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXHIBITION_MANAGE)
  @ApiOperation({ summary: 'Delete an exhibition' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exhibitions.remove(user, id);
  }
}
