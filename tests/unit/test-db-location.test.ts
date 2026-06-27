/**
 * Regression lock: the unit/integration suite must run against a SQLite database
 * OUTSIDE the repo's (OneDrive-synced) working tree.
 *
 * The synced tree intermittently locks the `.db` / `-wal` / `-shm` files and starves
 * SQLite into SQLITE_BUSY — the documented flake (STATUS #16/#17). tests/setup/
 * test-db.ts relocates the database to the OS temp dir (or TEST_DB_DIR) and the
 * vitest config wires DATABASE_URL to it. If that wiring regresses, the Prisma client
 * falls back to the repo-root `file:./dev.db` (db-adapter.ts DEFAULT_SQLITE_URL) and
 * these fail. The expected base is derived from the SAME resolver the code uses
 * (testDbDir), so honoring a TEST_DB_DIR override never turns this red.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { testDbDir, testDbUrl } from '../setup/test-db';

describe('test database location (flake regression)', () => {
  it('connects to a database off the repo tree, under the configured test-db dir', async () => {
    // PRAGMA database_list returns the absolute filesystem path of the open "main"
    // database (empty for an in-memory DB).
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; file: string }>>('PRAGMA database_list');
    const main = rows.find((r) => r.name === 'main');
    expect(main).toBeDefined();
    expect(main!.file.length).toBeGreaterThan(0); // not :memory:

    const resolved = path.resolve(main!.file).toLowerCase();
    const repo = path.resolve(process.cwd()).toLowerCase();
    const base = path.resolve(testDbDir()).toLowerCase();

    // Load-bearing invariant: the live DB is NOT inside the repo working tree.
    expect(resolved.startsWith(repo)).toBe(false);
    // And it IS under the configured test-db dir (os.tmpdir() by default, or TEST_DB_DIR).
    expect(resolved.startsWith(base)).toBe(true);
  });

  it('testDbUrl builds a file: URL under the configured dir, off the repo', () => {
    const url = testDbUrl('sample');
    expect(url.startsWith('file:')).toBe(true);
    expect(url).not.toContain('\\');

    const p = path.resolve(url.replace(/^file:/, '')).toLowerCase();
    expect(p.startsWith(path.resolve(testDbDir()).toLowerCase())).toBe(true);
    expect(p.startsWith(path.resolve(process.cwd()).toLowerCase())).toBe(false);
    expect(path.basename(p)).toContain('aimplifi-sample');
  });
});
