# Read GRAPH_ENGINEERING.md and LOOP_ENGINEERING.md first (graph composition, then node-internal discipline). Then GRAPH.md — this repo's topology/state/gate contract. Then skim docs/lessons/INDEX.md — accumulated lessons from prior sessions.

# CLAUDE.md — Aimplifi project memory

You are building **Aimplifi** (formerly "Pulse Finance" — the product was renamed; the brand
appears as "Ask Aimplifi" / the nav "Aim·plifi"), a production-grade personal finance web app
that is meaningfully better than Mint and Simplifi. The full product spec is in `SPEC.md`.
Phase 0 (architecture) is complete: see `docs/PHASE_0_ARCHITECTURE.md`. Work proceeds
phase by phase per `docs/PHASES.md`, executed as the **build graph** defined in `GRAPH.md`:
each slice is a subgraph of specialized nodes (plan → implement → verify gate → simulate →
hostile-critic verifier → fix), connected by ledger state, routed by gates — never by vibes.

## Purpose (owner-directed, 2026-08-06 — DECISIONS #418)

Aimplifi exists to make its users deliberately wealthier — it is a financial coach with
a bank feed, not a bank feed with charts. It pairs the aggregation backbone of Mint and
Simplifi with the practical personal-finance canon (*I Will Teach You to Be Rich*, *The
Psychology of Money*, and the rest of SPEC.md Differentiator #3) expressed as AI-driven
product behavior: organize the user's complete financial picture, show where money
actually goes, cut the expenses that don't buy happiness while protecting the spending
that does (conscious spending — "money dials"), and keep the long game — financial
independence, retirement, the user's own goals — visible and on track. Every feature
serves this mission and none defines it: "how much money do I need and when" is the
Cash-Needed Engine's job, a flagship feature, not the app's identity. Lead with the
mission in any description of the app — README, app copy, docs, or an answer to the
owner. The under-10-seconds cash-needed benchmark in the build graph below remains a
valid UX benchmark for that flow.

## Working location

The canonical local checkout is `C:\dev\Aimplifi` (relocated off OneDrive on
2026-06-27; GitHub remote: `github.com/meleesciony/Aimplifi`). Both the older
`C:\dev\Pulse Finance` (stale ~#74) and the original
`C:\Users\micha\OneDrive\Documents\Pulse Finance` copy are now **abandoned** — all
current work lives in `C:\dev\Aimplifi`; start agent sessions from there. Do **not** develop
inside a cloud-synced folder (OneDrive / Dropbox / iCloud): background sync holds
file locks that cause spurious `verify` failures — a cold `tsc` / `eslint` /
`next build` can fail once and then pass on a clean rerun — and it forces LF→CRLF
churn on every touched file. Keep the working copy on a plain local disk path; treat
any one-off cold-start verify failure that doesn't reproduce on rerun as an
environment flake, not a code defect.

## Non-negotiable operating rules

0. **Never guess — verify, or say you're not sure. And write for a first-timer.**
(Learned the hard way in a live Plaid/env-var + password-reset support session; see
`docs/lessons/never-guess-and-write-for-a-first-timer.md`.)
   * **Do not assert a cause, a fix, or "it's probably X" without checking the actual
evidence** — the real code, the real error/log line, the real env value, the real
screen. "It should work" / "likely" / "probably" are not conclusions. If you haven't
verified it, say **"I'm not sure — here's how we find out,"** then find out. A
hypothesis is allowed only when labeled as one AND immediately followed by the step
that confirms or kills it.
   * **Never describe a screen (Vercel/Plaid/any dashboard) you haven't seen.** If you
don't know exactly what's on the user's screen, ask for a screenshot instead of
imagining button names and layouts — guessing at a UI is the same failure as guessing
at a bug.
   * **Every instruction the user must follow is granular: assume zero background
knowledge** (picture a middle-schooler shipping their first app). One action per
numbered step, the exact on-screen label to click and where it is, jargon explained in
the same breath (e.g. "redeploy — push the new settings live so the site uses them").
No abbreviated "go to settings and update it."
   * **When the app is broken, restore a known-good state first** (revert the single most
recent change), then diagnose — don't debug in place while the user is locked out.
Prefer reversible moves and say that they're reversible.
1. **No fabrication.** Never claim a test passed, a build succeeded, or a feature works
unless you actually ran the command in this session and can show real output. If you
cannot run something, say so and mark it `UNVERIFIED`. A verdict inherited from another
node or subagent is a hypothesis until a gate you ran reproduces it.
2. **Definition of Done (every slice).** All of the following, with command output shown —
these are the **gate nodes** of the build graph (`GRAPH.md` §5), and a slice may not
cross to the next node until each gate's verdict is read:

   * `npx tsc --noEmit` → zero errors
   * `npx eslint .` → zero errors
   * `npx vitest run` → all tests pass, with new tests for this slice's logic
   * `npx next build` → clean
   * At least one e2e flow for the slice passes (Playwright; if Playwright cannot run in
this environment, a scripted simulation with logged assertions, clearly labeled)
   * Hostile Critic review (docs/CRITIC_RUBRIC.md) returns **zero P0/P1 findings** — run
as a **separate verifier context**, never the maker grading itself
   * Run `bash scripts/verify.sh` as the single source of truth for LOCAL done; for
work that ships, the CI conclusion is additionally required (rule 5, "Read the gate").
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
5. **Ship it: commit, PUSH, and DEPLOY — then prove it's live — before asking the
owner to look at anything.** (Owner instruction, 2026-07-21: *"Always do all 3 before
asking me to check."* Restated 2026-08-24: *"always push and commit at end of every
slice."* A harness auto-mode block on `git push` is not an exception — see
AGENTS.md tool-specific translations.) A green local verify is not a shipped feature. `main` sat **8
commits ahead of `origin/main`** for four sessions — #257 through #261 — so the owner
could not see the password reveal they had asked for, and a whole diagnosis was built
on a hypothesis about code that was never on the deployed site. In graph terms: the
ship edge has three gates in series, and the slice's state is "unshipped" until all
three verdicts are read.
   * Vercel auto-deploys on push to `main` (project `aimplifi`, team `reiforge`);
there is no separate deploy step, but there IS a separate **verification** step.
   * "Deployed" is not the push succeeding. Confirm the deployment reached `READY`
**and** fetch the live URL and grep for a marker unique to the change
(`curl -s https://www.aimplifi.app/<route> | grep '<new testid or label>'`). An old
deployment answers `200` perfectly well, so a status code proves nothing.
   * **Read the gate, not just the deploy (K.8).** After every push, run
`bash scripts/ci-status.sh` — GitHub Actions runs the FULL `VERIFY_E2E=1` gate on
every push, and it sat red on every push for days (50 failure / 49 cancelled /
0 success, 2026-08-02..06) while sessions reported "verify green", because nobody read
it. `scripts/verify.sh` stays the local Definition-of-Done gate (rule 2); the CI
conclusion is the SHIP gate. Precisely: start the wait in the background and keep
working; the turn may not claim the slice SHIPPED-green until the conclusion is read.
On `success` → done. On `cancelled` (exit 3) → a newer push superseded this one;
re-run against the newest sha. On `failure` → never silent: if any failing test is one
this push touched, that is a stop — fix it. If every failure is proven pre-existing
(red on the prior run or a stashed tree), the slice may close, but only by recording
the run id + the failing tests in docs/STATUS.md and naming them in the turn's
PASS/FAIL contract.
   * Before pushing, check `git diff origin/main..main --stat -- prisma/`: a schema
change means `prisma db push` runs against the live Neon database on deploy. No schema
diff = the database is untouched.
   * If the push carries more than the current slice, say so — the owner is receiving
everything that accumulated, not just today's work.
6. **Engine before UI.** Within each phase, build and fully test the pure business-logic
engine (no React, no DB calls — pure functions on typed inputs) before wiring UI or
persistence. The Cash-Needed Engine, categorization engine, and FI engine all live in
`src/lib/engine/` as pure, deterministic, unit-testable modules. Graph reading: the
engine node and the UI node are separate nodes with a tested edge (the engine's typed
output) between them; the UI node may not start until the engine node's gate is green.

## Build graph (every phase, every slice)

The per-slice subgraph — full topology, edge payloads, and gate semantics are the
contract in `GRAPH.md` §4–§5. The operational sequence inside it:

1. **Plan node:** restate the phase's acceptance criteria from `docs/PHASES.md` as testable
assertions. Add any you discover. Get them into a test file skeleton first.
2. **Maker node (implement):** complete, working code. No TODOs in delivered code paths.
Independent subtasks fan out to subagents in separate worktrees; the merge is owned and
re-gated.
3. **Gate (verify):** `bash scripts/verify.sh`. Paste real output. Fix until green.
Red ⇒ route back to the maker node — only the failed node, never the whole graph.
4. **Simulate-the-user node:** walk the actual UI flow for the slice (Playwright preferred).
Benchmark: a new user with 4 cards must answer "how much do I need and when?" in
under 10 seconds from the dashboard.
5. **Verifier node (Hostile Critic):** a **separate context** adopts the persona in
`docs/CRITIC_RUBRIC.md`. It receives the diff, the assertions, and the gate output —
not the maker's rationale. It produces the scorecard and numbered P0/P1/P2 findings
with evidence.
6. **Fix edge and re-verify.** Repeat 3–5 until the critic passes. Hard retry budget:
**4 critic cycles per phase** (a budget carried in the slice's state). Budget exhausted
⇒ STOP, write open findings to `docs/STATUS.md`, and route to the human gate.
7. **State-writer edge (every boundary):** `PROGRESS.md` after each step; decisions →
`docs/DECISIONS.md`; every fix → `REGRESSION_LEDGER.md` + a locking regression test;
open items → `docs/STATUS.md`.

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
* **One status home:** `docs/STATUS.md` (plus root `TASKS.md` for the build queue) is the
only place current status/counts live. Never hardcode test counts, coverage numbers, or
"as of" totals in README, ROADMAP, PHASES, or the gap plan — those files describe what a
feature does or what's next, never how many tests currently pass. `docs/DECISIONS_INDEX.md`
is the index into `docs/DECISIONS.md`; read the index first on large-file lookups.
These ledgers are the graph's shared state (`GRAPH.md` §3): write them at node
boundaries, read them instead of re-exploring.

## Model routing (which model runs which node)

Model choice is routing, and routing is config — assigned per **node type**, per
`docs/COMPETITIVE_GAP_PLAN.md` §3 (revised 2026-08-08 to an "absolute need" bar):
**DeepSeek V4 Flash** as the default maker for feature slices, UI, refactors, e2e
authoring, mechanical slices, and routine non-money critic cycles (~80% of sessions);
**Opus 5** (`xhigh`/`max`) only where absolutely needed — new money-math engines,
architecture/authz redesigns, hostile-critic passes on money/security/data-integrity
(including, especially, slices Flash built — **Flash never self-certifies these**:
a maker model never occupies its own verifier node), and multi-hour autonomous phase
builds; **Fable 5** only as the differently-trained second-opinion verifier when an
Opus 5 critic pass comes back clean on an expensive money/security surface. Escalation
triggers (Flash → Opus 5) and the Claude Code env config for Flash sessions are in §3.
Heavy reads always via the `explorer` subagent regardless of main model (Haiku 4.5 in
Claude sessions, `deepseek-v4-flash` in Flash sessions). The graph's fan-out spends the
same budget as everything else: a parallel node that isn't on a cheaper tier, offloading
context, or buying needed wall-clock is a token leak — collapse it to a sequential loop.
In Claude Code sessions, end every substantive turn (after the PASS/FAIL contract) with a
`NEXT MODEL:` line — model + effort + why — as the routing recommendation for the next
node's session.

## When blocked

Make a high-quality decision, record it in `docs/DECISIONS.md` with rationale, and move
on. Only ask the human when truly blocked (missing credential, contradictory requirement,
4 failed critic cycles, or a destructive/irreversible action or real scope change that
only they can approve) — those four conditions are the graph's human gates, enumerated
in `GRAPH.md` §1. The human is usually not watching in real time: for reversible
actions that follow from the original request, proceed without asking — never end a turn
on "Want me to…?" or a promise about work not yet done. When you have enough information
to act, act; don't re-derive established facts or re-litigate decisions already made.
