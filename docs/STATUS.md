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

## Phase 4 (complete — see commit)

Calendar/goals/budgets/exports/PWA/cron/security headers + dormant Plaid
provider (UNVERIFIED — docs/PLAID_WALKTHROUGH.md has the validation
checklist). Unauthenticated API requests now return 401 JSON (middleware).

## Known limitations (accepted, by design or deferred)

1. **Statement balances in seed history are plausible PRNG values**, not exact
   sums of that cycle's card transactions (DECISIONS #14). Likewise the
   checking account's posted balance is not reconciled against its full
   transaction history. No engine math depends on this reconciliation.
2. **Minimum-path interest is the v1 simple-monthly formula** (carried × APR/12),
   labeled "approximate" in the UI. Average-daily-balance method is roadmap
   (DECISIONS #5).
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
7. **Recurring-detection fragilities (critic F8, P2):** a refund+rebill inside a
   series drops it for the period; annual subscriptions need 3 occurrences
   (2+ years of history); `possiblyUnused` is a fitness-category proxy
   (usage is not observable in transaction data — DECISIONS #18) and is always
   phrased as a question in the UI.
8. **Refunds count as inflows** in income aggregation (consistently, engine-wide);
   netting refunds against spending is a roadmap refinement.
9. **Equal-priority rules tie-break by creation order** (stable sort) — documented
   here rather than enforced.
10. **Narrow concurrency races** (critic, P2): two concurrent splits of the same
    row from different sessions could double-split (ownership check precedes the
    transaction); "Always" tapped racing "Undo" can orphan a rule. No UI path
    reaches either; server-side locks are a scale-out refinement.
11. **Unknown billers containing a word-bounded "EPAY"** (e.g. "DUKE ENERGY
    EPAY") classify as transfers consistently in both modules; a merchant-table
    entry wins when added.
12. **Plaid integration is UNVERIFIED** (no sandbox credentials in the build
    environment) — implemented against the documented API behind the provider
    seam; validation checklist in docs/PLAID_WALKTHROUGH.md.
13. **Coast-FI with a 0-month target** and `detectLifestyleCreep(windowMonths=1)`
    are degenerate for out-of-range inputs — unreachable from the app
    (constants fixed), noted for API consumers.
