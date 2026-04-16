import { PrismaClient } from '@prisma/client';

// Prevent multiple instances of Prisma Client in development
declare global {
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient({
  // Optimize connection pool for production
  // Default is 5 connections with no timeout — causes pool exhaustion under load
  datasources: process.env.NODE_ENV === 'production' ? {
    db: {
      url: (process.env.DATABASE_URL || '') + 
        (process.env.DATABASE_URL?.includes('?') ? '&' : '?') +
        'connection_limit=15&pool_timeout=10'
    }
  } : undefined,
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
});

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

export { prisma };
export default prisma;
