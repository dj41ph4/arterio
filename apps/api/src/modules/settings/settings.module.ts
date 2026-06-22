import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { MigrationService } from './migration.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, MigrationService],
  exports: [MigrationService],
})
export class SettingsModule {}
