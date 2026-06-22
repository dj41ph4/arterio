import { Module } from '@nestjs/common';
import { ArtistController } from './artist.controller';
import { ArtistService } from './artist.service';
import { ArtistEnrichmentService } from './artist-enrichment.service';

@Module({
  controllers: [ArtistController],
  providers: [ArtistService, ArtistEnrichmentService],
  exports: [ArtistService],
})
export class ArtistsModule {}
