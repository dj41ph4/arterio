import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SetupService } from './setup.service';
import { MigrationService } from '../settings/migration.service';
import { CompleteSetupDto } from './dto';
import { Public } from '../../common/decorators';

@ApiTags('setup')
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly migration: MigrationService,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Whether the first-run setup wizard still needs to be completed' })
  async status() {
    return { needsSetup: await this.setup.needsSetup() };
  }

  @Public()
  @Post()
  @ApiOperation({
    summary: 'Create the first organization + administrator account',
    description: 'Only succeeds once — refuses if any organization already exists.',
  })
  complete(@Body() dto: CompleteSetupDto, @Req() req: Request) {
    return this.setup.complete(dto, { ip: req.ip, ua: req.headers['user-agent'] });
  }

  @Public()
  @Post('import')
  @ApiOperation({
    summary: 'First-run alternative to creating a fresh organization — restore a migration .zip instead',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, _file, cb) => cb(null, `arterio-import-${randomBytes(8).toString('hex')}.zip`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
          cb(new BadRequestException('Expected a .zip file'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async importDuringSetup(@UploadedFile() file: Express.Multer.File) {
    if (!(await this.setup.needsSetup())) {
      throw new ConflictException('Setup has already been completed');
    }
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      return await this.migration.importMigration(file.path);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
}
