import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { validateEnv } from './core/config/configuration';
import { PrismaModule } from './core/prisma/prisma.module';
import { CryptoModule } from './core/crypto/crypto.module';
import { AuditModule } from './core/audit/audit.module';
import { EmailModule } from './core/email/email.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/artwork.module';
import { ArtistsModule } from './modules/artists/artists.module';
import { ExhibitionsModule } from './modules/exhibitions/exhibitions.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RestorationsModule } from './modules/restorations/restorations.module';
import { LoansModule } from './modules/loans/loans.module';
import { LocationsModule } from './modules/locations/locations.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AiModule } from './modules/ai/ai.module';
import { MembersModule } from './modules/members/members.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SetupModule } from './modules/setup/setup.module';
import { SearchModule } from './modules/search/search.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

@Module({
  imports: [
    // Config — validates env on startup, available everywhere via ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),

    // JwtService for the global JwtAuthGuard below (verify-only — secret passed per-call)
    JwtModule.register({}),

    // Infrastructure
    PrismaModule,
    CryptoModule,
    AuditModule,
    EmailModule,

    // Features
    AuthModule,
    CatalogModule,
    ArtistsModule,
    ExhibitionsModule,
    CollectionsModule,
    ReportsModule,
    RestorationsModule,
    LoansModule,
    LocationsModule,
    DocumentsModule,
    AiModule,
    MembersModule,
    SettingsModule,
    SetupModule,
    SearchModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: JwtAuthGuard populates req.user, then PermissionsGuard reads it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
