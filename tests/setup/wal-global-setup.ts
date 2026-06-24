/**
 * Vitest global setup — put the local SQLite test database into WAL journal mode
 * before the suite runs.
 *
 * The unit suite is integration-heavy and opens ONE dev.db from many parallel
 * worker processes. In the default rollback journal ("delete") mode a writer must
 * wait for every reader to release its SHARED lock, so under load (e.g. a CPU/IO
 * spike from a background indexer) a write can exceed busy_timeout and throw
 * SQLITE_BUSY. connectSimplefin's intentional credential-safe catch then masks
 * that as `added: 0` — surfacing as the flaky "expected 0 to be 2" failure.
 *
 * WAL lets concurrent readers and a single writer proceed without blocking each
 * other, removing the contention. WAL is persistent on the database file, so every
 * worker connection inherits it after this one-time switch. Production runs on
 * Postgres (DECISIONS #35), so this affects the local/test SQLite path only.
 *
 * Proven mechanism: a rollback-journal write is starved to SQLITE_BUSY while a WAL
 * write proceeds (fail-before/pass-after). Locked by tests/unit/db-wal.test.ts.
 */
import { prisma } from '../../src/lib/db';

export default async function setup(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode=WAL');
  const mode = rows?.[0]?.journal_mode?.toLowerCase();
  if (mode !== 'wal') {
    // Don't hard-fail setup: a filesystem that can't do WAL (e.g. a network mount)
    // still runs, just with the old contention. The regression test reports the
    // reversion loudly so it can't pass silently.
    console.warn(`[vitest globalSetup] WAL not enabled (journal_mode=${mode ?? 'unknown'})`);
  }
  await prisma.$disconnect();
}
