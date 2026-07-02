import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { makeAdapter } from './db-adapter';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient(): PrismaClient {
  return new PrismaClient({ adapter: makeAdapter(process.env.DATABASE_URL) });
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Interactive transaction at SERIALIZABLE isolation with a bounded retry
 * (cycle-2 checker P1: the check-then-act transactions — sync guards, the
 * pending→posted transplant, fileMerchantGroup — were "atomic" only because
 * SQLite serializes write transactions; production is Postgres at READ
 * COMMITTED, where a concurrent commit between an in-tx read and its write
 * silently clobbers a user decision, records stale-fromCategoryId corrections,
 * or mints duplicate rules).
 *
 * Serializable closes the whole class: Postgres detects the write-write
 * conflict (first-updater-wins) EVEN when the other writer runs at READ
 * COMMITTED, and SSI's predicate locking catches read-then-insert races
 * (e.g. two group-files both missing the rule-dedupe findFirst) between two
 * serializable transactions. A detected conflict aborts with P2034; the whole
 * fn re-runs against fresh state (all its writes rolled back), so fn must have
 * no external side effects — DB-only, which all four call sites are. On the
 * better-sqlite3 adapter the level is accepted and semantically a no-op
 * (single-writer file lock — probed 2026-07-02, DECISIONS #146).
 */
/** True when the error is Prisma P2002 — a unique-constraint violation. Used by the
 *  sync ingest loops to convert a lost create/create race (two overlapping syncs,
 *  CQ-2 class) into the guarded-update path instead of aborting the whole sync. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function serializableTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { attempts?: number; client?: Pick<PrismaClient, '$transaction'> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const client = opts.client ?? prisma;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e) {
      const conflict =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (!conflict || attempt >= attempts) throw e; // fail loudly — never continue past a real error
    }
  }
}
