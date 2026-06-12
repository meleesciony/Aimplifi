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

## Roadmap (in rough priority order)

1. **Plaid sandbox validation** — run docs/PLAID_WALKTHROUGH.md; transaction
   ingest mapping (sign flip), liabilities→statements, webhook handler,
   dedicated PlaidItem token table; then production OAuth flow. Ingest MUST
   follow the pipeline order in DECISIONS #22 (rules + transfer + recurring
   processing on every ingested row) — the rule prompt's "future charges skip
   review" promise depends on it.
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

