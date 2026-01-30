import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Build connection URL with pool parameters for Supabase session mode
const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL || '';
  // Add pgbouncer params if not already present
  if (baseUrl && !baseUrl.includes('pgbouncer=')) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}pgbouncer=true&connection_limit=1`;
  }
  return baseUrl;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

// Cache Prisma client in all environments to prevent connection exhaustion
globalForPrisma.prisma = prisma;

// Handle cleanup on process termination
if (process.env.NODE_ENV !== 'production') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

export default prisma;
