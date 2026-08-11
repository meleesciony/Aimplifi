# v1 (shipped) vs roadmap

## v1 — in this repo, verified

- FI Coach: savings rate, FI/Coast/years-to-FI, opportunity compounding,
  lifestyle creep, runway, life energy, Money Review, copy guardrails.
- Categorization: normalization table + cleanup fallback, confidence routing,
  contextual rules, seed review rate under the 5% target (asserted + printed by
  `tests/unit/categorize.test.ts`); triage inbox with gestures,
  batch, splits, consented durable rules, universal undo. Register rows are also
  inline-recategorizable — ANY transaction, not just the review queue — with
  just-once / always-for-merchant (durable rule), reusing the triage correction
  machinery (DECISIONS #36). LLM-assisted categorization + accuracy/Brier
  surfacing remain open (the "B/C" options).
- Recurring/subscription detection (cadence, price change, possibly-unused,
  payroll → projection wiring); transfer detection through one decision path.
- Cash-Needed Engine with the full edge-case suite (autopay modes, mid-cycle
  payments, estimates, same-day aggregation, weekend/holiday walk-back,
  post-close credits, $0-due, intra-period dips, pending applied once,
  delinquent statements, past-date-proof recommendations).
- Calendar, goals→FI impact, budgets view, CSV/PDF export with audit log,
  CSP/rate-limit/401 middleware, AES-256-GCM token-crypto helper (live use awaits Plaid), PWA manifest,
  cron sync route, demo auth. WCAG AA (axe) green on all core pages.
- Transaction register (`/transactions`): every transaction across all
  accounts, with search + account/category/type/date filters and money-in /
  out / net totals (transfers excluded); pure query engine, unit-tested.
- Accounts page (`/accounts`): all accounts grouped into assets vs liabilities
  with subtotals and net worth (matches the dashboard golden value).
- Manual card statements (`/accounts`, DECISIONS #46): a manual CREDIT card can
  carry a current statement (balance, minimum, close + due dates) + optional APR +
  autopay, so the Cash-Needed Engine runs the PRECISE "how much do I need & when"
  path for a no-Plaid card instead of dropping it. Pure parser + known-answer +
  end-to-end engine tests + a throwaway-user integration test + a golden-safe e2e;
  hostile-critic clean (0 P0/P1). Closes the documented gap in #45.
- Manual transaction entry (`/transactions/new`): cash/check/missed-feed rows,
  categorized through the standard pipeline; records activity only — balances
  stay provider-authoritative (DECISIONS #24).
- CSV import (`/transactions/import`): paste a bank/Mint export → parsed,
  validated (per-row line errors), categorized through the pipeline, bulk
  inserted. The credential-free way to get real transactions in (DECISIONS #27);
  pure parser unit-tested.
- Money Dials settings (`/settings`): edit the five per-user dials the engines
  read — payment account, safe withdrawal rate, expected return, hourly wage,
  and personal money dials. Pure validation engine (string-only parse,
  all-fields-at-once errors, bounds that keep the FI engine defined), thin
  ownership-scoped persist + audit, e2e round-trip (DECISIONS #28). A dashboard
  onboarding nudge activates for users with no payment account set (dormant in
  demo). This is the credential-free half of roadmap #2.
- Plaid ingestion implemented behind the provider seam (mappers unit-tested;
  network UNVERIFIED — see roadmap #1 below and docs/PLAID_WALKTHROUGH.md).
- SimpleFIN ingestion (DECISIONS #56) — a cheaper, no-business-gate Plaid
  alternative. Paste a setup token at `/accounts` → claim → encrypted access URL
  → accounts + transactions flow through the standard pipeline into net worth,
  the register, cash-needed, reminders. Pure mapper + connect/sync actions
  unit-tested (20) against a mocked server; idempotent re-sync (DB unique) +
  SSRF/redirect/credential-leak hardened (hostile-critic clean, 5 P1s fixed). The
  LIVE network path is UNVERIFIED (no token in env) — docs/SIMPLEFIN_WALKTHROUGH.md.
- Spending Trends (`/trends`, DECISIONS #74): the "what changed & what to look
  at" surface — a pace projection for the in-progress month, completed-month
  category movers (last month vs a 3-month average), the biggest purchases, and
  new merchants — all from the shared snapshot via the tested reports engine (one
  spend definition, no model calls). A dashboard `SpendingInsightsCard` +
  reciprocal /reports link (no 8th nav icon, #71). Pure engine + 16 known-answer
  unit tests + 3 e2e (incl. axe AA); hostile-critic reviewed (1 P1 resolved).
- Ask Aimplifi (`/ask`, DECISIONS #75): a grounded natural-language assistant —
  ask about your money in plain English and get answers computed from your own
  data. The LLM never originates a fact: a pure rule-based parser routes the
  question to a typed intent (no model call) and the server answers from the SAME
  tested engines the dedicated views use (reports/spending-plan/cash-needed/
  recurring/forecast/coach/net-worth), so /ask can't drift from /reports, /coach,
  or /trends. An optional, key-gated, rate-limited, 7s-timeout LLM only classifies
  an unrecognized question (and can abstain); the demo works with zero keys.
  Dashboard card + page, no 8th nav icon (#71/#74). Pure engine unit tests
  (parser, formatters, seed grounding, no-key no-network) + e2e; two hostile-
  critic cycles, all P0/P1 fixed and regression-locked. (Current test counts:
  docs/STATUS.md — the only status home.)
- Plan in Words — debt-free-BY-A-DATE inverse planner (`/ask` + `/goals`, DECISIONS
  #125): state a goal date ("be debt-free by December 2027") and the app SOLVES the
  tested debt engine for the minimal extra/mo (bisection over `planDebtPayoff`, the
  `coastFI` idiom — no new math), with an honest outcome (on-track / reachable /
  over-budget / unreachable) framed as a share of real safe-to-spend. The LLM extracts
  only the date (deterministic `parseTargetDate`, zero-key); "Confirm & save as goal"
  re-solves server-side and renders as a debt-aware `Goal.kind` card. Hostile critic +
  confirmation cycle, 3 P1s fixed and regression-locked. **Savings-goal-by-date (#126)
  and retire-at-age (#131) now SHIPPED — the Plan-in-Words trilogy is COMPLETE** (debt
  #125 → savings #126 → retire-at-age #131, each engine-first + hostile-critic'd to 0
  P0/P1). Retire-at-age bisects the boolean `projectRetirement` "sustained" predicate
  (#122 decumulation engine, no new math) and persists the chosen age to the existing
  `User.retirementAge` dial rather than a flat Goal (which would contradict the
  compounding engine). Remaining Wave-1 concept: Cash Flow Radar (AI plan §1.2, owner-gated).
- Postgres deploy path (DECISIONS #35): the app runs on SQLite locally + in all
  tests (zero credentials) and on Postgres in production, chosen by DATABASE_URL
  scheme (`src/lib/db-adapter.ts`). One canonical schema; `scripts/gen-pg-schema.mjs`
  derives the postgresql variant; `vercel.json` build = derive → generate → db
  push → next build. Provisioned + seeded against a dedicated Neon `pulse`
  database for real (842 txns). REMAINING for a confirmed-live deploy: set
  `DATABASE_URL` (Neon direct endpoint) + `AUTH_SECRET` in Vercel env and redeploy.

## Roadmap (in rough priority order)

1. **Plaid sandbox validation** — ingest path IMPLEMENTED and now VERIFIED.
   (a) **DONE (2026-06-17):** `npm run plaid:validate` (docs/PLAID_WALKTHROUGH.md §5)
   run against a live sandbox with real credentials — PASSED: public_token →
   exchange (encrypted PlaidItem stored) → 12 accounts synced → /transactions/sync
   16 txns with correct signs → /liabilities/get 1 statement; temp user cleaned up.
   The network path is no longer UNVERIFIED. REMAINING: (b) **DONE** (DECISIONS #53)
   — the #22 tail: `syncTransactions` now re-detects recurring series + refreshes the
   detected scheduled projections after ingest (`refreshRecurringForUser`, unit-tested;
   the sync that triggers it stays sandbox-UNVERIFIED); (c) **DONE** (DECISIONS #52) —
   Plaid-Verification JWT check on the webhook (ES256 + body-SHA-256 + freshness,
   verified before any DB work; logic unit-tested with a real keypair, live key
   fetch UNVERIFIED pending creds); (d) production OAuth flow; (e) **DONE** — a "Connect a bank or
   brokerage" Plaid Link UI (DECISIONS #41, `connect-accounts-button.tsx` +
   `plaid-actions.ts`, react-plaid-link). Enabled for SANDBOX. The deployed app
   stays in demo until **real multi-user auth** (roadmap #2) lands — linking real
   banks to the shared demo user would leak one person's data to all; that's the
   gate to production Plaid, not a code gap.
2. **Real authentication** — **DONE** (DECISIONS #43, #57). Real multi-user
   email/password signup (scrypt-hashed) + sign-in with durable per-IP and
   per-account rate limiting; JWT sessions; middleware route protection; dormant
   Google. Every server action resolves `requireUserId()` from the verified
   session with NO demo fallback, and data isolation is TESTED (two users; user
   A's view returns only A's accounts/net worth) + an e2e (brand-new signup →
   empty onboarding, no demo-data leak → sign out → back in). Invite-only signup
   (DECISIONS #57) gates account creation behind a `SIGNUP_ALLOWLIST` env var
   (dormant = open for demo/tests). DEPLOYED and live at www.aimplifi.app
   (Vercel + Neon Postgres); a fresh deploy needs `DATABASE_URL`, `AUTH_SECRET`,
   `DATA_ENCRYPTION_KEY`, and `SIGNUP_ALLOWLIST` — step-by-step in
   **docs/DEPLOY.md**.
3. ~~**Average-daily-balance interest** for the minimum path~~ — **DONE**
   (DECISIONS #29): the minimum-path interest now uses the average-daily-balance
   method (APR÷365 × the cycle's average balance, grace-gated), replacing the
   labeled v1 simple-monthly approximation. Pure primitive + known-answer tests.
4. ~~**Refund netting**~~ — **DONE** (DECISIONS #33): refunds reduce category
   spend instead of counting as income, engine-wide in `monthlyFlows` (savings
   rate + FI). Known-answer tested. Recurring detection is now refund-robust too
   (DECISIONS #34): a refund+rebill no longer drops a subscription. (Still open:
   split-CHILDREN handling — a niche, low-impact edge.)
5. ~~**Service worker** for offline PWA~~ — **DONE** (DECISIONS #32): `public/sw.js`
   + a precached, self-contained `/offline` shell + production-only registration.
   Network-first navigations (online stays fresh, nothing personal cached),
   passthrough hashed assets (bounded SW storage), offline fallback. Deferred: a
   build-stamped cache name + an in-app "update available" affordance.
6. ~~**Email/push payment reminders**~~ — **DONE** (DECISIONS #47): a pure reminder
   engine (selection + email rendering) shared by an in-app dashboard "Payment
   reminders" card AND a `CRON_SECRET`-guarded `/api/cron/reminders` sweep that emails
   imminent reminders. Email is DORMANT by default (no `RESEND_API_KEY` → nothing sent,
   no network call); set a Resend key to activate. Known-answer + dormant + real-handler
   tests; hostile-critic clean after fixing a cards/upcoming double-count and the
   partial-autopay disclosure. REMAINING to actually fire on a schedule: add the cron
   path(s) to `vercel.json` crons + set `CRON_SECRET` (+ `RESEND_API_KEY` to send) — a
   documented operator deploy step, like the sync cron.
7. ~~**Budget targets UI**~~ — **DONE** (DECISIONS #30): set/clear a per-category
   monthly target on `/budgets` (atomic upsert on a new `@@unique`, refunds netted,
   progress bar + remaining). Pure engine + known-answer tests + e2e.
8. **Performance**: ~~multi-instance rate limiting~~ — **DONE** (DECISIONS #48): durable,
   DB-backed `rateLimitDurable` (atomic, self-pruning, indexed) on the export route + a
   sign-in throttle (Redis no longer required). ~~Register pagination~~ — **DONE**
   (DECISIONS #51): the transaction register now paginates (pure `paginate` + Prev/Next,
   filter-preserving, accurate full-set summary) instead of a silent 200-row cap.
   Remaining (deferred, not needed at household scale): true DB-level LIMIT/OFFSET for the
   register (needs the normalized merchant denormalized onto the row to keep search
   SQL-able) and snapshot caching once data far exceeds demo scale.
9. ~~**Concurrency hardening**~~ — **DONE**: the split double-split race (DECISIONS #48,
   atomic conditional claim) and the Always/Undo orphan-rule race (DECISIONS #49,
   lineage-scoped rule deletion) are both fixed and regression-tested. Plus a sign-in
   throttle hardened to remove a targeted-account lockout (per-IP + per-account-fail
   dimensions, #49). Remaining (deferred, no UI path, append-only audit data): the
   `alreadyUndone` TOCTOU on a double-undo of the same correction (docs/STATUS.md #10).
10. ~~**Data deletion UI**~~ — **DONE** (DECISIONS #31): Settings → "Delete my
    data" with a typed-confirmation gate, a live summary of what's removed, and an
    idempotent ownership-scoped cascade (`prisma.user.delete`) + best-effort Plaid
    revoke + sign-out. Pure gate/summary engine + action-level integration test;
    `(app)/error.tsx` added for graceful degradation. Remaining for the real-auth
    release: multi-device session invalidation (JWT) and a non-cascading
    compliance deletion-record.


## Investments / portfolio tracking (in progress, DECISIONS #77)

The clearest gap from the honest Aimplifi-vs-Simplifi scorecard (Simplifi wins
investments decisively: holdings, TWR/IRR, a retirement planner). Closing it
engine-first: the pure performance/valuation engine
(`src/lib/engine/investments/portfolio.ts`) is **landed + tested + hostile-critic
clean** — market value, cost basis, unrealized gain, allocation, time-weighted
return, and money-weighted XIRR (20 known-answer tests). REMAINING (next increment):
a `Holding` data model (additive, Postgres-safe), manual holdings entry, an
`/investments` view surfaced from `/accounts` (no 8th nav icon, #71), demo seed
holdings, and an e2e. A retirement planner and live brokerage-holdings ingest are
later increments.

### Investments — update (DECISIONS #78)

Engine (#77) is now wired into the app: an additive `Holding` model, a demo-seeded
$142k portfolio, and `src/server/investments.ts` (`getInvestments` read-path running
the engine + ownership-scoped `addHolding`/`removeHolding`), all integration-tested
and hostile-critic clean (1 P0 + 3 P1 fixed). REMAINING (owner's UI): an `/investments`
view consuming `getInvestments()` and an optional manual-entry form calling `addHolding`,
plus an e2e. Later: a retirement planner and live brokerage-holdings ingest.

### Retirement planner — decumulation projection (DECISIONS #122) — DONE ✅

The retirement-planner increment is landed. Pure
`src/lib/engine/investments/retirement.ts::projectRetirement` adds the DECUMULATION
("will my money last / when do I run out") lens the FI engine never covered — a
deterministic month-by-month accumulate-then-draw-down sim that reuses
`geometricMonthlyRate` (one compounding convention), reports balance-at-retirement,
sustained-vs-depleted + the depletion age, a sustainable-withdrawal (SWR) reference, and
a yearly balance path. `getRetirementOutlook` grounds it in the SAME figures /coach shows
(via `getCoachData`, so it can't drift) and feeds a REAL return (nominal − a disclosed
~2.5% inflation) so figures are honestly in today's dollars. A "Retirement outlook" card
on `/investments` (outcome headline, balance-at-retirement, a phase-colored balance
sparkline, planned-vs-sustainable framing, every assumption — ages, inflation — stated
inline). 17 engine known-answer tests (incl. an independent closed-form ordering pin) +
3 server-glue + 3 e2e (axe AA); two hostile-critic Checkers, 0 P0/P1 after fixes.

### Retirement planner — editable inputs + interactive what-if (DECISIONS #123) — DONE ✅

The planner's ages + inflation are now PERSONAL, not hardcoded. Four additive nullable
`User` columns (currentAge/retirementAge/endAge/inflationBps; null = the documented
default, so demo/golden is byte-identical and the seed is untouched) edited from a
"Retirement plan" fieldset on /settings through the existing Money Dials validate/persist
engine (new bounds + cross-field ordering so whatever persists is always engine-valid).
`getRetirementOutlook` reads them (coalesced to defaults) and feeds them — with the
still-/coach-grounded financial figures — through one shared pure `buildRetirementInputs`
builder. The /investments "Retirement outlook" card became a client island with an
interactive what-if: number inputs for retire/plan-through age + inflation recompute the
SAME pure `projectRetirement` live (byte-identical to the server at the saved values,
exploratory/never-persists so it can't perturb golden data), reset-to-saved, Settings link.
The invariant-maintaining lever logic is a pure, fuzz-tested module
(`retirement-whatif.ts`). Added unit tests; two hostile-critic Checkers, the one P1
(untested client logic) fixed via the pure-module extraction. Verify GREEN (counts:
docs/STATUS.md); settings + investments e2e all green incl. axe AA.

### Live brokerage-holdings ingest from SimpleFIN (DECISIONS #124) — DONE ✅

Real positions from a connected SimpleFIN INVESTMENT account now flow into the `Holding`
model + the #77 portfolio engine, surfacing automatically on `/investments`. Engine-first:
a pure `mapSimplefinHoldings` (in `src/lib/providers/simplefin-holdings.ts`) turns SimpleFIN's
optional `holdings[]` (decimal strings) into engine-valid Holding rows — aggregating
same-symbol lots, deriving the model's per-share `priceCents` from `market_value ÷ shares`,
validated to the exact `addHolding` bounds, skipping+counting any un-mappable position (never
throws). Wired into `syncFromSimplefin`'s INVESTMENT branch via `reconcileSimplefinHoldings`,
which upserts feed positions as `source='simplefin'` and deletes sold ones — touching ONLY its
own synced rows (additive `Holding.source` column, default `'manual'`), so a hand-entered
holding is never overwritten or wiped. **Net worth is unaffected** (the account's
`currentBalanceCents` stays authoritative; holdings are a within-account breakdown), so demo/
golden is byte-identical. Added tests (pure mapper incl. end-to-end through the engine +
mocked-server integration); two hostile-critic Checkers — a confirmed P0 (same-ticker upsert
silently overwrote a manual holding) FIXED + regression-locked, plus a transient-empty
data-loss P2 fixed (reconcile only on an explicit holdings array). Verify GREEN (counts:
docs/STATUS.md); full e2e + investments e2e all green incl. axe AA. LIVE NETWORK UNVERIFIED (no token) —
consistent with the existing SimpleFIN/Plaid live-path labeling; the mocked-server integration
is the labeled end-to-end simulation.
LATER: a "Synced from your brokerage" provenance tag on /investments (the `source` column is
in place); live Plaid `/investments/holdings` ingest (parity with the SimpleFIN path).

## Production-readiness roadmap (UX/prod audit, 2026-06-24)

An 11-agent UX + production-readiness audit (DECISIONS #80). Blockers and the
investments UI are DONE; the rest is a prioritized backlog for the owner to approve
(each "only change if markedly better").

DONE this pass: /investments view; removed the dev command from the production error
screen; fixed "Pulse"→"Aimplifi" brand leaks on bank-connect + reminder copy;
corrected the Settings card that told real users they were in "demo mode".

DO NEXT — **ALL DONE (reconciled #185 via a file:line audit; this list was stale)**:
- ~~Add `src/app/(app)/loading.tsx` skeleton(s)~~ **DONE (#81)** — route-group Suspense skeleton.
- ~~Empty states for charts/cards with no data~~ **DONE** — reports (`reports-view.tsx:83,103`),
  coach/life-energy (`life-energy-card.tsx:49-52`), cards (`cards/page.tsx:18-30`), investments
  (`investments-view.tsx:64-74`). (Forecast always has a seeded balance series; no zero-state path.)
- ~~Heading structure~~ **DONE** — `CardTitle` renders a real heading (`ui/card.tsx:36-54`, `as`-prop,
  default `h2`); pages carry a page `<h1>`.
- ~~Per-page <title> template + global-error.tsx~~ **DONE** — `layout.tsx:17` (`template:"%s · Aimplifi"`),
  `src/app/global-error.tsx` present.
- ~~Confirmation before destructive deletes (manual accounts, goals)~~ **DONE** — goal delete
  (`delete-goal-button.tsx`, #83), manual-account delete (`accounts-list.tsx:509-517`), custom-category
  delete (`custom-category-manager.tsx`), account-data typed-phrase gate (`engine/account/deletion.ts:16`).
  Budget-`Clear` is a deliberate one-tap (reversible display-only target, same class as manual-statement
  `Clear`) — a CONSISTENT non-gap, not a missing confirm (#185).
- ~~Escape/outside-click dismissal for the recategorize popover~~ **DONE** —
  `transaction-list.tsx:315-323` (Escape→close+refocus) + `:106-117` (mousedown click-away).
- ~~An "Investments" nav entry~~ **DONE (#176-era)**.

ALSO CONSIDER (reconciled #186 — code truth, not the 2026-06-24 note):
- ~~distinguish empty-register states (no data vs no match)~~ **DONE #186**
- ~~make the triage split flow usable (2nd category + preview)~~ **DONE #89** (shopping is a default, not a hard-lock)
- ~~budgets first-run empty state~~ **DONE** zero-account `#87` + no-target hint **#186**
- ~~inline goal/budget amount validation~~ **DONE #166 / #30** (field errors, never boundary)
- ~~calendar shortfall warning shown unconditionally~~ **DONE** (gated on `shortfallDate` + recommendation)
- ~~aria-labels on calendar arrows~~ **DONE #81**
- ~~skip-to-content link~~ **DONE #81**
- ~~iOS PWA safe-area~~ **DONE #90**
- ~~reframe overspent "Safe to spend" as "Over plan by $X"~~ **DONE #186** (dashboard header + amount; /spending-plan already reframed)
- ~~spending-plan allocation legend~~ **DONE #186**
- ~~Mobile nav redesign (7→8 unlabeled icons, sub-44px targets)~~ **DONE #187** —
  labelled More sheet; primary bottom tabs unchanged.
