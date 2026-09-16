# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Sections through 2026-08-19 live in `docs/archive/STATUS_ARCHIVE_2026-07_to_2026-08-19.md`
> (rotated 2026-09-11); only current-wave BUILT entries and OPEN/FOUND/DECIDED items
> remain here.
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ⛔ HUMAN GATE 2026-09-16 — O.20j converse-leak identity (critic budget exhausted, DECISIONS #743)

**Do not land the working-tree identity union on `main`.** Hostile critic cycle 4 of 4 = **FAIL 0 P0 + 1 P1**. The attempted rule (same-type + mask COLUMN ≥4, different ingest connections, dismissal/same-connection as a *component* veto) is still unsound: the veto walks the `(type, mask)` group while the union unifies `root()`, so a confirmed H.7 predecessor that shares a last-4 can fold two accounts on ONE Plaid item (including a pair the user dismissed) and a genuine transfer between them stops flagging **and** filing. Executed by the cycle-4 critic: `$2,500` phantom income + `$2,500` phantom expense via O.20c's unfiled-inflow rule, and H.7b would *clear* those flags. **Fix named, not applied:** evaluate the veto over the component `root()` would produce, not over the mask group; lock with a non-empty `confirmed` map plus a dismissal and a same-item pair.

**What is measured and must not be forgotten.** Live converse: 94 rows, $180,466.86 outflow / $37,949.79 inflow withheld. 61 FLAG RIGHT (~$205k genuine transfers, stale category). 33 FLAG WRONG / $12,878. H.7b never run (0 runs); would clear 25 today. 8 remaining WRONG ($237.08, CREDIT CARD last-4 `0977`, two Plaid items vs a filed `TRAVEL CREDIT`) are the prevention target. Demo 0 converse. Reader-side "count converse as spend" is killed (would dump ~$180k of real transfers into spending). `countsInFlows` / `isSpendRow` / auto-run H.7b were correctly left untouched.

**Cycle history (all four spent).** C1: HIGH detector as money identity (year-in-name, balance-only spouse cards) — fixed. C2: dismissal edge-skip, fail-OPEN dismissals, same-item edge-skip — fixed as *component* vetoes + `'unavailable'` fail-closed. C3: same-connection still an edge skip via a third copy — fixed as group veto. C4: confirmed-map back door, above.

**Residuals (not the P1).** Plaid+SimpleFIN copies cannot fold (SimpleFIN never writes `mask`; the live 0977 pair is Plaid-item vs Plaid-item). The 8 existing flags stay until the owner taps H.7b. Union does not read `currency`. Dismissal read is `take: 500` / `orderBy createdAt desc`.

**Code lives on branch `o20j-mask-column-identity` as draft PR #24, not on `main`.** Local verify of that tree was GREEN (8444 passed + 1 expected fail + 1 skipped / 629 files) — a green local gate is not a critic pass. Resume from the branch; do not re-derive from HEAD.

**Ledger on `main`.** `d2e146d1` (docs only — the identity union is not in that tree). CI verify **35151281286 = SUCCESS** (full VERIFY_E2E=1). Vercel Production `dpl_DMsPr3qg7mk97BDLzbd3GGYBKH9w` READY on the same sha. Live: this HUMAN GATE heading is on `origin/main`; `unionSameMaskColumnIdentity` is absent from `src/` on `main`.

## ✅ BUILT 2026-09-16 — The debt-payoff path names a balance the bank stopped sharing (L.19 surface 5, DECISIONS #742)

**The gap.** TASKS L.19 (5) — the one surface DECISIONS #305 left open: `loadDebtAccounts` narrowed each liability to the engine's `DebtInput` and dropped `feedDroppedAt`, so /goals' Debt Freedom planner ("Debt-free by Jan 2034" + total interest) and both Ask debt answers (a payoff month; an extra-per-month toward a chosen date) amortised a frozen balance with nothing said — and each is one save button from a persisted goal target.

**Shipped.** `DebtAccount extends DebtInput` (`kind`, `frozenSince`) is what the read path returns and the planner + both Ask answers accept; `planDebtPayoff` / `solveDebtFreeByDate` still take `DebtInput` and never read the stamp (byte-identity locked). New `frozenDebtPlanNote` in `feed-dropped-view.ts`: card → "may be higher or lower"; loan → NO direction ("nothing about this loan has been confirmed since"); mixed → two claims, ONE Accounts remedy; `figureLabel` names what each surface prints (the by-date unreachable branch names only `the total debt`). Rendered above the save control on /goals; appended to both Ask answers' `detail`. DISCLOSE, ADJUST NOTHING — figures and the save action untouched. No schema change.

**Critic (fresh context, separate node): cycle 1 FAIL 1 P1 + 8 P2 → cycle 2 ZERO P0/P1.** (A second, independent cycle-1 critic finished after the merge and converged on the same P1 and the same P2 set; its two new items — a false justification in the builder's header comment and an absence-only abstention pin — were fixed in the follow-up commit, and its coach read-path residual is (5) below.) The P1: the first cut's loan sentence said the real balance "may be lower" — false for Plaid's revolving `line of credit` / `home equity`, which `plaid-map.ts` folds into `LOAN` (a draw pushes the balance UP), and for accrued interest; the understating direction is the dangerous one. Fixed to claim no direction (the `frozenLoanNote` precedent) and pinned negatively. P2s fixed: repeated remedy in the mixed note; by-date label naming an extra the unreachable branch does not print; the planner's source-grep "test" replaced by a jsdom render lock (fail-old: pre-slice component → 1 failed | 1 passed; filter inversion → 2 failed); a float-derived expectation replaced by the integer-cents literal `162_923` (critic verified minimal: `162_922` → 13 months). Cycle 2 independently reproduced the gates, the mutation probes, the "Jan 2034" figure and the DECISIONS rotation (63 lines verbatim).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,439 passed + 1 expected fail + 1 skipped / 630 files**, `next build` clean. Playwright mobile-380 on the fresh build: `debt-plan-frozen` + `frozen-figure-surfaces` + `ask` = **35 passed**. (One local e2e run hung first: Playwright's `reuseExistingServer` attached to a `next start` whose `.next` the gate's build had replaced underneath it — a stale-server flake, not a code defect; killed by PID and re-run clean.)

**CI + live.** `19152a3d` on `main` (PR #23 fast-forwarded the same turn). CI verify **35115110437 = SUCCESS on `main`** (full VERIFY_E2E=1; the same sha was also green on the branch push 35113323242 and the PR run 35113236398). Vercel Production 6484384476 = success. Live probe 7/7 (demo session): /goals planner abstains (nothing frozen on the demo); the /goals client chunks carry the new loan sentence and not the retracted one; Ask's debt-free answer carries no frozen note.

**CI on the follow-up push `82f59146` (comment correction + abstention pin + STATUS residual) — run 35118629557 = failure, PRE-EXISTING, recorded per the ship-gate rule.** 1 failed / 390 passed: `tests/e2e/transactions.spec.ts:638 "CSV import (H.2): re-importing the same file adds nothing"` red through both retries (`import-result` toContainText predicate timeout) — the same recurring flake recorded above for run 34667973958 and in the 2026-08 archive; `:735` and `:1014` flaked once each and passed on retry. The push touched a comment in `feed-dropped-view.ts`, a unit-test literal, and this file; none of it runs in that spec, and the identical source was green on 35113323242 / 35113236398 / 35115110437 the same hour. Vercel Production on `82f59146` = success. **Re-read on the next push `7f88e5a6` (docs only): run 35121407928 = SUCCESS** (full VERIFY_E2E=1) — same source, green; the red was the flake.

**Ledger cut.** `docs/DECISIONS.md` was 44.6 KB; #724–#736 rotated verbatim to `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (now 36 KB; index regenerated, 729 entries).

**Still open / residuals.** (1) **Saved debt-free goal is silent after save** (critic P2-6): `saveDebtFreeGoal` persists `totalBalanceCents` from `loadDebtAccounts` as the target and the /goals goal card prints it with no frozen note — the same shape as #305's PDF finding, one hop later; the planner note above the save control is the only warning. Fix needs the goal card to know the target's basis (a `frozenAtSave` or a re-resolve against current `feedDroppedAt`). (2) `stoppedSharing` says "Your banks" for two frozen rows at one institution — inherited from the L.18 builders. (3) The `perDebt` resolution in the planner and `answerDebtPayoff` is the identity today (the engine echoes every row) — kept as the L.15 resolution point. (4) `text-xs` muted contrast unmeasured (UNVERIFIED, pre-existing token). (5) **A second debt read path still strips the fact** (the late cycle-1 critic's P2-4): `src/server/coach.ts` builds the next-dollar `loans` from `snap.accounts` without `feedDroppedAt`, and `next-dollar.ts` has no frozen handling — the coach names a specific loan to put the next dollar toward over a balance the bank may have stopped confirming. Outside #305's enumerated debt-payoff path, so not this slice's defect; same disease, next cut. Wave 0 ops owner-blocked. M.4 owner-deferred. Wave 2/3/4 rows per TASKS.md.

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

## ✅ BUILT 2026-09-11 — TASKS.md ledger cut + M.4 slice 4: residual section labels onto the token (DECISIONS #735, #736)

**Ledger cut (#735).** The rotation commit's named next cut: eight fully-closed wave sections (O, O.16, O.12, O.18, O.19 totals, C, G, O.19 accounts — zero status-badged rows, each range re-verified row-by-row; Wave O's owner requests confirmed shipped via the done-row archive + #725) moved verbatim to `docs/archive/TASKS_DONE_ARCHIVE.md` under a dated marker. TASKS.md 143 KB → 126.5 KB; the rest is open rows' live status cells. docs-lint clean; ledger suite 20/20.

**Slice 4 (#736).** The ~13 residual near-twin section-label literals from slice 3's critic now render PAGE_SECTION_LABEL_CLASS across 8 files (budgets/triage/rules/settings category h3 pairs with mb-2 kept; household-card, learned-phrases, household-sharing-card h3s; the spending-plan hero <p> pair with `justify-center`). Charter exclusions named: badge pills, nav/list-group headers, onboarding brand caption.

**Critic (fresh context): cycle 1 FAIL 1 P1 — fixed same-session.** P1-1: the token is a flex row; the spending-plan hero labels lost the parent's text-center effect (flex items pack to start) and left-aligned beside the centered amount on all three hero branches — fixed with the recurring-view `justify-center` precedent. P2-1: the new e2e was tautological on spending-plan (weight was already 500) — replaced with a real alignment lock (justifyContent center + label/amount centers within 1px), which demonstrably fails-old (caught the stale pre-fix build).

**Gate.** bash scripts/verify.sh (run 2, after the P1 fix) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,315 passed + 1 expected fail + 1 skipped / 623 files**, next build clean. Playwright m4-page-chrome **4/4** against the fresh build (19 routes × 380+1440 no overflow; budgets label weight 500; hero centered).

**Ship.** `692fe505` on `main`, docs state `290e7f78`. GitHub Actions `verify` run **34626408618 = SUCCESS** on the head sha (the slice run was cancelled by the docs push; re-read on the newest sha). Vercel Production **6398151276 = success** (`https://aimplifi-162ibogn8-reiforge.vercel.app`, aliased to `www.aimplifi.app`); live `/sign-in` 200 and its stylesheet carries the token's utilities + `background-attachment:local`.

## ✅ BUILT 2026-09-11 - M.4 slice 3: near-twin section labels + lead-column cap + body-wash scroll fix (DECISIONS #734)

**The report.** The tree held slice 3 interrupted before its gates. Closed the three #724 residual P2s: 7 near-twin section-label literals render PAGE_SECTION_LABEL_CLASS (spend-class-panel's h3 keeps mb-2); PAGE_LEAD_CLASS capped at max-w-md with PAGE_LEAD_WIDE_CLASS re-opening the wide routes (accounts, goals, rules, triage, ask); body gradient background-attachment: local.

**Gate.** bash scripts/verify.sh → ✅ VERIFY GREEN: tsc 0, eslint 0, unit **8,297 passed + 1 expected fail + 1 skipped / 616 files**, next build clean. Playwright mobile-380: m4-page-chrome **3/3** (19 routes × 380+1440, no horizontal overflow) + phase1-cash-needed **2/2**.

**Critic (fresh context): cycle 1 FAIL 1 P1 - fixed same-session.** The P1 was staging: the untracked lock test sat beside the throwaway capture spec + shots/ + scratch logs, so a commit habit could ship the slice without its lock (or ship the throwaway). Scratch deleted; lock staged explicitly. Residual P2s: ~13 near-twin literals outside the 7-file charter (triage/rules h3s, budgets/settings/spending-plan/household cards) - slice 4 candidates; the near-twin lock regex is order-heuristic; gap-1.5→gap-2 micro-deltas on /investments + /recurring accepted and named.

**Rotation.** Four ledgers cut under the 40KB ceiling, verbatim: DECISIONS #485-#723 → DECISIONS_ARCHIVE_485_to_723.md (live = #724+); PROGRESS 2026-08-20..2026-08-31 → PROGRESS_ARCHIVE_2026-08-20_to_2026-08-31.md; STATUS BUILT/records through 2026-08-19 → STATUS_ARCHIVE_2026-07_to_2026-08-19.md (OPEN/FOUND/DECIDED + 2026-09 BUILT stay live); REGRESSION rows 2026-08-20..2026-09-02 → REGRESSION_LEDGER_ARCHIVE_2026-08-20_to_2026-09-02.md. Index regenerated (712 entries); ledger-decisions-index unit test green; docs-lint clean. TASKS.md (139.9KB, no line-level [x] rows) is the named next cut.

**Ship.** Landed `6cf6f3d0` on `main` (rebased over the parallel session's #726-#733 feature commits; my decision renumbered #726 -> #734). GitHub Actions `verify` run **34615048819 = SUCCESS** (full VERIFY_E2E=1 suite on the merged tree). Live `https://www.aimplifi.app/sign-in` 200 and its served stylesheet carries `background-attachment:local` - the slice marker unique to this change.
## ✅ BUILT 2026-09-10 — CI repair: four red e2e specs + Needs-a-category aria-pressed (DECISIONS #725)

**The report.** Slice 2 left CI `verify` run `34511385651` red on four pre-existing e2e + one flaky a11y scan. Those were the next leftover.

**Shipped.** Specs follow the shipped UI. Budget Clear is inside the row editor — open `budget-row-target-*`, then after clear assert the first-run hint and the gone row (a collapsed `budget-clear-*` count-0 does not prove the target left). Failed-sync alert locks `couldn't sync` / `Reconnect it so your numbers stay current` plus in-place SimpleFIN reconnect. Wealth-target dials link is `#coach-money-dials` and that target is on /coach. Needs-a-category chip stays a pre-hydration `<a>`; `aria-current` when on; no `aria-pressed` (axe `aria-allowed-attr`).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8,288 passed + 1 expected fail + 1 skipped / 614 files + 1 skipped (615)**, `next build` clean. Playwright mobile-380 **17/17** on the repaired specs + phase5-a11y, then **2/2** after the clear-outcome strengthen.

**Critic (fresh context): PASS — 0 P0, 0 P1.** Residual P2s: `aria-current` is not toggle semantics; dials jump is existence-locked not click-tested.

**Ship.** `ad9c0f77` on `main`. GitHub Actions `verify` run `34516971264` = SUCCESS. Vercel Production `dpl_6eQqSWvabbbv1SdV9y9bQRU2bCqn` READY (`https://aimplifi-bupvp09n8-reiforge.vercel.app`, aliased to `www.aimplifi.app`). Live `/sign-in` 200. The repaired chip and reconnect alert are signed-in-only — public HTML marker UNVERIFIED.

**Still open.** M.4 slice 3 (section labels + dashboard/accounts). Ledger rotation (ceiling). Wave 0 ops owner-blocked.

## ✅ BUILT 2026-09-10 — M.4 slice 2: page-chrome tokens, chrome restyle, brand-tinted dark theme (DECISIONS #724)

**Shipped.** Four shared page-chrome tokens (title / lead / stack / section label) in `src/components/finance/page-chrome.ts`, unit-locked; every visible page h1 + lead migrated (16 routes + the new-user welcome card); two byte-identical trends-view section labels onto the token. Shell chrome: sticky translucent header, pill desktop nav, mobile bottom-bar active indicator (shape, not color), demo banner as a pill, sign-in card elevation, rounded-lg auth inputs, surface cards with a 1-ring hairline. `.dark` retinted with brand-green chroma (oklch hue 165) — the app renders hard-coded dark (root layout), so the retint is the identity, not a mode; light `:root` untouched. className/CSS only: no copy, figure, adjacency, testid, or logic change.

**Boundary repairs (own REGRESSION_LEDGER rows).** A 2026-09-08 `core.autocrlf=true` re-smudge had put CRLF on 586 worktree files while the index stayed LF: byte-identical repair + `.gitattributes` `* text=auto eol=lf`. `vercel-build.test.ts` never passed on Windows — `bash` here is WSL (PATH/env do not cross as the test assumed; DATABASE_URL needs WSLENV): made platform-aware, Linux path unchanged. Lesson: `docs/lessons/wsl-is-the-bash-env-and-boundary.md`.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (run 5, exit 0, 365s): tsc 0, probes tsc 0, eslint 0, unit **8,288 passed + 1 expected fail + 1 skipped / 614 files + 1 skipped (615)**, `next build` clean.

**Walkthrough.** `tests/e2e/m4-page-chrome.spec.ts` 3/3: 19 (app) routes × 380px+1440px with no horizontal overflow; desktop h1 renders 30px; desktop nav links pill-shaped; demo banner renders as a pill; hero font weight ≥600. Retinted screenshots reviewed: dashboard 380px, accounts 1440px, sign-in — all render coherently.

**Critic (fresh context): cycle 1 FAIL 3 P1 — all fixed same-session.** Junk WSL cmds.log files staged (removed from disk+index); deleted temp spec still staged (replaced by the promoted `m4-page-chrome.spec.ts`); new lessons INDEX line over the 220-char ceiling. Contrast re-check passed (all text pairs AA-preserved). Open P2s for M.4 continuation: 7 near-twin section-label literals (allocation-drilldown, forecast-view, recurring-view, retirement-outlook-card, spend-class-panel, top-spending-card, ask-view); PAGE_LEAD_CLASS `max-w-2xl` dead on `max-w-md` routes (transactions/import, transactions/new, error); `background-attachment: fixed` body gradient (scroll repaints, ignored by iOS Safari).

**Ship.** `795b0dc1` on `main` (pushed 2026-09-10). Live `https://www.aimplifi.app/sign-in` serves the slice marker (`shadow-lg ring-1 ring-foreground/5`, sign-in card elevation) — deployment READY. **CI `verify` run `34511385651` FAILURE — all failures proven pre-existing** at ship time; repaired in #725.

## ✅ BUILT 2026-09-03 — Home recent charges line up; compact direction says Money out (DECISIONS #638)

**The report.** Owner: Home Recent transactions were not lined up, and compact “Out” did not say what it meant. Beauty later, after the feature set.

**Shipped.** 3-column grid (payee / dollars / Open). Meta wraps on a second line. Compact direction uses Money in / Money out, same as detail. Writes stay siblings of the C.15 Open Link. Amounts stay `shrink-0`. Wave M.4 restated, not started.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN. Unit **8,183 passed + 1 expected fail + 1 skipped / 537 files + 1 skipped**. E2E mobile-380: `transaction-return-c15` 3/3, `phase1-cash-needed` 2/2.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** Residual P2s: silent toggle, aria-label vs visible name, demo empty third track, source-string lock only.

**Ship.** `dc74a020` on `main`. CI `33808709791` SUCCESS. Vercel Production `6253396769` SUCCESS (`https://aimplifi-j5b85v6i7-reiforge.vercel.app`). Live `https://www.aimplifi.app/dashboard` → 307 `/sign-in` (auth). The Money out control is signed-in-only, so the public HTML has no `home-recent-direction` marker — that probe is UNVERIFIED without a signed-in session.

## ✅ BUILT 2026-09-03 — Add a card from the Cards page (DECISIONS #637)

**The report.** Standing leftover after #634: Cards empty still sent
“Add a card manually” to Accounts, and a populated Cards page had no
add affordance.

**Shipped.** `CardAddControl` on both Cards empty (`cards-empty-manual`)
and the populated page (`cards-add-open`). Same writer as Accounts
(`addManualAccount`); type locked to CREDIT. Demo not mounted.
Balance still refuses $0. Writer also revalidates `/cards`.

**Does not** add loans or other liabilities from Cards. Does not
collect APR / due day on create (statement add remains #634). Linked
cards still come from Connect.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0, probes
tsc 0, eslint 0, `next build` clean). Unit **8,182 passed + 1 expected
fail + 1 skipped / 536 files + 1 skipped**. E2E cards-add **1/1**,
connect-affordances **1/1**, cards-statement **1/1** on mobile-380.

**Critic (fresh context): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0, 0 P1.**
P1-1: amount unlabeled. P1-2: unknown-due named Accounts / a bank
statement. Residual P2s: empty-state still mentions the plan; household
add does not say “your” card; `$500`/`1,234` still rejected.

**Ship.** `16590072` on `main`. CI `33803882007` SUCCESS. Vercel
Production `6252565100` SUCCESS. Public `/cards` is auth-gated.

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

