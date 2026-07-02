import { Module } from '@nestjs/common';
import { ArtworkController } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { MediaIndexService } from './media-index.service';

@Module({
  controllers: [ArtworkController],
  providers: [ArtworkService, MediaIndexService],
  exports: [ArtworkService, MediaIndexService],
})
export class CatalogModule {}
