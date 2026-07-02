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
import { PERMISSIONS } from '@arterio/shared';
import { DocumentService } from './document.service';
import { CreateDocumentDto, UpdateDocumentDto } from './dto';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UPLOAD_DIR } from '../../core/config/paths';
import type { AuthUser } from '../../common/types';

const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

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

  @Post(':id/file')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Upload the document file (new version) — invoices are OCR-analyzed automatically' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${randomBytes(16).toString('hex')}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => cb(null, ALLOWED_DOC_TYPES.has(file.mimetype)),
    }),
  )
  uploadFile(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Fichier manquant ou format non supporté (PDF, JPEG, PNG, WebP — 15 Mo max).');
    return this.documents.addVersion(user, id, { filename: file.filename, mimetype: file.mimetype, size: file.size });
  }

  @Post(':id/ocr')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Run OCR on the latest file version (+ structured extraction for invoices)' })
  runOcr(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.runOcr(user, id);
  }
}
