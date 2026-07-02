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

## Post-Phase-5 refinement: Plan in Words — debt-free-by-date (DECISIONS #125)

The first AI-differentiation build from `docs/AI_DIFFERENTIATION_PLAN.md` §5 (owner-chosen):
an INVERSE debt planner. State a goal date and the app SOLVES the tested debt engine for
the minimal extra/mo, with honest feasibility. New pure `engine/solve/debt-free-by-date.ts`
`solveDebtFreeByDate` bisects the monotone `planDebtPayoff` (the shipped `coastFI` idiom —
no new debt math); the answer is a share of real `getSpendingPlan` safe-to-spend. New Ask
intent `debt_free_by_date` (a deterministic `parseTargetDate` owns date extraction zero-key;
the LLM, if it routes here, supplies only the kind). "Confirm & save as goal" via
`saveDebtFreeGoal` re-solves server-side (never trusts a client number) and tags
`Goal.kind='debt_free'` (new nullable column) so /goals renders it with the solver's date,
not the savings-goal timeline. Engine-first; the LLM never originates a number or a date.

Gate (real output 2026-06-28): `bash scripts/verify.sh` core → **✅ VERIFY GREEN** —
typecheck/lint clean, **1281 unit / 102 files**, build clean. Full `VERIFY_E2E=1`: **55/57
passed** (+1 new debt-free-by-date e2e), with the ONE documented `phase2-triage:82`
throughput flake (triage-accept button stuck `disabled` mid-write → 60s `locator.click`
timeout) — an untouched page, machine saturated by this session's heavy runs; identical
symptom to STATUS #16/#17 + DECISIONS #88/#99/#120/#121; confirmed it on isolated rerun, NOT
a regression. All changed surfaces pass every run: ask.spec **6/6** (incl. the new inverse-
planner flow + axe AA), phase4-features goals + phase5-a11y goals green (the debt-aware
goals card did not regress the savings-goal renderer).

Hostile critic (wf_8faca37d, 5 dimension critics + adversarial verification): all dims 7/10,
**0 P0, 3 confirmed P1 — ALL FIXED + regression-locked**, then a confirmation cycle
(wf_ab686016) re-verified the fixes:
- **P1 goal render/drift** — the saved goal rendered via the generic savings card (flat
  `remaining/extra` ETA contradicting the solver, "moves your FI date back" framing,
  `targetDate` never shown, on-track→$0→"add a contribution") → debt-aware `Goal.kind` card
  showing the date + the suggested extra (or "on track … no extra needed"), bypassing
  `goalFIImpact`; savings goals render unchanged.
