# Skills & Automation Plan + Docs De-duplication — Aimplifi

*2026-07-09. Full-repo review: all root/docs markdown, lessons, scripts/, .claude/, .cursor/,
.github/. Goal 1: identify repetitive work Claude Code / Cursor currently re-derives with AI
every session, and plan skills/scripts so they don't. Goal 2: name the redundancies in the
docs and make intent clearer. Build tasks are queued as **Wave S in TASKS.md**.*

**Principle (LOOP_ENGINEERING rule 5, applied to the toolchain itself):** if a rule can be
written, write it — as a *script* (zero model calls) first, a *skill* (procedure loaded only
when triggered) second, and always-in-context instructions (CLAUDE.md) only for the few rules
that must survive even when nothing is read. Today the repo over-relies on tier 3: every
session re-reads ~25KB of canon and re-derives the same recipes. Skills invert that — the
canon stays lean, and the recipe loads only when the matching task appears.

---

## 1. Repetitive AI work observed (evidence)

| Repeated task | Evidence it repeats | Today's cost |
|---|---|---|
| Hostile-critic pass | Every phase since Phase 1; CRITIC_RUBRIC.md + attack lists re-derived each time | Re-reasoned per session, inconsistent depth |
| New pure engine + known-answer tests | ~25 engines in `src/lib/engine/*`, all same shape (EDGE_CASES entry → pure module → known-answer tests → server glue → UI) | Structure re-derived; occasional convention drift |
| Mutation form wiring | Bit twice (#166, #170) → became a lesson | A documented recipe still applied from memory |
| e2e authoring + flake triage | 3 sessions misdiagnosed mobile-380 (corrected #193: read the error signature first) | Whole sessions lost to misattribution |
| Additive schema change (SQLite+PG dual) | Every model addition (#77, #78, #122, #123, #124…) repeats: schema → gen-pg-schema → generate → push → golden-byte-identical check | Checklist re-derived; golden-safety is safety-critical |
| Ledger bookkeeping | Every substantive turn: DECISIONS entry, PROGRESS checkpoint, REGRESSION line, PASS/FAIL contract; PROGRESS backfill for #173–176 was *forgotten* | Pure formatting done by a frontier model; sometimes skipped |
| Categorization tuning | normalize.ts (60KB) + messy-corpus + categorize-eval.ts benchmark loop | The eval script exists; the *procedure* around it isn't captured |
| Status reconciliation | ROADMAP #185/#186 "this list was stale"; gap-plan 2026-07-08 reconciliation block; test counts differ across 5 files | Repeated multi-agent audits just to learn what's already built |
| Doc hygiene | "Pulse" brand leaks fixed piecemeal (#80-era) yet persist in 8 files | Grep-able, yet done by hand |

The `explorer` subagent that CLAUDE.md/LOOP_ENGINEERING route all heavy reads to is **not
defined in the repo** (`.claude/` has only settings) — it presumably exists in the owner's
global `~/.claude`. Any other machine/CI/agent silently loses the token-routing policy.

---

## 2. Tier 1 — Scripts (zero model calls; build these first)

| # | Script | Replaces | Sketch |
|---|---|---|---|
| S1 | `scripts/scaffold-engine.ts <name>` | Engine boilerplate re-derivation | Emits `src/lib/engine/<name>/<name>.ts` (header-comment template, ISODate/Cents imports), `tests/unit/<name>.test.ts` (known-answer table skeleton), and an EDGE_CASES.md section stub. Write/Edit-based (lesson: never shell heredocs). |
| S2 | `scripts/ledger.ts <decision\|regression\|progress> "…"` | Hand-formatting ledger entries | Appends a correctly-formatted, numbered entry (next decision # auto-detected); `regression` takes `symptom\|cause\|rule\|test`. Also regenerates `docs/DECISIONS_INDEX.md` (one line per decision) so sessions stop grepping a 450KB file. |
| S3 | `scripts/docs-lint.ts` | Manual doc-drift hunts | Fails/warns on: "Pulse" outside the frozen allowlist (seed strings, `demo@pulse.finance`), hardcoded test counts anywhere but STATUS.md, missing `> HISTORICAL` banner on archived docs, verify-command phrasing drift. Add as a warning step in `verify.yml`. |
| S4 | `package.json` aliases | Retyping | `verify` (=bash scripts/verify.sh), `verify:e2e` (VERIFY_E2E=1), `verify:fast` (tsc+eslint+vitest only), `eval:categorize`. Ends the `npm run verify` vs `bash scripts/verify.sh` doc drift by making both true. |

## 3. Tier 2 — Claude Code skills (`.claude/skills/<name>/SKILL.md`)

Each skill: frontmatter `name` + one-job `description` (LOOP rule 11: descriptions must not
overlap), body = the distilled procedure + copy-paste templates + pointers, ≤ ~150 lines.
Source material exists; building each is mostly extraction, not invention.

| # | Skill | Trigger (description) | Contents | Sources |
|---|---|---|---|---|
| K1 | `hostile-critic` | Run the end-of-phase hostile-critic review | Persona, 8-axis scorecard template, P0/P1/P2 format, evidence rules ("no pass on vibes"), per-domain attack checklists (money math, security/authz, categorization sign-guards, coach-copy guardrails), 4-cycle cap, fresh-context-checker instruction | CRITIC_RUBRIC.md, SPEC critic section, recurring critic transcripts in STATUS.md |
| K2 | `new-engine` | Create a new pure business-logic engine | Engine-before-UI order: EDGE_CASES entry first → run S1 → conventions (integer cents, ISODate, no I/O, recompute-from-scratch) → known-answer tests → server glue (ownership-scoped) → golden-safety check | CLAUDE.md §5, PHASE_0, any exemplar engine |
| K3 | `mutation-form` | Add/modify a form that mutates data | The proven recipe verbatim: onSubmit (never useActionState), own busy state, `withDeadline`, flash + reload/navigate on success; template component; the React-19 auto-reset failure mode it prevents | docs/lessons/mutation-form-recipe.md |
| K4 | `e2e-recipe` | Write or debug a Playwright e2e | mobile-380 project config, seeded e2e DB pattern, axe AA assertion snippet, **error-signature triage table** (`intercepts pointer events` = the flake; anything else = real bug, per #193), throwaway-user integration pattern | playwright.config.ts, lessons #193, existing specs |
| K5 | `schema-change` | Add or alter a Prisma model/column | Additive-only rule, nullable-with-documented-default idiom, exact sequence: schema.prisma → `gen-pg-schema.mjs` → generate → db push → seed untouched → golden byte-identical assertion → both-DB portability notes | db-adapter.ts, gen-pg-schema.mjs, #122/#123/#124 precedents |
| K6 | `session-close` | End a substantive session / phase | Ordered close-out: verify green (paste real) → S2 ledger entries → TASKS.md status flip → lessons-worthy? (one-file lesson + INDEX line) → PASS/FAIL contract → NEXT MODEL line (Claude Code only) | LOOP_ENGINEERING, CLAUDE.md handoff |
| K7 | `categorization-tuning` | Improve merchant normalization / review rate | Where tables live (normalize.ts), how to add merchants/synonyms safely (sign-guard #44, aggregate rules), run `eval:categorize` before/after, interpret review-rate + Brier deltas, seed-vs-messy-corpus honesty (see §5 D3) | normalize.ts, categorize-eval.ts, CATEGORIZATION_DIAGNOSIS |
| K8 | `deploy-runbook` | Deploy or change production env | DEPLOY.md distilled to an ordered checklist + env-var matrix (which key activates which dormant system), cron/plan-tier gates, post-deploy smoke checks | DEPLOY.md, vercel.json, activation items from TASKS 0.3/0.5 |

**Agents to define in-repo** (make the routing policy real on every machine):
- `.claude/agents/explorer.md` — model: haiku, read-only tools (Read/Grep/Glob), returns
  structured reports; the subagent LOOP_ENGINEERING already mandates.
- `.claude/agents/critic.md` — fresh-context verifier persona wired to K1; model chosen per
  COMPETITIVE_GAP_PLAN §3 at invocation (Fable for money/security domains).

## 4. Cursor / Grok mirroring (`.cursor/rules/*.mdc`)

Cursor's equivalent of skills is scoped rules. Mirror only the skills Grok is allowed to use
(per TASKS.md routing, Grok stays off money engines and critic passes):

| Rule file | Mirrors | Attach |
|---|---|---|
| `mutation-form.mdc` | K3 | glob: `src/components/**/*form*.tsx`, `src/server/*-actions.ts` |
| `e2e-recipe.mdc` | K4 | glob: `tests/e2e/**` |
| `schema-change.mdc` | K5 (with a "stop and hand to Claude if non-additive" line) | glob: `prisma/**` |
| `session-close.mdc` | K6 minus NEXT-MODEL line | agent-requested (description) |
| `aimplifi-boot.mdc` | (exists) add one line pointing to TASKS.md as the queue | alwaysApply |

Scripts (S1–S4) are shared by every tool automatically — that's why they're tier 1.

## 5. Docs: redundancy findings & the cleanup plan

The core rules (no-fabrication, integer cents, verify gate, demo-first, model routing) are
stated in up to **8 places** but agree — that redundancy is *deliberate* (AGENTS.md says so)
and should stay. The harmful redundancy is **status**, tracked in 7+ places with proven
drift, and **stale entry points**. Findings → actions:

- **D1 — One status home.** Test counts differ across README (409/18), REVIEW_CYCLES
  (409/18), session docs (1142→1229), ROADMAP (~1229), gap plan (1411): none authoritative.
  ROADMAP and the gap plan both carry "this list was stale" reconciliation scars. **Action:**
  STATUS.md (+ TASKS.md for the queue) is the only place status lives; ROADMAP becomes
  forward-looking only; README/PHASES/gap-plan get pointers, never counts. Add one line to
  CLAUDE.md codifying this; S3 docs-lint enforces the no-hardcoded-counts rule.
- **D2 — Archive the stale entry point.** START_HERE.md is fully pre-rename ("Pulse Finance
  Handoff Kit", "begin Phase 1") and contradicts AGENTS.md's reading order. **Action:** move
  to `docs/archive/` with a `> HISTORICAL` banner; README points humans at AGENTS.md.
- **D3 — Reconcile the review-rate claim.** README/SPEC/PHASES assert the <5% target as met
  (3.60% on seed); CATEGORIZATION_DIAGNOSIS documents 33–60% on the messy corpus. Both are
  true of different datasets; the top-level docs only tell the flattering half. **Action:**
  README states both honestly ("3.6% on the seed benchmark; messy-corpus rate tracked in
  eval:categorize output"). This is a trust product — the docs should meet its own bar.
- **D4 — Banner the historical plans.** SPEC.md, PHASE_0_ARCHITECTURE.md: add
  `> HISTORICAL — original build prompt/plan, pre-rename; current rules live in CLAUDE.md`.
  SCHWAB_PROVIDER_SKETCH.md: add "premise superseded by #124 (SimpleFIN holdings ingest)".
- **D5 — Archive one-offs.** SESSION_CONTEXT_×4 (self-labeled "safe to /clear"),
  PULSE_CATEGORIZATION_FIX.md + CATEGORIZATION_DIAGNOSIS.md (task prompt + point-in-time
  diagnosis), REVIEW_CYCLES.md (frozen 2026-06-12) → `docs/archive/`.
- **D6 — Finish the rename.** "Pulse" leaks remain in DEPLOY, PRIVACY, PLAID_WALKTHROUGH,
  SIMPLEFIN_WALKTHROUGH, SEED_SPEC titles/prose. Rename to Aimplifi **except** the frozen
  seed strings (`demo@pulse.finance`, seed descriptors) — S3 encodes the allowlist.
- **D7 — Harmonize the verify command.** `bash scripts/verify.sh` vs `npm run verify` both
  appear; S4 makes the alias real, docs may then say either.
- **D8 — Index the megafiles.** DECISIONS.md (453KB), STATUS.md (233KB), PROGRESS.md (274KB)
  are token hazards the explorer keeps re-scanning. S2 generates `DECISIONS_INDEX.md`;
  quarterly, rotate closed content to `docs/archive/STATUS-<quarter>.md`.
- **D9 — Owner reconciliations: RESOLVED 2026-07-21 (#262), no change needed.** The
  premise was a false dichotomy. The Vercel API returns a single team,
  `{"name": "Mike's projects", "slug": "reiforge"}` — "Mike's projects" is the display
  name used in BACKUP_AND_RECOVERY and "reiforge" is the URL slug used in
  SESSION_CONTEXT/DECISIONS #198. Both docs are correct about the same team.

**Intent clarity, net:** after D1–D8 the repo has exactly four kinds of markdown, each with
one job — **canon** (AGENTS/CLAUDE/LOOP + CRITIC_RUBRIC: how to work), **state** (STATUS,
TASKS, DECISIONS+index, REGRESSION_LEDGER, PROGRESS: what is true now), **plans** (ROADMAP
forward-only, gap plan, AI plan, audit: what's next and why), **archive** (everything
historical, bannered). A new agent or human can be told that sentence and never guess again.

## 6. Sequencing & routing (queued as Wave S in TASKS.md)

Order: S2+S4 (unblock ledger hygiene, ~1 session) → D1–D7 docs pass (one Sonnet session +
S3 to lock it) → K3/K4/K5 (the thrice-bitten recipes) → K1/K6 (biggest per-session token
savers) → S1/K2, K7, K8, agents. Everything is Sonnet/Grok-buildable except K1 (Opus — the
attack checklists need judgment to distill) and the K5 golden-safety wording (Opus). Nothing
here needs Fable. Estimated total: ~6 short sessions, mostly cheap models — repaid quickly:
K1+K6 alone remove ~15–20KB of re-read canon and re-derived procedure from *every*
substantive session, and S2/S3 remove whole classes of drift-hunting sessions (the #185/#186
reconciliation audits) permanently.
