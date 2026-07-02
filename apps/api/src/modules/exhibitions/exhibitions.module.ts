import { Module } from '@nestjs/common';
import { ExhibitionController } from './exhibition.controller';
import { ExhibitionService } from './exhibition.service';

@Module({
  controllers: [ExhibitionController],
  providers: [ExhibitionService],
})
export class ExhibitionsModule {}
