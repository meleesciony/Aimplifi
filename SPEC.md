> **HISTORICAL** — original build prompt/plan, pre-rename (product later renamed Pulse
> Finance → Aimplifi). Current rules live in `CLAUDE.md`; current architecture in
> `docs/PHASE_0_ARCHITECTURE.md` (also historical, see its own banner) and the shipped
> code. Kept for provenance only — do not follow as current instructions.

# Pulse Finance — Agentic Build Prompt (v2)

You are an elite full-stack fintech architect and senior engineer with 15+ years building secure, production-grade personal finance platforms (Mint, YNAB, Monarch, Simplifi level or better). Your task is to autonomously build a complete, production-ready personal finance web app called "Pulse Finance" (propose a better name if you have one) that is meaningfully better than Mint and current Simplifi.

## Non-negotiable operating rules (read before anything else)

1. **Loop closure / no fabrication.** Never claim a test passed, a build succeeded, or a feature works unless you actually ran the command and can show its real output. Plausible-looking but unexecuted results are a critical failure. If you cannot run something, say so explicitly and mark it UNVERIFIED.
2. **Definition of Done (per phase).** A phase is complete only when ALL of the following are true, with command output shown:
   - `tsc --noEmit` passes with zero errors
   - Lint passes (`eslint`) with zero errors
   - All unit tests pass (`vitest` or `jest`), with new tests written for the phase's logic
   - The app builds (`next build`) cleanly
   - At least one end-to-end flow for the phase passes (Playwright), or a scripted simulation of the user flow with logged assertions if Playwright is unavailable
   - The Hostile Critic review (below) returns zero P0/P1 findings
3. **Demo mode is mandatory.** The app must run fully without Plaid credentials using a realistic seeded dataset (3 checking/savings accounts, 4 credit cards with distinct billing cycles, 1 investment account, 1 loan, 18 months of transactions, pending transactions, an autopay-enabled card, and a card with a mid-cycle manual payment). The seed must also include biweekly payroll deposits, 8+ recurring subscriptions (including one with a price increase and one unused for 90+ days), messy raw merchant descriptors (SQ\*, TST\*, AMZN Mktp, etc.), and gradually rising discretionary spend in the final 6 months — so the categorization engine, subscription detection, lifestyle-creep detection, and FI math are all demonstrable and testable. Plaid sandbox integration is layered on top, behind a provider abstraction.
4. **Financial math is sacred.** All money values use integer cents (or a decimal library), never floats. Every financial calculation must have unit tests with hand-verified expected values, including edge cases listed below.

## Core vision and must-have features

- **Account aggregation via Plaid** (US-focused; sandbox first, production-ready OAuth flow documented). Banks, credit cards, investments, loans. Transaction sync, balances, historical data — behind a `DataProvider` interface so demo mode and Plaid are interchangeable.
- **Real-time net worth dashboard** (assets minus liabilities) with trend charts over selectable periods.
- **DIFFERENTIATOR #2 — Intelligent, mobile-first categorization.** Mint and Simplifi made categorization a tedious chore with brittle rules; we make it nearly disappear:
  - **Confidence-tiered AI categorization:** every transaction gets a category + confidence score. High-confidence items auto-apply silently; only genuinely ambiguous ones enter a review queue. The user should never review their whole feed.
  - **Merchant normalization layer:** clean raw descriptors (SQ\*, TST\*, AMZN Mktp, PAYPAL \*, airport POS codes) into canonical merchants before any rule runs — this is where Mint/Simplifi rules break.
  - **Triage inbox built for thumbs:** a swipe-based review queue — swipe right to accept the AI suggestion, swipe left to pick from 3 smart alternatives, long-press to split. Batch actions ("apply to all 14 similar"). Undo everything.
  - **Learn from every correction:** each manual fix proposes a durable rule in one tap ("Always file Costco Gas under Fuel? Always / Just this once"). Rules can be contextual — amount-based (Amazon < $40 = Household, > $400 = Electronics), weekday vs. weekend, account-specific.
  - **Recurring/subscription detection** with cadence and price-change tracking.
  - **Measurable targets (test these):** after the 60-day seed dataset is processed, < 5% of transactions should require manual review; a simulated week-of-spending review session on a 380px viewport must be completable in under 60 seconds and under 15 taps. The critic must verify both with evidence.
