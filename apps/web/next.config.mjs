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
  // experience as any other reverse-proxied app. Defaults to "localhost:4000",
  // correct both for local dev (API runs on the host) and the all-in-one
  // Docker image (API runs in the same container) — override
  // API_INTERNAL_URL only if you genuinely run the API on a different host.
  async rewrites() {
    const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
    return [
      { source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${apiInternalUrl}/uploads/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
