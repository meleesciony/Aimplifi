/**
 * Absolute SQLite database URLs for the test + e2e suites, located under the OS
 * temp directory (or TEST_DB_DIR) — OFF any cloud-synced tree.
 *
 * Why: the repo's working copy lives under OneDrive (see CLAUDE.md). OneDrive's
 * background sync intermittently holds an OS file lock on the SQLite `.db` / `-wal`
 * / `-shm` files, which starves a SQLite writer into a transient, unrecoverable
 * SQLITE_BUSY — the documented unit + e2e flake (STATUS #16/#17, REGRESSION_LEDGER:
 * the SimpleFIN "expected 0 to be 2" mask and the phase2-triage throughput timeout).
 * WAL + a busy_timeout + serialized file access (vitest `fileParallelism: false`)
 * reduce the IN-PROCESS contention but cannot wait out an EXTERNAL lock held by the
 * sync client. Relocating the database out of the synced tree removes the
 * contention at its source.
 *
 * Scope: this changes ONLY the local SQLite test/e2e path. `npm run dev` keeps its
 * own repo-root `dev.db` (the `.env` default), and production runs on Postgres
 * (DECISIONS #35) selected by URL scheme — both are unaffected. Nothing here ships
 * in the production bundle (test/config files only).
 *
 * Override the directory with TEST_DB_DIR (e.g. point CI at a tmpfs); it is created
 * if missing.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The directory holding the off-tree test databases: TEST_DB_DIR if set, else the
 * OS temp dir. Created if missing so an override pointing at a not-yet-created path
 * (a fresh CI box / tmpfs) still works.
 */
export function testDbDir(): string {
  const dir =
    process.env.TEST_DB_DIR && process.env.TEST_DB_DIR.length > 0
      ? process.env.TEST_DB_DIR
      : os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function testDbUrl(name: string): string {
  // Per-checkout suffix: a stable 8-char hash of the repo path, so two clones on one
  // machine (this OneDrive copy + the stale C:\dev copy) get DISTINCT files instead
  // of clobbering one shared name. Deterministic per checkout, so reruns reuse (and
  // re-seed) the same file. Same-checkout CONCURRENT runs (e.g. `vitest --watch`
  // alongside a `verify` run) still share one file — set TEST_DB_DIR to isolate those.
  const tag = createHash('sha1').update(path.resolve(process.cwd())).digest('hex').slice(0, 8);
  const file = path.join(testDbDir(), `aimplifi-${name}-${tag}.db`);
  // The better-sqlite3 adapter strips a leading `file:` and passes the remainder
  // verbatim to better-sqlite3 (src/lib/db-adapter.ts). Forward slashes are valid
  // on Windows and sidestep the `file:` + drive-letter URL ambiguity.
  return `file:${file.split(path.sep).join('/')}`;
}

/** Unit/integration suite DB (vitest). Schema + the deterministic demo seed. */
export const UNIT_DB_URL = testDbUrl('test-unit');

/** E2E suite DB (playwright). Schema + WAL + the deterministic demo seed. */
export const E2E_DB_URL = testDbUrl('test-e2e');