- **P1 parse misroute** — a month mentioned in passing + "by `<year>`" ("…loan in March …
  debt-free by 2028") parsed to March 2028 → the bare-year deadline is now resolved BEFORE
  the month loop and the global "any year in the string" fallback dropped (adjacent-year
  only); "by December 2027" still resolves correctly. Regression-locked.
- **P1 overspent fake-yes** — safe-to-spend ≤ 0 returns `withinSafeToSpend:null`, and the
  formatter's `=== false` check skipped the warning → an honest "budget you don't have yet"
  branch for the overspent cohort (real figure shown, no fake affordable framing).

P2s fixed: `hi` grows past one month's interest (no false "unreachable" at pathological APR),
de-doubled the over-budget clause, past-date copy ("already behind us"), Save button disabled
while a question is in flight + kept mounted on save (focus preserved, no nested `role=status`),
"in N → end of month", "by next/this month" + "done with my debt" routing, and new tests
(non-divisible share rounding, snowball + tighter monotonicity, high-APR reachable, overspent
formatter, non-zero server re-solve). Accepted P2s (documented): a bare credit-card question
stays `cash_needed` even with a date (DECISIONS #98 convention, pinned); the /goals debt-card
render + Save success/error states are display-layer, covered by inspection (the save
persistence is integration-tested; can't e2e without mutating the shared demo's goals).

## Post-Phase-5 refinement: Plan in Words — savings-goal-by-date (DECISIONS #126)

The second AI-differentiation slice (after #125's debt-free-by-date): state an amount + a
date ("save $20,000 by December 2028") and the app SOLVES for the minimal monthly
contribution, with honest feasibility (share of safe-to-spend, within-budget flag). New pure
`engine/solve/savings-goal-by-date.ts` `solveSavingsGoalByDate` — funding is LINEAR (no
investment growth; closed-form `ceil(remaining/targetMonths)`, NOT a bisection, because
savings doesn't amortize). The funding-months formula is extracted to one shared
`goals.ts::goalFundingMonths` used by BOTH the solver and the /goals `goalFIImpact` card, so a
saved goal renders a byte-identical timeline (the #125 card-vs-solver P1 designed out — no new
`Goal.kind` needed). The user-stated AMOUNT is extracted deterministically by a new
`parseTargetAmount` (the LLM supplies only the kind; the amount/date are re-derived in code);
a date with no amount → an "ask for the amount" answer. `saveSavingsGoal` re-solves the monthly
server-side (the client passes only the stated amount + date; the contribution is never trusted).

Gate (real, measured 2026-06-28): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint/build clean, **1328 unit / 105 files** (+46). ask.spec e2e **7/7** (new
savings-by-date flow + axe WCAG-AA + debt sibling no-regression).

Hostile critic (wf_3de855be, 5 dims → adversarial verify): **0 refuted; 1 P0 + 1 P1 confirmed,
both FIXED + regression-locked**, then a confirmation critic (wf_99a99d0d) re-verified the fixes:
- **P0 (parseTargetAmount truncation):** an ungrouped 4+ digit `$` amount truncated to its first
  3 digits — "$20000"→$200 (regex alternation matched the first branch without backtracking), a
  100×-wrong figure persisted on Save → fixed by requiring ≥1 comma-group (`+` not `*`).
  REGRESSION_LEDGER 2026-06-28.
- **P1 (canonical phrasing missed):** "have $X **saved** by <date>" routed to unknown because
  `saveVerb` didn't match the past participle → added "saved".
- **3 P2 mis-routes FIXED:** past/status review poached into the "ask" path; a per-period RATE
  ("$500 a month") misread as the lump total; a comma-grouped NON-money quantity ("10,000 steps")
  read as $10,000.
- **Confirmation round caught my P2 guards OVER-blocking** (the broad rate/past guards blocked
  the feature's own canonical demo-mode ask "how much per month to save $20,000 by 2027", and
  amount-bearing forward goals) → fixed by making the rate-guard PRECISE (a rate only when a
  period cue is adjacent to a dollar figure) and applying the past guard ONLY to the amount-free
  path; locked + an 18-case routing probe (real output) green.

Accepted P2s (documented, by design):
1. **Two-amount sentences pick the leftmost amount** — "I have $20,000 saved, goal of $50,000 by
   2028" plans for the stated $20,000, not the $50,000 goal (`parseTargetAmount` returns the
   leftmost match). It is a *mis-role of a number the user actually typed* (surfaced in the
   answer), NOT a fabrication, and needs an uncommon two-amount phrasing; full disambiguation is
   deferred. The save path re-solves the (mis-roled-but-user-stated) amount, so no app-originated
   figure is ever persisted.
2. **A contrived income question embedding "saving $X by <year>"** can be poached by the savings
   block (it sits before the income intent). Low likelihood; `savings_rate` (the common collision)
   is correctly NOT poached.
3. The /goals savings-card target-date line + the Ask "Save as a goal" success/error states are
   display-layer, covered by inspection (save persistence is integration-tested; can't e2e
   without mutating the shared demo's goals).

NOTE (env, not a code defect): an e2e `phase4-features.spec.ts:32` ("goals: creating a goal")
failed repeatedly in this session's degraded environment — but it fails IDENTICALLY at baseline
HEAD with a clean rebuild (proven by stash + rebuild), the delete persists to the DB correctly
(verified), and `router.refresh()` simply isn't dropping the card here even at a 20s budget. It
passed in #124 (56/56) and #125. This is the documented OneDrive/long-session e2e-flake class
(STATUS #16/#17), on a page this feature does not touch; NOT a regression from #126.

## Live provider ingest — contract audit + first fixes (DECISIONS #127)

**Framing correction (important).** The owner runs the app in PRODUCTION with REAL aggregator
credentials: Plaid is on `PLAID_ENV=production` (Vercel env) and SimpleFIN Bridge has all their
accounts linked (the encrypted access URL lives in the `SimpleFinConnection` DB row, by design —
DECISIONS #56 — so there is no SimpleFIN env var). The repeated "Plaid/SimpleFIN live path is
UNVERIFIED (no token in env)" notes elsewhere in this doc and in the mapper headers describe the
CI/TEST SUITE (which has no creds and runs against mocks), NOT the owner's deployment. Those paths
DO run on real money data every sync. The mappers' ledger math is unit/mock-tested; what CI never
exercised is the live socket + the providers' real field shapes — which the owner's accounts now do.

Because real data flows through code written against mocks, ran an adversarial CONTRACT AUDIT
(wf_6eade83c, 5 reviewers vs the official Plaid/SimpleFIN response schemas → adversarial verify of
every P0/P1). Result: **1 P0 (downgraded P1 on verify) + 10 P1 + 9 P2 confirmed.**

**FIXED now (DECISIONS #127, two clusters, hand-verified + regression-locked):**
- **SimpleFIN balance SIGN + TYPE (audit #1/#2/#8/#9):** `mapSimplefinAccount` did `Math.abs(balance)`
  on every account, so an OVERDRAWN deposit account was stored as a positive ASSET (net-worth sign
  inverted), and a keyword-less liability (HELOC, a loan under a servicer name, a no-keyword card like
  "Active Cash") defaulted to CHECKING and only the negative-balance rescue saved it — so a
  positive-principal loan booked as an asset. Fix: store the SIGNED balance for assets (overdraft
  stays negative) and `|amount owed|` for liabilities (SimpleFIN gives NO liability sign convention —
  a card may report owed-negative, a loan positive-principal — so the magnitude is the robust owed
  value); broadened `inferAccountType` with no-keyword card products + a non-card-liability branch
  (heloc/home-equity/line-of-credit/servicers) checked BEFORE the generic "credit" rule. Net-worth
  contribution hand-verified per case in `tests/unit/simplefin-map.test.ts`. KNOWN EDGE (documented in
  code): a genuine OVERPAID card credit balance is indistinguishable from owed-reported-positive, so
  it's treated as a small owed amount (rare).
- **Plaid APR (audit #7):** `aprs[]` was never mapped, so EVERY live Plaid card carried `aprBps`
  null/0 → the debt-payoff + cash-needed engines computed ZERO interest on real cards (corrupting the
  just-shipped debt-free-by-date + cash-needed figures). Fix: new pure `pickPlaidAprBps` (purchase APR
  → bps, fallback highest non-special, integer-rounded ×100 so no float drift) wired into the
  `/liabilities/get` loop to set `Account.aprBps` (even when no statement has generated yet). Locked by
  `tests/unit/plaid-map.test.ts`. (SimpleFIN has no APR field in its protocol, so SimpleFIN cards keep
  a user-entered/blank rate — expected.)

**TRACKED backlog (confirmed real, NOT yet fixed — prioritized for follow-up increments):**
1. **(P1, audit #4) SimpleFIN pending never reconciled** — ✅ **DONE (DECISIONS #128, 2026-06-28)** — see
   the dedicated section directly below. A pending that never posts lingered forever, and a
   pending→posted `id` change double-counted. Fixed with a two-pass `reconcilePendingTransactions`
   (in-window absence reconcile + an age-out backstop).
2. **(P1, audit #5) SimpleFIN holdings per-share round-trip** — ✅ **DONE (DECISIONS #129, 2026-06-28)**.
   Persisted the feed's authoritative TOTAL as a new nullable `Holding.marketValueCents`; `valuePosition`
   uses it verbatim when present, else derives round(qty×price). A penny lot no longer renders $0; the VOO
   −1¢ drift is gone. Net worth untouched (only the /investments breakdown). Hostile critic: 1 P1 FIXED —
   the new Int column is Postgres 32-bit ($21.4M/position ceiling); an over-ceiling total would overflow +
   be silently swallowed by the reconcile catch → mapper now bounds every persisted cents value to
   MAX_DB_CENTS (skip+count, not silent vanish). 3 P2 FIXED (engine self-validation; "≈" approximate
   per-share display; softened addHolding comment). **Residual / accepted (documented):** a single position
   over $21,474,836.47 is skipped+counted (out of model scope; widening these total columns to BigInt is the
   follow-up if such positions come into scope — the cost-basis column has always had the same Int ceiling).
   A hand-edited fed symbol keeps `source='simplefin'` so a later sync may re-ingest it (pre-existing #124).
3. **(P1, audit #6) Plaid investment/loan balances freeze at link time** — only refreshed on link, not
   on sync, so net worth goes stale. Fix: call `syncAccountsForItem` (or `/accounts/balance/get`) each
   sync.
4. **(P1, audit #3/#10) Currency never read** (both providers) — a non-USD or zero-decimal (JPY/KRW)
   balance is summed into net worth at a fake 1:1 / 100×-off rate. Almost certainly N/A for a US-only
   user, but unguarded. Fix: read `currency`/`iso_currency_code`; exclude-or-FX non-USD at the
   net-worth boundary (a withheld figure beats a silently wrong one).
5. **P2s (9):** epoch→date UTC-day-boundary (evening txn can land a day off); SimpleFIN symbol regex
   drops options/crypto/slash share-class tickers; all-unmappable-holdings → `[]` is treated as
   "sold everything" and deletes synced rows; Plaid null `balances.current`→0; Plaid
   `last_statement_balance` run through abs() (a statement CREDIT flips to owed); Plaid null
   `minimum_payment_amount`→$0 (worse than the estimate path); Plaid `liabilities.mortgage[]` /
   `student[]` dropped (only `credit[]` read). Each carries a suggested fix in the audit output.

Recommendation: tackle the backlog in small, individually-verified increments (each its own DECISIONS
entry + regression test), highest-money-impact first (pending reconcile, then holdings total, then the
Plaid balance refresh), rather than one large risky change.

## SimpleFIN pending reconcile — backlog #4 DONE ✅ (DECISIONS #128)

Closed the highest-money-impact live-ingest backlog item. `reconcilePendingTransactions` runs after the
Pass-2 transaction upsert in `syncFromSimplefin`, in two passes: (1) IN-WINDOW — per account synced this
run, delete feed-owned PENDING rows (date >= startDate) the snapshot no longer reports; (2) AGE-OUT —
delete feed-owned PENDING on the user's SimpleFIN accounts older than `PENDING_MAX_AGE_DAYS = 32`,
excluding anything the current snapshot still reports as pending. Kills both #127-audit failure modes: a
pending that never posts (lingered, overstated the cash-needed sum) and a pending re-posting under a new
id (double-count). Safety rails on the deleteMany: `status:'PENDING'` (POSTED never touched),
`providerRef:{not:null}` (manual/seed rows never touched), `isSplitParent:false` (no orphaned split),
passes date-disjoint. Golden-safe (demo never connects SimpleFIN; `SyncResult.removed` has no UI consumer).

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1343 unit / 106 files** (+11
known-answer, proven fail-before/pass-after), typecheck/lint/build clean. Hostile critic wf_35ef0562 (3
dims + adversarial verify): 0 refuted, **2 P1 confirmed + FIXED** (age-out for aged-pending drift past the
fetch window; `!acct.transactions` null guard replacing a `=== undefined` regression that let
`transactions: null` abort the whole sync), each regression-locked.

Accepted residuals (P2, documented in code + DECISIONS #128):
- A multi-day hold that drifts past the 5-day overlap then re-posts under a NEW id can briefly double-count
  until it ages out (≤ 32 days, self-healing). Eliminating it needs a wider per-sync fetch window, which
  would expand the existing re-sync re-categorization churn + bandwidth for a rare, self-correcting case.
- An account entirely ABSENT from a sync response isn't in-window-reconciled (its aged pendings are still
  swept by the age-out pass).
- The delete can orphan a Correction / CategoryPrediction analytics-log row (linked by id-string, no FK) —
  harmless and consistent with the Plaid `removed[]` path.

REMAINING live-ingest backlog: ~~**#5** SimpleFIN holdings per-share round-trip~~ ✅ DONE (DECISIONS #129);
~~**#6** Plaid investment/loan balance refresh each sync~~ ✅ DONE (DECISIONS #130); plus the currency
(#3/#10) + 9 P2 items from the #127 audit.

## Plaid per-sync balance refresh — backlog #6 DONE ✅ (DECISIONS #130)

Closed the last named live-ingest P1 from the #127 audit. `PlaidProvider.syncTransactions` refreshed an
account's balance only when `/transactions/sync` echoed it in its `accounts` array — i.e. depository/credit
accounts with transaction activity. INVESTMENT and LOAN accounts carry no Transactions product, so they were
re-fetched ONLY at link (`exchangePublicToken` → `syncAccountsForItem`) and their `currentBalanceCents` —
hence the owner's net worth — froze afterward. Fix: call the already-tested `syncAccountsForItem`
(`/accounts/get`, which returns EVERY account on the item) once per item at the start of each sync, before
the cursor loop; the loop's `page.accounts` echo still wins (fresher-or-equal) for active accounts.
Best-effort + audited (`plaid.accounts.refresh.failed`) so a refresh failure never blocks transaction ingest.
Reuses `/accounts/get` (cached, no per-call fee) over the billable real-time `/accounts/balance/get`, as the
audit recommended. Golden-safe (the demo never uses PlaidProvider). This also adds the FIRST mocked-server
integration test of the Plaid network orchestration; the live socket stays UNVERIFIED, consistent with the
existing labeling.

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1369 unit / 107 files** (+5 across one
new file, proven fail-before/pass-after), typecheck/lint/build clean. No e2e surface (server-only sync; the
demo never connects Plaid → the mocked-server integration is the labeled end-to-end, per #124/#128/#129).

Hostile critic wf_25be9884 (3 lenses + adversarial verify): **0 P0, 1 P1 confirmed + FIXED + regression-locked.**
The P1: now that investment/loan balances refresh every sync, a `/accounts/get` reporting a null
`balances.current` (documented-nullable) ran through the mapper's `?? 0` and would OVERWRITE a real balance
with $0 — silently cratering net worth until a later non-null sync self-heals. Fix = map a null `current` →
null (UNKNOWN, not 0) and OMIT `currentBalanceCents` from the UPDATE data when null so Prisma preserves the
last-known-good value (CREATE falls back to 0 — no prior to preserve); fixing it in the shared
`upsertPlaidAccounts` ALSO closes the same pre-existing hole on the depository/credit echo path. Independent
confirmation checker: SHIP, 0 P0/P1 (and confirmed the fix is robust to either `/accounts/get` or the
`/transactions/sync` echo writing null — last-writer preserves).

Accepted residuals (P2, documented in DECISIONS #130):
- Per-sync audit-log noise: a `plaid.account.skipped` row each sync for a permanently-unmappable account, and
  double rows (`refresh.failed` + `item.sync.failed`) on a full item outage — cosmetic, zero ledger/net-worth
  impact.
- The access token is decrypted twice + the item re-fetched per item per sync (the sync loop has the token,
  but `syncAccountsForItem` re-derives it) — negligible at hourly cadence; kept surgical rather than widen the
  method signature.
- `availableBalanceCents`/`creditLimitCents` still write through a null value (both nullable by design and
  non-net-worth; null is a legitimate state for them, unlike `current` where a balance always exists).

## 2026-06-29 — Plan-in-Words slice 3: retire-at-age inverse planner (DECISIONS #131)

The final Plan-in-Words slice (after debt #125 + savings #126), completing the owner-sequenced trilogy. "Can I
retire at 60?" → `solveRetireAtAge` bisects the boolean `projectRetirement(...).outcome==='sustained'` (the #122
decumulation engine, via the same `buildRetirementInputs` the /investments outlook uses — no new compounding math)
for the minimal monthly contribution that makes the portfolio last, framed as an honest share of real safe-to-spend.
Grounded: every figure from `getCoachData.fi` + the User planning dials (?? the documented defaults) + `getSpendingPlan`;
the LLM supplies only the intent kind, the age is deterministic (`parseTargetAge`). "Save as my plan" persists the age
to the existing `User.retirementAge` dial (not a flat Goal, which would contradict the compounding engine). Read-only
Ask path + demo planning columns null → byte-identical to #122/#123 (golden-safe). Hostile critic wf_c5d22775 (4 dims +
adversarial verify): **0 P0 / 0 P1**; 1 P1 candidate downgraded to P2 + 2 more P2 all FIXED + regression-locked
(inflection coverage "retiring"/"retired"; the age==endAge answer-vs-save inconsistency; "saving"→"savings"). Gate:
`bash scripts/verify.sh` → ✅ VERIFY GREEN (1409 unit/110 files, +40; typecheck/lint/build clean); ask.spec e2e 8/8 incl.
the new retire-at-age flow + axe AA.

Accepted P2 (documented, by design):
- **The solver fails LOUD on a structurally-invalid PLANNING age** (currentAge ≥ endAge, non-integer, out of [0,120]) —
  those reach `projectRetirement` and throw, rather than returning a clean `unreachable`. The solver only guards the
  USER-facing `targetAge` (age-in-past / age-after-end / cannot-sustain); the planning ages are always app-validated
  (User columns through the dials validator, or the documented defaults), so this throw is unreachable from the app and
  fail-loud on a programming error is correct (matches the #122 / STATUS #13 API-consumer precedent).
- **E2E throughput flake reaffirmed (NOT a regression).** The phase's own e2e (ask.spec, all 8 incl. retire-at-age,
  `:107` ✓ 6.6s) passes reliably, but a full-suite run during this heavy session failed `phase2-triage:82` (the
  ~15-sequential-accept-in-60s throughput test) with the documented symptom — the triage accept/`rule-always` button
  stuck `disabled` mid-write → `locator.click` timeout, under SQLite single-writer contention. It reproduced in
  isolation too because the machine was still write-saturated from this session's many back-to-back verify/critic/e2e
  runs (the #122/#123 finding: re-running only worsens it). The page is UNTOUCHED by #131 (retire-at-age → /coach is a
  one-way edge; zero triage/transaction/provider code in the diff). Same class as STATUS #16/#17, DECISIONS
  #88/#99/#120/#121/#122/#123 — clears on a settled machine, not a code defect.

## 2026-06-29 — Plaid credit-liability statement-field correctness (DECISIONS #132, live-ingest backlog)

Resumed on "continue" with the Plan-in-Words trilogy (debt #125 / savings #126 / retire-at-age #131)
complete + deployed; owner chose the LIVE-MONEY CORRECTNESS backlog over the next feature (Cash Flow
Radar). Picked up the highest-money-impact remaining items from the #127 live-ingest audit — both in the
Plaid credit-liability → statement mapper, both corrupting the cash-needed headline on the owner's REAL
connected Plaid cards:
- **abs() flip:** `mapPlaidLiabilityToStatement` mapped `last_statement_balance` through
  `plaidDollarsToPositiveCents` (abs), so a statement CREDIT / overpayment (negative balance) flipped to
  an amount OWED → a card the holder overpaid would DEMAND cash it doesn't owe. Fix: sign-preserving
  `plaidSignedDollarsToCents`; the engine's `floorAtZero` then yields a correct $0 obligation.
- **null/zero minimum → $0:** a null (or literal 0) `minimum_payment_amount` collapsed to a $0 minimum,
  understating the MINIMUM-path cash needed below the engine's own no-statement estimate. Fix: when no
  usable (>0) minimum is reported on a positive balance, mirror the engine's exact estimate by reusing a
  now-exported `estimateMinimumPayment` (max $35 / 1% of balance) — one definition, no drift.

Golden-safe by construction (common positive-balance + provided-positive-min path byte-identical; demo
never connects Plaid). Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/
build clean, **1417 unit / 110 files** (+8, proven fail-before/pass-after). No e2e surface (server-only
mapper; the labeled unit + mapper→cash-needed ENGINE end-to-end is the coverage, per #124/#128/#129/#130).

Hostile critic wf_edd3d8f3 (4 dimension critics → adversarial verification of every P0/P1): **0 P0 / 0 P1.**
Two P2s FIXED + regression-locked: (a) a PROVIDED 0 (or sub-cent) minimum on a positive balance reproduced
the same understatement → a "usable" minimum is now >0 (a reported ≤0 falls through to the estimate); (b)
the $0 guarantee for CONTRADICTORY feed data (a credit balance reported with a positive minimum) was
unpinned → pinned with a mapper known-answer + a mapper→computeCashNeeded e2e under both scenarios.

ACCEPTED/DEFERRED P2 (documented): an estimated minimum is presented with `isEstimated:false` and no
per-card "minimum estimated" disclosure. Honoring the cardinal "assumptions inline" rule here would need a
PERSISTED `Statement.minimumIsEstimated` column threaded through the sacred cash-needed engine + types
(the assemble layer reads stored Statement rows and cannot re-derive whether a minimum was synthesized) —
disproportionate to the rare trigger (Plaid omitting the minimum on a card that HAS a generated statement).
The estimate is conservative and equals the engine's own no-statement formula; in the MINIMUM scenario it
only ever errs toward funding more (paying ≥ an estimated minimum is always safe).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): the currency guard (audit #3/#10,
likely N/A for a US-only user but unguarded) + the rest of the audit's P2 cluster — Plaid
`liabilities.mortgage[]`/`student[]` dropped (only `credit[]` read), all-unmappable-holdings `[]` treated
as "sold everything" (deletes synced rows), epoch→date UTC-day-boundary, SimpleFIN symbol regex dropping
options/crypto/slash tickers. Tackle in small individually-verified increments, highest-money-impact first.

## 2026-06-29 — SimpleFIN all-unmappable-holdings data-loss guard (DECISIONS #133, live-ingest backlog)

Second live-money backlog increment this session (after #132). Closed the #127 audit P2 where a SimpleFIN
sync could WIPE the owner's synced /investments breakdown. `syncFromSimplefin`'s INVESTMENT branch
reconciled holdings whenever `acct.holdings !== undefined`; since `mapSimplefinHoldings` skips un-mappable
positions, a NON-EMPTY feed whose positions ALL fail to map returned `holdings:[]`, and the reconcile's
empty-set branch (`deleteMany({accountId, source:'simplefin'})`) deleted every synced row — mistaking a
format glitch / all-unsupported-types feed for a sell-all.

Fix: reconcile only when `holdings.length > 0 || acct.holdings.length === 0` (positions to write, OR an
EXPLICITLY empty feed = a genuine sell-all); a non-empty feed mapping to zero leaves existing rows intact
(counted as skipped) and self-heals on the next sync that maps any position — the same conservative stance
as the OMITTED-field guard (#124 P2). NET WORTH UNAFFECTED (account.currentBalanceCents stays authoritative;
holdings are a within-account breakdown). GOLDEN-SAFE (demo never connects SimpleFIN).

Hostile critic wf_8a9d99dc (2 dims → adversarial verify; one dim hit a mid-response API error, the other
returned the finding): **0 P0 / 0 P1**; **1 P2 FIXED + regression-locked** — the outer guard tested
`!== undefined`, so an untrusted feed sending `holdings: null` (not omitted) reached `mapSimplefinHoldings(null)`
→ "null is not iterable" → ABORTED the whole sync (the `transactions: null` failure class fixed in #128),
and a `holdings: ""` would even wipe via `.length`. Changed the guard to `Array.isArray(acct.holdings)` so
undefined/null/any-non-array all route to "leave rows intact".

Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/build clean, **1419 unit /
110 files** (+2, proven fail-before/pass-after). No e2e surface (server-only sync; the mocked-server
integration is the labeled end-to-end, per #124/#128/#129/#130).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): Plaid `liabilities.mortgage[]`/`student[]`
dropped (only `credit[]` read — these loans get no statement/due-date in cash-needed/calendar; net worth is
correct via the account balance) — the biggest remaining item, needs a small design call on how loan due
dates surface; currency guard (audit #3/#10, likely N/A for a US-only user); epoch→date UTC-day-boundary;
SimpleFIN symbol regex dropping options/crypto/slash tickers (coupled to the addHolding ticker rule, so a
wider change). Tackle in small individually-verified increments.

---

## #134 — Plaid mortgage/student loans → calendar + reminders (2026-06-30)

Biggest remaining #127 live-ingest item, SHIPPED (owner picked the surface = "Calendar + reminders", NOT the
cash-needed dollar headline). `syncLiabilities` now ingests `liabilities.mortgage[]`/`student[]` → populates
each loan Account's aprBps + minimumPaymentCents + dueDayOfMonth (preserve-on-null #130; mortgage subtype →
MORTGAGE, excluded from the snowball; student/other → LOAN). A new pure `selectLoanObligations` engine
surfaces the next loan payment on the calendar (`loan-due` event) + reminders ONLY — the cash-needed engine is
untouched. Seed `sched-autoloan` stand-in removed (loan now first-class). Gate: VERIFY GREEN, 1444→ unit /
113 files; e2e calendar/reminders/a11y 15/15 clean.

Hostile critic wf_d388bf4b (3 lenses → adversarial verify): **0 confirmed P0/P1.** 2 mapper money-bugs FIXED
+ regression-locked: (F1) `> 0` checked on the PRE-rounded value, so a sub-cent payment / sub-bps rate wrote a
fabricated 0 (zeroing a stored value) → now round-FIRST then `> 0`; (F2) a huge finite payment threw via
cents()'s safe-integer assert (aborting the item's whole liability sweep) despite the "non-throwing" comment →
now magnitude-bounded to the Postgres Int ceiling BEFORE rounding, returns null.

### KNOWN LIMITATIONS / NEXT (owner-gated de-dup design)
A loan payment is representable two ways — a recurring-detected/scheduled cash outflow (existing) AND the new
loan-due obligation — and #134 does not de-duplicate between them. Two consequences, both documented, neither a
confirmed P0/P1:
1. **Demo /forecast inconsistency:** `getCashFlowForecast` reads `snap.scheduled`; removing `sched-autoloan`
   dropped the demo's only scheduled loan row, so the demo forecast over-projects checking by $385/mo and is
   inconsistent with its own calendar/reminders (which DO show the loan). Real users are unaffected here (their
   loan ACH is still recurring-detected into `snap.scheduled`). Negligible ($385 on $340k) but a visible demo
   gap.
2. **Real-user calendar double-display (narrow):** a connected MORTGAGE/STUDENT loan whose monthly payment is
   ALSO recurring-detected as a NON-transfer checking outflow would show twice on the calendar (recurring
   outflow + loan-due) and double-count in totalOut. Does NOT affect an AUTO loan (not a Plaid liability → no
   loan-due) nor a payment categorized as a transfer (recurring detection skips it, detect.ts:85).
3. **Reported-$0 payment preserve (F1a, accepted):** a forbearance/IDR loan reporting `minimum_payment_amount:0`
   is treated like "not reported" (preserve prior), conservatively matching #132 — a later increment could read
   `loan_status` to clear a genuinely-$0 obligation.

NEXT (owner-gated): decide the CANONICAL loan source and de-duplicate — e.g. exclude loan-categorized
recurring/scheduled rows from the calendar+forecast when a loanObligation exists for that loan, OR feed
loanObligations into the forecast and suppress the recurring row. Requires threading a loan-account link or
categoryId through the scheduled pipeline; a focused follow-up, not bolted onto this increment.

## 2026-06-30 — Currency guard: withhold non-USD accounts (DECISIONS #135, live-ingest audit #3/#10)

Closed the #127 live-ingest "currency never read" item. The app does no FX, so a non-USD feed
balance was summed into net worth at a fabricated 1:1. Persisted a nullable `Account.currency`
(null = legacy/demo/manual = assumed USD → golden-safe) set by both mappers; withhold non-USD
accounts AND all their child rows at every account-scoped read (snapshot accounts/transactions/
scheduled/snapshots; getAccountsView; getInvestments; register; triage; /budgets; the recurring
refresh; and all ~15 first-run empty-state gates). Pure `src/lib/providers/currency.ts`
(`canonicalizeCurrency`/`resolvePlaidCurrency`/`isSupportedCurrency`); the DB reads mirror it as
`OR:[{currency:null},{currency:'USD'}]`.

**Two hostile-critic cycles.** Cycle 1 (wf_74fc0808, 4 dims → adversarial verify): **4 P1 bypasses
+ 1 P2, all FIXED + regression-locked** — getInvestments roll-up (P1-A); the count-gates-vs-snapshot
invariant break → all-non-USD user throws + export 500 (P1-B); the transaction leak into
reports/trends/coach/register (P1-C ×2); and `resolvePlaidCurrency('','BTC')` failing open (P2).
Confirmation (wf_bda5c45a, 3 lenses): 2 lenses fixes-hold, the completeness lens found **2 more
direct transaction reads of the same class — `/budgets` spend + `refreshRecurringForUser` — both
FIXED + locked** (a foreign subscription would otherwise persist a scheduled row on the USD payment
account at 1:1). Gate (real 2026-06-30): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1465 unit /
115 files** (+21), typecheck/lint/build clean.

### Accepted / deferred P2 residuals (documented, by design or follow-up)
18. **No excluded-account disclosure.** A withheld non-USD account vanishes from /accounts + the net
    worth headline with no "N accounts excluded — no FX yet" note; for a LIABILITY the withhold
    flatters net worth ("a withheld figure beats a silently wrong one" — but the direction is
    optimistic). **Highest-value follow-up:** a disclosure banner on the dashboard + /accounts.
19. **Cosmetic non-figure surfaces still touch foreign rows:** the transactions-CSV export lists a
    foreign account's rows (faithful raw dump, no summed figure); the account pickers (settings
    payment-account selector, /transactions/new, /transactions/import) may list a non-USD account
    (a foreign payment-account choice falls back to a USD account); the categorization backfill +
    the settings transaction-COUNT still process foreign rows. None is a wrong money figure.
20. **SimpleFIN HOLDING-level currency unread.** The guard is account-level; a non-USD position
    inside a SUPPORTED (USD) brokerage rolls into the /investments breakdown at 1:1. Net worth uses
    the authoritative account balance, so bounded to the breakdown; a deeper follow-up.
21. **Numeric ISO codes withheld, not mapped** (e.g. '840'=USD) — fail-safe; neither Plaid nor
    SimpleFIN emits numeric codes.
22. **All-non-USD user is a fail-SAFE edge** (unreachable for the invite-only US base; every real
    user has ≥1 USD account). The gates now render EmptyDashboard for it; the remaining pages that
    don't throw render zero-data safely.

REMAINING #127 live-ingest backlog: SimpleFIN symbol regex (options/crypto/slash tickers, coupled to
the addHolding ticker rule) + epoch→date UTC-day-boundary — both P2, lower money-impact.

## 2026-07-01 — Triage write-in custom categories (DECISIONS #136, owner request #1)
Shipped increment 1 of the owner's sweep: "+ New category" in the triage picker (create + file in one
step) and the LIVE manual-entry custom-id bug fix. Hostile critic wf_e4584600: 2 confirmed P1 FIXED +
e2e-locked (error-boundary escape on a rejected create; stale open form crossing cards via batch/undo);
4 P2 fixed (overlay prune, IME Enter guard, name normalization parity, Escape). **0 open P0/P1.**

Accepted P2 residuals:
1. PRE-EXISTING: applyCategory creates its Correction row before the FK-guarded transaction update,
   non-atomically — a deleteCustomCategory race can orphan a Correction string ref (delete already
   remaps corrections; window is milliseconds; same class as the deferred alreadyUndone TOCTOU).
2. Partial-success recovery: if the create succeeds but the filing fails, retrying via the form shows
   "You already have a category with that name" — the category IS in every picker (discoverable path);
   custom copy plumbing for a rare double-failure judged disproportionate.
3. Focus is not restored to a specific control when the mini-form closes (axe AA passes).
4. The Settings manager has the same IME Enter-composition gap (pre-existing, same class as the
   triage one fixed here).

**ENVIRONMENTAL ESCALATION of #16/#17 (evidence-backed):** the phase2-triage full-review throughput
test now fails on THIS MACHINE even isolated on a fresh temp DB, at THREE code points: the #136 tree,
the pre-change HEAD (dd08f2e), and #131 (6a63729 — the commit where it measured green isolated on
2026-06-29). Symptom unchanged (accept/batch/undo stuck disabled ≥60s mid-write); stall position
varies run-to-run (15 remaining, 7 remaining). Conclusion: machine-level SQLite write-throughput
degradation TODAY — not a code regression at any point (3-point A/B), not OneDrive (the #121
relocation stands). Blast radius: ONLY the rapid-sequential-write loop — the other 58 e2e passed the
same day, and the three triage specs run in 0.8–4.1s when the box isn't saturated. Follow-up
(owner-gated): retest after a reboot; consider Windows Defender exclusions for the repo and
%TEMP%\aimplifi-test-*; if it persists, serialize that one spec's writes or give the throughput test
a dedicated DB.

## 2026-07-01 — #136 increment 2: searchable triage picker (Checker 2 P1 fixed) + stall diagnosis CORRECTED
Replaced the unsearchable ~84-option native <select> in triage alternatives with a search input +
scrollable option list over the pure `filterCategoryOptions` (assign.ts, 11 unit tests). Focused
Checker (wf_634e20c6): **2 confirmed P1, both FIXED + locked** — (1) search matched category NAMES
only while GROUP labels are visible in the list ("bills" → false "no match" → nudged the user to
create a DUPLICATE category; fix: a group-label match keeps the whole group); (2) keyboard access
regressed vs the native select (~86 tab stops to reach search, dead Enter; fix: the panel takes focus
on open (tabIndex -1 container — child buttons can be disabled mid-action, a container focus can't
silently no-op), Enter files the single visible match, Escape clears/closes). P2 fixed: stale search
query no longer survives batchApply/undoLast card changes (same class as the P1 form fix). e2e locks
added for all of it (focus-on-open, group-label search, Enter-files, empty-query-after-undo).

**STALL DIAGNOSIS CORRECTED (supersedes this morning's "SQLite write-throughput" wording):** a direct
Prisma write probe against the SAME e2e DB file ran 60×(create+update+delete) at **min 0 / p50 1 /
p95 1 / max 22 ms** while browser-driven server actions stalled ≥60s — the storage layer is HEALTHY;
the stall lives in the request/server layer (`next start` action POST handling) under RAPID
SEQUENTIAL actions. Switching the test loopback localhost→127.0.0.1 stabilized the lighter specs this
session but did NOT cure the full-review rapid-write stall (still reproduces, stall position varies).
Still environmental-not-code (3-point A/B incl. #131 stands). Runtime versions for future comparison:
node v24.16.0, playwright 1.60.0, next 15.5.19 — a system Node/OS update since 2026-06-29 (when this
test last measured green) is the prime suspect. Owner follow-ups: reboot + rerun; if persistent, try
pinning the Node version the 6/29 run used, or instrument the action route latency server-side.

## 2026-07-01 — #136 increment 3: register write-in (Checker 1 P1 fixed) — sweep COMPLETE
"+ New category" inside the register's category-menu → hands off to the existing once/always confirm
(#121); shared group-label search (#137) replaces the menu's name-only filter; drop-up menu on low rows.
Checker P1 FIXED + locked: `chosen` is now ROW-BOUND (rowId) — a create resolving after a row switch can
no longer put the one-tap confirm (incl. merchant-wide + durable-rule) on the wrong row. Race lock GREEN
×4 on the final tree. Accepted P2s: one-shot dropUp measurement (no scroll/resize re-measure; stale side
after scrolling with the menu open); write-in form inside the pre-existing role=listbox (SR
discoverability — fold into the shared-CategoryPicker follow-up); drop-up top-clipping on very short
viewports; the happy-path spec's full pass on the FINAL tree is UNVERIFIED (witnessed green through the
confirm pane ×3; the tail stalls on the machine's documented action-apply stall) — rerun after reboot.
Root-cause note for #16/#17: the ≥60s stalls are the ACTION-RESPONSE REVALIDATION APPLY (server actions
carrying 9-route revalidations hold the client transition — and every disabled={pending} button — until
the payload lands); storage proven healthy (p50=1ms probe). Environmental TODAY per the 3-point A/B.

## 2026-07-01 — #139 write-in prefill from the search query (owner request; Checker 2 P1 fixed)
Owner (testing #136-#138 in prod): "consolidate the new category into that search box so user doesn't
have to retype a field." Shipped: both write-in mini-forms prefill their name from the picker's live
search query at open (still editable; submit normalizes as before); triage Enter on a zero-match query
opens the prefilled form. Register search gains no Enter semantics (has none today — shared-
CategoryPicker follow-up). Checker wf_e902ad02 (3 lenses → adversarial verify): 2 P1 FIXED + locked —
(1) missing !newCatOpen let a second zero-match Enter silently clobber the edited draft (name/group/
discretionary) since the search box stays interactive beside the open form; (2) HELD-Enter auto-repeat
chained through the name input's autoFocus into an instant create+file with never-reviewed defaults →
e.repeat guards both Enter handlers. The pre-guard bundle DEMONSTRATED (2) in a stale-build e2e run
(rule prompt offering the typo category) — see process lock below. Test-adequacy P2 fixed (guards now
pinned: multi-match no-op, repeat no-op, draft survival).

Accepted residuals: two DISCRETE rapid Enters still create+file (indistinguishable from intent; filing
undoable, category deletable, rule prompt consensual); register keyboard parity deferred (pre-existing).

**PROCESS LOCK (cost ~40 min today):** playwright webServer = `next start -p 3100` with
reuseExistingServer — it serves whatever .next holds. NEVER run e2e concurrently with scripts/verify.sh
(its `next build` races/lags the spec edits): the first "P1 reproduction" run was the PREVIOUS bundle.
Sequence is always: verify green FIRST, then e2e.

Gate (real 2026-07-01): verify.sh → ✅ GREEN 1476 unit/116 files, tsc/eslint/build clean. E2E on the
final tree: triage write-in spec (all 5 new locks) GREEN 7.9s; register race lock GREEN; register happy
path witnessed green through prefill assert + confirm pane ×3 — its once-click tail is the documented
environmental action-apply stall (re-A/B'd at HEAD this session: fails at spec line 230 pre-change) —
full pass UNVERIFIED until the owner reboot (#16/#17 protocol; one triage stall occurrence also hit
line 106 mid-session then passed 7.9s on retry, consistent with "position varies").

## 2026-07-01 — #140 iOS focus-zoom fix (owner report)
Owner on #139 in prod: the dropdown "zooms in" — iOS Safari force-zoom on <16px focused controls; ALL
raw inputs here are text-sm (14px) and the register menu autofocuses its search. Fixed at the root:
globals.css (pointer:coarse) floors input/select/textarea at 1rem ([class] specificity trick, no
!important; checkbox/radio excluded; desktop unchanged). Register menu w-56→w-72 + max-w viewport clamp.
e2e locks assert computed ≥16px on both surfaces in the touch-emulated project (proved the media query
matches under Playwright's Pixel-5 emulation). Gate: verify GREEN 1476/116; triage write-in 7.7s GREEN
(incl. zoom locks); register race 4.6s GREEN; register happy-path tail = the documented environmental
stall (unchanged label). Residual: real-device (physical iPhone) confirmation is the owner's — emulation
proves the CSS applies, not Safari's zoom behavior itself.

## 2026-07-02 — #141 currency-disclosure banner (#135 residual 18) — Checker 1 P1 + 10 P2 confirmed, P1 + 7 P2 fixed
Resumed from stash `wip-135-disclosure` (banner + pure summarizer + getAccountsView.withheld +
getWithheldAccountSummary + dashboard//accounts wiring). Completed the pending pieces: integration
tests on the existing currency-guard fixture, the guarded scripts/e2e-add-foreign-account.ts (refuses
unless DATABASE_URL === E2E_DB_URL exactly AND the email is an @aimplifi.test throwaway; idempotent
via delete-own-rows-first), and tests/e2e/currency-disclosure.spec.ts (negative: all-USD demo user, no
banner; positive: ad-hoc signup user + helper → banner on dashboard + /accounts, withheld names absent,
axe AA with the banner present — the demo user never renders it, so the phase-5 pass can't cover it).

**Hostile Checker (wf_de889cf4, 4 lenses → adversarial verifier): 17 raw → 11 CONFIRMED (1 P1, 10 P2),
6 refuted.** Fixed:
- **P1 (tests): vacuous dashboard zero-render lock** — the negative spec anchored on `demo-banner`,
  which the LAYOUT flushes before the route-group Suspense resolves, so `toHaveCount(0)` passed
  against the loading skeleton. Re-anchored on `net-worth-card` (page content below the boundary).
- P2 copy sweep, all grammar now built by the PURE `withheldBannerCopy()` and branch-locked in unit
  tests: singular+opaque folds to "another currency" (was ungrammatical "an account in other
  currencies"); title now "not in U.S. dollars" (was "foreign currency" — mislabels crypto/BTC, a
  first-class withheld case); display tokens = letters 3–5 only, uppercased + deduped ('840', 'US',
  'doge' no longer pasted into copy; case-variant dedupe can't fake "and others").
- P2: all-foreign /accounts contradiction (banner "Nothing is deleted" above "No accounts yet / Add
  your first account") — AccountsEmptyState gets a withheld-aware copy variant; zero-account users
  byte-identical.
- P2: spec `.first()` removed (strict mode now locks single-render); helper made idempotent.

**Accepted residuals (documented, not fixed):**
23. Disclosure covers dashboard + /accounts only (the residual-18 scope as recorded). The register,
    /investments, /triage, /recurring, /reports, /coach still withhold silently — register is the
    page a user hunts a missing account on, /investments is one click from the disclosed /accounts.
    Follow-up: reuse getWithheldAccountSummary there (checker recommends /investments first). Note:
    every sign-in lands on /dashboard, whose banner reads app-wide ("every total, trend, and
    projection shown"), so the vanish is no longer fully silent anywhere.
24. The supported-currency predicate stays hand-duplicated across ~4 page gates + the DB complement
    in getWithheldAccountSummary; only the summary side is invariance-tested. Refactor candidate
    (single exported Prisma where-fragment), not a live defect.
25. Coach/reports projections don't state the currency-exclusion assumption inline (guardrail
    tension flagged by the checker; same scope decision as 23).
Refuted (verifier): CSV-export marker claim (accepted residual 19 covers it), backfill-count
disagreement, all-foreign dashboard P1 (gates to EmptyDashboard = accepted 22), banner salience,
reassurance-copy coupling, execSync cwd fragility.

**Gate (real, 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1492 unit / 116 files**
(+16 this session: 6 stash + 2 integration + 8 checker locks), tsc/eslint/build clean.
E2E on the final tree: currency-disclosure 2/2 GREEN (2.7s/4.0–4.8s incl. axe) ×3 runs;
auth.spec 3/3 GREEN (one non-reproducing single failure in the first post-build parallel run —
isolated rerun 2.6s + full-file rerun 3/3 green; classed environmental per the #16/#17 protocol and
the CLAUDE.md cold-start-flake rule).

## 2026-07-02 — Phase 3 (3d+3a+3b+3c) shipped; environmental notes
Rebuild increments all verify-green + committed: resync clobber guard (regression-locked), merchant
identity (eval 60%→23.3% review on messy data, precision 100%), group engine/server (trust-on-repeat
locked end-to-end), group-first UI + adapted e2e. Two environmental findings today (evidence-backed):
(1) phase5-a11y "keyboard-only /cards" fails TODAY at THREE code points incl. 69a335b (witnessed green
60/61 on 2026-07-01) — identical $2,135 toggle assertion, focus+Enter racing hydration on the degraded
box; 3-point A/B ⇒ NOT a regression from today's code; retest after the owner-gated reboot.
(2) The new throughput e2e passed isolated ×2 (14s) + in-suite once; one serial run hit the documented
#16/#17 pending-stall (button disabled >120s, position varies). Same cure.
Accepted 3c residuals: the "Always/Just once" prompt is now reachable only via one-by-one mode on
multi-row rule-eligible groups (group cards carry consent in copy — #143/#144); positive e2e coverage
of that prompt needs a multi-row real-merchant fixture (demo has none) — Phase-4 item with the messy
corpus; rule-prompt makeRuleFromCorrection machinery unchanged and unit-covered.
