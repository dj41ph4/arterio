import { z } from 'zod';

/** Validated environment. Fail fast on boot if misconfigured. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:3000'),
  // Extra CORS origins (comma-separated) on top of APP_URL + auto-allowed LAN.
  CORS_ORIGINS: z.string().optional(),
  // Off by default — existing deployments keep talking plain HTTP behind
  // their reverse proxy. When set, the API serves HTTPS directly using a
  // self-signed certificate generated at boot (no real cert needed: the
  // reverse proxy in front is what end users actually trust).
  HTTPS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // SQLite by default — a single file, no separate database server. In Docker
  // this points at a mapped volume (see infra/docker/all-in-one.Dockerfile).
  DATABASE_URL: z.string().default('file:./dev.db'),
  // Where uploaded media is written. Defaults to <cwd>/uploads; the container
  // overrides it to live alongside the database in the mapped /data volume.
  UPLOAD_DIR: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2_592_000),

  // 32-byte base64 key for AES-256-GCM. Dev default is clearly insecure.
  DATA_ENCRYPTION_KEY: z
    .string()
    .default(Buffer.alloc(32, 'arterio-dev-key').toString('base64')),

  SUPPORTED_LOCALES: z.string().default('en,fr,it,es,de,nl'),
  DEFAULT_LOCALE: z.string().default('en'),

  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AI_PROVIDER: z.enum(['anthropic', 'openrouter', 'openai', 'local', 'none']).default('none'),
  AI_MODEL: z.string().default('claude-opus-4-8'),
  ANTHROPIC_API_KEY: z.string().optional(),
  // OpenRouter integration (optional)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('openrouter/auto'),
  // Gemini (Google AI Studio) — free-tier fallback for when OpenRouter's free
  // models hit a 402/429, or as the preferred provider if an org orders it
  // first (see Settings → AI). Native Google Search grounding, no separate
  // "web" plugin fee unlike OpenRouter.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  // Mistral (La Plateforme) — native web_search grounding via the Conversations
  // API, free-tier key available from console.mistral.ai. A third provider an
  // org can mix into the fallback chain alongside OpenRouter/Gemini, in any order.
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL: z.string().default('mistral-medium-latest'),

  // Artist enrichment fallback sources — used when Wikidata has no unambiguous
  // art-world match. The Met and AIC APIs are keyless; the rest are free but
  // require registering for a key, so they no-op when unset.
  EUROPEANA_API_KEY: z.string().optional(),
  RIJKSMUSEUM_API_KEY: z.string().optional(),
  HARVARD_API_KEY: z.string().optional(),
  SMITHSONIAN_API_KEY: z.string().optional(),

  // Outbound email (password reset, future notifications) — optional. The
  // platform runs fully without it; self-service password reset and email
  // alerts simply stay unavailable until an operator sets these.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_FROM: z.string().default('Arterio <no-reply@arterio.app>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
