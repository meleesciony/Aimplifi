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

// K.8 harness fix (2026-08-10): the e2e DB is one SQLite file shared by the
// server connection + ~45 direct spec connections across 4 workers. A worker
// seed (or a concurrent server transaction) committing between a server
// transaction's first read and its first write makes the write upgrade burn
// the FULL busy_timeout on a doomed stale-snapshot wait. At the 15s default
// the burns stack on the single Prisma engine connection and sever
// server-action confirmation streams (the K.8 ledger classes: 6-19s+ stalls,
// 30s+ test timeouts, 12 failed reads across 8 tests on 2026-08-10). This
// shrinks the burn to 500ms so a collision costs ≤500ms + one P2034 re-roll
// instead of queue-stacking minutes. Set at module scope: webServer.env spreads
// process.env (reaches `next start`), and the specs' direct connections read
// it too (tests/e2e/*.spec.ts). Dev/unit runs don't set it — they keep the 15s
// default. See src/lib/db-adapter.ts.
process.env.SQLITE_BUSY_TIMEOUT_MS = '500';

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
  // K.8 harness fix (2026-08-10): retries absorb the residual P2034 lottery that
  // remains after SQLITE_BUSY_TIMEOUT_MS=500 above. The stale-snapshot collision
  // itself cannot be eliminated while ~45 direct spec connections write to the
  // same file the server reads (worker-isolated DBs are incompatible with one
  // server process; routing every seed through the server is a larger refactor).
  // With the short burn the collision is CHEAP (<1s + re-roll) and the retry
  // (fresh page, fresh signup, fresh unique seed ids) is deterministic. Any test
  // that fails after retries is a REAL failure and enters the K.8 ledger — the
  // retry never papers over a regression, only the harness lottery.
  retries: 2,
  // 4 workers (#166): the shared-SQLite e2e DB is the same single-writer harness
  // the unit suite already serializes for (tests/setup/test-db.ts). At the
  // default worker count on a loaded machine, write contention severs enough
  // server-action confirmation streams to flunk the reload-bearing mutation
  // specs (solo-green every time) and to widen the manual-card net-worth window
  // into the golden readers. Production is Postgres per-request — 8 concurrent
  // sessions against one SQLite file tests the harness, not the app.
  workers: 4,
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
    // Wave M.1: the owner's phone is iOS Safari (WebKit), which the Chromium-based
    // mobile-380 project never exercised — and WebKit's flexbox `min-width:auto`
    // behaviour differs from Chromium's, so a truncation-in-flex overflow can pass
    // in Chromium and break in Safari (exactly the /accounts report, 2026-07-21).
    // Scoped to the overflow gate for now (a full WebKit suite migration is its own
    // task); it renders the real Safari engine at the real phone widths.
    {
      name: 'mobile-webkit',
      testMatch: /mobile-overflow\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
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
