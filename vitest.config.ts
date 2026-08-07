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

// K.8 — the unit gate's clock is PINNED, not ambient. Before this, `businessToday()`
// fell through to the real machine clock locally (vitest does not load .env) while CI
// declares DEMO_TODAY as a job-level env var, so the same commit answered "6,167 passed"
// on the maintainer's machine and "4 failed" on every CI run for days — and any test
// that read the clock without stubbing it drifted with the calendar. Both values are
// set unconditionally (a shell-exported DEMO_TODAY must not change the gate's verdict)
// and mirrored into `test.env` so every forked worker inherits them at spawn. The date
// matches .env and .github/workflows/verify.yml; TZ=UTC matches the CI runner's default
// (an assumption about the runner, but a safe one: this config forces UTC on BOTH sides
// regardless), so the local unit gate and CI's unit step answer the SAME question. Note
// the scope: this immunizes the UNIT step only — `next build` and the e2e server still
// read the ambient env/.env. A test that needs a different date pins its own via
// `vi.stubEnv('DEMO_TODAY', …)` — that still wins over this default.
// Locked by tests/unit/gate-clock-pin.test.ts. Lock scope (critic-verified): it fails
// if BOTH this assignment and the test.env mirror are removed, or if the pinned VALUES
// change; deleting just one of the two redundant mechanisms is invisible to it (and
// changes no behavior on the forks pool). Known tradeoff (critic F5): forcing UTC means
// no test exercises `realClockToday()` outside UTC any more — that function is 3 lines
// of local-date formatting, accepted.
process.env.DEMO_TODAY = '2026-06-10';
process.env.TZ = 'UTC';

// K.8 critic F4 — same parity discipline for LLM keys: the maintainer's ambient env
// carries a REAL XAI_API_KEY (via .env.local) which would reach every vitest worker,
// while CI has none — so `isLlmConfigured()` could answer differently per machine and,
// worse, a unit test could make a live paid call. playwright.config.ts already blanks
// both keys at module scope for exactly this reason; the unit gate now matches it.
// A test that needs "configured" simulates it with vi.stubEnv, same as the date.
process.env.XAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // `server-only` is a client-bundle guard with no meaning under the node test env; stub it
    // to a no-op so server modules that import it can be exercised transitively (e.g. coach.ts
    // → money-review-llm.ts). Without this, any tested module reaching a 'server-only' import
    // fails to load with "Cannot find package 'server-only'".
    alias: { 'server-only': fileURLToPath(new URL('./tests/setup/server-only-stub.ts', import.meta.url)) },
    // Injected into the test runtime (workers) — belt-and-suspenders with the
    // process.env assignments above. TZ is injected at worker spawn, which is the
    // reliable mechanism on Windows (runtime TZ changes were verified to work on
    // this Node, but spawn-time env needs no such guarantee).
    env: {
      DATABASE_URL: UNIT_DB_URL,
      DEMO_TODAY: '2026-06-10',
      TZ: 'UTC',
      XAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    },
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
