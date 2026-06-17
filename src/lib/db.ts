import { PrismaClient } from '@/generated/prisma/client';
import { makeAdapter } from './db-adapter';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient(): PrismaClient {
  return new PrismaClient({ adapter: makeAdapter(process.env.DATABASE_URL) });
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
