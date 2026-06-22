import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // The suite is integration-heavy on a single SQLite file opened from many
    // parallel worker processes; a write can wait on the cross-process lock (up to
    // the adapter's 15s busy_timeout). Give tests + hooks headroom above that so a
    // contention spike resolves instead of tripping the default 5s deadline.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
