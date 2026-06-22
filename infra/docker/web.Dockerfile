# syntax=docker/dockerfile:1
# ---- Next.js web (standalone) — built from the monorepo root context ----

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN npm install --no-audit --no-fund

# ---- Build ----
# NOTE: we deliberately do NOT bake NEXT_PUBLIC_API_URL here. Leaving it unset
# lets the browser derive the API URL from the host that served the page (see
# apps/web/src/lib/api/client.ts), so the same image works on any IP/hostname.
# To pin a fixed public domain instead, pass --build-arg NEXT_PUBLIC_API_URL=...
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Production images talk to the real NestJS API (the mock dataset is a dev-only
# default in the repository code). Override with --build-arg to ship a demo.
ARG NEXT_PUBLIC_DATA_SOURCE=http
ENV NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=@arterio/shared \
 && npm run build --workspace=@arterio/web

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
