import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { UNIT_DB_URL } from './tests/setup/test-db';

// Force the unit/integration suite onto a SQLite file under the OS temp dir, OFF
// the OneDrive-synced tree (the SQLITE_BUSY flake source — STATUS #16/#17, see
// tests/setup/test-db.ts). Set on process.env so the main process + globalSetup
// connect there, and on `test.env` so every (forked) worker inherits it. The
// .env default (file:./dev.db) is for `npm run dev` only; production is Postgres
// (DECISIONS #35).
process.env.DATABASE_URL = UNIT_DB_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // `server-only` is a client-bundle guard with no meaning under the node test env; stub it
    // to a no-op so server modules that import it can be exercised transitively (e.g. coach.ts
    // → money-review-llm.ts). Without this, any tested module reaching a 'server-only' import
    // fails to load with "Cannot find package 'server-only'".
    alias: { 'server-only': fileURLToPath(new URL('./tests/setup/server-only-stub.ts', import.meta.url)) },
    // Injected into the test runtime (workers) — belt-and-suspenders with the
    // process.env assignment above.
    env: { DATABASE_URL: UNIT_DB_URL },
    environment: 'node',
    // `.tsx` is included for the component-render harness added in C.26 (critic
    // cycle 2, F2): two cycles of user-visible copy shipped unlocked because
    // nothing in this repo could assert a rendered component. Those files opt
    // into jsdom with a `// @vitest-environment jsdom` pragma; everything else
    // stays on the node environment above.
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'src/**/*.test.ts'],
    // Create/sync the temp-dir schema, then put it into WAL before workers spawn
    // (see the setup file). WAL lets concurrent readers and a single writer proceed
    // without blocking, which (together with the temp-dir relocation) prevents the
    // SQLITE_BUSY starvation flake. WAL is persistent on the file, so each worker
    // connection inherits it.
    globalSetup: ['./tests/setup/wal-global-setup.ts'],
    // The suite is integration-heavy on a SINGLE SQLite file. WAL + a 15s
    // busy_timeout handle reader/writer overlap, but two *writer* transactions
    // racing from different worker processes can still trip an unrecoverable
    // SQLITE_BUSY (a deferred txn upgrading read→write that busy_timeout won't
    // wait out) — an inherent SQLite multi-process limit, independent of where the
    // file lives. Running test files one-at-a-time means at most one connection
    // writes at a time, which removes the cross-process writer race entirely. The
    // pure-function tests dominate and stay fast; the integration writes are what
    // benefit. (Production is Postgres, so this constraint is local/test only.)
    fileParallelism: false,
    // Headroom above the adapter's 15s busy_timeout so any residual lock wait
    // resolves instead of tripping the default 5s deadline.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
