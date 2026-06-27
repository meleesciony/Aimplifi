/**
 * Regression lock for the SimpleFIN SQLITE_BUSY flake (REGRESSION_LEDGER).
 *
 * The unit suite runs many parallel workers against one SQLite file. WAL journal
 * mode is what keeps a writer from being starved by concurrent readers — in the
 * default rollback journal that starvation throws SQLITE_BUSY, which
 * connectSimplefin's catch swallowed into `added: 0` (the flaky "expected 0 to be
 * 2"). The vitest globalSetup switches dev.db to WAL; if that wiring is removed or
 * the file reverts to a rollback journal, the flake can return — so assert the mode
 * here and fail loudly instead.
 *
 * As of STATUS #16/#17 the test database is a file under the OS temp dir, off the
 * OneDrive-synced tree (tests/setup/test-db.ts) — but WAL is still wanted there to
 * keep the in-process reader/writer overlap from contending, so this assertion
 * stands. tests/unit/test-db-location.test.ts separately locks the off-tree path.
 *
 * Scope of protection: this reliably catches an unwired globalSetup on a fresh / CI
 * checkout, where the DB is created in rollback ("delete") mode and would read
 * non-wal. On a machine whose temp DB is already persistently WAL, removing the
 * wiring would not be caught until the file is recreated — an accepted blind spot
 * (the path that matters for a pipeline is covered).
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

describe('local test database concurrency mode (flake regression)', () => {
  it('runs the SQLite suite in WAL journal mode (set by vitest globalSetup)', async () => {
    // Read with a bounded retry: the single test DB is hit by every worker, so a
    // single read can transiently throw or see a stale mode. A genuinely reverted
    // journal (globalSetup unwired) reads non-wal on EVERY attempt and still fails
    // — so this tolerates blips, not bugs.
    let mode: string | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
        mode = rows[0]?.journal_mode?.toLowerCase();
        if (mode === 'wal') break;
      } catch {
        // transient contention (SQLITE_BUSY / external file lock) — retry
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(mode).toBe('wal');
  });
});
