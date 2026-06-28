import { Module } from '@nestjs/common';
import { ArtistController } from './artist.controller';
import { ArtistService } from './artist.service';
import { ArtistEnrichmentService } from './artist-enrichment.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ArtistController],
  providers: [ArtistService, ArtistEnrichmentService],
  exports: [ArtistService],
})
export class ArtistsModule {}
