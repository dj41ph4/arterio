import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client.
 *
 * In development Next.js / Nest hot-reload would otherwise spawn a new client on
 * every reload and exhaust the connection pool, so we cache it on globalThis.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';
