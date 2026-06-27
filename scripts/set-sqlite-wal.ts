/**
 * Put the SQLite database at DATABASE_URL into WAL journal mode.
 *
 * Run as a CHILD PROCESS (via tsx) from the e2e global setup — importing the
 * generated Prisma client (CommonJS) into Playwright's ESM config loader throws
 * "exports is not defined in ES module scope"; a tsx child handles the CJS client
 * fine (the same reason prisma/seed.ts runs as a child). No-op on Postgres. WAL is
 * persistent on the file, so the production server (`next start`) and any other
 * connection inherit it — preventing the rollback-mode write starvation that hangs
 * the disabled-while-pending accept button under load (STATUS #16/#17).
 */
import { isPostgresUrl, makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || isPostgresUrl(url)) return; // SQLite-only; production is Postgres (#35)

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode=WAL');
    const mode = rows?.[0]?.journal_mode?.toLowerCase();
    if (mode !== 'wal') {
      console.warn(`[set-sqlite-wal] WAL not enabled (journal_mode=${mode ?? 'unknown'})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
