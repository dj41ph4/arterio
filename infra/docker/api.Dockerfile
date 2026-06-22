# syntax=docker/dockerfile:1
# ---- NestJS API — built from the monorepo root context ----

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN npm install --no-audit --no-fund

# ---- Build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run generate --workspace=@arterio/database \
 && npm run build --workspace=@arterio/database \
 && npm run build --workspace=@arterio/shared \
 && npm run build --workspace=@arterio/api

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages ./packages

USER nestjs
EXPOSE 4000
ENV PORT=4000
# On boot: create/sync the database schema (no migration files exist — the
# project uses `prisma db push`, which is idempotent and a no-op once the schema
# matches), then start the API. This makes a fresh Postgres "just work".
CMD ["sh", "-c", "npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate && node apps/api/dist/main.js"]
