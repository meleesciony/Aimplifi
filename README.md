# Aimplifi

A personal-finance web app that helps you cut the expenses that don't buy you
happiness — and spend confidently on the ones that do (your "money dials") —
in service of the long game: financial independence, retirement, and whatever
else you're aiming at. The practical personal-finance canon (*I Will Teach You
to Be Rich*, *The Psychology of Money*, and friends) built into the product's
behavior, on top of Mint/Simplifi-grade account aggregation with AI-driven
intelligence throughout.

Three things carry that purpose:

- **The Cash-Needed Engine**, which answers to the cent: *"How much money must
  be in my checking account, and by what date, to pay every card in full this
  cycle?"*
- **Categorization that nearly disappears** — merchant normalization →
  confidence routing → a thumb-first triage inbox — the chore Mint and
  Simplifi never got right.
- **An FI Coach** that treats your savings rate — not returns — as the
  headline metric, and ranks savings opportunities by compounded impact, never
  by latte shame.

## Quickstart (demo mode — zero credentials)

```bash
npm install              # postinstall runs `prisma generate`
npx prisma db push       # creates dev.db (SQLite) from prisma/schema.prisma (source of truth)
npx prisma db seed       # deterministic demo dataset (asOf 2026-06-10)
npm run dev              # http://localhost:3000 → “Explore the demo”
```

Demo mode is first-class: 9 accounts, 4 credit cards with distinct billing
cycles (autopay, a mid-cycle payment, a not-yet-generated statement), 18
months of realistically messy transactions, biweekly payroll, 8+
subscriptions (one price increase, one possibly-unused), engineered
lifestyle creep, and an engineered intra-period cash dip — all pinned by
hand-verified expected values in `docs/EDGE_CASES.md`.

## Verification (Definition of Done)

```bash
bash scripts/verify.sh              # typecheck + lint + unit tests + build
VERIFY_E2E=1 bash scripts/verify.sh # + Playwright e2e at 380×800 (incl. axe WCAG AA)
# current test counts live in docs/STATUS.md (single source of truth) — not here
```

Every engine number is unit-tested against hand-computed values; the seed
headline ($5,412.33 by Fri Jun 26; dip −$1,012.33 on Jun 24; transfer $1,050
by Jun 23) is a golden integration test. Each phase passed a Hostile Critic
review (`docs/CRITIC_RUBRIC.md`); findings and fixes are logged in
`docs/STATUS.md`, and the critic’s adversarial probes live on as regressions
in `tests/unit/critic*-*.test.ts`.

## What’s implemented

- **Cash-Needed Engine** (`src/lib/engine/cash-needed/`) — per-card statement
  intelligence, aggregate obligation timeline, day-by-day projection with
  intra-period minimum (not just endpoints), autopay handled without double
  counting, weekend/holiday due-date walk-back, estimates labeled, pay-in-full
  ⇄ minimum toggle with average-daily-balance interest cost (APR÷365 × the
  cycle's average balance, grace-gated), transfer recommendation (rounded up to
  $50, never dated in the past).
- **Categorization** (`engine/categorize/`) — merchant normalization (SQ\*,
  TST\*, AMZN Mktp, PAYPAL \*, airport POS…), confidence routing (auto-silent ≥
  90%, AI-badge 70–90%, review < 70%), contextual rules (amount bands, weekend,
  account scope), review rate under the **5% target** on the last 60 seed days
  (the exact seed rate is asserted and printed by `tests/unit/categorize.test.ts`) —
  the seed benchmark is intentionally clean; the messy-corpus rate (realistic
  merchant strings) is tracked by `npm run eval:categorize` and reported in its
  own output, not restated here.
- **Triage inbox** (`/triage`) — swipe right accept, swipe left for 3
  alternatives, long-press split, batch “apply to all N similar”, universal
  undo (inverse corrections), one-tap durable rules with explicit consent.
  A full seeded weekly review clears in a handful of thumb actions — asserted
  under the **<15 interactions / <60 s** targets by `tests/e2e/phase2-triage.spec.ts`,
  which prints the exact count at a documented 4 s/interaction budget.
- **Recurring detection** (`engine/recurring/`) — cadence, price-change
  tracking, possibly-unused flag, biweekly payroll feeding the cash projection.
- **FI Coach** (`/coach`) — savings rate with net-worth-parity placement, FI
  number (with its expense basis stated inline), years-to-FI (live slider),
  Coast FI, opportunity engine ranked by 10/20/30-year compounding, lifestyle
  creep detector (median-based, payroll-lump robust), months-of-runway,
  life-energy view, monthly Money Review. Copy guardrails are enforced by
  tests: zero shame language, assumptions on every projection, no tickers.
- **Cash-flow calendar** (`/calendar`), **goals with FI-date impact**
  (`/goals`), **budgets** (`/budgets`), **CSV/PDF export** (audit-logged),
  **PWA manifest**, **security headers (CSP)**, **rate limiting**, **cron sync
  route**, **AES-256-GCM token encryption for bank tokens (Plaid/SimpleFIN) at rest**.

## Live in production (www.aimplifi.app) — env keys for a fresh deploy

| Feature | Status / activate on a new deploy with |
|---|---|
| Plaid bank connections | **LIVE** — real accounts connected on the production deployment (production keys; per-bank disconnect, DECISIONS #256). Fresh deploy: `DATA_PROVIDER=plaid`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `DATA_ENCRYPTION_KEY` (32-byte base64); see docs/PLAID_WALKTHROUGH.md. Schwab/PNC need per-institution Plaid registration (TASKS 0.7). |
| Auth (email + password, emailed reset) | **LIVE** — Credentials provider in `src/auth.ts` with reset flow via Resend (`AUTH_SECRET`, `RESEND_API_KEY`, `AUTH_URL` on non-Vercel; DECISIONS #257). Demo sign-in remains for demo mode. No Google/magic-link providers. |
| Background sync schedule | `CRON_SECRET` + a Vercel cron hitting `/api/cron/sync` (see docs/DEPLOY.md). |

`src/lib/providers/types.ts` is the seam: anything that implements
`DataProvider` (accounts, cursor-based transaction sync, statements) plugs in
without touching the engines — that is also how you’d add any other data API.

## Deploy (Vercel)

See `docs/DEPLOY.md` (canonical, step-by-step). Short version: import into
Vercel, Postgres via `DATABASE_URL` (schema is portable), `AUTH_SECRET`, then
`prisma db push && prisma db seed`. A blank Plaid config still builds and runs
(demo mode).

## Repo map

```
src/lib/money.ts, dates.ts     # THE money/date utilities (branded types)
src/lib/engine/                # pure engines: cash-needed, categorize,
                               # recurring, fi, calendar, goals
src/lib/providers/             # DataProvider seam: demo (seeded) | plaid (live in prod)
src/server/                    # session+ownership-scoped data assembly & actions
prisma/seed.ts + src/lib/seed/ # deterministic demo dataset (pure builder)
docs/                          # architecture, edge cases (hand math), critic
                               # rubric, status, privacy, Plaid walkthrough
tests/unit + tests/e2e         # unit + e2e tests (counts: docs/STATUS.md), incl. axe WCAG AA
```

Known limitations are honestly listed in `docs/STATUS.md`; the v1-vs-future
split is in `docs/ROADMAP.md`. Educational software, not financial advice.



