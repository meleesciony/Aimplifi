# Phases & Acceptance Criteria

Every phase ends with `bash scripts/verify.sh` green + Hostile Critic pass
(zero P0/P1). Criteria below are the minimum; restate them as test assertions at phase
start and add what you discover.

---

## Phase 1 — Scaffold, seed data, Cash-Needed Engine (THE killer feature)

**Build order:** `money.ts` + `dates.ts` (with tests) → Prisma schema + migration →
seed script per `docs/SEED_SPEC.md` → cash-needed engine (pure) + full edge-case test
suite → dashboard card + `/cards` page UI → e2e.

Acceptance criteria:
1. `npx prisma db seed` produces the exact dataset in `docs/SEED_SPEC.md`,
   deterministically (same `--asOf` ⇒ byte-identical data). A `seed.test.ts` asserts the
   invariants (counts, the autopay card, the mid-cycle payment, etc.).
2. Every edge case in `docs/EDGE_CASES.md` §Cash-Needed has a named, passing unit test
   whose expected value matches the hand-computed value in that doc.
3. Engine returns correct headline for the seed dataset: required amount, by-date,
   shortfall, transfer recommendation (rounded up to next $50, dated due-date − 1
   business day). Expected values are pre-computed in `docs/EDGE_CASES.md` §Seed-headline
   — the seed and the doc must agree; if the seed changes, recompute by hand and update
   both.
4. Intra-period minimum: the engine flags the seed's engineered mid-period dip (see
   SEED_SPEC) even though the balance recovers by the due date.
5. Pay-in-full ⇄ minimum toggle works; minimum path shows interest cost matching the
   hand-computed value.
6. Dashboard shows the cash-needed answer above the fold on a 380px viewport; Playwright
   e2e: sign in (demo) → dashboard → assert the headline string → tap into per-card
   breakdown. "Answer in under 10 seconds" = the headline requires zero navigation.
7. Net worth number + basic trend chart present (full dashboard polish is Phase 4).

## Phase 2 — Categorization engine + mobile triage UX

1. Normalization layer: a fixture file of ≥40 messy descriptors (taken from the seed,
   incl. SQ\*, TST\*, AMZN Mktp, PAYPAL \*, airport POS codes) each maps to the expected
   canonical merchant in a table-driven test.
2. After processing the most recent 60 days of seed data: **<5% of transactions have
   `needsReview = true`** — asserted by a test that prints the actual rate and lists the
   reviewed items.
3. Rules: contextual rule (amount-banded Amazon example), weekend rule, account-scoped
   rule each covered by tests; user rule beats merchant default beats suggestion.
4. Triage inbox at 380px: swipe right accept, swipe left → 3 alternatives, long-press
   split, batch "apply to all N similar", universal undo. Playwright (mobile viewport)
   completes a seeded week-of-spending review in **<15 interactions**; emit an
   interaction log as evidence and map to the documented human-time budget for the <60s
   claim.
5. Every correction offers a one-tap durable rule; corrections are recorded and
   reversible.
6. Recurring detection on the seed finds ≥8 subscriptions, the price increase, the
   90-day-unused one, and biweekly payroll (as income cadence, feeding ScheduledTransactions
   for the cash-needed projection — wire this back into Phase 1's engine and re-run its
   tests).
7. Transfer detection: credit-card payments and savings transfers are excluded from
   spending/income (test with seed data).

## Phase 3 — FI Coach

1. Savings rate computed monthly from seed data, headline placement parity with net
   worth; values match hand-computed expectations for at least 3 seed months.
2. FI engine: FI number, years-to-FI, Coast FI — each tested against the hand-built
   tables in `docs/EDGE_CASES.md` §FI. Interactive slider updates years-to-FI live.
3. Savings-opportunity engine ranks seed opportunities (unused subscription, price
   increase, etc.) by compounded 10/20/30-year impact; the $/mo → FV math is tested.
4. Lifestyle-creep detector flags the seed's engineered final-6-months discretionary
   rise, comparing spend growth vs. income growth.
5. Room-for-error card: months of runway = liquid assets / avg monthly expenses, tested.
6. Life-energy view (hours of work) togglable, uses `hourlyWageCents`.
7. Monthly "Money Review" narrative generated from real seed data: one improvement, one
   creep, one concrete next action.
8. `coach-copy.test.ts`: zero shame-phrases; every projection string carries its
   assumptions. Critic hunts for preachy copy by reading every coach string.

## Phase 4 — Plaid, security hardening, calendar/budgets/goals, export, PWA

1. Plaid sandbox: Link flow, transactions sync (cursor), liabilities → statements,
   webhook handler. Research current Plaid docs first. Provider switch via env. If
   sandbox credentials are unavailable in the build environment, implement against the
   documented API, mark integration tests `UNVERIFIED`, and provide a manual sandbox
   walkthrough doc.
2. Cash-flow calendar: inflows, outflows, card due dates on one timeline; reminder
   stubs (in-app; email optional).
3. Budgets + goals; each goal shows its effect on the FI date (wired to FI engine).
4. CSV + PDF export (transactions, net worth); audit-logged.
5. Security pass: middleware auth on all app routes, row-ownership helper everywhere,
   token encryption, CSP, rate limits, `docs/PRIVACY.md` with the deletion path.
6. PWA installable, dark mode, responsive audit on 380px/768px/1280px.
7. Background sync via cron route (Vercel cron) + queue-safe sync function.

## Phase 5 — Final hardening & deliverables

1. Full-app Hostile Critic review (all axes, all three differentiators re-attacked).
2. Accessibility pass to WCAG AA on core flows (axe in Playwright, keyboard nav, contrast).
3. Final deliverables: README setup, `.env.example` finalized, Plaid sandbox
   walkthrough, Vercel deploy guide, seed/demo instructions, security review summary,
   final critic scorecard, v1-vs-roadmap doc.
