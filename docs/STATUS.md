# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

## Phase 1 (complete — critic cycle 2 green)

Hostile Critic cycle 1 verdict: FAIL (2× P1). Both fixed in cycle 2; the
critic's adversarial probes are kept permanently in
`tests/unit/critic-scenarios.test.ts`:

- **P1-1 fixed:** transfer recommendation could be dated in the past when the
  first short date was today/overdue. Now clamped to `today`
  (`engine.ts`, regression: probes S3/S9).
- **P1-2 fixed:** the assembler dropped a delinquent (past-due, unpaid)
  statement into the estimate path, mislabeling real debt. Current-statement
  selection now also matches any statement with an unpaid remainder
  (`assemble.ts`, regression: probe S4).
- P2s addressed: future-dated balance snapshot (seed now dates the current
  month's snapshot at asOf), scenario toggle semantics (segmented buttons with
  `aria-pressed` + `aria-live` summary), tabular-nums on headline amounts,
  PHASES.md recommendation wording aligned with EDGE_CASES, this file created.

## Phase 2 (complete — critic cycle 2 green)

Critic cycle 1 verdict: FAIL (1 P0, 6 P1). All fixed in cycle 2; the critic's
probes live on as regressions in `tests/unit/critic2-*.test.ts`:

- **F1 (P0) fixed:** splitting a transaction double-counted it (parent +
  children) in the cash-needed pending projection and flow aggregates. Splits
  now mark the parent `isSplitParent`; every aggregation excludes parents and
  counts children (schema field + assemble/insights/transfers updates).
- **F2 fixed:** split validation now rejects mixed signs, zero parts,
  re-splitting parents, and splitting children; multi-writes run in
  `prisma.$transaction`.
- **F3 fixed:** batch apply no longer creates a silent durable rule — the same
  one-tap "Always / Just this once" consent prompt follows batches, and undo
  removes a consented rule via `becameRuleId`.
- **F4 fixed:** transfer descriptor patterns are anchored/word-bounded and
  transfer detection consumes the normalizer's verdict (one decision path) —
  "T-MOBILE PREPAY", "GIFT CARD PAYMENT", "GEICO AUTOPAY" no longer vanish.
- **F5 fixed:** the band-gap→review rule honors account/day scoping.
- **F6 fixed:** triage actions roll back the optimistic UI and surface an
  error banner on failure; corrections are never silently lost.
- **F7 fixed:** tree green (`npx vitest run` → 321/321).
- F8/F9 partials: `previousAmountCents` + `possiblyUnused` now persisted on
  RecurringSeries; whitespace descriptors get an "Unknown Merchant" fallback;
  `undoSplit` guards non-split rows; split input parses via
  `centsFromDollarString`. Remaining accepted P2s listed below.

## Phase 3 (complete — critic cycle 2 green)

Cycle 1 verdict: FAIL (1 P1). All hand-verified math passed (8/8 anchors to
the cent). Fixed in cycle 2:

- **P1-1 fixed:** the FI number now states its expense basis inline on the FI
  card ("…on $X/yr of spending — estimated from your last 6 full months × 2").
- P2s fixed: split parents excluded from life-energy list and recurring
  detection input; runway "Infinity" rendered as "no expenses yet"; negative
  savings-rate headline has honest copy; slider state clamped to its range;
  Money Review fallback no longer claims an improvement it didn't measure
  ("What held steady…"); opportunity projections state the assumed return rate.
- Phase 2 cycle-2 hardening from the same review: integer-cents split
  validation, one-action-at-a-time guard on triage gestures, empty-batch
  prompt guard.

## Phase 5 / final full-app critic: **PASS** (zero P0/P1)

Financial correctness 10/10 (30 hand-verified assertions incl. 6 brand-new
adversarial cash-needed scenarios, all exact to the cent), edge-case coverage
10/10. Findings, all P2:
- **P2-1 CSV formula injection — FIXED post-review**: `csvField` now prefixes
  `= + - @` / tab / CR-leading fields with an apostrophe; the critic's evidence
  probes were flipped to safe-behavior regressions (critic5-surface.test.ts).
- P2-2 rate limiter is in-memory/single-instance — accepted for v1, documented
  in authz.ts and ROADMAP #8.
- P2-3 cosmetic Recharts width(-1) console warning during headless e2e.

## Post-Phase-5 refinement: Spending Trends / insights (DECISIONS #74, surpass feature #7)

