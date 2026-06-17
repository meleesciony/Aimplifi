# Aimplifi

A personal-finance web app built around one killer question, answered to the cent:

> **“How much money must be in my checking account, and by what date, to pay every card in full this cycle?”**

Plus the two things Mint and Simplifi never got right: categorization that
nearly disappears (merchant normalization → confidence routing → a thumb-first
triage inbox), and an FI Coach that treats your savings rate — not returns —
as the headline metric.

## Quickstart (demo mode — zero credentials)

```bash
npm install              # postinstall runs `prisma generate`
npx prisma migrate deploy # creates dev.db (SQLite) from prisma/migrations
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
bash scripts/verify.sh              # typecheck + lint + 409 unit tests + build
VERIFY_E2E=1 bash scripts/verify.sh # + 18 Playwright e2e at 380×800 (incl. axe WCAG AA)
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
  account scope), **3.60% review rate** on the last 60 seed days (target < 5%).
- **Triage inbox** (`/triage`) — swipe right accept, swipe left for 3
  alternatives, long-press split, batch “apply to all N similar”, universal
  undo (inverse corrections), one-tap durable rules with explicit consent.
  A full seeded review session: **4 interactions (≈16 s at a documented 4 s/interaction budget)** (targets: <15, <60 s).
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
  route**, **AES-256-GCM token-encryption helper (used by the dormant Plaid path)**.

## Dormant pending keys

| Feature | Activate by |
|---|---|
| Plaid bank connections | `.env.local`: `DATA_PROVIDER=plaid`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`, `DATA_ENCRYPTION_KEY` (32-byte base64). **The provider is a partial scaffold**: Link/exchange/remove are written (never run against a live sandbox); transaction-sync persistence and liabilities→statement mapping are **not implemented** and fail loudly (ROADMAP #1). See docs/PLAID_WALKTHROUGH.md. |
| Real auth (magic link / Google) | `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` + enabling the providers in `src/auth.ts` (demo sign-in is the Phase-1–5 default). |
| Background sync schedule | `CRON_SECRET` + a Vercel cron hitting `/api/cron/sync`. |

`src/lib/providers/types.ts` is the seam: anything that implements
`DataProvider` (accounts, cursor-based transaction sync, statements) plugs in
without touching the engines — that is also how you’d add any other data API.

## Deploy (Vercel)

1. Push the repo to GitHub; import into Vercel (framework: Next.js).
2. Database: switch `datasource` to Postgres (schema is portable; money is
   `Int` cents, dates are `YYYY-MM-DD` strings) — e.g. Vercel Postgres/Neon —
   set `DATABASE_URL`, run `prisma migrate deploy && prisma db seed`.
3. Env: `AUTH_SECRET` (`npx auth secret`), optionally the Plaid/Google/cron
   vars above. A blank Plaid config still builds and runs (demo mode).
4. Cron: add `{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 11 * * *" }] }`
   to `vercel.json`, with `CRON_SECRET` set.

## Repo map

```
src/lib/money.ts, dates.ts     # THE money/date utilities (branded types)
src/lib/engine/                # pure engines: cash-needed, categorize,
                               # recurring, fi, calendar, goals
src/lib/providers/             # DataProvider seam: demo (seeded) | plaid (dormant)
src/server/                    # session+ownership-scoped data assembly & actions
prisma/seed.ts + src/lib/seed/ # deterministic demo dataset (pure builder)
docs/                          # architecture, edge cases (hand math), critic
                               # rubric, status, privacy, Plaid walkthrough
tests/unit + tests/e2e         # 409 unit tests; 18 e2e incl. axe WCAG AA
```

Known limitations are honestly listed in `docs/STATUS.md`; the v1-vs-future
split is in `docs/ROADMAP.md`. Educational software, not financial advice.



