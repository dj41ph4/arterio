import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
