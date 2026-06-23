import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@arterio/shared';
import { DocumentService } from './document.service';
import { CreateDocumentDto, UpdateDocumentDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('documents')
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'List documents' })
  list(@CurrentUser() user: AuthUser, @Query('artworkId') artworkId?: string) {
    return this.documents.list(user, artworkId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Create a document record' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.documents.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Update a document record' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Delete a document record' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.remove(user, id);
  }
}