The "what changed & what to look at" surface (Copilot/Cleo/Monarch lead with it)
that the category/recurring/forecast views never exposed. Pure engine
`engine/trends/trends.ts` — a thin, exact layer over the tested
`spendingByCategory` (one spend definition, integer cents, no model calls):
pace projection for the in-progress month, completed-month category movers (last
month vs a ≤3-month average, ≥$20 AND ≥20%), largest purchases, and new merchants
(vs the prior 6 months). Non-actionable money movement ('Transfers & Other':
cash/transfer/cc-payment/uncategorized) is kept out of movers/largest/new and
aggregate pseudo-merchants out of new-merchants; pace alone keeps the full reports
total so the headline matches /reports & /spending-plan. `getSpendingTrends`
reads the same ownership-scoped snapshot; `/trends` page + a dashboard
`SpendingInsightsCard` + a reciprocal /reports link, NO 8th nav icon (380px bar
full at 7, #71).

Gate (real output 2026-06-23): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, **807 unit / 65 files** (+16: hand-
derived synthetic + a real-seed pinned run + an integrated normalize→engine test),
build clean, **46 e2e** (+3: discovery, render incl. Costco as the seed's biggest
June buy, WCAG-AA axe). One e2e iteration first caught a real dark-mode contrast
miss (an `opacity-80` on the % label, 4.42 vs 4.5:1) — FIXED before sign-off.

Hostile Critic (4 dimension critics + adversarial verification of every P0/P1):
financial 7 / edge-case 7 / security 9 / UX-a11y 8. **1 P1 confirmed + RESOLVED:**
"Store Card Purchase" surfaced as a new merchant — traced to a docstring
OVER-CLAIM, not a code bug. This codebase deliberately treats "Store Card
Purchase" as a real, rule-eligible merchant (`assign.ts isRuleEligibleMerchant`
+ the triage flow assert `rule-always` for it), so flagging it aggregate would
have broken that tested decision; fixed by correcting the doc + adding an
INTEGRATED test (derives the aggregate flag via `normalizeMerchant` like the
server does, proves genuine aggregates Zelle/Check ARE excluded while Store Card
legitimately appears). P2s FIXED: deterministic largest tie-break
(amount→date→merchant), no-history-vs-steady empty-state copy, pace `h2` for
heading order, reciprocal /reports→/trends link, new-merchant amount doc clarified.
Accepted P2s (documented, by design): (1) pace counts money-movement to MATCH
/reports & /spending-plan (movers exclude it for actionability — a deliberate,
documented split, not a third spend definition); (2) largest excludes
uncategorized to avoid Unknown-Merchant noise (consistent with movers); (3)
refunds are not netted from the new-merchant total (a brand-new merchant rarely
has a same-month return; netting would risk a confusing negative line); (4) the
day-1/2 pace projection is volatile but explicitly caveated ("a projection, not a
prediction"); (5) the mover baseline averages over months-with-any-spend — a true
calendar-monthly average including $0 months; (6) trends copy is hand-verified
against the coaching guardrails but isn't yet in the automated guardrail-scan set.

## Post-Phase-5 refinement: Money Dials settings/onboarding (DECISIONS #28)

The five per-user dials the engines read (payment account, SWR, expected return,
hourly wage, money dials) were seed-only with no editing path. Added the
credential-free half of ROADMAP #2:
- Pure validation engine `src/lib/engine/settings/dials.ts` (string-only parse,
  all-fields-at-once errors, bounds that keep the FI engine defined — SWR
  rejected ≤ 0 because `fiNumberCents` divides by it). `tests/unit/settings-dials.test.ts`
  (70 cases) + hand-verified parse table in EDGE_CASES §Money-Dials.
- Thin ownership-scoped `updateMoneyDials` server action (validate → persist →
  audit → revalidate dashboard/coach/cards/accounts/settings).
- `MoneyDialsForm` (useActionState, inline per-field errors + ARIA, assumptions
  in copy) on `/settings`; dashboard onboarding nudge gated on `paymentAccountId
  == null` (dormant in demo, activates for real new users post-auth).
- E2e `tests/e2e/settings-dials.spec.ts`: one sequential test (mutates only
  `moneyDials`, the dial with no golden coupling, and restores it) — proves
  pre-population, validation-without-persist, and a DB round-trip, golden-safe
  under fullyParallel.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, **24 e2e** green (was 23 + the new dials flow).

Hostile Critic (multi-agent workflow, 4 dimension critics + adversarial
verification of every P0/P1): **PASS** — scorecard financial 9 / security 9 /
UX-a11y 8 / code-tests 8, **0 P0/P1** (the lone P1 candidate — a stale
`paymentAccountId` silently falling back — was independently verified to P2:
no account-deletion path exists anywhere in the codebase, so it is latent /
forward-looking). P2s fixed in this pass: centralized the triplicated
`JSON.parse(moneyDials)` into a malformed-safe `parseStoredDials`/`encodeDials`
engine boundary (used by coach/settings/budgets/action); made `needsOnboarding`
existence-aware (a dangling/ineligible saved id re-fires the nudge instead of a
silent fallback) and removed the redundant 3rd dashboard user-read (single
source via `DashboardData.paymentAccountId`); added a `role="status"` live region
for the "saved" confirmation (WCAG SC 4.1.3); code-point-aware dial length;
zero-eligible-account empty state; tightened the nudge copy (money dials don't
move the headline); `autoComplete="off"` on the numeric inputs. Deferred P2s
(documented, not fixed): per-action rate limit (consistent with the codebase's
other mutations — DECISIONS/ROADMAP #8), focus-to-first-error + error summary,
and light-theme error/success contrast (light theme is unreachable today).

NOTE (env, not a code defect): the first e2e run failed with `ChunkLoadError`
because a stale `next start` (the desktop launcher app) held port 3100 and
Playwright's `reuseExistingServer` reused it after the rebuild overwrote its
chunks. Stopping that process and re-running clean was green. If e2e ever shows
chunk-load / 400-on-`_next/static` errors, check for a stray server on 3100
(`netstat -ano | grep :3100`).

## Post-Phase-5 refinement: average-daily-balance interest (DECISIONS #29, ROADMAP #3)

Minimum-path interest moved from the labeled v1 simple-monthly approximation
(carried × APR/12) to the **average-daily-balance method**: per card not paid in
full, interest = round(DPR × Σ daily balances) over the next cycle
[close → close+1mo], DPR = APR/10000/365, balance = full statement until the
minimum posts on the due date then carried after; grace-gated (paid in full → $0).
New pure primitive `averageDailyBalanceInterestCents` in money.ts (own known-answer
tests incl. a fail-loud overflow guard); engine derives cycleDays/daysUntilDue from
the statement close+due dates. The retired `mulBps` (its sole caller) was removed.
Every pinned value recomputed BY HAND and updated with its test + doc (EDGE_CASES
§I/§Seed-headline: §I $61.08, the 06-01-cycle §I anchor $58.81, seed $65.76→$67.36,
S8 $12.23, N6 $19.17/$18.74).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, 24 e2e green. (One full-run failure was a confirmed environment flake —
`net::ERR_NETWORK_IO_SUSPENDED` from the machine suspending network I/O mid-run;
the 3 affected specs, all on pages untouched by this change, passed on a clean
re-run, and the subsequent full verify was green.)

Hostile Critic (multi-agent, adversarial verification): **PASS** — financial 9 /
regression 9 / code-tests 9, **0 P0/P1**, 0 refuted; all three critics
independently hand-derived every pinned ADB value and each matched exactly, and
confirmed PAY_IN_FULL + all non-interest golden values are unchanged. Critic P2s
fixed: removed dead `mulBps` + its fossil test, overflow guard, citation #5/#21→#29,
type-comment + assumption-string transparency (mid-cycle payment timing). Accepted
P2s: theoretical float-half fragility and the latent estimate-path clamp (unreached;
estimates are excluded from MINIMUM interest whenever a real statement exists).

## Post-Phase-5 refinement: budget-targets UI (DECISIONS #30, ROADMAP #7)

Set/clear a per-category monthly target against actuals on `/budgets`. Pure engine
`engine/budgets/status.ts` (summarizeBudgets over the union of spent+target
categories; netSpendByCategory nets refunds; isBudgetable; parseBudgetTargetCents),
22 unit cases. `setBudget` is an atomic `prisma.budget.upsert` on a new
`@@unique([userId, categoryId])` (applied via `prisma db push`); `clearBudget` is
ownership-scoped. Budget targets are display-only — they feed nothing but /budgets
(not cash-needed/FI/net-worth) — so writes perturb no golden value.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the new budget-targets flow: set → axe scan → atomic overwrite → clear).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
correctness 8 / security 9 / ux-tests 7. Two P1s found and FIXED before sign-off:
(1) budget actuals ignored refunds → a net-under-target category could show a false
"over target" bar — fixed by netting refunds in the budgets spend calc (scoped to
the display; income/savings-rate aggregations stay gross per the documented
convention, ROADMAP #4); (2) the overwrite path was untested with no DB uniqueness
guard → fixed with `@@unique` + `upsert` (structurally one row, no race) + an e2e
overwrite step. P2s fixed: non-spendable categories no longer selectable (shared
`isBudgetable` allow-list on picker AND server), progress bar gained
`role="progressbar"` + aria, and the e2e now runs axe on the target-bearing DOM.
Accepted P2s (consistent with the codebase): action throws on invalid input like the
sibling `createGoal` (no error boundary app-wide), per-action rate limit deferred
(ROADMAP #8), and the pre-existing exact-name money-dial match.

## Post-Phase-5 refinement: account-deletion UI (DECISIONS #31, ROADMAP #10)

Settings → "Delete my data": typed-confirmation gate → ownership-scoped
`prisma.user.delete` (cascades every user-owned row; shared Merchant/Category
left intact) → best-effort Plaid revoke → signOut. Idempotent (existence guard
skips audit+delete on an already-gone row, still signs out). Pure gate/summary
engine (`engine/account/deletion.ts`) + an integration test that drives the REAL
`deleteMyData` against throwaway users (gate-reject → no deletion; exact phrase →
scoped wipe + signOut; idempotent re-run). `(app)/error.tsx` added so a
post-deletion no-accounts render (or any action throw) degrades gracefully.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the gate/summary flow; the destructive execution is deliberately not e2e'd
against the shared demo — proven by the integration test instead).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
security 7 / correctness 8 / ux-tests 6; cascade correctness verified down to live
`PRAGMA foreign_keys`. Four P1s found and FIXED: (1) the action had zero execution
coverage → action-level integration test; (2)+(4) non-idempotent crash (P2003/P2025)
on an absent/double-submitted row → existence guard; (3) post-deletion demo
re-sign-in 500 with no error boundary → `(app)/error.tsx`. P2s fixed: honest
summary catch-all, permanence warning moved above the form + `aria-describedby`,
form suppressed in the no-data state, de-flaked the integration test (unique ids).
Accepted P2s (real-auth release): multi-device JWT session invalidation and a
non-cascading compliance deletion-record (documented in PRIVACY.md §Deletion).

## Post-Phase-5 refinement: offline PWA service worker (DECISIONS #32, ROADMAP #5)

`public/sw.js` + a precached self-contained `/offline` shell + production-only
registration (`sw-register.tsx`, wired into the root layout). Conservative by
design: navigations network-first (online always fresh, never cached → no stale/
cross-user data), icon/manifest cache-first with a `res.ok` guard, hashed
`/_next/static/*` passthrough (bounded SW storage — no per-deploy accumulation).
Middleware excludes `/sw.js` + `/offline` (anchored so prefix collisions can't
skip auth).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(new pwa-offline spec: SW registers + an offline reload serves the shell; existing
PWA-manifest + security-header specs unaffected — network-first means online specs
always hit the network).

Hostile Critic (multi-agent, adversarial verification): **PASS** — suite-safety 8 /
correctness 9 / privacy-robustness 7, **0 P0/P1** (the 3 review-phase "P1"s —
fixed cache name, atomic-precache-swallow, cache-first-stale-offline — were all
adversarially downgraded to P2: no online stale-serving, no leak, no suite
destabilization). P2s fixed proactively: `res.ok` cache guard, resilient per-asset
precache, network-first `/offline`, self-contained inline-styled shell, anchored
middleware matcher. Deferred P2s (documented): a build-stamped cache name and an
in-app "update available" affordance — unneeded while hashed assets are passthrough
and online navigations are network-first.

## Post-Phase-5 refinement: app-wide refund netting (DECISIONS #33, ROADMAP #4)

`monthlyFlows` (the single income/expense classifier feeding savings rate + FI)
now nets refunds: a positive transaction in a non-income category reduces that
month's expenses instead of counting as income (payroll/income unaffected;
ambiguous no-category positives stay income; a month's spend is floored at 0). The
demo's lone refund (+$50 AMZN return, May) now reduces shopping spend rather than
inflating May income — a small, correct shift (no pinned golden value depended on
it). Verified by 4 known-answer fixture tests in insights.test.ts; the only
in-app income path is `monthlyFlows` (`incomeExcludingTransfers` is test-only), so
the change is consistent. Reviewed by a focused self-check (income-detection edge
cases + single-path confirmation) rather than the full multi-agent critic, given
the 6-line, well-tested, single-path scope. `VERIFY_E2E=1 bash scripts/verify.sh`
→ **✅ VERIFY GREEN** (585 unit / 29 files, 27 e2e, clean typecheck/lint/build).

## Post-Phase-5 refinement: production hardening (DECISIONS #48, ROADMAP #8 + #9)

Closed two deferred launch-gating items. (#9) The `splitTransaction` double-split race
— it read `isSplitParent` before its transaction, so two concurrent splits could each
create children (doubling the txn in every aggregate). Now the parent is CLAIMED
atomically inside the transaction (conditional `updateMany`; a racing loser aborts before
creating children). (#8) The in-memory rate limiter was a per-instance no-op on
serverless; replaced with a durable, DB-backed `rateLimitDurable` (new `RateLimit` table,
applied via `prisma db push`) on the export route + a new per-account sign-in throttle.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **698 unit / 51 files**, build clean, **35 e2e** (existing
split + export flows unaffected).

Hostile Critic (4 parallel dimension critics + adversarial verification): the split fix
scored 10/10 (proven 20/20; the loser is rejected by the claim, not the pre-read). But it
found **3 P1s in the limiter, all FIXED**: (CONC-1/SEC-1) the reset branch returned `true`
UNCONDITIONALLY, so a concurrent burst of N first-hits ALL bypassed (50/50 at limit 8) —
fully defeating the brute-force throttle; fixed by deciding from an atomic
increment-or-create's returned count (regression: a 12-call burst at limit 4 allows exactly
4). (OPS-1) the `RateLimit` table grew unboundedly (no prune/index, attacker-controlled
`signin:<email>` keys, CWE-770); fixed with `@@index([resetAt])` + a self-pruning
`pruneExpiredRateLimits()` (≤1/min/instance, no cron needed). P2s fixed: export 401/429
tests, undo→resplit test, honest dead-code comment, explicit fail-closed comments. Deferred
P2s (documented): email-keyed sign-in throttle allows a bounded ≤60s account lockout
(IP-scoping is the next step); the limiter is two Prisma statements vs a single raw
ON-CONFLICT (a Postgres-only optimization); the Always/Undo orphan-rule race (STATUS #10).

## Post-Phase-5 refinement: payment reminders (DECISIONS #47, ROADMAP #6)

The calendar badged due days but nothing delivered a reminder. Added the MECHANISM:
a pure `engine/reminders/select.ts` (selection + email text) shared by an in-app
dashboard "Payment reminders" card and a `CRON_SECRET`-guarded `/api/cron/reminders`
sweep. Email dispatch (`lib/email.ts`) is DORMANT by default — no `RESEND_API_KEY` →
nothing sent, no network call (zero-credential demo, fetch-spy tested); set a Resend
key to switch on. Both surfaces derive from the same Cash-Needed obligations so they
can't disagree.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **686 unit / 48 files**, build clean, **35 e2e**
(dashboard reminders panel + no-duplicate-card assertion + reminder-cron-secret 401).

Hostile Critic (4 parallel dimension critics + adversarial verification): **2 P1s found
+ FIXED** before sign-off. (F1) both callers spread `[...result.cards, ...result.upcoming]`,
but the engine's `cards` already includes `upcoming` (a subset) → estimated obligations
double-counted (demo showed "Store Card" twice) → pass `cards` only + made the selector
idempotent under overlap (dedup) + an e2e uniqueness check. (PR6-001) the partial-autopay
(top-up) case dropped the autopay portion in the email/card against the larger headline
→ added the both-portions disclosure + a known-answer fixture. P2s fixed: shared
constant-time cron compare (now used by sync too), keyed-send cron test, tomorrow/soon-
boundary coverage, long email dates, stale calendar-footer copy. Deferred P2s
(documented): scheduling is an operator deploy step (`vercel.json` crons + `CRON_SECRET`),
consistent with the sync cron; the cron response lists userIds to the secret-holder only.

NOTE (deploy): to actually fire, add `{ "crons": [{ "path": "/api/cron/reminders",
"schedule": "0 13 * * *" }, { "path": "/api/cron/sync", "schedule": "0 * * * *" }] }` to
`vercel.json` and set `CRON_SECRET` (+ `RESEND_API_KEY` to send email). Dormant otherwise.

## Post-Phase-5 refinement: manual card statements (DECISIONS #46, extends #45)

A manual CREDIT card was treated as a card by the Cash-Needed Engine but, lacking a
Statement and cycle days, `buildObligation` returned null (engine.ts:83) → it was
DROPPED from "how much do I need & when", counting only toward net worth. Now a user
attaches a statement (+ optional APR + autopay) on `/accounts` so the card runs the
PRECISE path. No schema change (Statement/AutopayConfig already exist; the snapshot
already loads all of them). Pure parser `engine/cards/manual-statement.ts`, atomic
manual+CREDIT-guarded `card-actions.ts` (ARRAY-form `$transaction` — the interactive
form timed out under parallel SQLite), `getAccountsView` billing + `/accounts` UI.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **666 unit / 44 files**, build clean, **33 e2e**
(new manual-card-statement flow: add card → add $0 statement [headline-neutral] →
FIXED_AMOUNT autopay re-hydrates on edit → clear → delete-revert).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **0 P0/P1** — all three P0/P1 candidates reproduced then downgraded to P2
(parse failure returns before any DB write → no data loss; clear error surfaced in
the role=alert banner; narrow blast radius). Scorecard: security 9–10, code/tests
6–9, UX/a11y 6–9. P2s FIXED: FIXED_AMOUNT autopay round-trip on edit (billing now
carries the amount), blank-APR inline disclosure, `role="group"` on the form, an
aria-live `role="status"` success confirmation, + 3 missing tests (FIXED_AMOUNT split,
idempotent clear, APR-wipe). Accepted/deferred P2s (documented): manual estimate path
uses the user-entered balance for the next cycle; input-prefill `toFixed` (consistent
with existing prefill code); read-then-write single-statement race (STATUS #10 /
ROADMAP #9); one-tap Clear without confirm (consistent with the more-destructive
sibling `manual-delete`, reversible, no money/history loss).

## Post-Phase-5 refinement: real-clock "today" for real users (DECISIONS #58)

Found while prepping the multi-user deploy: the app resolved "today" as
`DEMO_TODAY ?? DEFAULT_AS_OF('2026-06-10')`, so a production deploy with
`DEMO_TODAY` unset would FREEZE every real user's "today" at the seed date —
wrong days-until-due, reminders, and net-worth "today" point. Fixed with one
sanctioned wall-clock read (`src/lib/business-today.ts` `businessToday(userId?)`):
DEMO_TODAY pin → demo user pinned to the seed date → real users get the real
clock. Threaded `userId` through `DataProvider.today(userId?)` and all call sites
(finance/coach/budgets/layout/new-txn/accounts/simplefin/plaid + the reminders
cron via getCashNeeded). Golden-safe by construction: tests set DEMO_TODAY, the
demo path still resolves to 2026-06-10.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — **753 unit / 60 files** (+4 known-answer: DEMO_TODAY-wins, demo-pinned,
real-user-real-clock, no-userId-real-clock), build clean, **37 e2e**.

## Post-Phase-5 refinement: invite-only signup (DECISIONS #57, ROADMAP #2)

The user needs the app for themselves + spouse + chosen testers, not the public.
Real multi-user auth already existed (DECISIONS #43) and its data isolation is
tested (re-confirmed live: `auth-actions`/`auth-password` → 10 passed, incl. the
two-user isolation check). What was missing was a way to keep signup private. Added
a pure env-driven allowlist (`src/lib/auth/allowlist.ts`) wired into
`signUpWithPassword` before any DB write. DORMANT by default (`SIGNUP_ALLOWLIST`
unset → open, so demo/local/tests are unchanged); set it → invite-only (exact
emails and/or whole `@domains`, case-insensitive). Gates creation only; existing
logins are unaffected.

Inline hostile-critic (proportionate to a ~45-line pure gate), 0 P0/P1: rejected
domain-suffix spoofing (`@team.com` ≠ `evilteam.com` / `team.com.attacker.net`),
multi-`@`/malformed (regex gate runs first + independent no-local/no-domain guard),
typo'd entries fail closed, no eval/SQL. KNOWN OPERATIONAL RISK (documented, bold in
docs/DEPLOY.md, not a code defect): forget to set `SIGNUP_ALLOWLIST` on deploy →
open signup.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **749 unit / 59 files** (+9: 8 known-answer allowlist
+ 1 action-level gate test), build clean, **37 e2e**. New deploy runbook docs/DEPLOY.md.

## Post-Phase-5 refinement: SimpleFIN aggregator (DECISIONS #56, ROADMAP)

A user hit Plaid's approval/cost wall and asked for an aggregator. Answer: don't
clone Plaid — wire SimpleFIN, a read-only documented protocol with no business
gate. Split like Plaid (#26): a TESTED pure mapper (`simplefin-map.ts` — signs,
cents, dates, account-type, dedup) + an UNVERIFIED network layer (`simplefin.ts`).
A `SimpleFinConnection` row stores ONLY the AES-256-GCM-encrypted access URL.
Re-sync is idempotent + race-safe on a new `@@unique([accountId, providerRef])`
(seed/Plaid goldens unaffected — providerRef nullable), 5-day overlap, then
cross-account transfer pairing (Plaid parity). SimpleFIN amounts are
outflow-NEGATIVE like Pulse, so — unlike Plaid — the sign is NOT flipped.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **740 unit / 58 files**, build clean, **37 e2e**.
20 new SimpleFIN tests (mapper fixtures + real connect/sync actions vs a mocked
server: encrypted-at-rest, correct signs/categories, idempotent re-sync, SSRF
rejection incl. an internal access URL returned BY the claim server, IPv6 internal
tokens, malformed-row skip).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **5 P1s confirmed and FIXED + tested** — (1) SSRF redirect-follow bypass →
`safeFetch` re-validates every hop + drops Authorization on cross-host redirect;
(2) IPv6 private/ULA/link-local not blocked → added (`::`, fc00::/7, fe80::/10,
::ffff: mapped); (3) `posted:0` pending sentinel → 1970-01-01 → falls back to
`transacted_at` then sync date; (4) ambiguous account + negative balance could
INVERT net-worth sign → classified as liability + UI notice; (5) action errors
echoed `e.message` (could leak the credentialed URL) → fixed strings. P2s fixed:
amount parser tolerant of thousands-separators + >2 decimals (integer math, no
float); malformed-row skip not fatal.

**UNVERIFIED (honest, documented — docs/SIMPLEFIN_WALKTHROUGH.md):** the live
network path has NEVER run against a real SimpleFIN server here (no token in env).
The ledger-corrupting logic is unit-tested; the socket isn't. Confirm field shapes
vs the current spec before trusting real money data. Like Plaid, a real bank
linking to the *deployed* app also waits on real multi-user auth (ROADMAP #2) —
linking to the shared demo user would leak data. DNS-rebinding (pin-resolved-IP)
and scheduled auto-sync are deferred follow-ups.

## Phase 4 (complete — see commit)

Calendar/goals/budgets/exports/PWA/cron/security headers + dormant Plaid
provider (UNVERIFIED — docs/PLAID_WALKTHROUGH.md has the validation
checklist). Unauthenticated API requests now return 401 JSON (middleware).

## Known limitations (accepted, by design or deferred)

1. **Statement balances in seed history are plausible PRNG values**, not exact
   sums of that cycle's card transactions (DECISIONS #14). Likewise the
   checking account's posted balance is not reconciled against its full
   transaction history. No engine math depends on this reconciliation.
2. **Minimum-path interest uses the average-daily-balance method** (DECISIONS #29,
   supersedes the v1 simple-monthly approximation): APR÷365 × the cycle's average
   balance (full statement until the minimum posts, carried after), grace-gated so
   paid-in-full cards show $0. New purchases are not projected (a stated
   assumption); the minimum is modeled as posting on the due date, and any
   mid-cycle payment already made is treated as reducing the balance from the
   statement's close date (its exact posting date is not modeled — a conservative,
   user-favorable simplification). Two §I anchors in EDGE_CASES differ purely by
   cycle dates ($61.08 vs $58.81) — expected, both pinned.
3. **Demo auth is one-click** (anyone can open the demo user). Real auth
   (magic link / Google) plus the security pass land in Phase 4 (DECISIONS #13).
4. **`getDashboardData` loads the full snapshot per render** — fine at seed
   scale; pagination/caching is a Phase 4/5 concern.
5. **A card payment in transit that is recorded nowhere** (neither CardPayment
   row nor pending debit) is conservatively double-demanded (full statement +
   money still in checking). Documented behavior (critic scenario S2).
6. WCAG AA: axe (wcag2a/aa + wcag21a/aa tags) passes on all core pages plus a
   keyboard-only flow (tests/e2e/phase5-a11y.spec.ts); a full manual audit
   (screen readers, zoom, cognitive review) has not been performed.
7. **Recurring-detection fragilities (critic F8, P2):** ~~a refund+rebill inside a
   series drops it for the period~~ — **FIXED** (DECISIONS #34, ROADMAP #4): the
   detector analyzes only the dominant sign per merchant, so a refund (the minority
   sign) no longer breaks amount-stability or flips a series to "income"; the two
   critic2-recurring probes now assert the survived behavior. Still open: annual
   subscriptions need 3 occurrences (2+ years of history); `possiblyUnused` is a
   fitness-category proxy (usage is not observable in transaction data —
   DECISIONS #18) and is always phrased as a question in the UI.
8. **Refunds are NETTED against spend** (DECISIONS #33, ROADMAP #4 — supersedes the
   prior "refunds count as inflows" stance): a positive transaction in a non-income
   category reduces that month's expenses in `monthlyFlows` rather than counting as
   income, so savings rate and FI inputs reflect net spend. Payroll (category
   `income`) still counts as income; a positive with no/unknown category stays
   income (ambiguous inflow not netted). The /budgets view already did this locally
   (DECISIONS #30); this makes it consistent engine-wide.
9. **Equal-priority rules tie-break by creation order** (stable sort) — documented
   here rather than enforced.
10. **Concurrency races:** ~~two concurrent splits could double-split~~ — **FIXED**
    (DECISIONS #48: `splitTransaction` claims its parent atomically inside the tx).
    ~~"Always" racing "Undo" can orphan a rule~~ — **FIXED** (DECISIONS #49:
    `undoCorrections` deletes the rule only WHERE `createdFrom` still points back to
    this correction; regression-tested). ~~The `alreadyUndone` pre-read TOCTOU lets two
    concurrent undos of the same correction write a duplicate inverse~~ — **FIXED**
    (DECISIONS #50: the inverse correction carries `undoesId` with a `@@unique`, so the
    racing loser's insert violates the unique and rolls back; regression-tested with two
    concurrent undos → exactly one inverse). **All of #10 is now closed.**
11. ~~**Unknown billers containing a word-bounded "EPAY"** (e.g. "DUKE ENERGY
    EPAY") classify as transfers~~ — **FIXED** (DECISIONS #55): a utility-token +
    biller-payment-token pattern now wins before the transfer pattern, so utility
    e-payments are categorized as `utilities` (real spend) instead of being dropped
    as transfers — without affecting card payments. Surfaced by the adversarial
    categorization eval (`npm run eval:categorize`) + regression-tested.
12. **Plaid integration is IMPLEMENTED but UNVERIFIED** (no sandbox credentials
    in the build environment). The pure mapping layer (sign flip, account-type,
    liability→statement, per-row categorization) is unit-tested
    (tests/unit/plaid-map.test.ts, 18 cases); the network orchestration in
    plaid.ts (accounts/transactions-sync/liabilities/webhook/item-remove, with a
    dedicated `PlaidItem` token+cursor table) is real code that has never run
    against a live sandbox. Webhook JWT verification — **DONE** (DECISIONS #52:
    ES256 + body-SHA-256 + freshness, unit-tested with a real keypair; the live
    key fetch is the only UNVERIFIED part). Recurring/scheduled refresh after ingest
    — **DONE** (DECISIONS #53: `refreshRecurringForUser`, unit-tested). The only thing
    still UNVERIFIED is the live Plaid NETWORK orchestration itself (no sandbox creds
    here); production OAuth (ROADMAP #1d) is the remaining gap. Validation checklist in
    docs/PLAID_WALKTHROUGH.md §5.
13. **Coast-FI with a 0-month target** and `detectLifestyleCreep(windowMonths=1)`
    are degenerate for out-of-range inputs — unreachable from the app
    (constants fixed), noted for API consumers.

## Post-Phase-5 refinement: Ask Aimplifi — grounded NL assistant (DECISIONS #75, surpass feature #8)

The conversational surface the app is named for, built on the no-fabrication soul:
the LLM never originates a fact. A pure rule-based parser (`engine/assistant/intent.ts`,
no model call — LOOP #5) maps a question to a typed intent; the server answers it from
the SAME tested engines/read-paths the dedicated views use (`spendingByCategory` == /reports,
spending-plan, cash-needed, recurring, forecast, `monthlyFlows`, `netWorthCents`, coach),
rendered by pure formatters via `formatCents`. The LLM is an optional, key-gated,
7s-timeout-bounded, per-user-rate-limited fallback that ONLY classifies an unknown question
into a kind (can abstain via "none"); params are re-derived deterministically + re-validated
before any data is touched, and answers flag `interpreted` so a guess is never silent.
Zero-key demo fully functional. Dashboard `AskAimplifiCard` + `/ask` (no 8th nav icon, #71/#74).

Gate (real output 2026-06-24): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **900 unit / 70 files** (+93), build clean, **51 e2e** (+5; the off-topic
case at 7.0s confirms the LLM-timeout → deterministic-fallback path), axe WCAG-AA green.

Hostile Critic (2 cycles, 16 agents, adversarial verification): cycle 1 financial 7 / security 8 /
code 6 / UX 8 — **6 P1s confirmed + FIXED**, each regression-locked: (1) net-worth used a truncated
liability set → canonical `isLiabilityType` (incl. MORTGAGE/OTHER_LIABILITY), facts reconcile to the
headline; (2) income/savings dropped `categoryId`+`isSplitParent` → income now `monthlyFlows(snap.transactions)`
(full rows; refunds net, splits excluded — F3 synthetic regression) and savings_rate delegates to
`getCoachData` (byte-identical to /coach); (3) largest omitted the POSTED filter → POSTED-only, grounding
test pins top-5 == /trends `computeLargest`; (4) off-topic could be silently misrouted when a key is set →
LLM `none` abstention + per-user `rateLimitDurable` + visible `interpreted` note. Confirmation cycle
(financial 93 / security 95 / code 88 / UX 88) confirmed all six and surfaced **1 further P1** — largest
diverged from /trends on the `<= today` guard + locale-vs-code-point tie-break — now FIXED to mirror
`computeLargest` exactly, with a non-tautological test (future-dated exclusion + code-point tie).
P2s FIXED: dead `answerUnknown` source line, third-party disclosure footnote (gated on `assistEnabled`),
no-flicker re-ask (prior answer dimmed while pending), dashboard card examples no longer fake-interactive,
500-char question clamp. Accepted/deferred P2s (documented): a shared `toFlowTxns`/`isPurchaseRow`/month-name
extraction across coach/trends/assistant (future DRY refactor); the pre-existing `monthlyFlows` income rule
(positive = income only for category null/'income', else nets) is unchanged.

## 2026-06-24 — SimpleFIN test flake hardened (DECISIONS #76)

A post-restart `verify` once failed `tests/unit/simplefin.test.ts` as "expected 0 to
be 2". Root cause: the parallel unit suite shares ONE rollback-journal SQLite dev.db
across worker processes; under an I/O spike (the codegraph daemon re-indexing) a write
was starved past the 15s busy_timeout → SQLITE_BUSY, which connectSimplefin's
intentional credential-safe catch masks as `added:0`. The code was never wrong (23+
clean full-suite reruns). Fix is TEST-ONLY (prod is Postgres): a vitest globalSetup
puts dev.db in WAL (concurrent readers + one writer no longer block), the SimpleFIN
test now asserts no swallowed error, and a regression test locks WAL on. Proven
fail-before/pass-after; verify GREEN (901 unit / 71 files), e2e 51 passed, 10/10
consecutive full-suite reruns clean.

## Coach Principles (Wave 1 + P0.4 + P0.5 + Wave 3) — M7 hostile-critic PASS (DECISIONS #92–98)

Embedded 7/9 finance-book principles into the Coach + app: Wave-1 captions
(Housel/Sethi/Ramsey framings), the P0.4 Conscious-Spending bucket lens, the
P0.5 Automation blueprint, and the Wave-3 Debt Freedom planner + Ask `debt_payoff`
intent — engine-first, each milestone verify-green and committed (#92–97).

**M7 hostile-critic review** (8 read-only dimension reviewers, opus, + adversarial
verification): **6 P1s confirmed and FIXED, each regression-locked** (full detail
in DECISIONS #98):
- **DEBT (P1):** the negative-amortization guard tested the *portfolio total*, so a
  single never-amortizing debt reported ALL debts — even ones steadily clearing —
  as never-paid-off (reachable with the seed's own estimated card minimums). Now a
  **per-debt** progress guard + a $1B overflow valve + a $0-budget short-circuit;
  pinned by new mixed-portfolio + zero-budget known-answer tests (EDGE_CASES §D/F/G).
- **AUTOMATION (P1):** the blueprint presented *estimated* next-cycle card
  obligations (the demo Store Card) as firm "set autopay" instructions → the engine
  now drops `isEstimated` cards, matching the cash-needed headline.
- **GUARDRAILS (P1):** `debtTradeoff` was a projection flagged `isProjection:false`
  (bypassing the assumption scan) → inline assumption added + flag corrected.
- **ASK (P1×2):** "pay off my credit card debt" was poached into `debt_payoff` (now
  stays cash_needed); "owe"/"out of debt"/"pay down" debt questions were missed (now
  routed) — both directions regression-tested.
- **MIGRATION (P1):** README's `prisma migrate deploy` builds a column-short DB —
  the single init migration is broadly stale (the migrations dir is vestigial;
  schema.prisma + `db push` are the real source of truth) → README + deploy step
  aligned to `prisma db push`.

P2s fixed: two `Math.round`/`*0.01` float-on-cents smells → `roundHalfAwayFromZero`;
conscious-strip bar widths normalized to sum 100% (overspent no longer overflows);
value CardTitles `as="div"` (#88); strategy toggle `aria-pressed`; sliders
`aria-valuetext`; debt-row truncation; trends mover-icon label. Deferred-with-rationale
P2s: Plaid LOAN minimum unmodeled (connector dormant); the conscious fixed-bucket
caveat already conveyed by the "bills and spending" copy; marginal small-text contrast
(axe-PASSING).

Gate (real output 2026-06-25): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **1008 unit / 77 files**, build clean. A11y-focused e2e
**16/16 pass** (coach/goals/budgets/trends/ask axe WCAG-AA — all four new surfaces).

**Book coverage completed to 9/9 (DECISIONS #99).** On "continue", the two books the
recommended scope left invisible were surfaced as content lines (the plan §2 line-69
owner option): C11 Kiyosaki — assets-vs-liabilities caption on /accounts; C16
Aliche/Sethi — a "Your money rules" strip on /coach (reads the existing moneyDials, no
new storage). Pure content, guardrail-scanned, no engine/schema change. The remaining
Wave-4 items (income-lever slider, mortgage early-payoff what-if, memory-dividend
reflection, PAW lens, the heavier stored My-Money-Rules feature, new Ask intents) stay
deferred as genuine polish below the plan's "markedly better" stop bar (§7 + #80). Gate:
core verify GREEN (**1014 unit / 77 files**), axe e2e for /accounts + /coach 2/2.

NOTE (env, not a code defect): a full `VERIFY_E2E=1` run's lone failure is
`phase2-triage` "a full review session completes in <15 interactions" — it times out
on a `disabled`-while-`pending` accept button under SQLite write contention (1/4 pass
in isolation). This is the OneDrive/SQLite `SQLITE_BUSY` flake class already recorded
in item #16 below; it occurs on a page this work never touched (the entire Coach
Principles delta since the pre-work commit is a nullable `Account.minimumPaymentCents`
column + its nullable seed field — zero triage/transaction/provider code), so it is
not a regression. The documented bigger fix (move the test DB to %TEMP%) remains the
deferred infra item in #16.

Accepted P2s (independent hostile Checker, 0 P0/P1):
14. The WAL regression test catches an unwired globalSetup on a fresh/CI checkout
    (dev.db created in rollback mode) but NOT on a dev machine whose dev.db is already
    persistently WAL — an accepted blind spot (the pipeline path is covered).
15. The e2e global-setup does not separately enforce WAL; e2e is low-contention and
    inherits the persistent-WAL file in practice.
16. OneDrive (the repo lives under OneDrive\) can hold a transient OS lock on dev.db /
    -wal / -shm that WAL cannot prevent; a future transient SQLITE_BUSY there is NOT a
    WAL regression. Deferred bigger fix: move the test DB out of the synced tree (%TEMP%).
    **PARTIALLY RESOLVED 2026-06-27 (#120):** the unit + e2e SQLite DBs now live under
    the OS temp dir, off the synced tree (tests/setup/test-db.ts). This FULLY fixes the
    UNIT SQLITE_BUSY flake (the SimpleFIN "expected 0 to be 2"; unit suite green + fast,
    reliably). The e2e flake is reduced but NOT eliminated — see the dated section below.

## 2026-06-26 (resumed session) — REC-2 income-raise fix + prod HSTS + privacy-doc accuracy (DECISIONS #118–119)

Picked up the actionable items from the 2026-06-26 handoff (the Plaid questionnaire is user-action). Shipped:
- **REC-2 (#118):** recurring INCOME raises no longer render as red "price increase" warnings — engine `!isIncome`
  at summary.ts (`priceIncreases`) + insights.ts (`findOpportunities`), and the per-row badge tone extracted to a
  pure `priceChangeBadge()` and unit-locked. Seed payroll is flat → golden-safe. New
  tests/unit/recurring-income-raise.test.ts (proven to fail without the fix).
- **HSTS + privacy doc (#119):** production-gated `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  (no preload) in next.config.ts, asserted in the phase4 e2e (prod build); PRIVACY.md rate-limiter line corrected to
  the durable DB-backed limiter (RateLimit table; export + per-IP/per-account auth throttle, STATUS #48) + CSP
  wording softened (Plaid origin allowlisted). NOT pushed — deploy + the 2-year HSTS commitment are the owner's call.

Hostile critic wf_1ba761ed (4 dims → adversarial verify): **0 P0 / 0 P1, 2 P2 (both FIXED)**. Gate:
`bash scripts/verify.sh` → ✅ GREEN (1140 unit / 93 files, +7 over baseline; typecheck/lint/build clean).

17. **E2E throughput flake reaffirmed (NOT a regression).** The changed surfaces pass every run (HSTS phase4:79;
    recurring:14/:20), but `phase2-triage:82` ("a full review session in <15 interactions") still times out under
    the OneDrive/SQLITE_BUSY contention of item #16. It is a CUMULATIVE-throughput test (~15 sequential accept→DB
    writes inside a 60s budget), so unlike a single-action flake it cannot be cleared by `--retries=2` (the shorter
    triage:29 did go flaky→pass). The page is untouched by this diff. Durable fix = the #16 item (e2e DB off the
    OneDrive-synced tree) or developing on a plain local disk per CLAUDE.md.
    **UPDATE 2026-06-27 (#120):** the e2e DB is now off the synced tree (+ WAL), but this did NOT eliminate the
    e2e flake — measured 3/5 full-suite runs green, and the failures were wall-clock timeouts of DIFFERENT correct
    tests run-to-run (phase2-triage throughput AND transactions register-search), not just one page. Root cause is
    broader than the DB: the `next start` server, the `.next` build, and the app files all still live on OneDrive,
    so its sync I/O contends with the server's synchronous better-sqlite3 round-trips. The COMPLETE e2e fix is the
    OTHER half of the #16 disjunction — relocate the whole working copy off OneDrive (CLAUDE.md), the owner's
    environment call. The e2e flakes are correct tests timing out under load, clearable by re-run, not code defects.

## 2026-06-27 (resumed) — Test/e2e DB relocated off the OneDrive tree (durable #16/#17 fix, DECISIONS #120)

Picked up the deferred durable fix for the SQLITE_BUSY flake class (the only un-gated engineering item left in the
handoff). The unit (vitest) and e2e (playwright) suites resolved DATABASE_URL to the repo-root `file:./dev.db`, under
OneDrive; the sync client's external OS locks on .db/-wal/-shm starved SQLite writers (masked as the SimpleFIN
"expected 0 to be 2"; aggravating the e2e phase2-triage throughput timeout). In-process mitigations (WAL,
busy_timeout, fileParallelism:false) can't wait out an external lock.

**Fix:** `tests/setup/test-db.ts` points the unit + e2e SQLite files at the OS temp dir (TEST_DB_DIR override,
mkdir'd; per-checkout hash so this OneDrive copy and the stale C:\dev copy don't share one file). vitest +
playwright configs set DATABASE_URL to it; both global-setups `db push` → WAL → `db seed` the off-tree file (e2e
WAL is set by a tsx child `scripts/set-sqlite-wal.ts` — the generated Prisma client is CJS and can't import into
Playwright's ESM config loader). Locked by `tests/unit/test-db-location.test.ts`. NO production surface (db-adapter
/ next.config untouched; `npm run dev` keeps the repo-root dev.db; prod = Postgres #35); nothing ships in the bundle.

**Outcome (honest):** the UNIT SQLITE_BUSY flake is FIXED — core `bash scripts/verify.sh` GREEN and FAST across
many runs (1142 unit / 94 files, +2 regression tests). The e2e suite is improved (DB off-tree + WAL) but STILL
flakes ~2/5 under load — the residual cause is the whole working tree on OneDrive (server/.next/app I/O), not the
DB. Documented at #16/#17; complete fix = relocate the working copy.

**Hostile critic** wf_d9503a9a (4 dims → adversarial verify): **0 P0 / 0 P1, 10 P2.** Applied 5: location test
honors TEST_DB_DIR (else the documented /dev/shm CI example would go red); mkdir the TEST_DB_DIR; per-checkout
hashed filename; accurate re-seed wording (RateLimit isn't wiped but its tests are key-isolated); documented the
reuseExistingServer/port-3100 assumption. Accepted P2s: same-checkout CONCURRENT runs (vitest --watch + verify)
still share a file (set TEST_DB_DIR); a server squatting on 3100 started from the repo would bypass the relocation
(verify 3100 free; CI spawns fresh).

## 2026-06-27 (resumed) — working tree relocated off OneDrive → C:\dev\Aimplifi (completes the #16/#17 e2e half) + transactions:145 hardened

The owner approved the #16/#17 COMPLETE fix (relocate the whole working copy off the synced tree). Done
non-destructively: robocopy'd the active checkout → `C:\dev\Aimplifi` (excluding regenerable node_modules/.next/
.codegraph + test artifacts; INCLUDING .git with the unpushed commits + all secrets .env*/keys/dev.db), then a fresh
`npm ci` (788 pkgs + prisma generate) on local disk. The OneDrive copy is retained as a reversible fallback.

**Measured at the new location:** core `verify.sh` GREEN (1142 unit/94 files); `VERIFY_E2E=1` full suite **54/54**.
The #16 e2e residual (phase2-triage:82 throughput timeout that no in-tree mitigation could clear) now runs in
14-24s and passed on EVERY run — confirming #120's finding that the residual was whole-tree OneDrive sync I/O
contention. Items #16/#17 are RESOLVED for the new checkout (the OneDrive copy is abandoned, not repaired).

**transactions:145 (inline recat) latent race — FIXED** (DECISIONS #121, REGRESSION_LEDGER 2026-06-27): the positive
assert matched the in-flight 'File as Groceries?' confirm prompt on the whole row → passed before persistence, so the
negative `not.toContainText('Dining Out')` raced `router.refresh()` on a 5s budget. App verified correct; the
assertion now targets the category-chip with a 20s budget on both sides. **4/4 consecutive full-suite runs green
post-fix.**

**Process caveat:** future sessions MUST run from `C:\dev\Aimplifi`; if work happens in the OneDrive copy out of
habit, the two repos diverge. CLAUDE.md's canonical-path note is updated to prevent this.
