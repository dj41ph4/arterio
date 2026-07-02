import { Module } from '@nestjs/common';
import { RestorationController } from './restoration.controller';
import { RestorationService } from './restoration.service';

@Module({
  controllers: [RestorationController],
  providers: [RestorationService],
})
export class RestorationsModule {}
