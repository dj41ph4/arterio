import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { RestorationService } from './restoration.service';
import { CreateRestorationDto, UpdateRestorationDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('restorations')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('restorations')
export class RestorationController {
  constructor(private readonly restorations: RestorationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List restorations, optionally filtered by artwork' })
  list(@CurrentUser() user: AuthUser, @Query('artworkId') artworkId?: string) {
    return this.restorations.list(user, artworkId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RESTORATION_MANAGE)
  @ApiOperation({ summary: 'Propose a restoration — sets the artwork status to in_restoration' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRestorationDto) {
    return this.restorations.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.RESTORATION_MANAGE)
  @ApiOperation({ summary: 'Update a restoration — marking it completed returns the artwork to active' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRestorationDto) {
    return this.restorations.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.RESTORATION_MANAGE)
  @ApiOperation({ summary: 'Delete a restoration record' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.restorations.remove(user, id);
  }
}
