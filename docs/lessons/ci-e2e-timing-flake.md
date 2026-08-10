# CI (GitHub Actions Linux runner) e2e timing flake — different test each run

**One-line summary:** on the hosted CI runner, the full `VERIFY_E2E=1` Playwright suite has
intermittently failed a single timing-sensitive assertion — a different test each time, never
the same one twice — while the identical unit suite and the identical spec files pass cleanly
on a subsequent rerun with no code change. This is runner resource contention, not a code
regression; it is a distinct phenomenon from `mobile-380-viewport-scaling-flake.md` (that one
has a specific `intercepts pointer events` signature on a local Windows machine — this one is
a plain `toHaveCount`/timeout assertion on GitHub's Linux runner).

## Observed 2026-07-11 (push `e1fca4a` → `9c60cc3`, confirming CI post-#216)

Same commit (`9c60cc3`), three consecutive full `verify` job runs:

1. Run 1: real bug — `self-audit-server.test.ts` failed deterministically (see
   REGRESSION_LEDGER 2026-07-11, fixed in this commit).
2. Run 2 (after the fix): unit suite green; `budget-targets.spec.ts:58` timed out on
   `toHaveCount(0)` waiting for a full-page reload (15s timeout, under "full-suite load" per
   the test's own comment).
3. Run 3: unit suite green; `budget-targets.spec.ts` did NOT fail again, but
   `phase2-triage.spec.ts:382` timed out on a different `toHaveCount(0)` assertion (5s
   timeout) instead.
4. Run 4: full green, same commit, no code change between runs 2–4.

## What to do when you hit this again

1. Check whether the SAME test fails on a rerun of the exact same commit. If yes, treat it as
   a real regression and diagnose normally.
2. If a DIFFERENT test fails on rerun (or the same test passes on rerun), it's this pattern:
   report the honest state, rerun via `gh api .../rerun-failed-jobs` (or the Actions UI) once
   or twice, and trust a clean run — don't chase a fix for a test your diff never touched.
3. Don't conflate this with `mobile-380-viewport-scaling-flake.md` — different environment
   (CI Linux runner vs. local Windows), different error signature (assertion timeout vs.
   pointer-interception). If a NEW distinct signature shows up, it may deserve its own note
   rather than being folded in here.

## CORRECTED 2026-08-07 — two of this lesson's "flake" signatures were real test defects, diagnosed by reading the components

The headline "a different test each time, never the same one twice" stopped being true on
2026-08-07: `category-rename.spec.ts:110` failed the gate three consecutive runs across two
shas, and `budget-targets.spec.ts:58` carried a recurring signature at the same line. Both were
the SAME defect class, not contention: **a spec asserting convergence off a single
post-mutation read.** The category-remove toggle is optimistic with rollback (#167), so the
spec's confirmation was the client's echo and the next navigation's server read could beat the
commit; the budget clear awaits its action under a DEADLINE and reloads in `finally`, so on a
deadline the reload precedes the commit — and in both cases a full-document response never
re-polls, making the failure permanent for that run while remaining unreproducible on an idle
local machine. Both specs now confirm on a re-rendered page (reload inside `toPass`) before the
final assertion. The rule: before filing a CI-only e2e failure under this lesson, check whether
the asserted state is separated from the mutation by an optimistic echo, a deadline, or a
single reload — CI load does not create those races, it only wins them.

## Member log 2026-08-09/10 — the shared-SQLite severed-flight class (C.14–C.18 records)

On the 4-worker suite the failures are the shared-DB single-writer wedge (severed
confirmation flights / stuck pending buttons on the reload-bearing mutation specs),
which the C.15 remedy handles locally (fresh temp e2e DB) and `gh run rerun --failed`
handles in CI. Seen across the C.14→C.19/K.4 gates: `category-rename.spec.ts:110`,
`transactions.spec.ts` :566/:637/:910/:982/:638/:709, `budget-targets.spec.ts:61`,
`register-return.spec.ts:119`, `phase4-features.spec.ts:97`, `merchant-lens.spec.ts:22`,
`mobile-overflow.spec.ts:386` (the [mobile-webkit] route sweep), regression #216.
Every member was isolation-proven 1/1 (or 7/7 for the sweep) on the exact failing tree;
the K.4 gate also re-proved `:982` (2.7s solo) and `:386` (6.5s solo) on 2026-08-10.
The current rule: same test fails on rerun of the same commit → real defect, diagnose;
different test (or green on rerun) → the wedge, record run id + member + isolation
proof in STATUS.md and trust the clean run.
