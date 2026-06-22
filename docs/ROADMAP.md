# v1 (shipped) vs roadmap

## v1 — in this repo, verified

- Cash-Needed Engine with the full edge-case suite (autopay modes, mid-cycle
  payments, estimates, same-day aggregation, weekend/holiday walk-back,
  post-close credits, $0-due, intra-period dips, pending applied once,
  delinquent statements, past-date-proof recommendations).
- Categorization: normalization table + cleanup fallback, confidence routing,
  contextual rules, 3.60% review rate on seed; triage inbox with gestures,
  batch, splits, consented durable rules, universal undo. Register rows are also
  inline-recategorizable — ANY transaction, not just the review queue — with
  just-once / always-for-merchant (durable rule), reusing the triage correction
  machinery (DECISIONS #36). LLM-assisted categorization + accuracy/Brier
  surfacing remain open (the "B/C" options).
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
   The network path is no longer UNVERIFIED. REMAINING: (b) wire the DECISIONS #22
   tail — recurring re-detection + scheduled refresh after ingest (per-row
   normalize→rules→categorize→transfer is done); (c) Plaid-Verification JWT check
   on the webhook; (d) production OAuth flow; (e) **DONE** — a "Connect a bank or
   brokerage" Plaid Link UI (DECISIONS #41, `connect-accounts-button.tsx` +
   `plaid-actions.ts`, react-plaid-link). Enabled for SANDBOX. The deployed app
   stays in demo until **real multi-user auth** (roadmap #2) lands — linking real
   banks to the shared demo user would leak one person's data to all; that's the
   gate to production Plaid, not a code gap.
2. **Real authentication** — Auth.js magic link + Google. The per-user dials
   themselves now ship (the Money Dials editor above); what remains here is
   multi-user signup + a true first-run onboarding flow (the dashboard nudge is
   already wired and waiting on a real "new user with no payment account").
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

