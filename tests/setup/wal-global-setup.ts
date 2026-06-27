/**
 * Vitest global setup — prepare the local SQLite test database (a file under the
 * OS temp dir, OFF the OneDrive-synced tree; see tests/setup/test-db.ts).
 *
 * 1. `prisma db push` creates/syncs the schema. The DB lives outside the repo, so
 *    a fresh checkout / CI / first run starts with no file at all; push is
 *    idempotent and doubles as drift protection against schema.prisma.
 * 2. Switch the file to WAL journal mode before the workers spawn.
 * 3. `prisma db seed` loads the deterministic demo dataset. Integration tests that
 *    read the seeded `user-demo` data (e.g. the triage queue probe) require it, and
 *    re-seeding every run keeps that demo fixture deterministic (the seed wipes its
 *    own tables + the user cascade; a few ancillary tables like RateLimit are not part
 *    of the wipe, but their tests are key-isolated and self-cleaning).
 *
 * Why WAL: the unit suite is integration-heavy and opens ONE database from many
 * worker processes. In the default rollback journal ("delete") mode a writer must
 * wait for every reader to release its SHARED lock, so under load a write can
 * exceed busy_timeout and throw SQLITE_BUSY. connectSimplefin's intentional
 * credential-safe catch then masks that as `added: 0` — the flaky "expected 0 to
 * be 2". WAL lets concurrent readers and a single writer proceed without blocking;
 * it is persistent on the file, so every worker connection inherits it. Relocating
 * the file off the synced tree removes the EXTERNAL (OneDrive) lock contention that
 * WAL alone could not wait out. Production runs on Postgres (DECISIONS #35), so all
 * of this affects the local/test SQLite path only.
 *
 * Proven mechanism: a rollback-journal write is starved to SQLITE_BUSY while a WAL
 * write proceeds (fail-before/pass-after). Locked by tests/unit/db-wal.test.ts; the
 * off-tree location is locked by tests/unit/test-db-location.test.ts.
 */
import { execSync } from 'node:child_process';
import { prisma } from '../../src/lib/db';
import { UNIT_DB_URL } from './test-db';

export default async function setup(): Promise<void> {
  const env = { ...process.env, DATABASE_URL: UNIT_DB_URL };

  // 1. Schema.
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env });

  // 2. WAL (persistent on the file; do it before seeding so the seed writes in WAL).
  const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode=WAL');
  const mode = rows?.[0]?.journal_mode?.toLowerCase();
  if (mode !== 'wal') {
    // Don't hard-fail setup: a filesystem that can't do WAL (e.g. a network mount)
    // still runs, just with the old contention. The regression test reports the
    // reversion loudly so it can't pass silently.
    console.warn(`[vitest globalSetup] WAL not enabled (journal_mode=${mode ?? 'unknown'})`);
  }
  await prisma.$disconnect();

  // 3. Deterministic demo seed (the integration tests' fixture).
  execSync('npx prisma db seed', { stdio: 'inherit', env });
}
