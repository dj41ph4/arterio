import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { LocationService } from './location.service';
import { CreateLocationDto, UpdateLocationDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('locations')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List storage/display locations' })
  list(@CurrentUser() user: AuthUser) {
    return this.locations.list(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Create a location' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Update a location' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Delete a location' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.locations.remove(user, id);
  }
}
