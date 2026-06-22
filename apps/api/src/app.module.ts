import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './core/config/configuration';
import { PrismaModule } from './core/prisma/prisma.module';
import { CryptoModule } from './core/crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/artwork.module';
import { ArtistsModule } from './modules/artists/artists.module';
import { AiModule } from './modules/ai/ai.module';
import { MembersModule } from './modules/members/members.module';
import { SettingsModule } from './modules/settings/settings.module';
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

    // Rate limiting — limits overridden per controller/route as needed
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),

    // JwtService for the global JwtAuthGuard below (verify-only — secret passed per-call)
    JwtModule.register({}),

    // Infrastructure
    PrismaModule,
    CryptoModule,

    // Features
    AuthModule,
    CatalogModule,
    ArtistsModule,
    AiModule,
    MembersModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: JwtAuthGuard populates req.user, PermissionsGuard reads it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
