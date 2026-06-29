import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: process.cwd().includes('apps') ? undefined : process.cwd(),
  // Shared workspace package ships TS source; let Next compile it.
  transpilePackages: ['@arterio/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
    ],
  },
  // Lets a single reverse-proxy hostname serve both web and API: Next.js
  // forwards /api/v1/* and /uploads/* server-side to the actual API instead
  // of the browser ever calling it directly, so the browser only ever sees
  // one origin and never needs CORS — the same "one proxy entry, just works"
  // experience as any other reverse-proxied app. Defaults to "localhost:4000"
  // since that's correct both for local dev (API runs on the host) and the
  // combined all-in-one Docker image (API runs in the same container) — the
  // split two-container deployment (infra/synology/docker-compose.split.yml)
  // overrides API_INTERNAL_URL to the api container's address explicitly,
  // since "localhost" inside the web container isn't the api container there.
  async rewrites() {
    const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
    return [
      { source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${apiInternalUrl}/uploads/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
