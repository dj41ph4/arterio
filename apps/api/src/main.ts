import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AppModule } from './app.module';
import type { Env } from './core/config/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // ---------------------------------------------------------------------------
  // Uploaded media — served directly from disk in dev (bypasses the /api prefix)
  // ---------------------------------------------------------------------------
  const uploadDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads' });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const appUrl = config.get('APP_URL', { infer: true });
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: isProd
      ? undefined
      : false, // relaxed in dev for Swagger UI
  }));
  app.use(cookieParser());

  // ---------------------------------------------------------------------------
  // CORS — allow the web app and Swagger UI in dev
  // ---------------------------------------------------------------------------
  app.enableCors({
    origin: isProd ? [appUrl] : [appUrl, 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    // Cache the preflight so the browser doesn't re-issue an OPTIONS request
    // before every single call — without this, every GET/POST pays double.
    maxAge: 86400,
  });

  // ---------------------------------------------------------------------------
  // API versioning + global prefix
  // ---------------------------------------------------------------------------
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ---------------------------------------------------------------------------
  // Validation pipe — strip unknown fields, transform primitives
  // ---------------------------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---------------------------------------------------------------------------
  // Swagger / OpenAPI (always on — protected in prod by Nginx)
  // ---------------------------------------------------------------------------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Arterio API')
    .setDescription('Art collection management platform — REST API v1')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer(`http://localhost:${port}`, 'Local development')
    .addServer(appUrl, 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Arterio API Docs',
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  console.log(`\n🎨 Arterio API running on http://localhost:${port}/api`);
  console.log(`📖 Swagger docs:     http://localhost:${port}/api/docs`);
  console.log(`🏥 Health check:     http://localhost:${port}/api/v1/health\n`);
}

void bootstrap();
