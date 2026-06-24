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
    // The suite is integration-heavy on a single SQLite file opened from many
    // parallel worker processes; a write can still wait on the cross-process lock
    // (up to the adapter's 15s busy_timeout) for writer-vs-writer overlap. Give
    // tests + hooks headroom above that so a contention spike resolves instead of
    // tripping the default 5s deadline.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
