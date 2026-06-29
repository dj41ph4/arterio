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
  // forwards /api/v1/* and /uploads/* server-side to the API container over
  // the Docker-internal network, so the browser only ever sees one origin
  // (the web app's domain) and never needs CORS at all — the same "one proxy
  // entry, just works" experience as any other reverse-proxied app. Falls
  // back to the docker-compose service name "api" (the default in
  // infra/synology/docker-compose.yml); override API_INTERNAL_URL if the API
  // genuinely runs on a different host/port.
  async rewrites() {
    const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://api:4000').replace(/\/+$/, '');
    return [
      { source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${apiInternalUrl}/uploads/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
