# v1 (shipped) vs roadmap

## v1 — in this repo, verified

- Cash-Needed Engine with the full edge-case suite (autopay modes, mid-cycle
  payments, estimates, same-day aggregation, weekend/holiday walk-back,
  post-close credits, $0-due, intra-period dips, pending applied once,
  delinquent statements, past-date-proof recommendations).
- Categorization: normalization table + cleanup fallback, confidence routing,
  contextual rules, 3.60% review rate on seed; triage inbox with gestures,
  batch, splits, consented durable rules, universal undo.
- Recurring/subscription detection (cadence, price change, possibly-unused,
  payroll → projection wiring); transfer detection through one decision path.
- FI Coach: savings rate, FI/Coast/years-to-FI, opportunity compounding,
  lifestyle creep, runway, life energy, Money Review, copy guardrails.
- Calendar, goals→FI impact, budgets view, CSV/PDF export with audit log,
  CSP/rate-limit/401 middleware, AES-256-GCM token-crypto helper (live use awaits Plaid), PWA manifest,
  cron sync route, demo auth. WCAG AA (axe) green on all core pages.
- Transaction register (`/transactions`): every transaction across all
  accounts, with search + account/category/type/date filters and money-in /
  out / net totals (transfers excluded); pure query engine, unit-tested.
- Accounts page (`/accounts`): all accounts grouped into assets vs liabilities
  with subtotals and net worth (matches the dashboard golden value).
- Manual transaction entry (`/transactions/new`): cash/check/missed-feed rows,
  categorized through the standard pipeline; records activity only — balances
  stay provider-authoritative (DECISIONS #24).

## Roadmap (in rough priority order)

1. **Plaid sandbox validation** — the ingest path is now IMPLEMENTED (mapping +
   sign flip unit-tested in plaid-map.test.ts; `/accounts`, `/transactions/sync`
   cursor loop, `/liabilities`→statements, webhook, cron, and the dedicated
   `PlaidItem` token+cursor table all written). REMAINING: (a) run
   docs/PLAID_WALKTHROUGH.md §5 against a live sandbox to verify the network
   paths; (b) wire the DECISIONS #22 tail — recurring re-detection + scheduled
   refresh after ingest (per-row normalize→rules→categorize→transfer is done);
   (c) Plaid-Verification JWT check on the webhook; (d) production OAuth flow.
2. **Real authentication** — Auth.js magic link + Google; per-user onboarding
   (designate payment account, money dials, wage, SWR).
3. **Average-daily-balance interest** for the minimum path (replaces the
   labeled v1 simple-monthly approximation).
4. **Refund netting** (refunds reduce category spend instead of counting as
   income) and split-aware recurring detection.
5. **Service worker** for full offline PWA (manifest + icons ship in v1).
6. **Email/push payment reminders** (v1 badges due days on the calendar; no notification mechanism yet).
7. **Budget targets UI** (model + actuals view ship in v1).
8. **Performance**: snapshot pagination/caching once data exceeds demo scale;
   Redis-backed rate limiting for multi-instance deployments.
9. **Concurrency hardening**: row-level locks around split/undo paths
   (documented races in docs/STATUS.md #10).
10. **Data deletion UI** (path documented in docs/PRIVACY.md; cascade schema
    already in place).

