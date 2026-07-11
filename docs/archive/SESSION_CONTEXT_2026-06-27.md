# Session Context / Handoff — 2026-06-27 (session "test-db relocation")

Self-contained context to resume after a chat clear. Files persist on disk; clearing the
conversation deletes nothing. Point the new session at this file (then PROGRESS.md).

## TL;DR

App = **Aimplifi** (formerly "Pulse Finance"). Production is live at **https://aimplifi.app**
(origin/main `551ac97`, READY). This session took the one un-gated engineering item left in
the prior handoff — the deferred **OneDrive `SQLITE_BUSY` flake** fix (STATUS #16/#17) — and
relocated the unit + e2e SQLite databases OFF the OneDrive-synced tree (DECISIONS #120).

**Outcome (honest):** the UNIT flake is **FIXED**; the e2e flake is **reduced but not
eliminated** because its real cause is broader than the DB (the whole working tree is on
OneDrive). Committed locally as `6df4aca`, **unpushed**.

## Git / repo state

- Branch `main`. **Working tree CLEAN.**
- HEAD `6df4aca` (this session's #120 change). Local `main` is **2 commits ahead of origin**:
  - `6df4aca` test: relocate unit/e2e SQLite DB off the OneDrive tree (#120, verify green)
  - `905da57` docs: record REC-2 + HSTS production deploy (from the prior session)
- `origin/main` = `551ac97` — the LIVE production deploy (REC-2 #118 + HSTS #119).
- **Why unpushed:** both local commits are test-infra + docs with ZERO production-bundle
  impact. Pushing `main` triggers a Vercel prod build that rebuilds identical functional
  output. Deliberately deferred — push them alongside the next FUNCTIONAL change (or on
  request). Pushing now is safe, just a redundant redeploy.

## What #120 did

Relocated the test/e2e SQLite DB to the OS temp dir (off the synced tree):
- `tests/setup/test-db.ts` (NEW) — `testDbUrl(name)` builds `file:` + an absolute path under
  `os.tmpdir()` (or `TEST_DB_DIR`, which is `mkdir`'d). Per-checkout `sha1(cwd)` suffix so
  this OneDrive copy and the stale `C:\dev` copy can't share one file. `UNIT_DB_URL`,
  `E2E_DB_URL`. The better-sqlite3 adapter strips `file:` and passes the rest verbatim, so a
  Windows absolute path with forward slashes works.
- `vitest.config.ts` — forces `DATABASE_URL=UNIT_DB_URL` (process.env + `test.env`).
- `tests/setup/wal-global-setup.ts` — `db push` -> WAL (imported prisma client; works in
  vitest) -> `db seed` on the temp unit DB.
- `playwright.config.ts` — sets `DATABASE_URL=E2E_DB_URL` + `webServer.env`; documents the
  `reuseExistingServer`/port-3100 assumption.
- `tests/e2e/global-setup.ts` — `db push` -> WAL -> `db seed` on the temp e2e DB. **WAL is set
  by a tsx CHILD** (`scripts/set-sqlite-wal.ts`, NEW) because the generated Prisma client is
  CJS and throws "exports is not defined in ES module scope" if imported into Playwright's
  ESM config loader.
- `tests/unit/test-db-location.test.ts` (NEW) — locks it: `PRAGMA database_list` shows the
  live DB is under the configured dir and NOT under cwd (the repo).
- `tests/unit/db-wal.test.ts` — comment-only update.
- **No production surface.** `src/`, `next.config.ts`, `db-adapter.ts` untouched; `npm run dev`
  keeps the repo-root `dev.db` (.env default); prod = Postgres (DECISIONS #35).

## Verified facts / ground truth (measured this session — don't re-derive)

- **UNIT flake FIXED.** Core `bash scripts/verify.sh` is GREEN and FAST across MANY runs:
  **1142 unit / 94 files** (+2 regression tests over the 1140 baseline), typecheck/lint/build
  clean. The SimpleFIN "expected 0 to be 2" `SQLITE_BUSY` flake is gone.
- **E2E residual flake — root cause is NOT the DB.** With the e2e DB confirmed off-tree AND in
  WAL, the full suite still flaked ~2/5 runs under load, and the failures were wall-clock
  timeouts of **different correct tests** run-to-run: `phase2-triage.spec.ts` (the ~13-accept
  throughput session) AND `transactions.spec.ts:76` (register search `toHaveURL`). A clean
  quiet run is 54/54 in ~46s. Conclusion: the `next start` server, the `.next` build, and the
  app files all still live on OneDrive, so its sync I/O contends with the server's SYNCHRONOUS
  better-sqlite3 round-trips. Moving only the DB can't fix this.
- A **120s timeout bump** for the throughput spec was tried and **REVERTED** — it still timed
  out under load (RUN hit 120s) and the suite flaked on other tests regardless. Band-aid, not
  a fix; left out deliberately.
- **Hostile critic** wf_d9503a9a (4 dims + adversarial verify): **0 P0 / 0 P1, 10 P2.** 5
  applied (TEST_DB_DIR-honoring location test; `mkdir`; per-checkout hash; accurate re-seed
  wording re RateLimit not being wiped; reuseExistingServer/3100 doc). Accepted P2s: same-
  checkout CONCURRENT runs (`vitest --watch` + `verify`) still share a file (set TEST_DB_DIR);
  a server squatting on 3100 started from the repo would bypass the relocation (verify 3100
  free; CI spawns fresh).
- E2E flakes are CORRECT tests timing out under load — clearable by re-run, not code defects.

## Pending / next steps

1. **(Owner — the COMPLETE e2e fix)** Relocate the working copy off OneDrive onto a plain
   local disk, as CLAUDE.md already recommends. The canonical `C:\dev\Pulse Finance` copy is
   stale/abandoned — all recent work is in the OneDrive copy. Moving the active tree removes
   the whole-tree sync I/O contention the #120 DB move can't reach, which is the only thing
   left making `VERIFY_E2E=1` flaky.
2. **(Optional)** Push the 2 local commits (`905da57`, `6df4aca`) — bundle with the next
   functional change to avoid a redundant prod rebuild, or push standalone if desired.
3. **Otherwise:** the roadmap backlog (docs/ROADMAP.md) is mostly owner-gated ("only change if
   markedly better"): investments retirement planner / live brokerage ingest; the UX "ALSO
   CONSIDER" list (CardTitle-as-heading shared primitive, triage split-flow 2nd category,
   mobile-nav redesign, iOS safe-area). None are forced; pick per owner priority.

## How to verify quickly

- `bash scripts/verify.sh` — core gate (typecheck + lint + 1142 unit + build). GREEN + fast +
  reliable now. **This is the gate to trust.**
- `VERIFY_E2E=1 bash scripts/verify.sh` — adds the 54 e2e. Passes in a quiet window; still
  env-flaky under load until the working copy moves off OneDrive (see #1). Re-run on a flake.

## Carry-over notes (still true)

- **Do NOT change** the seed RNG string `pulse-finance-seed` or demo email `demo@pulse.finance`
  (`src/lib/seed/build.ts`) — they pin the golden test values.
- "Aimplifi" is everywhere user-facing; "Pulse Finance" survives only in the folder name +
  some docs.
- Vercel: project `aimplifi` (`prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`), team `reiforge`
  (`team_pk5Bl46h1HAtdlfO5ASqydxE`). Domains: aimplifi.app, www.aimplifi.app.
- This handoff doc + the PROGRESS.md #120 entry are the authoritative state. **Safe to /clear.**
