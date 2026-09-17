# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Sections through 2026-08-19 live in `docs/archive/STATUS_ARCHIVE_2026-07_to_2026-08-19.md`
> (rotated 2026-09-11) and the BUILT entries 2026-09-03 through 2026-09-11 in
> `docs/archive/STATUS_ARCHIVE_2026-09-03_to_2026-09-11.md` (rotated 2026-09-17); only
> current-wave BUILT entries and OPEN/FOUND/DECIDED items remain here.
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-09-17 — The next-dollar ranking names the frozen debt it points at (L.19 residual 5, DECISIONS #745)

**The gap.** #742's critic named it: `src/server/coach.ts` built the next-dollar ranking's loans from `snap.accounts` without `feedDroppedAt`, and its past-due cards from `CardObligation`s that carried `frozenSince` and dropped it — so /coach's "Your next dollar" card and Ask's `next_dollar` answer said "Next extra dollar: <loan> (12.00% APR)", an instruction naming one debt to send money to, over a balance the bank had stopped confirming, with nothing said.

**Shipped.** `NextDollarDebt.frozenSince` (REQUIRED, both `classifyDebts` inputs) rides out of `coach.ts` for loans AND past-due cards; the ranking never reads it (byte-identity locked). New `frozenNextDollarNote` (its own builder — the ranking amortises nothing; the stale thing is the PREMISE that admits the debt): card → "the past-due amount that ranks it here is from the last statement it sent — a payment you have already made may not be counted, so the card may not be past due at all"; loan → no direction, no rate claim — "nothing about it has been confirmed since, including whether it is still open". Resolved against the debt the copy PRINTS (`nextDollarNamedDebt`, beside the sentences it mirrors), rendered directly after the why on the card (`next-dollar-frozen`) and in the Ask detail. Demo and every unfrozen plan byte-identical. No schema change.

**Critic (fresh context, isolated worktree): cycle 1 PASS 0 P0 / 0 P1 / 3 P2 — all fixed same-session** (empty-string stamp painted "Tue, undefined 0, 0"; investing-branch note preceded the loan's first mention; `nextStep: 'partner'` accepted beside a reader opener). The critic independently reproduced 927/927 on the touched files, tsc 0, eslint 0, FAIL-OLD 2|23, an 810-case selector↔copy grid, and probed superseded predecessors (zeroed, never ranked), estimated obligations (never past due), MORTGAGE rows and the demo.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8510 passed + 1 expected fail + 1 skipped / 633 files + 1 skipped**, `next build` clean; docs-lint clean (245 files). FAIL-OLD vs `9892cd44` `coach.ts`: **2 failed | 23 passed**. Playwright mobile-380 on the fresh build: `next-dollar-frozen` **2/2** + `phase3-coach` 1/1 (+ `ask.spec.ts` 31/31 on the pre-P2-fix build).

**Ledger cut.** `REGRESSION_LEDGER.md` 44.5 → 10 KB (113 rows dated 2026-09-03..09-11 → `docs/archive/REGRESSION_LEDGER_ARCHIVE_2026-09-03_to_2026-09-11.md`, selected by DATE since the live file was not date-ordered); `docs/STATUS.md` 42.5 → ~31 KB (six BUILT sections #637–#736 → `docs/archive/STATUS_ARCHIVE_2026-09-03_to_2026-09-11.md`); `docs/DECISIONS.md` 43.2 → 29.7 KB (#737–#739, the closed goals wave → `docs/archive/DECISIONS_ARCHIVE_737_to_739.md`). Index regenerated (732 entries); ledger suite 20/20.

**CI + live.** `2930799d` (slice) + `cc8a8ae6` (critic fixes + ledgers) on `origin/main`; no `prisma/` diff — database untouched. **CI verify run 35255710898 = SUCCESS on `cc8a8ae6`** (full `VERIFY_E2E=1`, 15m09s, watched to conclusion via `gh run view` — `scripts/ci-status.sh` exits 4 under WSL bash, the #737 precedent). Vercel Production `dpl_2BMtVkUCRZD5ZyZPU8KkbRvgb9Dy` **READY** on `cc8a8ae6`, aliases include `www.aimplifi.app`. Live probe (demo session on production): /coach next-dollar card renders `next-dollar-headline` → `next-dollar-why` ("The Auto Loan is 6.49%…") → `next-dollar-skipped` → cards → assumptions with **`next-dollar-frozen` count 0**, and Ask "Where should my next dollar go?" answers the golden four-sentence detail with no "stopped sharing" — the ABSTENTION (the demo has no frozen rows), which is the only branch production can show without writing a frozen account into the live database. The speaking branch is proven by `next-dollar-frozen.spec.ts` (local + CI) and `git grep frozenNextDollarNote cc8a8ae6` (3 hits) confirms the code is in the deployed sha; a live render of the note itself is **UNVERIFIED** on production by construction.

**Still open / residuals.** (1) The saved debt-free goal card (STATUS #742 residual (1)) needs a schema column — `Goal` has no `createdAt`; see the #742 residual list. (2) `frozenNextDollarNote` takes one row by design; if the copy ever prints two debts on one branch, the selector must return a list. (3) Playwright and `next build` were not run by the critic (port 3100 is contended by WSL relay on this machine — it forwarded an unrelated `~/rakazo-host` process; the Windows-side relay was killed by PID, the WSL process left alone). Wave 0 ops owner-blocked. M.4 owner-deferred.

## ✅ BUILT 2026-09-17 — O.20j converse-leak identity: mask COLUMN + detector prereqs (DECISIONS #744)

**The leak.** Two Plaid items of CREDIT last-4 `0977` still paired a real purchase with a filed `TRAVEL CREDIT` on the other copy. H.7 confirmed links already equated some copies; unconfirmed same-mask copies did not. Reader-side "count converse as spend" was killed (~$180k of real transfers). Writer-side identity is the remaining prevention.

**Shipped.** `unionSameMaskColumnIdentity` folds unconfirmed same-type copies that share a MASK COLUMN (≥4) across different ingest connections into the H.7 map `planTransferUpdates` already reads. A mask-group union is skipped when any pair in the current `root()` component is dismissed, same-connection, mixed-type, both `institutionId`s present and different, different currency (null = USD), or `registrationsConflict`. Missing records fail closed. Group keys sorted by `type|mask`. Live Plaid `institutionId` is the item's, falling back to the account stamp (same join as combine-connections). `isTransfer` add-only. H.7b not auto-run.

**Critic (fresh context, isolated worktree): new-budget cycle 1 FAIL 0 P0 + 3 P1 → cycle 2 PASS 0 P0 / 0 P1.** Cycle 1: last-4-only wider than the detector; unordered `findMany`; stale `$237.08` claim. Cycle 2 independently closed all three plus the cycle-4 confirmed-map back door (probes fail on `71d22d54`, pass at `3022f696`), reproduced VERIFY GREEN **8477 passed + 1 expected fail + 1 skipped / 631 files**, FAIL-OLD **12 failed | 22 passed**, and a 4,000-corpus shuffle fuzz.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8477 passed + 1 expected fail + 1 skipped / 631 files**, `next build` clean. FAIL-OLD vs `71d22d54`: **12 failed | 22 passed**. Playwright `transfer-flag-repair.spec.ts` mobile-380 **1/1** (maker; critic left UNVERIFIED because the spec drives the repair card). Identity+filing files **72 passed**.

**CI + live.** `c3ff71b26` on `main` (PR #24 merged the same turn). CI verify **35188955926 = SUCCESS** on `c3ff71b26` (full VERIFY_E2E=1, 11m48s). Vercel Production `dpl_CNL5qQfa7GigLhjvMPhbxWQzgFEW` READY, aliases include `www.aimplifi.app`. Live: unsigned `/settings` 307 → `/sign-in` 200 (expected); HTML build id `NF8UtGOD-t1u8ZqGcKsw9`. The identity union is server-only (no new UI copy); `git grep` on that sha finds `unionSameMaskColumnIdentity` in `transfers.ts` and `transfer-refresh.ts`. H.7b not auto-run.

**Do not treat the cycle-3 8-flag / `$237.08` number as this function's live result.** Mixed-type over-veto can refuse the 0977 fold when a confirmed terminal has a different type.

**Still open / residuals (critic cycle 2 P2s, none blocking).** (1) Mixed-type over-veto, above. (2) Two Plaid items with null `institutionId` (pre-backfill) still fold on last-4 alone — an absence is never a difference; unnamed until now. (3) Dismissal read `take: 500`. (4) No shipped test locks the `PlaidItem` → `institutionId` join (the pure function is locked; the join was proven by the critic's throwaway DB probe). (5) `anyPairBlocked` is O(component²) per group; benign at realistic sizes, 1s at 120 accounts in one component. (6) Raw `provider === 'plaid'` matches `evaluatePair`. (7) The 8 existing `$237.08` flags stay until the owner taps H.7b. Wave 0 ops owner-blocked. M.4 owner-deferred.

## ⛔ HUMAN GATE 2026-09-16 — O.20j converse-leak identity (critic budget exhausted, DECISIONS #743) — SUPERSEDED by #744

**Superseded 2026-09-17.** The named close landed; critic cycle 2 of the new budget PASS 0 P0 / 0 P1. See BUILT #744 above.

**What is measured and must not be forgotten.** Live converse: 94 rows, $180,466.86 outflow / $37,949.79 inflow withheld. 61 FLAG RIGHT (~$205k genuine transfers, stale category). 33 FLAG WRONG / $12,878. H.7b never run (0 runs); would clear 25 today. 8 remaining WRONG ($237.08, CREDIT CARD last-4 `0977`, two Plaid items vs a filed `TRAVEL CREDIT`) are the prevention target — existing flags stay until the owner taps H.7b. Demo 0 converse. Reader-side "count converse as spend" is killed (would dump ~$180k of real transfers into spending). `countsInFlows` / `isSpendRow` / auto-run H.7b were correctly left untouched.

**Cycle history (first budget, all four spent).** C1: HIGH detector as money identity (year-in-name, balance-only spouse cards) — fixed. C2: dismissal edge-skip, fail-OPEN dismissals, same-item edge-skip — fixed as *component* vetoes + `'unavailable'` fail-closed. C3: same-connection still an edge skip via a third copy — fixed as group veto. C4: confirmed-map back door — closed on the #744 tree.

**Ledger on `main` at the stop.** `d2e146d1` / `72acec47` (docs only — the identity union was not in that tree). CI verify **35151281286 = SUCCESS** (full VERIFY_E2E=1). That heading is superseded by #744 above.

## ✅ BUILT 2026-09-16 — The debt-payoff path names a balance the bank stopped sharing (L.19 surface 5, DECISIONS #742)

**The gap.** TASKS L.19 (5) — the one surface DECISIONS #305 left open: `loadDebtAccounts` narrowed each liability to the engine's `DebtInput` and dropped `feedDroppedAt`, so /goals' Debt Freedom planner ("Debt-free by Jan 2034" + total interest) and both Ask debt answers (a payoff month; an extra-per-month toward a chosen date) amortised a frozen balance with nothing said — and each is one save button from a persisted goal target.

**Shipped.** `DebtAccount extends DebtInput` (`kind`, `frozenSince`) is what the read path returns and the planner + both Ask answers accept; `planDebtPayoff` / `solveDebtFreeByDate` still take `DebtInput` and never read the stamp (byte-identity locked). New `frozenDebtPlanNote` in `feed-dropped-view.ts`: card → "may be higher or lower"; loan → NO direction ("nothing about this loan has been confirmed since"); mixed → two claims, ONE Accounts remedy; `figureLabel` names what each surface prints (the by-date unreachable branch names only `the total debt`). Rendered above the save control on /goals; appended to both Ask answers' `detail`. DISCLOSE, ADJUST NOTHING — figures and the save action untouched. No schema change.

**Critic (fresh context, separate node): cycle 1 FAIL 1 P1 + 8 P2 → cycle 2 ZERO P0/P1.** (A second, independent cycle-1 critic finished after the merge and converged on the same P1 and the same P2 set; its two new items — a false justification in the builder's header comment and an absence-only abstention pin — were fixed in the follow-up commit, and its coach read-path residual is (5) below.) The P1: the first cut's loan sentence said the real balance "may be lower" — false for Plaid's revolving `line of credit` / `home equity`, which `plaid-map.ts` folds into `LOAN` (a draw pushes the balance UP), and for accrued interest; the understating direction is the dangerous one. Fixed to claim no direction (the `frozenLoanNote` precedent) and pinned negatively. P2s fixed: repeated remedy in the mixed note; by-date label naming an extra the unreachable branch does not print; the planner's source-grep "test" replaced by a jsdom render lock (fail-old: pre-slice component → 1 failed | 1 passed; filter inversion → 2 failed); a float-derived expectation replaced by the integer-cents literal `162_923` (critic verified minimal: `162_922` → 13 months). Cycle 2 independently reproduced the gates, the mutation probes, the "Jan 2034" figure and the DECISIONS rotation (63 lines verbatim).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,439 passed + 1 expected fail + 1 skipped / 630 files**, `next build` clean. Playwright mobile-380 on the fresh build: `debt-plan-frozen` + `frozen-figure-surfaces` + `ask` = **35 passed**. (One local e2e run hung first: Playwright's `reuseExistingServer` attached to a `next start` whose `.next` the gate's build had replaced underneath it — a stale-server flake, not a code defect; killed by PID and re-run clean.)

**CI + live.** `19152a3d` on `main` (PR #23 fast-forwarded the same turn). CI verify **35115110437 = SUCCESS on `main`** (full VERIFY_E2E=1; the same sha was also green on the branch push 35113323242 and the PR run 35113236398). Vercel Production 6484384476 = success. Live probe 7/7 (demo session): /goals planner abstains (nothing frozen on the demo); the /goals client chunks carry the new loan sentence and not the retracted one; Ask's debt-free answer carries no frozen note.

**CI on the follow-up push `82f59146` (comment correction + abstention pin + STATUS residual) — run 35118629557 = failure, PRE-EXISTING, recorded per the ship-gate rule.** 1 failed / 390 passed: `tests/e2e/transactions.spec.ts:638 "CSV import (H.2): re-importing the same file adds nothing"` red through both retries (`import-result` toContainText predicate timeout) — the same recurring flake recorded above for run 34667973958 and in the 2026-08 archive; `:735` and `:1014` flaked once each and passed on retry. The push touched a comment in `feed-dropped-view.ts`, a unit-test literal, and this file; none of it runs in that spec, and the identical source was green on 35113323242 / 35113236398 / 35115110437 the same hour. Vercel Production on `82f59146` = success. **Re-read on the next push `7f88e5a6` (docs only): run 35121407928 = SUCCESS** (full VERIFY_E2E=1) — same source, green; the red was the flake.

**Ledger cut.** `docs/DECISIONS.md` was 44.6 KB; #724–#736 rotated verbatim to `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (now 36 KB; index regenerated, 729 entries).

**Still open / residuals.** (1) **Saved debt-free goal is silent after save** (critic P2-6): `saveDebtFreeGoal` persists `totalBalanceCents` from `loadDebtAccounts` as the target and the /goals goal card prints it with no frozen note — the same shape as #305's PDF finding, one hop later; the planner note above the save control is the only warning. Fix needs the goal card to know the target's basis (a `frozenAtSave` or a re-resolve against current `feedDroppedAt`). (2) `stoppedSharing` says "Your banks" for two frozen rows at one institution — inherited from the L.18 builders. (3) The `perDebt` resolution in the planner and `answerDebtPayoff` is the identity today (the engine echoes every row) — kept as the L.15 resolution point. (4) `text-xs` muted contrast unmeasured (UNVERIFIED, pre-existing token). (5) ~~A second debt read path still strips the fact~~ — **CLOSED 2026-09-17 (DECISIONS #745, BUILT entry above)**: `coach.ts` now carries `feedDroppedAt` onto both the loans and the past-due cards of the next-dollar ranking, and the card + Ask answer name the frozen debt they point at. **Fact learned about (1), recorded so it is not re-derived:** `Goal` has no `createdAt` column, so "this target was computed from a frozen balance" cannot be judged at render time — a re-resolve against today's `feedDroppedAt` would over-claim for a debt that froze AFTER the save. The honest close needs an additive column (`Goal.frozenAtSave` or `createdAt`), i.e. a `prisma db push` on deploy; existing rows would carry no fact and must render no note. Wave 0 ops owner-blocked. M.4 owner-deferred. Wave 2/3/4 rows per TASKS.md.

## ✅ BUILT 2026-09-14 — One definition of an unidentified inflow: it is income (O.20c, DECISIONS #741)

**The report.** TASKS O.20c (owner-reported, live, P1, money-visible): two unfiled deposits that look identical to a reader landed on OPPOSITE sides of the same figure — a positive stored with no category counted as INCOME, while the same positive sitting in the `uncategorized` placeholder NETTED the month's spending down.

**Shipped.** `isIncomeFlowRow` now admits BOTH stores of "nobody labelled this row" (raw null AND the `'uncategorized'` placeholder) — the app's own sign rule, symmetric with how an unfiled OUTFLOW already counts as spending. `isSpendRow` gained the matching clause, so the "Spending by category" card can no longer count that row as negative spend: one row, one side, both surfaces. `MONTH_FLOW_BASIS` copy re-derived (the expense sentence's now-false clause deleted; the income sentence states the unified rule); `BREAKDOWN_BASIS` gained the clause naming the new drop. `isFallbackGuiltFreeIncomeRow` now delegates to `isIncomeFlowRow` instead of re-stating the rule by hand. A mid-slice regression (a loan-payment answer emptying because its fixture refund was unfiled) was found by the full suite and repaired; the O.18e-FU3 fixture now files its refund.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 2 P2 — all fixed same-session.** The P1 was ledger integrity (a "Locked." pointer naming a nonexistent test id and an untouched file), not code. The critic independently reproduced the probe, the full suite, both typechecks and FAIL-OLD, and swept the whole category domain through both predicates finding no remaining opposite-side disagreement for any positive row.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,420 passed + 1 expected fail + 1 skipped / 629 files**, `next build` clean. FAIL-OLD (stash-revert): **6 failed | 80 passed** pre-fix. Playwright mobile-380: 7 specs on the changed surfaces, **17 passed**.

**CI + live.** CI verify run **34882946348 = SUCCESS** on `d774c1ef` (full VERIFY_E2E=1, 11m40s); each docs-only push superseded it, and the ship-gate read on the **newest sha is run 34886003435 = SUCCESS on `042751b6`** (full VERIFY_E2E=1, watched to conclusion). The first run (34880225584 on `3918c1f2`) was **failure** on `trends-new-merchant-panel.spec.ts` — this slice's own copy widening; the spec pinned the disclosure sentence verbatim and was re-pointed at the shipped copy (never weakened), recorded in REGRESSION_LEDGER. Vercel production deployment **6443592177 = success** on `3918c1f2`. Live probe (demo session, mobile-380): the `uncategorized` category panel renders "**and an inflow nobody has filed yet are left out**"; the month-flow expense panel renders "**an inflow with no category, or one still sitting in Uncategorized, does not**" with the old false clause gone; the income panel renders "**no category at all or still sits in Uncategorized**".

**Still open.** Wave 0 ops owner-blocked. M.4 owner-deferred. Wave 2/3/4 rows per TASKS.md. Named residuals: the raw-null store is defensive (0 live rows, no writer produces one); the `'refund'` leaf nets the chart's month expenses while the card drops it — a pre-existing divergence the reports page's own basis-gap disclosure covers, not introduced here.

## ✅ BUILT 2026-09-12 — One discretionary definition: the creep bar classifies with the register (DECISIONS #740)

**The report.** TASKS O.20h (owner-reported, live, P1): "Discretionary" meant two different things on screen — the /coach lifestyle-creep bar counted rows by the CATEGORY's taxonomy flag while the register and /budgets label the same row by its Fixed/Discretionary SPEND CLASS (the reader's per-row override, then the recurring-bill merchant guess, then the flag). A gym membership reading "Fixed · you set this" was still counted in the bar, and the panel listed it beside a re-file link that could not move the number. The bar now selects rows on `classifySpendClass(...) === 'guilt-free'` — the register's own label, on the register's own input (the RAW row: a null-category row reaches the classifier's refusal, never the read-time pipeline guess). coach.ts loads the reader's recurring-bill merchants and per-row verdicts; Ask and Money Review inherit through the same `getCoachData`. The divergence-disclosure sentence is deleted with the divergence it described; the replacement is a positive admission rule naming the unified basis. The refund disclosure's trigger was re-keyed to the figure's own basis (the sign-flipped twin's classification), so a reader whose gym rows are Fixed gets no "discretionary category" sentence about a gym refund the bar does not carry.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 6 P2 — all fixed same-session; cycle 2 PASS (0 P0, 0 P1; 3 P2 fixed in passing).** Cycle-1 P1: the first cut classified the RESOLVED category, so null-category rows the register badges "No class yet" still counted through the pipeline's guess — fixed by passing the raw row; the census/test were built to miss it (unresolvable fixture; census bucket after the old==new continue). Cycle-2 P2s: stale FAIL-OLD counts in two ledgers; demo figures not traceable to a committed artifact (now re-derived by the probe's LIVE-SEED arm); probe census computed the NEW arm on the resolved category (fixed; no recorded number was wrong).

**Gate.** `bash scripts/verify.sh` (run 5, final) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,413 passed + 1 expected fail + 1 skipped / 629 files**, `next build` clean. FAIL-OLD: with the engine+wiring stashed, `tests/unit/insights.test.ts` = **7 failed | 52 passed**; restored → 59/59 (reproduced independently by the cycle-2 critic). Playwright mobile-380 on the fresh build: `o20h-one-definition` **1/1** (throwaway user: mark "O20H Store A" Fixed from the register's action menu → badge flips with the you-set-this marker → December's panel row count 1→0) + `coach-creep-verdict` 3/3 + `o20d-bars` 7/7.

**Measurement (before the fix — the prescribed-remedy-is-a-hypothesis rule).** `scripts/audit-probes/o20h-creep-definition-arms.mts` (read-only, committed) ran both definitions per user: real user 49 disagreement rows ($1,008 override-fixed + $253 override-guilt-free + $4,979 recurring-bill merchants + $0 uncategorized), baseline $17,342.29 → $17,013.68, spend growth 1.0% → −3.8%, **rendered verdict unchanged** (Tracking income, not flagged); live-demo DB 15 rows leave the bar at the wall-clock window; seed byte-identical (0 disagreements); LIVE-SEED arm (the shipped demo page's world — seeded RecurringSeries as fixedMerchants): 24 rows over the window (~$78/mo), spend growth 25.5% → 27.0%, verdict unchanged ("Spending is outpacing income", flagged both arms).

**Ship.** `e36eee79` pushed to `origin/main` (no `prisma/` diff — database untouched). CI verify run 34737014759 **success** on `e36eee79` (full VERIFY_E2E=1, watched to conclusion; the docs push `026f29ed` supersedes it — re-read on the newest sha per the ship-gate rule). Vercel deployment on the sha: **success** (commit status). Live probe (demo session on `www.aimplifi.app`): /coach creep panel renders **"the same Fixed or Discretionary label the register shows"**, the old divergence sentence is gone, December lists 15 rows, verdict "Spending is outpacing income" — the deployed build carries the slice.

**Still open.** Wave 0 ops owner-blocked. M.4 visual direction owner-deferred. The named residual "second discretionary" (`averageDiscretionaryCategorySpend`, wealth-target cut proposals, category-grain taxonomy flag) is recorded in TASKS O.20h with a revisit condition. Wave 2/3/4 rows per TASKS.md.

## ✅ BUILT 2026-09-11 — The goals wave closes: behind-pace nudge, seeded demo goals, the 1200-month horizon (DECISIONS #739)

**The report.** Three TASKS Wave GL dead ends closed in one slice: the Today feed now warns about a slipping savings goal (GL.3 `goal_behind_pace`, ACTION tier, `centsAtStake` = the extra monthly needed, dismissal keyed goal+target-month, detail = the goal card's own sentence); the live demo opens with two seeded goals (GL.4 — Vacation Fund on pace/no-date, New Car Fund behind by 24 months with a $300/mo gap) so /goals, Home, and the feed are populated for a first visitor; and the 1200-month planning horizon is a WRITER's rule (GL.5) — the /goals editor refuses a month past Jun 2126 with an inline error naming the ceiling, the month input carries `max` + an always-described hint, and BOTH Ask save writers refuse the same horizon (they previously would have persisted a year-2200 plan computed at the saturated cap).

**Critic (fresh context): cycle 1 FAIL 3 P1 — all fixed same-session; cycle 2 PASS (0 P0, 0 P1).** Cycle-1 P1s: demo plan e2e pinned the pre-seed $0 savings world (glass-box L.29 moved to a throwaway fixture where unset binds; demo pins retargeted to the goal-derived $350 "Planned savings (goals)" with no control; the demo guilt-free panel keeps its penny-match and loses "nothing is invented"); the date-passed row said "behind pace" with a "$0.00/mo more needed" why-line (title + why now branch on pace); Ask save writers bypassed the horizon (shared `isBeyondPlanningHorizon` beside the cap, called before solve/persist).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,407 passed + 1 expected fail + 1 skipped / 629 files** (seed log counts `goals: 2`), `next build` clean. Playwright mobile-380 on the fresh build: `goal-demo-and-nudge` **2/2** (demo Home "1 of 2 goals needs a look" behind-first, /goals badges + sentences, dashboard nudge row with the card sentence; throwaway user: 2126-08 server-refused inline, 3200-01 client-blocked, 2027-06 saves, cleanup) + glass-box, conscious-buckets, goal-progress, goal-status-ask, education/giving presets, today-feed.

**Ship.** `d8947c89` on `origin/main` (no `prisma/schema.prisma` diff — database untouched; only `prisma/seed.ts`); docs `89594836`. CI verify run 34666301914 **success** on `89594836` (full VERIFY_E2E=1; the slice-only run 34666020736 was cancelled by the docs push). Vercel production **success** (GitHub deployment 6404766880) on `www.aimplifi.app`. Live probe: the demo DB lagged the seed (empty /goals worked example — the O.20e staleness class), closed by the new additive idempotent `scripts/seed-demo-goals-prod.ts` (demo rows only, run by the session against the owner-held prod URL); final probe on production: dashboard `nudge-goal_behind_pace` reads **"New Car Fund is behind pace … $450.00/mo gets you there on time ($300.00/mo more)"**, Home **"1 of 2 goals needs a look"**, /goals **New Car Fund 10% funded · Behind pace** + **Vacation Fund 33% funded · No date yet**.

**CI on the follow-up push `95274881` (seeder + this evidence) — run 34667973958 = failure, PRE-EXISTING, recorded per the ship-gate rule.** Failing test: `tests/e2e/transactions.spec.ts:638 "CSV import (H.2): re-importing the same file adds nothing"` — all 3 attempts died at the `Imported 0` re-submit assertion (line 723) with the result panel still reading the FIRST import's `Imported 2 … history now reaches Fri, Mar 15, 2024`, i.e. the second submit's confirmation flight was severed — the documented ≥60s stall class (spec header: flake ledger runs 31362750997 + 31367228157; playwright.config:31). Not touched by this push: the diff 89594836..95274881 is two ledger files + `scripts/seed-demo-goals-prod.ts` (imported by nothing; `rg`-verified), and the identical tree's e2e passed this spec green (3.9s) on run 34666301914. The retry loop's own `isEnabled()` guard could not fire because the button never left `pending` through the stall — the same shape run 31367228157 already rode out once by widening to 180s. Named here rather than re-windowed blind: if it recurs on a CODE push, widen the retry loop or back the dedupe with a unique constraint (the spec's own named remedy), then re-gate.

**Still open.** Wave 0 ops owner-blocked. M.4 visual direction owner-deferred. Wave 2/3/4 rows per TASKS.md.



**The report.** After #737 the /goals card and Home knew pace; Ask could only inverse-plan a new amount + date. A reader with three named goals could not ask about any of them.

**Shipped.** Ask intent `goal_status`. Parser takes the reader's savings-goal names and commits only on a unique or ambiguous `matchGoalName` (none declines). `detail` is the card's own `goalPaceSentence`. Timeframe/`at`/date checks run on leftover tokens outside the matched name, so "June wedding" is askable and "Japan trip this month" still abstains. Demo read-only.

**Critic (fresh context): cycles 1–4 FAIL, all P0/P1 fixed same-session.** Residual P2s in DECISIONS #738. No 5th critic (budget 4).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,388 passed + 1 expected fail + 1 skipped / 625 files**, `next build` clean. Playwright mobile-380: `goal-status-ask.spec.ts` **1/1**.

**Ship.** `b27986a1` on `origin/main`; CI verify run 34647434237 **success**; Vercel `dpl_2ci7DbwztXw36kq7yfRzzQSK6JWd` READY on `www.aimplifi.app`. Live demo Ask: "how am I doing on my spending last month?" → "You spent $4,587.00 last month." (not unknown). Named on-track questions need a stored row — demo has none (GL.4).

**Still open.** GL.3 behind-pace nudge; GL.4 seeded demo goals (live demo Ask cannot show a match); GL.5 1200-month cap. Wave 0 ops owner-blocked. M.4 visual direction owner-deferred.

## ✅ BUILT 2026-09-11 — Goals: progress + pace on every savings goal, and a Home Goals card (DECISIONS #737)

**The report.** Owner: make the app "extremely user friendly and insightful towards goals." A savings-goal card answered only "how many months at this pledge?"; it never said how far along the reader is or whether the pledge makes the date, and Home never mentioned goals.

**Shipped.** Pure engine `goalProgress()` (integer cents / bps; funded percent FLOORED so 99.99% never reads 100%; the required monthly for a dated goal is `solveSavingsGoalByDate`'s own figure, so the card and Ask state one number; the deadline is month-granular - the form's 1st-of-month and Ask's month-end judge alike). Every /goals savings card: progress bar (role=progressbar) + "N% funded" + a pace badge (Funded / Date passed / Needs a monthly amount / No date yet / On pace / Behind pace) + one sentence naming both inputs ("counting the $X you've marked saved, $Y/mo has this funded by <Month>, N months ahead of / after your <Month> date") and, when behind, the monthly that closes the gap plus the invitation to update what's saved. Home: `GoalsProgressCard` with a headline ("1 of 3 goals needs a look"), the three goals most in need of attention, each with bar + "$X marked saved of $Y · N% funded" + the same sentence, and a link to /goals. Debt-free cards and reserves untouched; no writers added; demo unchanged (no goals → no Home card).

**Critic (fresh context): cycle 1 FAIL 1 P1 — fixed same-session.** P1-1: the verdict leaned on the hand-typed saved figure without naming it (an Ask-saved goal read "Behind pace" one month later with zero reader action). Fixed in copy + Home basis line; GP-M anchor. Residual P2s accepted: `wholeMonthsUntil` caps at 1200 months (a >100-year date overstates the required monthly; the month input has no max); a regex-passing invalid stored date would split the two readers (unreachable through current writers).

**Gate.** `bash scripts/verify.sh` (run 2, after the critic fixes) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,354 passed + 1 expected fail + 1 skipped / 623 files**, `next build` clean. Playwright mobile-380 on the fresh build: `goal-progress.spec.ts` **1/1** (no-date → on-track → 25% + 3 months ahead → behind with "$375.00/mo gets you there on time ($75.00/mo more)"; Home headline, basis line, row, link), phase4 goals **1/1**.

**Ship.** `e739981a` on `origin/main`; CI verify run 34634294883 **success**; Vercel `dpl_HBj2JyqeXKCCpQpupfKs6YbdHzsC` READY on `www.aimplifi.app`; live /goals lead + a throwaway demo goal's card and Home row read in a demo session, then deleted (demo row restored). Ops note: `scripts/ci-status.sh` exits 4 under WSL bash (`gh: command not found`) - run `gh` from PowerShell until the script resolves the Windows `gh`.

**Still open.** Ask against stored goals ("am I on track for my Japan trip?"); a behind-pace nudge; seeded demo goals. Wave 0 ops owner-blocked. M.4 visual direction owner-deferred.

## K.2 CORRECTION — Plaid is at the 90-day DEFAULT, not the 730-day ceiling (2026-08-07)

Owner: *"All I want is max plaid data."* The recorded answer was wrong and the new one is
measured, not inferred. Probe: `scripts/audit-probes/plaid-depth-why.mts` (read-only, live Neon).

**What K.2 said:** "Plaid is at its documented 730-day ceiling … Plaid holds no more."
**What is true:** 730 days is two years; the corpus holds ~90 days. The ceiling was never the
binding constraint — our own request was. K.2 read `historyBackfilledAt` set on every item as
"backfilled, therefore exhausted", which the flag cannot mean.

**Measured, all 12 items (not 13 — three of the 15 `plaid.item.link` audit rows were removed):**
every Item was created **2026-07-23/24**, one week before `PLAID_DAYS_REQUESTED = 730` shipped
on 2026-07-31. Plaid applies `days_requested` only where Transactions was not already
initialized, so all twelve are pinned to Plaid's 90-day default permanently. Reach-back from
link date is 67–90 days on every item holding rows.

**The backfill ran and provably bought nothing — this is the important part.** All 12
`plaid.item.history-backfill` audit rows read `windowStart: "2024-08-04"` (a correct 730-day
ask), `added: 0`, and `alreadyExists: N` equal to the rows already held (289 Chase, 392 Capital
One, 189 Schwab, …). So `/transactions/get` over two years returned ONLY the existing 90-day
window and nothing older. That is a clean, complete fetch — not an error.

**Therefore the core assumption in `plaid-history-backfill.ts` is FALSE:** its header claims
`/transactions/get` "DOES return already-delivered rows and, for most institutions, up to about
two years of them." It does not return rows outside the Item's initialized window. That file
flagged itself "UNVERIFIED against a live sandbox"; it is now verified, and it is wrong. The
backfill cannot deepen any existing Item and no amount of syncing will change that.

**The only remaining lever is remove + fresh Link**, which the code already said
(`plaid.ts:280`) and which is now the ONLY route rather than one of two. `disconnectPlaidItem`
is safe for data — it revokes at Plaid and deletes the item row, but keeps accounts and
transactions ("they just won't update"), so the 90 days already held survive the round trip and
the reconciliation boundary handles the overlap when the fresh link lands.

**Do ONE bank first.** `days_requested: 730` has never been exercised against a live bank —
every network path in `plaid.ts` carries the same UNVERIFIED note that just proved wrong once.
Re-link the smallest connection (Truist, 3 rows) and confirm it returns ~730 days before
spending the clicks on the other six institutions.

**Ceiling regardless: 730 days is Plaid's documented maximum.** Even a perfect re-link of every
bank reaches 2024, not 2023. The owner's three-year ask cannot come from Plaid at all — that is
SimpleFIN (connection currently deleted) or per-bank CSV.

