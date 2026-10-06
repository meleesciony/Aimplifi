> Sessions from 2026-06/2026-07 were moved verbatim to
> `docs/archive/PROGRESS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and
> sessions from 2026-08-01 through 2026-08-17 to
> `docs/archive/PROGRESS_ARCHIVE_2026-08-01_to_2026-08-17.md` on 2026-08-28.
> Sessions 2026-08-20 through 2026-08-31 live in `docs/archive/PROGRESS_ARCHIVE_2026-08-20_to_2026-08-31.md` (rotated 2026-09-11).
> The five 2026-09-03 sessions and the 2026-09-10 M.4 slice 2 session live in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-03_to_2026-09-10.md` (rotated 2026-09-16), and the
> 2026-09-10 CI repair through the 2026-09-11 goals wave (#725, #734-#739) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-10_to_2026-09-11.md` (rotated 2026-09-17), and the
> 2026-09-17 L.19 residual 5 session (#745) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-17-745.md` (rotated 2026-09-18).
> the 2026-09-12 O.20h and 2026-09-14 O.20c sessions (#740/#741) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-12_to_2026-09-14.md` (rotated 2026-09-19),
> and the 2026-09-18 #751/#752 sessions in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-18-751-752.md` (rotated 2026-09-20).
> the 2026-09-16 through 2026-09-17 sessions (#742–#748) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-16_to_2026-09-17.md` (rotated 2026-09-21).
> Only sessions from 2026-09-18 onward live here; append new sessions at the top as before.

## 2026-10-05 — Money you put in: brokerage deposits read from the bank side (DECISIONS #788) — IN PROGRESS

Owner, on remote control: "As a world class dev, ai engineer, personal finance expert and data scientist, build this out." No attachment; the next owner-agreed slice was brokerage deposit history, gated on "verify the endpoint is covered before building". Plaid's billing pages (fetched) say calling `/investments/transactions/get` adds a monthly per-login subscription ended only by unlinking → human gate → owner chose "Bank side, no new fee" (DECISIONS #788).

**Carried in.** CI verify run 37393515573 on `110a0df3` (the #787 docs fix) = SUCCESS (`scripts/ci-status.sh` exit 0) — closes the read #787 left open.

**Plan (assertions → `tests/unit/investment-deposits.test.ts`).** A1 brokerage name → the one linked investment account there; A2 last four after a mask marker → that account; A3 inflows are money taken out; A4 pending / split parent / excluded / other category / non-bank account / an equal opposite row on another linked bank or card account within 7 days → not counted; A5 brokerage not linked → listed, not counted; A6 a linked bank or card account at the same brokerage → counted only when its records cover the week and show no counterpart; A7 two brokerages or a shared mask → not counted; A8 mask and name disagree → not counted; A9 window = last 12 complete months + this month, never before the records; A10 several accounts at one brokerage → one destination; A11 combined accounts count once; A12 /investments card; A13 demo seed shows it, no other demo figure moves.

**Built (local commit `0de71e5e`, not pushed).** Engine `src/lib/engine/investments/deposits.ts` + `brokerages.ts` (the categorizer's brokerage list, drift-locked) + `deposits-copy.ts`; loader `src/server/investment-deposits.ts` (finance snapshot + its `terminalOf` + handover-day collapse; institution names through the live item row, then the disconnect stamp); card `deposit-history-card.tsx` on /investments (narrows with the holdings list's own `resolveInvestmentScope`); demo seed: −$750.00 "ONLINE TRANSFER TO BROKERAGE X8842" monthly + one +$2,000.00 back (appended, no RNG draw); probe `scripts/deposits-live-deploy-check.mjs` (pre-deploy run on production: 2/3 — the card absent, as designed; demo guilt-free $1,309.08).

**Gate (before the handover-day edit).** Git Bash `VERIFY_E2E=1 bash scripts/verify.sh` exit 1: tsc 0, probes 0, eslint 0; vitest 9,071 passed + 2 failed (`vercel-build.test.ts`, the recorded Git Bash environment failure — from PowerShell with `ledger-decisions-index` + `link-audit`: 31/31); build compiled; Playwright 470 passed / 4 flaky / 0 failed (budget-targets:61, merchant-lens:77, register-return:119, transactions:736 — passed on retry, untouched). Both new e2e tests and the /investments axe scan passed first try. After the edit: tsc 0; deposit tests 52/52. Mutation: 23/23 engine mutations killed.

**Critic cycle 1** (Opus, separate worktree, on `0de71e5e`) = **FAIL — 5 P1** (F1 any equal opposite row took a deposit; F2 a stopped feed read as "None"/"Nothing moved"; F3 unfiled rows naming a destination dropped silently; F4 a returned deposit counted; F5 the narrowed view's sentence and a brokerage-name deposit counted as the scoped account's) + 8 P2 + P3s, all executed. Its worktree's `node_modules` junction was removed link-only (`[IO.Directory]::Delete(path, $false)`) before the worktree was removed; the main `node_modules` verified intact.

**Fix cycle 1.** Engine rewritten to the rule now in DECISIONS #788: move-evidence pairing (ordinary moves first, card purchases never send), per-month record coverage via `accountRecords`' feed rule, not-filed / returned / not-a-deposit / precise ambiguity reasons, name → brokerage destination, scope counts only last-four money and reports name money beside it, multiset handover collapse, no "#" marker, own-account last four ignored. `REVERSAL_RE` exported from `bonus.ts` (one author). Card: wrap-safe money chunks, 44px link, empty states per missing account kind. Prod demo seeder `scripts/seed-demo-deposits-prod.ts` (additive, fixed ids, refuses non-Postgres — exercised). Mutation round 2: 36/41 — survivors closed with tests (unfiled return without words; money before a deposit is no return; the row's own last four; own account not its own counterpart) and one dead line removed (a cap on a vouched date no coverage question can reach); round 3: **40/40 killed**. Unit 68/68.

**Gate (on `33e72a8e`, committed locally).** Git Bash `VERIFY_E2E=1 bash scripts/verify.sh` exit 1: tsc 0, probes 0, eslint 0; vitest 9,088 passed + 2 failed (`vercel-build.test.ts`, Git Bash environment — PowerShell with `ledger-decisions-index` + `link-audit`: 31/31); build compiled; Playwright **473 passed / 1 flaky / 0 failed** (`fixed-composition.spec.ts:203`, untouched, passed on retry); both new e2e tests and the /investments axe scan passed first try.

**Critic cycle 2** (Opus, separate worktree, on `33e72a8e`) = **FAIL — 1 P1 / 6 P2 / 9 P3**; all five cycle-1 P1s verified CLOSED by execution (it also reproduced the full unit suite 9,090 passed from PowerShell, `next build`, and a 360/380px Chromium + WebKit render with no clipping). New P1: the cycle-1 return rule cancelled real deposits on unrelated same-amount money (roommate Zelle, Venmo cash-out, store return). Worktree junction removed link-only; worktree removed.

**Fix cycle 2.** A return must name the same destination, or be unfiled and worded as a return; returns reach 14 days before the window; this month needs records through the day before yesterday (nothing on the 1st/2nd; "None yet"); the reader's Ask record-edge words honoured (`accountRecords` start/end words, only while they name the record's edge); narrowed view: "Nothing placed on X by its last four digits", one-account by-name wording, only last-four rows listed; `names-two-accounts` reason; unfiled card credits and last-four deposits never pair with cards; two destination-naming rows never pair; direction-aware reasons; memberships (ROBINHOOD GOLD, COINBASE ONE), sub-$1 test deposits ignored, P2P descriptors never name a brokerage; long dates; trailing "·" separator; seeder idempotent against rows. Mutation round 4: 52/54 — survivors closed with tests (a return on another account; a stale "ended" word) → **54/54 killed**. Unit 78/78.

**Gate (on `1db14499`, committed locally).** Git Bash `VERIFY_E2E=1 bash scripts/verify.sh` exit 1: tsc 0, probes 0, eslint 0; vitest 9,098 passed + 2 failed (`vercel-build.test.ts`, Git Bash environment — PowerShell with `ledger-decisions-index` + `link-audit`: 31/31); build compiled; Playwright **472 passed / 2 flaky / 0 failed** (`no-dead-ends.spec.ts:300`, `rule-inventory.spec.ts:81` — recorded pre-existing, untouched, passed on retry); both new e2e tests and the /investments axe scan passed first try.

**Critic cycle 3** (Opus, separate worktree, on `1db14499`) = **FAIL — 2 P1 / 4 P2 / 9 P3**; every cycle-2 P1 verified CLOSED by execution (real categorizer, real loader on a DB fixture, Chromium + WebKit 360/380 with axe 0 violations; the demo's dashboard, plan, forecast, reports, trends, radar, coach, recurring, goals and cash-needed byte-identical with and without the 19 seed rows). P1-1 a bounced deposit counted once its return was filed Transfer (the categorizer files "ONLINE TRANSFER RETURN" Transfer); P1-2 "Nothing moved"/"None" false for brokerages and formats the engine cannot read. Worktree junction removed link-only; worktree removed.

**Fix cycle 3.** Returns worded as a return cancel unless filed to spending or as a refund (`mayBeADepositReturn`); zero copy is "Nothing matched" / "None matched", and the card names accounts it can match only by last four (`lastFourOnly`) or not at all (`unmatchable`); PayPal is a merchant route; rowless accounts are out of the coverage question; loan/mortgage/lending/insurance/premium/rebate/refund words (MARGIN dropped) with the matched word quoted; the one-day sync lag applies to every month; month notes say where records begin or stop; Ask words ignored on a combined record; "file it as Transfer" only; the STATUS "FOUND" entry #788 cites now exists; seeder docstring exact; mask regexes cached. Unit 84/84; tsc 0; eslint 0.

## 2026-10-05 — Bonuses that land pay this month's savings first, on their own line (DECISIONS #787)

Owner, on remote control: "As a world class dev, ai engineer, personal finance expert and data scientist, build this out." No attachment; the ledgers' first owner-agreed next slice was #784's open half (the bonus line, bonuses toward savings first), so it was built without a question (DECISIONS #787 records the reading of the owner's words and the alternatives).

**Picked up / closed.** New pure engine `src/lib/engine/spending-plan/bonus.ts` (`bonusesThisMonth`, `bonusTowardSavingsCents`) and one copy author `bonus-copy.ts`. Plan terms `bonusTowardSavingsCents`, `savingsFromPayCents`, `leftToSpendFromPayCents` (identity `income + bonus credit = fixed + savings + guilt-free`); the credit only on the regular-pay basis, never more than planned savings. Glass-box 4th row; /budgets strip split of pay; Home, /budgets card and strip, Ask (both answers); every planner reads the pay-only figure and says "from pay" in a bonus month. No schema change.

**Critic (Opus, separate contexts).** Cycle 1 FAIL (2 P1), cycle 2 FAIL (1 P1), cycle 3 **PASS 0 P0 / 0 P1**; its P2s and four P3s taken before ship, not re-reviewed (each narrows). Locked per cycle; fail-old and mutation recorded in DECISIONS #787.

**Gate.** Git Bash `VERIFY_E2E=1`: tsc/eslint 0, 9,020 unit passed (+ the known Git Bash `vercel-build.test.ts` 2 — 31/31 with its two neighbours from PowerShell on the same tree), build clean, Playwright 466 / 5 flaky / 1 failed (`transactions.spec.ts:736`, CSV import, under load — not touched; alone: passed; a full Playwright re-run on the same build: 471 passed / 1 flaky / 0 failed, exit 0). Earlier gates this session (each cycle): 470/2 flaky/0, 468/4 flaky/0, 472/0/0.

**Gate read.** CI verify run 37389535168 on `8a663da4` = SUCCESS; Vercel Production deployment (GitHub record 6871898956, `aimplifi-g6n94acdp`) success; `scripts/bonus-line-live-deploy-check.mjs` DEPLOY PROOF PASS 8/8 — `www.aimplifi.app`'s 23 `/_next/static` files on /sign-in match that deployment and differ from the previous one (`aimplifi-iuepslqqp`, `4397eb2b`); the shared demo still prints $1,309.08 guilt-free on Home, Guilt-free and /budgets (read before the push), with three plan lines and no bonus row or note. The change is server-rendered and speaks only when bonus money landed, so the build match is the discriminator; the bonus line itself is proven by the unit locks and the e2e throwaway users.

**Docs commit.** CI verify run 37391168086 on `f390ad80` (ledgers + lesson) = FAILURE — one unit test this push touched: `standing-reads.test.ts` (the new lessons-INDEX line was 357 characters, the cap is 220); e2e in that run 468 passed / 4 flaky / 0 failed. Fixed (line shortened to 190), full unit suite re-run (9,020 passed + the Git Bash `vercel-build` 2; from PowerShell `vercel-build` + `standing-reads` + ledger tests 36/36), REGRESSION_LEDGER row; pushed again — the CI read follows.

**Next.** Owner: on the live Guilt-free page, the month your next bonus lands, check the "Bonus this month, toward savings first" row (only while the plan reads regular pay). Recorded for later: a payroll bonus on the newest payday holds the plan on the median for one pay period (no credit then); measured savings; brokerage deposit history; big-retail payroll deposits categorized Shopping.

## 2026-10-05 — Regular pay counts the lower level after one change of pay (DECISIONS #786)

Owner, on remote control: "build this out". The message arrived with no plan or attachment, so the four open income candidates went to the owner as one question; the owner picked "Pay steps" — the #785 replay finding that the Social Security wage-base step held their household on the median.

**Picked up / closed.** `regular-pay.ts` condition 3 also passes after ONE change of level: the last eight in-band paychecks split, in date order, into two runs each within 2%, not overlapping, each at least two paychecks → the lower run's median, never more than the newest; the lowest qualifying split wins. Every week or every two weeks the month is also held to a usual month (× 4 / × 2) of the smallest paycheck after any qualifying split — a new job paid twice a month under the same payroll name reads as the old rhythm for up to six paydays. `RegularPayStream.step` feeds the one sentence author (glass box, both Ask answers), the row label and the /budgets note. No schema or loader change.

**Critic (Opus, separate contexts).** Cycle 1 FAIL (P1: timing clause false after a rise > 8.33%), cycle 2 FAIL (P1: same-name switch to twice-a-month pay read 26 a year → the usual-month cap), cycle 3 PASS 0 P0 / 0 P1; its P2-1 (later run needs two), P2-3 (tie-proof "since the change") and P3s taken before ship, not re-reviewed (each narrows). Owner calls recorded in STATUS: the cap plans below the lower level after a fall or a small rise; the median can sit above the lower level where the rule hands back.

**Gate.** Git Bash `VERIFY_E2E=1 bash scripts/verify.sh`: tsc 0, probes tsc 0, eslint 0; vitest 656 files passed + 1 failed — 8,969 passed, the 2 failures `tests/unit/vercel-build.test.ts` (the known Git Bash child-bash environment failure; from PowerShell on the same tree `vercel-build` + `ledger-decisions-index` + `link-audit`: 31/31); `next build` compiled; Playwright **467 passed / 3 flaky / 0 failed** — `merchant-lens.spec.ts:22`, `no-dead-ends.spec.ts:300` and `transactions.spec.ts:1015` (the last a recorded pre-existing flake) failed under full-suite load and passed on retry; alone, no retries, on this tree: 3/3. Both `regular-pay-income.spec.ts` tests passed first try. Mutation: 29 of 29 engine mutations, and the row-label and /budgets branches, each fail at least one test. Fail-old: 9 failed on the #785 engine.

**Gate read.** CI verify run 37353236148 on `ba8b9c90` = SUCCESS; Vercel Production deployment (GitHub record 6866394080, `aimplifi-27n7iv2r5`) success; `www.aimplifi.app` serves it — its 14 `/_next/static` files on /sign-in match that deployment exactly and differ from the previous one (`aimplifi-k5z4vrckj`, `d97ff2c6`) — the change itself is server-only, so the build match is the discriminator; `scripts/regular-pay-live-deploy-check.mjs` DEPLOY PROOF PASS 5/5 (the shared demo still plans on the median). The Vercel CLI was not signed in on this machine, so the deployment was read from its GitHub record.

## 2026-10-04 — Regular pay plans the month, when one steady paycheck explains the pay (DECISIONS #785)

Owner, after #784 ("Base pay plans the month"): "this app eventually will be used by many people, the base app has to cover everyone, think of a different approach." Read-only production probes (owner-run, figures kept out of the repo) showed the shipped recurring detector found no payroll series at all — real paychecks drift by cents.

**Picked up / closed.** New pure engine `src/lib/engine/spending-plan/regular-pay.ts`: a steady paycheck at its yearly rate (×26/12 biweekly, ×24/12 twice a month, ×52/12 weekly) plus a small usual remainder, used ONLY when one steady paycheck clearly explains the household's pay (unbroken run before the window; one level within 2% over the last eight; newest payday ordinary; no other steady payroll; other pay ≤ 10% of a usual month); every other household keeps the three-month median exactly. Plan basis `'regular-pay'` (plan reads `clean`), loader wiring, one sentence author for the glass box and both Ask branches, row label, /budgets note, plan-figures copy. Deploy probe `scripts/regular-pay-live-deploy-check.mjs` (bundle marker + the demo still on the median).

**Three human gates (owner).** Critic cycles 1–5 FAIL on a design that modelled every household → owner: fail closed ("Simplify, then 6th review"). Cycle 6 FAIL (step-down planned at the old level; copy over-promised) → fixed → owner: a 7th review. Cycle 7 FAIL (a second payroll's raised paydays counted twice) → owner: one steady paycheck only, then an 8th review. **Cycle 8 PASS (0 P0 / 0 P1)**; its P2-1/2/3 and P3-1/2 taken before ship.

**Gate.** Git Bash `VERIFY_E2E=1`: tsc/eslint 0, 8,955 unit passed (+ the known Git Bash `vercel-build.test.ts` 2 — 3/3 from PowerShell on the same tree), build clean, Playwright 465 passed / 2 flaky / 2 failed (the recorded pre-existing `rule-inventory.spec.ts:81` and `transactions.spec.ts:1015` flakes — alone on this tree: passed, and passed on retry). Mutation 40/40 killed. Live-figure scan of the whole slice diff: clean.

**Gate read.** CI verify run 37218230775 on `f9f4398c` = SUCCESS; Vercel READY; `scripts/regular-pay-live-deploy-check.mjs` DEPLOY PROOF PASS 5/5.

## 2026-10-03 — "Over plan" after a tax payment: charges filed as taxes leave the guilt-free plan (DECISIONS #783)

Owner, with a screenshot of Guilt-free far "Over plan": "How is it that I'm over plan by [that much]?", then "I think the app got tricked because I had a large tax payment recently … that was last month not oct" and "Certain things like tax payments shouldn't be considered in budget." Production read: the shipped `getSpendingPlan`, replayed from a scratch worktree with a Postgres client in a `default_transaction_read_only=on` session (the harness refused production reads from this session; the owner ran both probes in their own terminal and pasted the output — figures stay out of the repo). Cause: the Taxes line of the Fixed category rollup averaged a large IRS payment over 2 observed months.

**Picked up / closed.** Taxes + Estimated Tax Payment never count as Fixed on any basis (classifier, union, fallback, long-cadence notes); Property Tax stays Fixed (categorizer pattern widened to "TAXES"); a reader's tax target still counts; the remap lets a tax filing win only over a non-Fixed guess; `SpendingPlanDisclosures.taxChargesLeftOut` (12-month lookback, target, reader names) worded by one author (`tax-copy.ts`) on /spending-plan, the /budgets strip, both Ask answers and the glass box.

**Gate.** Git Bash `VERIFY_E2E=1`: tsc/eslint 0, 8,914 unit passed (+ the known Git Bash `vercel-build.test.ts` 2 — 3/3 from PowerShell on the same tree), build clean, Playwright 466 passed / 2 unrelated flaky / 0 failed.

**Critic (Opus, separate contexts).** Cycle 1 FAIL (2 P1), cycle 2 FAIL (2 P1), all fixed and mutation-locked; cycle 3 PASS 0 P0 / 0 P1 / 4 P2 — P2-A/B/D taken, P2-C and the P2-B backfill (owner gate: live-data write) in STATUS.

**Gate read.** CI verify run 37166494303 on `da0212a6` = SUCCESS; Vercel READY; `scripts/tax-out-live-deploy-check.mjs` DEPLOY PROOF PASS 4/4.

**Next.** Recommended to the owner: the same defect class in every other Fixed category — a category's FIRST charge in the window is priced whole by the observed-months divisor (C.5 residual; a live instance sits in the owner's Rent & Mortgage line). Owner-gated: count biweekly pay at its yearly rate (26/12) instead of the calendar-month median; re-file existing property-tax rows filed Taxes (none on the owner's account today).

## 2026-10-03 — "0977 counted twice": combined-away rows leave "Net worth today" (DECISIONS #782)

Owner: "take a look into why some of my accounts are being counted twice, specifically 0977. And fix it." Production read (read-only, owner-authorized in-session; `scripts/audit-probes/dup-0977-*.mts`): the 0977 pair was already combined; a replay of the shipped boundary + cash-needed + net-worth engines over the live rows counted the card once everywhere money is summed. The doubling was the live point's LIST: every combined-away row at $0.00 in "Net worth today", and the change line refusing ("No comparison — N accounts joined"). Fixed in `netWorthSeries` (required `supersededAccountIds`; live point skips them at $0.00). Replay after: only the combined-away rows gone, figure identical, change line compares. The owner chose to keep live figures out of the repo; tests use invented balances.

**Gate.** First Git Bash verify: tsc red on a stale local Prisma client (schema gained #781's columns; `src/generated` is gitignored, last generated 2026-09-26) — regenerated; second Git Bash run: 9 unit failures, 7 `database is locked` (all pass in isolation — the documented SQLite flake) + 2 `vercel-build.test.ts` (the documented Git Bash child-`bash` quirk). From PowerShell: **VERIFY GREEN**. Playwright mobile-380: `combined-live-point` + `o20d-bars` + `combined-accounts` **12/12**. FAIL-OLD: unit block 2 failed on HEAD's engine; e2e mutation (filter → `() => true`, rebuilt) fails with "No comparison — 1 account joined since …".

**Critic (Opus, fresh context): cycle 1 PASS — 0 P0 / 0 P1 / 6 P2.** Taken: bystander-$0 test (kills the critic's surviving mutant), doc comment, #782 wording, probes owner-scoped. Recorded: P2-1 (drilldown U.6 label on a predecessor's history), P2-3 (composed tests pass `[]`).

## 2026-10-03 — Ask compares months (DECISIONS #781): shipped after the owner-authorized fifth critic cycle PASSED

Four cycles spent (routing passed at 3; money's cycle-4 P1 — three records of one card — fixed by narrowing: a trimmed card takes no word and no older feed). Owner chose a fifth cycle: PASS, 0 P0 / 0 P1, 0 wrong figures in ~740k oracle questions. P2s → TASKS 2.9a.

## 2026-10-03 — (history) Ask: four critic cycles spent — at the human gate

Owner: "Finish Ask: update its tests for the fixed layout, run the full checks, get an independent review, and ship." Picked up: the `ask-rebuild` WIP (closed grammar + same-account engine) with a layout fix already in the code (left-out accounts moved from fact rows into the sentence) and tests still expecting the old rows. Updated them; gates green; full Playwright 434 / 1 flaky / 0 failed. Critic cycle 1 (two lanes): FAIL — money P0 (a combined card's gap priced at $0) + P1 (unscoped headline); routing six P1s (subject read from any word, non-spending subjects, three worse-than-production answers, a self-looping chip, a raw production error, clipped labels). Fixed by rule, not by case: gaps between a card's records are stated and proven; edges from each account's own span, capped at today; the subject read exactly as the one-month question reads it; a month in progress compared day for day; buttons only where an answer follows; the action returns a result. Found adding the spec to WebKit: text typed before hydration left Ask disabled (present on main) — the view adopts it on mount. U.1b's ship proof recorded (CI 37084952022, live 13 / 13). Main checkout: the uncommitted #777 work parked on `ask-analyst-777-parked`; main fast-forwarded. Worktrees `_uiux_base`, `_critic_l19e`, `_sfin`, `_uiux` removed (each checked: nothing unique).

## 2026-10-03 — U.1b shipped: fifth critic cycle PASS (DECISIONS #779)

Owner: "Update the compact row onto current main, re-run the fifth review, and ship if it passes." Rebased `uiux-pass` onto `48b78387` (ledger conflicts only, both sides kept). Gates green (the Git Bash / WSL `vercel-build` quirk noted in STATUS). Critic cycle 5 (Opus, separate context, own server and database): **PASS, 0 P0 / 0 P1 / 5 P2** — the cycle-4 note box now 246–316px wide (was 53px); P2s filed as TASKS U.1m. Also recorded X.1's ship proof (CI 37075733851 success; live 8 / 8, `scripts/x1-live-deploy-check.mjs`).

## 2026-10-02 — U.1b: the compact register row (DECISIONS #779)

**Picked up:** the owner's iPhone screenshot of his own Activity page — two rows to a screen —
and his choice among three mock-ups: "compact, opens in place". **Measured first:** 300–350px a
row on a signed-up account (the demo hides the controls that make it tall). **Built:** below
`sm` a row is closed until its chevron opens it; closed keeps payee, amount, category, date,
account, the class label and the chips that are facts or asks; open shows every control.
CSS-hidden, never unmounted; one Set for the list; open rows restored in a layout effect so
the scroll restorer finds the document at the height it was saved in.
**Critic cycle 1: FAIL, 1 P1** — the first cut put the chevron in the old row's right-hand
column, which made an OPEN row 15–20% taller than before while the ledgers said "as it was".
**Fixed by laying the phone row out as a grid** (chevron first, payee and amount on line one,
controls full-width beneath). **After:** closed 85–129px, mean 103 — about 7½ rows per 800px
screen; an opened row is 226–267px on the phone profiles, against 279–353px before.
**Critic cycle 2: FAIL, 3 P1** — each on a row the fixture did not have: a note longer than
~20 characters pushed its controls off the screen; "open" was borrowed from the note/tax panel,
so the first tap after opening that panel from a closed row closed the row instead of landing;
the amount editor took the whole row. **Fixed:** the control group wraps with its line; opening
the panel opens the row in the remembered set; the editor gets a line of its own. The fixture's
note is now 34 characters and the spec locks all three at 360 / 380–390 / 430px. That long-note
row opens at 294–320px (was 328px) — and 8px taller than before at 430px, said in #779.
**Critic cycle 3: FAIL, 3 P1** — the table reproduced exactly; the defects were older than the
slice and inside its claims. The Bank text editor and the account picker (with a long account
name) left the screen; and the ten inline row editors reloaded with a bare
`window.location.reload()`, so the row came back open and the reader came back 3,300px away —
the owner's August complaint, fixed then for the menus only. **Fixed:** the editor takes its
own line; one base rule keeps every `<select>` inside its line (and, for Safari, stops a long
selected name widening the page — which it was also doing on the shipped filter bar); all ten
editors reload through `reloadPreservingScroll`, fenced by a unit test. The browser test now
presses a real Save. **Swept by the maker before cycle 4:** ten awkward rows × seven editors ×
three popups × three widths × two engines — clean after the Safari fix it found.
**Critic cycle 4: FAIL, 1 P1 — budget exhausted, human gate.** Cycle 3's fixes held (ten
editors, 0px drift on real saves; the table reproduced; the dropdown rule moved nothing on 21
routes). The P1 was the cycle-2 fix's own side effect: the note editor's text box left with
53–83px beside its three buttons. **Fixed, unreviewed:** editor text fields take their own line
on phones; the payee rename box is no longer clipped; the open-rows cap is out of a reader's
reach. **Not shipped.** The owner decides whether a fifth cycle runs.
**Left alone:** desktop, the shared-household list, every figure.
**Locked:** `tests/e2e/activity-row.spec.ts` (real account, rows kept closed, Chromium and
WebKit), `tests/unit/register-open-rows.test.ts`; the rest of the suite runs rows-open by
harness flag. **Next:** U.1j (the out-of-scope class control). Gates, CI, live proof:
`docs/STATUS.md`.

## 2026-10-02 — SimpleFIN retired as a way to connect (DECISIONS #780)

**Picked up:** the owner's go-ahead to drop SimpleFIN "if we don't break stuff". **Checked
production first** (read-only): no connection exists, every one of the 24 SimpleFIN accounts
is joined to a Plaid successor, and 1,357 transactions came in through it — so the offer can
go and the rows must stay. **Built:** the connect door and token form removed from Accounts
and the first-run panel; Settings copy no longer names it; the orphaned-accounts notice now
points at the Plaid button. **Left alone:** an existing connection's panel, the sync engine,
the dashboard repair alert, the privacy policy, the schema, every stored row.
**Locked:** `simplefin-retired.test.ts` (both halves) and three browser specs.
Gates, CI, live proof: `docs/STATUS.md`.

## 2026-10-02 — Usability pass, wave 1 (TASKS U.1 / U.1a, DECISIONS #778)

Owner ask: "do a ui / ux pass and make the app user friendly and intuitive." Built in a
separate worktree (`C:\dev\_uiux`, branch `uiux-pass` off `origin/main`) because the main
checkout holds the unshipped Ask-analyst slice (#777); nothing of that slice is in this commit.

**Picked up:** TASKS U.1 (audit) and the direct ask. **Audit:** every route screenshotted on
the demo at 380px and 1280px, a first-run walk on a new account, changed screens re-checked in
WebKit → `docs/UX_AUDIT_2026-10-02.md` (21 findings, 7 rules). **Closed (findings 1–11):**
Activity's filters fold on phones; Forecast balances and account names no longer break
mid-token; chapter triangles share a line with their titles; five Coach rests get a chevron;
the Today feed links to Coach (where each opportunity is named) instead of pointing at a
section Home stopped rendering; Forecast and Recurring show their titles; Guilt-free folds its
limits; Settings has an index; Inbox leads with the queue; Home's demo rows print real dates.
No figure or engine changed. **Critic cycle 1 (Fable, separate context): FAIL, 3 P1** — a fold
of Guilt-free's method paragraphs hid claims two existing specs require on screen (reverted);
two new tests depended on the shared demo queue (fixed); the feed link first went to
/recurring, which marks only two of the four kinds (now /coach). **Cycle 2 (fresh context):
FAIL, 1 P1** — the reworded Guilt-free summary put a quarterly/twice-a-year rule on yearly
bills; the summary no longer paraphrases the rules at all. Its four P2s (a long balance at
640px, reduced motion, Filters on an empty register, the live probe's header) were taken too.
**Cycle 3 (fresh context, read-only): PASS, 0 P0 / 0 P1 / 4 P2** — all four folded (the
summary's "three cases" → "three notes"; the Coach link now lands on the card).

**SHIPPED `df348762`: CI 37038882008 SUCCESS, Vercel complete, live proof PASS (22 checks).**
The main checkout was brought to `df348762` with the uncommitted #777 slice intact (43 files
hash-identical; a stash near-miss on the way is `docs/lessons/a-pop-takes-whatever-is-on-top.md`).
**Then the owner's iPhone screenshots:** dropdowns fine (U.1i closed); "To" stranded in the fold
on a tagless account (this slice's defect — fixed, follow-up commit); and a real-account
register row is ~2 per screen, which the demo-only audit could not see — U.1b is now the top
open item and the redesign choice is with the owner.
**Left alone:** Ask (the #777 slice), every money sentence, desktop layouts. **Left for the
owner:** Activity row density (U.1b) and the phone tab bar (U.1c) — proposals in the audit.
**Locked:** `tests/e2e/usability-pass.spec.ts` (fails on the pre-fix source in every test but
the desktop-unchanged one), `tests/unit/usability-pass.test.ts`. **Lessons:** one new
(`a-wrap-rule-that-stops-overflow-can-split-the-content`), one extended
(`deleting-a-surface-deletes-the-claims-it-carried`). **Gate, critic, CI, live proof:**
`docs/STATUS.md`. **Next:** U.1b / U.1c need the owner; U.1d–U.1h are queued.

## 2026-09-28 — Category trust: Golf, Doctor, Eye Doctor (DECISIONS #776)

West Pines Golf Club was Entertainment & Streaming because golf had no leaf.
A doctor's visit matched no rule, so a Food & Dining bank guess could file it.
Eye care was named only "Vision", so eye doctor and optometrist were not in the list.
Golf is now its own category; doctor and eye-doctor descriptors file those leaves;
the eye-care name is "Eye Doctor & Optometrist". Already-filed rows are not rewritten.

## 2026-09-25 — O.11d: free-form tags — the last field of the "all other mint and simplifi fields" ask (DECISIONS #775)

**SHIPPED (same turn, DECISIONS #636 posture).** The O.11 wave's final row: a many-to-many
user-defined label set, with filtering and a tag total. Additive schema, engine-first,
no figure moves. **CI run 36225862658 on `b1e9164d` = SUCCESS (full VERIFY_E2E gate);
DEPLOY PROOF: PASS, 7/7 behavioral checks on www.aimplifi.app; prod demo seeded
additively via `scripts/seed-demo-tags-prod.ts` (2 tags / 6 verified joins).**
(The O.11c entry below said SHIPPED with a stale "(IN PROGRESS)" heading — the heading
is corrected above; CI 36209828932 SUCCESS + the live probe were already recorded in
STATUS §O.11c. Housekeeping also trashed the six leftover `.verify-*`/`.ci-status-*`
gate logs and gitignored the patterns.)

**Design, with the why.** `Tag` (per-user, `@@unique([userId, name])`) + an explicit
`TransactionTag` join (Cascade on both edges — the retention document's one-cascade
promise). The case fold lives at the WRITER, not the schema: `@@unique` is byte-wise
and must stay so (the reader's capitalization is theirs), so `addTransactionTag`
matches case-insensitively and APPLIES an existing tag instead of minting a twin;
a race that slips two spellings through yields two visible chips, never a hidden
wrong total. Tag naming = CATEGORY naming (`normalizeCategoryName` + the 40-code-point
ceiling, reused from the plain leaf module — the L.12c "two definitions" trap).
**The tag total is `summarizeTransactions` over the tag-filtered rows** — the very
function the unfiltered summary strip uses. No new arithmetic anywhere (L.9: one
function, not two copies); the engine tests prove the tag axis composes with the
transfer skip, the O.15 exclusion (figures down, count up), and the U.20 hand-over
gate with zero tag-specific branches. `TxnView.tags` is REQUIRED, not optional —
the same "forgot to select it" failure direction as every other flag on that type.

**Fence-by-construction (the #242/L.12c rule):** `isDemoUser` is checked inside the
SHARED server action, not at the UI entry point, so a future register popover
passes through it for free. The detail view renders the chips read-only + a why
(`canManageTags`), so the fence is an explanation on screen, not a dead button.

**Surfaces:** the tag editor lands on the detail view beside the note/receipts
(the three answers to "what was this?"); chips on register rows (always-visible —
the 380px lesson); `?tag=` axis through `TxnFilter` (URL carries the tag ID, never
the name — a renamed chip would orphan deep links); the toolbar select appears only
when the reader owns a tag or a stale `?tag=` needs mirroring ("(tag not found)",
the account control's own pattern from U.3).

**Seed (GL.4 precedent):** two demo tags, deterministic selection WITHOUT the PRNG
(first-N by exact descriptor in construction order, 3+3 rows) → no seeded amount
shifts; the golden seed→engine test is the byte-identical lock. SEED_SPEC §Tags +
seed.test.ts counts (tags: 2, assignments: 6) + "seeded names pass `validateTagName`"
(the seed is written BY the rules, not beside them).

**Evidence (all real, this session).** `tsc --noEmit` green; `eslint . --max-warnings=0`
green; full `vitest run` **8633 passed + 1 expected fail + 1 skipped** (the critic's own
independent re-run; my first full run was 8632 + the edge-case-heading meta-test fix);
`next build` green; official `bash scripts/verify.sh` → **✅ VERIFY GREEN**; targeted e2e
`tests/e2e/txn-tags.spec.ts` 6/6 on the mobile-380 project (the first run's two failures
were TEST bugs — a wrong badge testid, a chip assertion counting the remove button's × —
the app was right both times; a third was the serial-context cookie bug, also test-side).
Fail-old: the money line is the e2e's Money out `$65.00` on a tag-filtered set containing
a transfer row (the untagged register's own basis, unchanged).

**Hostile Critic (fresh verifier context; it re-ran tsc/eslint/full-vitest/build itself
before scoring): PASS — 0 P0 / 0 P1 / 6 P2.** All six folded in-session or recorded:
the `tag-unknown` empty state shipped for real (the comment had promised what the code
lacked — account-axis parity); the demo why renders on EVERY demo row (the seeded rows
are the tagged ones a first visitor opens); `rateLimitDurable` guards the creating verb;
`maxLength` 2× headroom (browser counts UTF-16 units, server is the authority); the cap
sentence states the true bound ("to 40"); the 40-char-chip-at-380px pin recorded open.
The fold revealed one family-wide copy nit (sibling validators say "under N") recorded
as a STATUS residual — one copy sweep, not six files in one slice.

---

## 2026-09-25 — O.11c: the reimbursement round trip (DECISIONS #774)

**Picked up.** Owner: continue with next surgical slice. Queue pick after verification: O.11c.
Explorer verified three "open" rows are STALE (built 8 weeks ago, verified at file:line this
session): O.13a keyword-rules UI (BUILT — keyword-rule-builder.tsx), O.13b detail view
(BUILT — /transactions/[id] full field set), O.11b flags UI (BUILT — row menu + detail +
triage + badges). TASKS rows to be corrected at close. Chose O.11c, the one genuinely open
money-correctness piece of the owner's O.11 ask.

**Found (verified in code).** `isIncomeFlowRow` (insights.ts:117) counts a positive
`reimbursement`-categorized inflow as INCOME on every shared-predicate surface (reports chart,
glass-box panel, /coach savings rate, Ask income + savings answers + trace, creep income
baseline, spending-plan fallback). The `refund` leaf is the only carve-out (#166). #166's own
rationale ("they aren't offsets of a tracked purchase") is false exactly when the row IS tracked
— the O.15 tracker shipped but matching is suggestion-only, so the excluded-outflow + counted-inflow
combination fabricates income. Naively mirroring `refund` (net against spend) would UNDERCOUNT
real spend when the outflow was excluded (too-generous direction).

**Decision (to be recorded #NEW):** a POSITIVE row categorized `reimbursement` is neither income
nor a spend-netter — it leaves flows entirely (`isReimbursementInflow`, consumed by monthlyFlows
AND the glass-box panel, skip before the asOf/notYet accumulation). Tracker stays suggestion-only.
tax-refund keeps its #166 income treatment. Copy re-derived: MONTH_FLOW_BASIS (both sentences),
trace income basis, Ask month-flow derivation. Demo seed holds zero reimbursement rows (verified)
→ demo figures byte-identical.

**Plan assertions → tests.** insights.test.ts: predicate refuses reimbursement inflow; tax-refund
still income; excluded-outflow round trip nets to zero flows (payback must not eat real spend —
pins the no-netting decision); non-excluded purchase + payback (no phantom income); OUTFLOW filed
reimbursement still spending (inflow-only guard). month-flow-breakdown.test.ts: reimbursement row
in NEITHER panel; notCountedYet does not claim a dated-ahead one; parity holds; basis sentences
name the leaf. income-pattern.test.ts: fallback path refuses it.

**Shipped 2026-09-25 (same day).** Fail-old **7 failed | 92 passed** → implemented (`isReimbursementInflow` in `insights.ts`, consumed by `monthlyFlows` + the glass-box panel before the asOf accumulation; copy re-derived in MONTH_FLOW_BASIS ×2, Ask trace + derivation, income-pattern, categories comment) → cycle-1 verify GREEN + targeted e2e 10/10 → live probe (read-only): **0 reimbursement inflows corpus-wide** (prevention; demo byte-identical) → **critic cycle 1 FAIL: 1 P1 + 5 P2** → P1 fixed (`money-in` chip stops claiming income) + 3 P2 folded (coach card + detail-view sibling now name the exclusion lever; categories comment; EDGE_CASES section added, O.20g predicate sentence corrected) → cycle-2 verify GREEN (FRESH_TSC) + units 942/942 + e2e 17/17 → **critic cycle 2 PASS (0 P0/0 P1, 3 delta P2, all folded)** → final verify GREEN (FRESH_TSC, **8611 passed + 1 expected fail + 1 skipped / 640 files**). Ledger writes this close: DECISIONS #774, REGRESSION_LEDGER, STATUS BUILT + 2 deferred P2s, TASKS corrections (O.11c DONE; O.11b, O.13a re-verified BUILT with the stale "UI NOT BUILT" wording fixed; O.13b STILL-OPEN list corrected). CI + live proof appended to STATUS at push.

## 2026-09-24 — Dining rule matches Grille; the owner's inbox revives on read (DECISIONS #773)

**Picked up.** Owner: build this out as a world class dev and data scientist. Queue pick: L.12(c), the last open code piece of the categorization complaint; #772 left no in-flight slice.

**Closed.** The generic dining token matches GRILLE/GRILLS (`GRILLE?S?`). The two #303 fixtures that called the owner's descriptor "a ruleset miss" moved to a verified true miss (GOOSE POND HIDEAWAY); the e2e locks both suggestion ladders — provider fallback and our own confident one-tap on rows already in review.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN: unit **8601 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**, tsc 0, eslint 0, build clean. First run RED on the #303 plaid-map fixture (caught by the widened rule) — fixture moved to a verified true miss, re-run green. Fail-old **4 failed | 115 passed**. Playwright **2/2** (17.2s, mobile-380). `eval:categorize` byte-identical: **480 | 59 | 421 | 410 | 11 | 97.4%**.

**Critic (fresh context): cycle 4 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Cycles 1–3 each reproduced gates (cycle 2 re-ran the full verify green) but were cut off before emitting a verdict — recorded honestly; cycle 4 delivered with the adversarial probe re-run byte-identical.

**Ledgers.** DECISIONS #773 (+ index regen); REGRESSION_LEDGER one row; STATUS BUILT; TASKS L.12.

**Ship.** 9f337a06 → CI 36059727655 ❌ — the write-in spec's by-design tripwire fired ("if the ruleset ever learns one of these merchants, this fails HERE"): this slice teaches the ruleset exactly its seeded merchant; fixture moved to a verified true miss, spec re-run 2/2 locally → 4f238856 → CI 36063077472 ✓ success (16m14s, full VERIFY_E2E gate), Vercel READY (F1ejGigF4JCNNLEVchs3MAHrxWR7), live probe `scripts/l12c-live-deploy-check.mjs` → **DEPLOY PROOF: PASS, 3 checks** on www.aimplifi.app (demo /triage healthy, data-remaining=12, controls render, no page errors; the demo seed holds no GRILLE merchant, so the behavioral discriminator is the CI e2e on this sha). `GRILLE?S?` marker verified in the raw file at the pushed sha on GitHub.

## 2026-09-22 — Month-rest names Monthly Money Review the way the card does (DECISIONS #772)

**Picked up.** Owner: name the monthly review the way the card does, if that polish is the next slice. #771 P2-1 left the closed rest saying “the monthly review”.

**Closed.** The summary and the card share `Monthly Money Review`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8596 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**, next build clean. Summary unit after literal sentences: 4/4. Playwright coach-chapters **7/7**. Browser on the fresh build, demo Coach: rest closed on that sentence; opening it shows the card label “Monthly Money Review”.

**Critic (fresh context): PASS UX 9 / 0 P0 / 0 P1 / 3 P2.**

**Ledgers.** DECISIONS #772 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #772. O.20j #753–#756 rotated out of STATUS.

**Ship.** `d88c7698` on `origin/main`. No `prisma/` schema diff. **CI verify run 35808922617 = SUCCESS**. Vercel `dpl_EQrvvfKwkFzasTJgy2s49PzuwDdd` **READY**, aliases include `www.aimplifi.app`. Live demo Coach: rest closed; summary ends “and Monthly Money Review”; the open card label is “Monthly Money Review”. Marker: `Monthly Money Review`.

## 2026-09-22 — Month-rest names the life-energy view from the card gates (DECISIONS #771)

**Picked up.** Owner: continue. #770 P2-2 named the purchases card “hours”. P2-1 duplicated the three optional-card gates.

**Closed.** The summary says “life-energy view”. The three optional cards and the sentence share one predicate each.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8595 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**, next build clean. Playwright coach-chapters **7/7**.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.**

**Ledgers.** DECISIONS #771 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #771.

**Ship.** `d67cc400` on `origin/main`. No `prisma/` schema diff. **CI verify run 35803590762 = SUCCESS**. Vercel `dpl_A35q9qMiqmEgXYfHEih6rRbpeV2X` **READY**, aliases include `www.aimplifi.app`. Live demo Coach: rest closed; summary names life-energy view; creep hidden. Marker: `life-energy view`.

## 2026-09-21 — Month-rest summary names every claim it hides (DECISIONS #770)

**Picked up.** Owner: continue. #769 P2-1 left automation, fulfillment, and value receipts inside a summary that did not name them.

**Closed.** The rest summary is composed from the cards that render. A missing blueprint, category curve, or receipts tally is not named.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8593 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**, next build clean. After the page-gate and full-sentence locks: chapter unit 1/1, summary unit 1/1, Playwright first-fold **1/1**.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** P2-3 and P2-4 closed same session. P2-1 and P2-2 remain.

**Ledgers.** DECISIONS #770 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #770.

**Ship.** `33039e2c` on `origin/main`. No `prisma/` schema diff. **CI verify run 35669406939 = SUCCESS**. Vercel `dpl_HaGw5t5n84TAvafXehRYPpds2Vpc` **READY**, aliases include `www.aimplifi.app`. Live demo Coach at 380×800: rest closed; summary names the automation blueprint, life energy by category, and what Aimplifi caught; creep hidden. Marker: `coach-month-rest`.

## 2026-09-21 — This month opens on the destination and the flags (DECISIONS #769)

**Picked up.** Owner: build this out. #768 left the assumptions and the FI-date essay on the open fold.

**Closed.** The destination is a 24px headline. The why stays. Essays that are not the answer start closed, and each summary names what it hides. Flags sit under the destination so the biggest lever finishes on a 380×800 screen.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**, next build clean. After the summary named the FI date: chapter unit 1/1, Playwright **14/14** (coach-chapters, phase3, employer-match, tax-advantaged, next-dollar-frozen). Wording lock “cash-flow walk” is in that same unit file, re-run 1/1; full verify re-run covers that string.

**Critic (fresh context): cycle 1 FAIL UX 5 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 3 P2.**

**Ledgers.** DECISIONS #769 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #769.

**Ship.** `0045560c` on `origin/main`. No `prisma/` schema diff. **CI verify run 35662854457 = SUCCESS**. Vercel `dpl_7c6uFDKG1cRLTW62tFq5XHcUoyuf` **READY**, aliases include `www.aimplifi.app`. Live demo Coach at 380×800: headline 24px “Next extra dollar: investing”; assumptions closed under a summary that names them; FI-date essay closed under a summary that names the FI date; biggest lever bottom 787. Marker: `next-dollar-more`.

## 2026-09-21 — This month first fold is the extra dollar and the flags (DECISIONS #768)

**Picked up.** Owner: “continue.” #767 shipped at about B+. Strongest leftover the owner can see: Coach This month still dumps creep, hours, and the monthly review under the open chapter.

**Closed.** `coach-month-rest` starts closed after next-dollar and the flags. Lead no longer promises the review on the first fold.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**, next build clean. After the summary named room for error: chapter unit 1/1, `next build` clean, Playwright first-fold **1/1** and the runway Ask test **passed** (prior combined run 82/82 before that summary lock).

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** P1 was runway buried under a summary that did not name room for error.

**Ship.** `f86b2e1b` on `origin/main`. No `prisma/` schema diff. **CI verify run 35654006430 = SUCCESS**. Vercel `dpl_ETE64G8VDPUc5TLKx8wYnGEwr9Yo` **READY**, aliases include `www.aimplifi.app`. Live demo Coach: This month open on “Next extra dollar: investing”; closed summary “Lifestyle creep, room for error, hours, and the monthly review”; Trajectory follows that row. Marker: `coach-month-rest`.

## 2026-09-21 — UX A-grade maker (DECISIONS #767)

**Picked up.** Owner: get the live C / 5.1 review closer to A; do not stop.

**Closed.** Stage money token on the amount button + CardTitle skip for `text-3xl`/`text-4xl`. Plan→Guilt-free, Spending→Budgets (routes kept). Home chip “N to file on Activity.” Home Today omits `payment_due` and unfrozen shortfall. Coach This month leads with next-dollar; household in Habits. Category catalogs start closed. Sign-in leads with Explore the demo.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**, next build clean. Playwright: home-stage 2/2 (amount ≥28px), today-feed 8/8, desktop-header 1/1, coach-chapters 6/6, phase5-a11y keyboard 1/1.

**Ship.** `c812a015` on `origin/main`. No `prisma/` schema diff. First CI `35625811096` FAILED (Tab→email). **CI verify run 35628035698 = SUCCESS**. Vercel `dpl_FxkvZkiBfk7bdwyuJneJ7QnAXppg` **READY**. Live cash-needed **36px**. Marker: `omitHomeStageNudges` / `or sign in to your account`.

## 2026-09-21 — UX adversarial review (verifier, no maker)

**Picked up.** Owner: thorough UI/UX adversarial review, show grades, then decide. No implementation.

**Walked.** Live `www.aimplifi.app` demo. Desktop 2074×1166 and emulated 380×800. Routes: `/sign-in`, `/dashboard`, `/coach`, `/cards`, `/spending-plan`, `/budgets`, `/triage`, `/ask`. Evidence = a11y snapshots + CDP computed styles (screenshot pipeline dropped word spaces — not used as type evidence).

**Verdict.** Overall **5.1 / 10 (C)**. **0 P0 / 8 P1 / 6 P2**. Best axis: 10s cash-needed **8** (amount + when + shortfall + transfer, zero clicks). Worst: visual hierarchy / cohesion / cognitive load **3**. Smoking gun: `MONEY_DISPLAY_CLASS` loses to `Card size="sm"` → live `[data-testid=cash-needed-amount]` is **14px / 64.75×20**.

**State.** Findings in canvas (not a slice). No tree change. No DECISION. Owner picks next.

## 2026-09-21 — Clear chapter hold on the next pointerdown (DECISIONS #766)

**Picked up.** Owner: “continue.” Strongest leftover: #765 P2-5 ghost-close after tap-open, plus P2-4 Enter-then-close swallow.

**Closed.** Arm hold on first click-open. `pointerdown` after ready clears it. Same-session: Enter then Playwright click closes; tap-open then `HTMLElement.click()` stays open.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #766 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #766.

**Ship.** `41973d94` on `origin/main`. No `prisma/` schema diff. First CI `35559960169` FAILED (leftover after `toBeVisible`). **CI verify run 35561069817 = SUCCESS**. Vercel `dpl_BesMXdeETanZZZpKRnXx2FLej6jA` **READY**. Live leftover click on Picture holds `$144,804.74`. Marker: `clearHoldOpen` / `onPointerDown`.

## 2026-09-20 — Hold first chapter open through the leftover click (DECISIONS #765)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #764 P2-4 leftover click after `readyRef` native-closes (Enter snap-shut).

**Closed.** `holdOpenRef` on `adopt()` + first-open Enter. Leftover click `preventDefault`s. Did not arm first click-open. Did not force-close. Same-session: leftover lock is trusted `summary.click()`; next click still closes.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session.

**Ledgers.** DECISIONS #765 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #765.

**Ship.** `5b9abc97` on `origin/main`. No `prisma/` schema diff. **CI verify run 35548078940 = SUCCESS**. Vercel Production `dpl_3XaasU1ydKTcRZ52xRW6QBSoTYab` **READY**. Live first-open Enter on Picture holds net-worth `$144,804.74`. Marker: `holdOpenRef` / `armHoldOpen` on that sha.

## 2026-09-20 — UA-first chapter open mounts the body before paint (DECISIONS #764)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #763 P2-1 empty flash when the UA toggles first.

**Closed.** `MutationObserver` on `open` + `toggle` in `useLayoutEffect`; `flushSync` mounts before paint. `readyRef` holds preventDefault until first open. Did not force-close.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #764 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #764. STATUS #749/#752 and PROGRESS #751/#752 rotated.

**Ship.** `6b9e5dff` on `origin/main`. No `prisma/` schema diff. **CI verify run 35543058639 = SUCCESS**. Vercel Production `dpl_Dmxn5FSFq4yDckemvucLsEcWJTbT` **READY**. Live Picture open holds net-worth `$144,804.74`. Marker: `flushSync` / `MutationObserver` / `readyRef` on that sha.

## 2026-09-20 — Space/Enter opens a chapter with the body already there (DECISIONS #763)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #762 residual (3) Space/Enter empty-open.

**Closed.** Space/Enter `preventDefault` while unmounted. `onToggle` mounts if a UA already opened. Did not force-close (`el.open = false` crashed the error boundary).

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #763 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #763.

**Ship.** `dcc78112` on `origin/main`. No `prisma/` schema diff. **CI verify run 35491937395 = SUCCESS**. Vercel Production `dpl_8PwomDELAYoZ8CG2n16xbRDWh91n` **READY**. Live Space on Picture holds net-worth. Marker: `onKeyDown` / `mountedRef` on that sha.

## 2026-09-19 — Open chapter bodies before the shell (DECISIONS #762)

**Picked up.** Owner: “continue.” Strongest leftover the owner can see: #761 empty-open flash + hidden landmark ring.

**Closed.** First open mounts, then `details.open` in `useLayoutEffect`. First summary click `preventDefault`s until mounted. Nested Coach landmarks no longer use `focus:outline-none`. Home hrefs parse via `new URL`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** #761 P2-3 and P2-4 closed.

**Ledgers.** DECISIONS #762 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #762.

**Ship.** `1d82018f` on `origin/main`. No `prisma/` schema diff. **CI verify run 35486194628 = SUCCESS**. Vercel Production `dpl_Aq99idazihofW8xk9JNC2kA84wVD` **READY**. Live Picture open holds net-worth; money-dials jump lands. Marker: `pendingOpen` on that sha.

## 2026-09-19 — Mount unread chapter bodies after first open (DECISIONS #761)

**Picked up.** Owner: “continue.” Strongest leftover: closed chapters still painted every card into the first HTML.

**Closed.** `{mounted ? children : null}`. Nested Coach hashes open the parent (cycle-1 P1). Daily loop + This month stay mounted.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

**Ledgers.** DECISIONS #761 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #761.

**Ship.** `c38a2168` on `origin/main`. No `prisma/` schema diff. **CI verify run 35480517482 = SUCCESS**. Vercel Production `dpl_GDwYXPVDFmWpkXq934DJPELyDbZR` **READY**. Live Home: closed Picture/Adjust unmounted. Live Coach: closed Trajectory/Habits unmounted; nested money-dials jump works. Marker: `{mounted ? children : null}` on that sha.

## 2026-09-19 — Home chapter jump nav, focus on open, valid summary lead (DECISIONS #760)

**Picked up.** Owner: “continue.” Strongest leftover the owner can use: #759 residual (6) no Home jump nav, plus focus and valid summary markup.

**Closed.** Nav after radar; reveal focuses the chapter; span leads; painted marker e2e; one `showHomeSetup` flag.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. After same-session P2 polish: tsc 0, eslint touched 0, chapter units 2/2, next rebuild clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 4/4 (**6/6**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session.

**Ledgers.** DECISIONS #760 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #760.

**Ship.** `19dec793` on `origin/main`. No `prisma/` schema diff. **CI verify run 35457883847 = SUCCESS**. Vercel Production `dpl_4gNKGsxYWkhTnvxDLAqQnUx9bt3n` **READY**. Live demo Home 390: chapter nav after radar; chapters closed. Marker: `home-chapter-nav` on that sha.

## 2026-09-19 — Coach chapters: native marker, same-hash re-open, coaching voice (DECISIONS #759)

**Picked up.** Owner: “continue.” Strongest leftover the owner can see: #757 Coach P2s (hidden triangle, dead Trajectory tap, IA-voice leads).

**Closed.** Native marker; click-to-open on same hash; Trajectory/Habits second-person; Home `#home-picture` lock. DECISIONS #742–#748 rotated to `docs/archive/DECISIONS_ARCHIVE_742_to_748.md`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 3/3, desktop-header 1/1 (**6/6**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.**

**Ledgers.** DECISIONS #759 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #759.

**Ship.** `eb4848c3` on `origin/main`. No `prisma/` schema diff. **CI verify run 35453050602 = SUCCESS**. Vercel Production `dpl_2xExX9An6YeS7xbq4VE4kPSYv8Pe` **READY**. Live demo Coach 390: Trajectory/Habits closed; native disclosure marker (`disclosure-closed`). Marker: `getAttribute('href')` on that sha.

## 2026-09-19 — Home chapters: daily loop open, dump closed (DECISIONS #758)

**Picked up.** Owner: “continue” after confirming mobile shipped. Strongest #757 residual: Home below the stage still a dump.

**Closed.** Adjust / Picture / Setup start closed. Return-moment + radar stay in the open loop (cycle-1 P1s). Banners before welcome.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): home-chapters 2/2, home-stage 2/2, phase1 2/2, today-feed 7/7, idle-cash 1/1, paw-lens 1/1 (**16/16**).

**Critic (fresh context): cycle 1 FAIL UX 6 / 2 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.**

**Ledgers.** DECISIONS #758 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #758.

**Ship.** `64173200` on `origin/main`. No `prisma/` schema diff. **CI verify run 35448886067 = SUCCESS**. Vercel Production `dpl_Ebo4UwJRwsQp1YyN5jm24hjoHUAS` **READY**. Live demo Home 390: Adjust / Picture closed. Marker: `home-chapter.tsx` on that sha.

## 2026-09-19 — Visual IA: grouped sidebar, Home stage, Coach chapters (DECISIONS #757)

**Picked up.** Owner: “i agree; keep working on it until worst critic gets to a 9.” After the live UI review (Craft 6 / Identity 4 / Composition 5 / IA 4 / Mobile 7).

**Closed.** Sidebar, Home stage, Coach `<details>` chapters, money tokens, BrandMark. Critic cycle 3 PASS UX 9 / 0 P0 / 0 P1.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8583 passed + 1 expected fail + 1 skipped / 636 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` on 127.0.0.1:3100 + e2e sqlite): home-stage 2/2 (dues closed), phase1 2/2, trends 3/3, mobile-nav 2/2, forecast 3/3, card-unknown-due 3/3, dashboard-duplicate-disclosure 5/5 (**21/21**).

**CI-red on `bec0b32e`.** Run 35424012696: guilt-free past 800 on Linux chrome; `/trends` `What changed` matched sidebar + page. Fix: closed `cash-needed-dues` details; Trends description "Category movers…".

**Ledgers.** DECISIONS #757 (+ index); REGRESSION_LEDGER two rows; STATUS BUILT; TASKS M.4 #757.

**Ship.** `b92219e2` on `origin/main`. No `prisma/` schema diff. **CI verify run 35426137075 = SUCCESS**. Vercel Production `dpl_AKbNTBWUnN3RpydQtKgwabMCiG7w` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200 with brand-mark + h1. Demo Home: dues details closed. Marker: raw `b92219e2` has `cash-needed-dues` + `Category movers`.

## 2026-09-19 — O.20j residual (10): trim sibling plaidItemId === so same-item copies stay two accounts (DECISIONS #756)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `81c93aad` (#755 ship-gate; CI 35404635879 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #755 critic P2-1 — sibling `plaidItemId ===` untrimmed.

**Closed.** `samePlaidItemId` trims both sides; empty / whitespace is not a match. `sameIngestConnection` treats empty after trim as missing (fail-closed). `accountsOf` and both `/accounts` filters use the helper.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8575 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD (no helper): **8 failed | 80 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r10`): cycle 1 PASS 0 P0 / 0 P1 / 7 P2.** Independently: tsc 0, 88/88, FAIL-OLD 6|82, kill-calls (a) 2|86 (b) 1|87 (c) 1|87. P2s in STATUS.

**Ledgers.** DECISIONS #756 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (10). STATUS L.19 #742/#746/#747 rotated verbatim to `docs/archive/STATUS_ARCHIVE_2026-09-17-l19.md`. PROGRESS #740/#741 rotated to `docs/archive/PROGRESS_ARCHIVE_2026-09-12_to_2026-09-14.md`.

**Ship.** `9490bcc8` on `origin/main` (PR #36 ff-merged). No `prisma/` schema diff. **CI verify run 35417204343 = SUCCESS** on `9490bcc8` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_ABSognfcmqoVNXNGRgU958KZCKgZ` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Marker: `raw.githubusercontent.com` on `9490bcc8` finds `export function samePlaidItemId` and ingest `ka === '' || kb === '' || ka === kb`; prior `81c93aad` still has `a.plaidItemId === b.plaidItemId`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (9): trim live-map keys so a padded stored itemId still joins (DECISIONS #755)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `65b61e52` (#754 ship-gate; CI 35389703386 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #754 critic P2-1 — lookup trimmed, map keys raw.

**Closed.** `liveInstitutionByItem` trims the insert key. Empty / whitespace-only stored ids are not keys. Three join callers use the helper.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8567 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD untrimmed helper: **3 failed | 113 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r9`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 116/116, FAIL-OLD 4|1|111, kill-call 1 died. P2s in STATUS.

**Ledgers.** DECISIONS #755 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (9). STATUS #750 BUILT rotated verbatim to `docs/archive/STATUS_ARCHIVE_2026-09-18-750.md`.

**Ship.** `64598fff` on `origin/main` (PR #35 ff-merged). No `prisma/` schema diff. **CI verify run 35404635879 = SUCCESS** on `64598fff` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_3PNcfzFNDWx75yh8fddRD8tMccKG` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `64598fff` finds `liveInstitutionByItem(items, (i) => i.institutionId)` in `combine-connections.ts`; prior `65b61e52` still has `new Map(items.map((i) => [i.itemId, i.institutionId]))`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (8): trim plaidItemId before the live institution join (DECISIONS #754)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `71ee2c3a` (#753 ship-gate; CI 35385735109 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #753 critic P2-1 / P2-2 — a padded `plaidItemId` missed `Map.has` and inherited the stamp.

**Closed.** Shared helper trims the lookup key. Empty / whitespace-only is missing (stamp). Map keys and sibling `===` stay untrimmed. Present map value `''` still returns `''`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8562 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD untrimmed `has`: **3 failed | 108 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r8`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 111/111, FAIL-OLD 3|108, kill-call value-trim 3 died. P2s in STATUS.

**Ledgers.** DECISIONS #754 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (8).

**Ship.** `09d51409` on `origin/main` (PR #34 ff-merged). No `prisma/` schema diff. **CI verify run 35389703386 = SUCCESS** on `09d51409` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_FJgPcT7MpweCoEEuW9Ps5bWiuyaz` **READY** on that sha, target production. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `09d51409` finds `const key = plaidItemId?.trim() ?? ''`; prior `71ee2c3a` still has `liveByItem.has(plaidItemId)`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (7): present-null institution name does not inherit the stamp (DECISIONS #753)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `205d1bc9` (#752 ship-gate; CI 35382534980 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #752 critic P2-1 — combine and `/accounts` still inlined `item?.institution ?? stamp`.

**Closed.** Both surfaces call `resolveLiveInstitutionName` (shared `Map.has` field helper). Present null stays null; disconnect stamp remains.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8558 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD `??`: **3 failed | 1 passed | 103 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r7`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 130/130, FAIL-OLD 3|1|103, kill-call 4 died. P2s in STATUS.

**Ledgers.** DECISIONS #753 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (7). STATUS #745 BUILT and this file's #745 session rotated verbatim to `docs/archive/`.

**Ship.** `0324a0be` on `origin/main`. No `prisma/` schema diff. **CI verify run 35385735109 = SUCCESS** on `0324a0be` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_6CuNCMKgGskRonBeFbDCpvxvfGE9` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `0324a0be` finds `resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)` in both server files; prior `205d1bc9` still has `item?.institution ?? a.institutionName ?? null`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (DECISIONS #750)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `0b89152e` (#749 ship-gate docs). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic. Mixed-type over-veto stays locked fail-closed by cycle-4. Strongest actionable money-identity row: #749 critic P2-1 — a present map entry whose value is `null` fell through to the stamp.

**Closed.** `resolveLiveInstitutionId` uses `Map.has`; present null stays null; disconnect (no key) still uses the stamp. Live 0977 fold unchanged.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8544 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD `??`: **3 failed | 84 passed**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**Critic (fresh context, `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently reproduced tsc 0, 87/87, FAIL-OLD 3|84. P2s in STATUS.

**Ledgers.** DECISIONS #750 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j note.

**Ship.** `261cbddb` on `origin/main` (PR #29 rebase-merged; feature-branch shas `bab1c0c6` / `a5df27b8` rewritten as `bb86f15a` / `261cbddb`). No `prisma/` schema diff. CI verify **35370637485 = SUCCESS** on `261cbddb` (`main`, full `VERIFY_E2E=1`, 15m15s, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_GNBd6UC2ZYJhcFz6iHXgK4hRenkp` READY on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Server-only marker: `raw.githubusercontent.com` on `261cbddb` finds `institutionByItem.has(plaidItemId)` in `transfers.ts`; prior production sha `0b89152e` still has `fromItem ?? accountStamp ?? null`.

## 2026-09-18 — O.20j residual (4): the live 0977 fold reads PlaidItem `ins_*`, not the null stamp (DECISIONS #749)

**Picked up.** Owner: "continue." Tree even with `origin/main` at `bd989510` (#748 shipped). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic; L.19 stored-figure residuals closed. Mixed-type over-veto (#748 residual 1) is locked fail-closed by cycle-4 (`CREDIT` must not become `CHECKING` via a confirmed terminal). Strongest actionable money-identity row: #748 critic P2-2 — the filing fixture stamped the account and never created a PlaidItem.

**Closed.** `resolveLiveInstitutionId`; `loadTransferSweepRows` calls it; filing fixture is stamp NULL + two `PlaidItem` rows `ins_56`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8541 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD stamp-only: **2 failed | 82 passed**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**Critic (fresh context, `/tmp/_critic_o20j_r4`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently reproduced tsc 0, 84/84, FAIL-OLD 2|82, ignore-map 4|80. P2s in STATUS.

**Ledgers.** DECISIONS #749 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j note.

**Ship.** `439d0650` on `origin/main` (PR #27 rebase-merged; feature-branch shas `16be7d28` / `0107216c` rewritten). No `prisma/` schema diff. CI verify **35356213456 = SUCCESS** on `439d0650` (`main`, full `VERIFY_E2E=1`, 10m58s, `gh run view` conclusion success). Vercel Production `dpl_2pmQnGNBYKyqfJi8kaLdhtBeCGZN` READY on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Server-only marker: `raw.githubusercontent.com` on `439d0650` finds `export function resolveLiveInstitutionId(` in `src/lib/engine/categorize/transfers.ts`; **0 hits** on the prior production sha `bd989510`.