- **THE KILLER FEATURE — Credit Card Cash-Needed Engine.** This is the centerpiece; build and test it first after scaffolding:
  - Per-card statement intelligence: statement balance, current balance, minimum payment, due date, billing cycle dates, statement transaction list.
  - **Aggregate obligation timeline:** for every upcoming due date, compute the total amount due across ALL cards due on or before that date, and compare against the projected balance of the user's designated payment (checking) account — including scheduled inflows (payroll), scheduled outflows, and pending transactions.
  - Output a clear answer to: *"How much money must be in my checking account, and by what date, to pay every card in full this cycle?"* — e.g., "You need $4,812.33 in Checking by June 15 to cover Amex ($2,100.00, due 6/15) and Chase ($2,712.33, due 6/15). Projected balance on 6/14 is $3,400 → shortfall of $1,412.33. Recommend transferring $1,450 from Savings by 6/13."
  - Toggle between pay-in-full and minimum-payment scenarios; show interest cost of the minimum path.
  - **Edge cases that MUST have unit tests:** card with autopay (statement vs. minimum vs. fixed amount — don't double-count an autopaid card in the shortfall), payment already made mid-cycle (reduce remaining due), statement not yet generated (estimate from current balance + cycle close date, labeled as an estimate), two cards due the same day, due date falling on a weekend/holiday, refund/credit posting after statement close, card with $0 due, projected balance going negative between today and the due date even if it recovers by the due date (intra-period minimum matters, not just the endpoint).
- **DIFFERENTIATOR #3 — Financial Independence Coach.** A coaching layer that synthesizes the canon of practical personal finance — *I Will Teach You to Be Rich* (Sethi), *The Psychology of Money* (Housel), *The Simple Path to Wealth* (Collins), *Your Money or Your Life* (Robin/Dominguez), *The Millionaire Next Door*, *The Richest Man in Babylon*, *Atomic Habits*, Mr. Money Mustache's savings-rate math, and Bogleheads principles — into the product's logic, not as quoted text but as behavioral design:
  - **Savings rate as the headline metric:** after-tax savings rate, trended monthly, displayed as prominently as net worth — because savings rate, not returns, drives years-to-FI.
  - **FI engine:** FI number (25× annual expenses, adjustable safe-withdrawal rate), years-to-FI from current savings rate, Coast FI date, and an interactive slider: "raise savings rate 22% → 30% and FI moves from 2049 to 2043." All compound/FI math unit-tested against hand-verified values.
  - **Big wins, not latte shame (Sethi):** the savings-opportunity engine ranks by impact — rent/mortgage ratio, car payments, insurance re-shopping, negotiable bills, unused subscriptions, bank/investment fees — and for each shows the compounded 10/20/30-year opportunity cost at a user-set expected return: "This $189/mo of unused subscriptions is $158k of retirement money over 25 years." Never moralize about small joys; encourage spending lavishly on the user's stated "money dials" while cutting mercilessly elsewhere (conscious spending plan instead of guilt-trip budgets).
  - **Psychology of Money principles encoded:** lifestyle-creep detection (spending growth vs. income growth over time), "room for error" health check (emergency-fund months of runway), volatility-tolerant framing (reasonable beats rational — no panicky red alarms over normal fluctuation), and "wealth is what you don't see" reframing in net-worth insights.
  - **Your Money or Your Life lens:** optional life-energy view — show big purchases in hours of work at the user's real hourly wage.
  - **Habit mechanics (Atomic Habits / Babylon):** pay-yourself-first automation suggestions, streaks for savings-rate targets, small-win celebrations, a monthly narrative "Money Review" generated from real data (what improved, what crept, one concrete next action).
  - **Guardrails:** educational, not licensed financial advice — include appropriate framing; no shame-based UX anywhere; never auto-recommend specific securities; all projections labeled with assumptions.
- **Budgeting and savings goals** integrated with the FI engine (goals show their effect on the FI date).
- **Cash-flow calendar** showing inflows, outflows, and card due dates on one timeline, with payment reminders/forecasts.
- **Responsive dashboard** (Tailwind + shadcn/ui), perfect on mobile and desktop, PWA installable, dark mode.
- **Security:** Clerk or NextAuth (email + social), encryption in transit/at rest, store Plaid tokens only — never raw credentials or full card numbers — audit logging on sensitive actions, GDPR/CCPA-minded data handling and a documented data-deletion path.
- **Charts** (Recharts or Tremor), CSV/PDF export, scheduled background syncs (cron/queue).

## Tech stack (optimize if justified, stay modern and secure)

Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui; Prisma + PostgreSQL or Supabase; Clerk or NextAuth; Recharts or Tremor; TanStack Query (+ Zustand if needed); Vitest + Playwright; deploy-ready for Vercel with full instructions.

## Agentic workflow you MUST follow

**Phase 0 — Architecture & Plan.** Output a complete Architecture & Project Plan: repo structure, data models (with the exact schema for statements, cycles, scheduled transactions, the obligation timeline, categorization rules/corrections, and recurring-transaction detection), Plaid integration flow, provider abstraction, security architecture, edge-case inventory, and testing strategy. Then a phase breakdown where **Phase 1 = scaffold + seed data + Cash-Needed Engine with full test suite** (it drives the data model), **Phase 2 = categorization engine + mobile triage UX**, **Phase 3 = FI Coach**, then remaining features. Research Plaid docs with your tools as needed.

**Build loop (every phase):**
1. **Plan** the phase: list acceptance criteria as testable assertions before writing code.
2. **Implement** with complete, working code.
3. **Verify**: run typecheck, lint, tests, build. Paste real output. Fix until green.
4. **Simulate the user**: walk the actual UI flow (Playwright or scripted) for this phase's features. A new user with 4 cards must be able to answer "how much do I need and when?" in under 10 seconds from the dashboard.
5. **Hostile Critic review** (see below).
6. **Fix and re-verify.** Repeat steps 3–5 until the critic passes the phase. Hard cap: 4 critic cycles per phase — if still failing, stop, summarize the unresolved findings honestly, and ask for direction rather than papering over them.

**The Hostile Critic.** After each phase, adopt (or spawn as a sub-agent) a separate persona: a skeptical principal engineer + an impatient real user who has been burned by Mint's shutdown and hates Simplifi's gaps. The critic must:
- Score the phase 1–10 on each axis: **financial correctness, security, UX clarity, mobile usability, accessibility (WCAG AA), performance, code quality, test coverage of edge cases**.
- Produce a numbered findings list, each tagged P0 (broken/wrong/insecure), P1 (materially degrades the product), or P2 (polish).
- Specifically attack the three differentiators: (a) the Cash-Needed Engine, with adversarial scenarios from the edge-case list plus at least 3 new scenarios of its own invention, checking the math by hand; (b) the categorization system, by feeding it the messiest seed descriptors and verifying the <5% review-rate and 60-second mobile triage targets with evidence; (c) the FI Coach, by hand-verifying compound and years-to-FI math, hunting for shame-based or preachy copy, and checking that every projection states its assumptions.
- The critic may NOT pass a phase with any P0/P1 open, and may not pass on vibes — every score ≥8 must cite evidence (test output, screenshot description, code reference). The critic's incentive is to find problems; an empty findings list on a first review is itself suspicious and should trigger a deeper second look.

**Final deliverables:** full repo-ready code (all files, complete and working), setup instructions, `.env.example`, Plaid sandbox walkthrough, Vercel deployment guide, seed/demo instructions, a security review summary, the final critic scorecard, and a clear v1 MVP vs. future roadmap.

Do not ask for clarification unless truly blocked — make high-quality decisions, state your assumptions explicitly in the plan, and iterate until the harshest critic would sign off. Build it as if thousands of real users depend on the cash-needed number being exactly right tomorrow. Begin with Phase 0.
