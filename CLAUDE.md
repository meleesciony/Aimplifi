# Read LOOP_ENGINEERING.md first.

# CLAUDE.md — Pulse Finance project memory

You are building **Pulse Finance**, a production-grade personal finance web app that is
meaningfully better than Mint and Simplifi. The full product spec is in `SPEC.md`.
Phase 0 (architecture) is complete: see `docs/PHASE_0_ARCHITECTURE.md`. Work proceeds
phase by phase per `docs/PHASES.md`.

## Non-negotiable operating rules

1. **No fabrication.** Never claim a test passed, a build succeeded, or a feature works
unless you actually ran the command in this session and can show real output. If you
cannot run something, say so and mark it `UNVERIFIED`.
2. **Definition of Done (every phase).** All of the following, with command output shown:

   * `npx tsc --noEmit` → zero errors
   * `npx eslint .` → zero errors
   * `npx vitest run` → all tests pass, with new tests for this phase's logic
   * `npx next build` → clean
   * At least one e2e flow for the phase passes (Playwright; if Playwright cannot run in
this environment, a scripted simulation with logged assertions, clearly labeled)
   * Hostile Critic review (docs/CRITIC_RUBRIC.md) returns **zero P0/P1 findings**
   * Run `bash scripts/verify.sh` as the single source of truth before declaring done.
3. **Financial math is sacred.** All money values are **integer cents** (`number` of
cents, or `bigint` where sums could overflow). Never floats for money. Every financial
calculation has unit tests with the hand-verified expected values in
`docs/EDGE_CASES.md`. Date math uses a single tested utility module (no ad-hoc
`new Date()` arithmetic in business logic); all business dates are calendar dates
(YYYY-MM-DD strings or date-only types), never timestamps with timezones.
4. **Demo mode is mandatory and first-class.** The app must run fully with zero
credentials via the seeded dataset specified in `docs/SEED_SPEC.md`, behind the
`DataProvider` interface. Plaid is a second provider layered on top, never a
prerequisite.
5. **Engine before UI.** Within each phase, build and fully test the pure business-logic
engine (no React, no DB calls — pure functions on typed inputs) before wiring UI or
persistence. The Cash-Needed Engine, categorization engine, and FI engine all live in
`src/lib/engine/` as pure, deterministic, unit-testable modules.

## Build loop (every phase)

1. **Plan:** restate the phase's acceptance criteria from `docs/PHASES.md` as testable
assertions. Add any you discover. Get them into a test file skeleton first.
2. **Implement** complete, working code. No TODOs in delivered code paths.
3. **Verify:** `bash scripts/verify.sh`. Paste real output. Fix until green.
4. **Simulate the user:** walk the actual UI flow for the phase (Playwright preferred).
Benchmark: a new user with 4 cards must answer "how much do I need and when?" in
under 10 seconds from the dashboard.
5. **Hostile Critic review:** adopt the persona in `docs/CRITIC_RUBRIC.md`. Produce the
scorecard and numbered P0/P1/P2 findings with evidence.
6. **Fix and re-verify.** Repeat 3–5 until the critic passes. Hard cap: 4 critic cycles
per phase. If still failing, STOP, write open findings to `docs/STATUS.md`, and ask
the human for direction.

## Conventions

* Next.js 15 App Router, TypeScript strict mode, Tailwind + shadcn/ui, Prisma +
PostgreSQL (SQLite acceptable for local dev/test if Postgres is unavailable — keep the
schema portable), NextAuth (Auth.js v5), TanStack Query, Recharts, Vitest + Playwright.
* Path alias `@/*` → `src/*`. Engines in `src/lib/engine/`, providers in
`src/lib/providers/`, money/date utilities in `src/lib/money.ts` and `src/lib/dates.ts`.
* Currency formatting happens ONLY at the UI boundary via one `formatCents()` helper.
* All copy follows the coaching guardrails: educational not advisory, no shame-based
language, every projection states its assumptions inline.
* Commit after every green verify: `phase-N: <summary> (verify green)`.

## When blocked

Make a high-quality decision, record it in `docs/DECISIONS.md` with rationale, and move
on. Only ask the human when truly blocked (missing credential, contradictory requirement,
4 failed critic cycles).

