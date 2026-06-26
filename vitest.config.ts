import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // Put the shared dev.db into WAL before the workers spawn (see the setup file):
    // WAL lets concurrent readers and a single writer proceed without blocking,
    // which is what prevents the SQLITE_BUSY starvation flake on this single-file
    // suite. WAL is persistent on the file, so each worker connection inherits it.
    globalSetup: ['./tests/setup/wal-global-setup.ts'],
    // The suite is integration-heavy on a SINGLE SQLite file. WAL + a 15s
    // busy_timeout handle reader/writer overlap, but two *writer* transactions
    // racing from different worker processes can still trip an unrecoverable
    // SQLITE_BUSY (a deferred txn upgrading read→write that busy_timeout won't
    // wait out). Running test files one-at-a-time means at most one connection
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
