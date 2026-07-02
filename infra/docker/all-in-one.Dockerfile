# syntax=docker/dockerfile:1
# ---- Arterio, single image — API + Web in one container ----
#
# Runs both the NestJS API and the Next.js web app as sibling processes in one
# container, so the web app's internal API proxy (apps/web/next.config.mjs
# rewrites) always reaches the API via plain "localhost" — no Docker network/
# DNS between two containers to get wrong, which is exactly the class of bug
# ("api doesn't resolve", "Failed to fetch", silent 500s) that motivated this
# image. Only port 3000 (web) needs to be published/reverse-proxied; the API
# on 4000 is reachable from the host too if you want direct access (Swagger,
# debugging) but never needs to be exposed to the internet.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl bash
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
ENV NEXT_TELEMETRY_DISABLED=1
# Same rationale as web.Dockerfile: leave NEXT_PUBLIC_API_URL unset so the
# browser derives the API origin from whatever host actually served the page.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DATA_SOURCE=http
ENV NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run generate --workspace=@arterio/database \
 && npm run build --workspace=@arterio/database \
 && npm run build --workspace=@arterio/shared \
 && npm run build --workspace=@arterio/api \
 && npm run build --workspace=@arterio/web

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# --- API, under /app/api ---
COPY --from=builder /app/node_modules ./api/node_modules
COPY --from=builder /app/apps/api/dist ./api/apps/api/dist
COPY --from=builder /app/apps/api/package.json ./api/apps/api/
COPY --from=builder /app/packages ./api/packages

ENV DATABASE_URL=file:/data/arterio.db
ENV UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads
VOLUME /data

# --- Web, under /app/web (Next.js standalone output is self-contained) ---
COPY --from=builder /app/apps/web/public ./web/apps/web/public
COPY --from=builder /app/apps/web/.next/standalone ./web
COPY --from=builder /app/apps/web/.next/static ./web/apps/web/.next/static

COPY infra/docker/start-all-in-one.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000 4000
# The web process talks to the API over plain localhost — same container,
# same network namespace, always correct, nothing to configure. start.sh sets
# each process's own PORT explicitly (api: 4000, web: 3000).
ENV API_INTERNAL_URL=http://localhost:4000
CMD ["/app/start.sh"]
