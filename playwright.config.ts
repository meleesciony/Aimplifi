import { defineConfig, devices } from '@playwright/test';
import { E2E_DB_URL } from './tests/setup/test-db';

/**
 * E2E config. The golden flows run on a 380×800 mobile viewport per
 * docs/PHASE_0_ARCHITECTURE.md §9. The web server uses the production build
 * (`next start`) against the seeded demo database.
 *
 * The e2e database is a SQLite file under the OS temp dir, OFF the OneDrive-synced
 * tree (the SQLITE_BUSY flake source — STATUS #16/#17, see tests/setup/test-db.ts).
 * Set on process.env so the global-setup's `db push` + seed target it, and passed
 * through to `next start` via webServer.env. Production is Postgres (DECISIONS #35).
 */
process.env.DATABASE_URL = E2E_DB_URL;

// E2E is hermetic: no live LLM calls. The dev machine's .env.local carries real
// provider keys (STATUS 2026-07-04), so a spawned `next start` would otherwise make
// live xAI/Anthropic calls from every ingest-path action during a run — slow,
// non-deterministic, and (pre-timeout-fix) a hung fetch could stall a server action
// past the click timeout. Blanked HERE (module scope) so both webServer.env and the
// global-setup children (which spread process.env) inherit the neutralized values;
// empty string is falsy for every `if (key)` provider check.
process.env.XAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    // 127.0.0.1, NOT localhost: Node 17+ resolves localhost to ::1 first, so the
    // loopback family the tests use is otherwise ambiguous. Pinned 2026-07-01 while
    // investigating ≥60s server-action stalls (STATUS #16/#17): a direct Prisma
    // write probe on the same DB ran at p50=1ms, so the stall is in the
    // request/server layer, not storage. IPv4 did NOT cure the rapid-write
    // full-review stall, but the lighter specs stabilized over it this session;
    // kept as deterministic hygiene.
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-380',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 380, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'npx next start -p 3100',
    url: 'http://127.0.0.1:3100/sign-in',
    // The off-tree e2e DB is applied via webServer.env below, so it only takes
    // effect when Playwright SPAWNS the server. reuseExistingServer is true locally
    // for fast iteration: ensure port 3100 is free before a clean run — a server
    // already squatting on 3100 that was started from the repo would resolve the
    // .env default (file:./dev.db, the synced flake DB) and silently bypass the
    // relocation. CI always spawns fresh (reuse=false).
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Point the production server at the same off-tree e2e database the global
    // setup seeds (Next.js does not override an env var already present in
    // process.env, so this wins over the .env default).
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
  },
});
