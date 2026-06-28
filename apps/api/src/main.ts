import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import selfsigned from 'selfsigned';
import { AppModule } from './app.module';
import { UPLOAD_DIR, CUSTOM_CERT_PATH, CUSTOM_KEY_PATH } from './core/config/paths';
import type { Env } from './core/config/configuration';

/**
 * Self-signed — generated fresh on every boot, never persisted. Nothing is
 * meant to trust this certificate directly: it only exists so a reverse
 * proxy in front (which presents its own real, trusted certificate to end
 * users) can speak HTTPS to this upstream instead of plain HTTP. Off by
 * default (HTTPS_ENABLED=false) so existing plain-HTTP deployments are
 * unaffected.
 */
async function generateSelfSignedCert(): Promise<{ key: string; cert: string }> {
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'arterio' }], {
    notAfterDate,
    keySize: 2048,
    algorithm: 'sha256',
  });
  return { key: pems.private, cert: pems.cert };
}

/** A cert uploaded via Settings → HTTPS (see settings.service.ts) always wins over the self-signed default. */
async function loadHttpsOptions(): Promise<{ key: string; cert: string; custom: boolean }> {
  try {
    const [cert, key] = await Promise.all([readFile(CUSTOM_CERT_PATH, 'utf8'), readFile(CUSTOM_KEY_PATH, 'utf8')]);
    return { cert, key, custom: true };
  } catch {
    return { ...(await generateSelfSignedCert()), custom: false };
  }
}

async function bootstrap() {
  const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
  const httpsOptions = httpsEnabled ? await loadHttpsOptions() : null;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });

  // ---------------------------------------------------------------------------
  // Uploaded media — served directly from disk in dev (bypasses the /api prefix)
  // ---------------------------------------------------------------------------
  mkdirSync(UPLOAD_DIR, { recursive: true });
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads' });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const appUrl = config.get('APP_URL', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
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
  // CORS — a self-hosted appliance is reached by raw IP over the LAN, so we
  // can't know the exact origin ahead of time. We allow:
  //   - the canonical APP_URL,
  //   - any origin listed in CORS_ORIGINS (comma-separated),
  //   - localhost (dev / same-machine),
  //   - any private-LAN origin (10.x, 192.168.x, 172.16–31.x, *.local).
  // A public deployment should set APP_URL/CORS_ORIGINS to its real domain.
  // ---------------------------------------------------------------------------
  const explicitOrigins = new Set(
    [appUrl, ...(corsOrigins ? corsOrigins.split(',') : [])]
      .map((o) => o.trim())
      .filter(Boolean),
  );

  const isLanOrigin = (origin: string): boolean => {
    try {
      const { hostname } = new URL(origin);
      return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.local') ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
      );
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      // Non-browser clients (curl, server-to-server) send no Origin header.
      if (!origin || explicitOrigins.has(origin) || isLanOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
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
    .addServer(`${httpsEnabled ? 'https' : 'http'}://localhost:${port}`, 'Local development')
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
  const scheme = httpsEnabled ? 'https' : 'http';
  const certLabel = httpsOptions ? (httpsOptions.custom ? ' (custom certificate)' : ' (self-signed cert)') : '';
  console.log(`\n🎨 Arterio API running on ${scheme}://localhost:${port}/api${certLabel}`);
  console.log(`📖 Swagger docs:     ${scheme}://localhost:${port}/api/docs`);
  console.log(`🏥 Health check:     ${scheme}://localhost:${port}/api/v1/health\n`);
}

void bootstrap();
