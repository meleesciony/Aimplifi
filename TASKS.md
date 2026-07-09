# TASKS.md — Prioritized build queue with model routing

*Derived from `docs/STRATEGIC_AUDIT_2026-07-09.md` (read it for the "why" behind every task).
Every task obeys AGENTS.md / CLAUDE.md / LOOP_ENGINEERING.md: engine-first, integer cents,
`bash scripts/verify.sh` green before done, hostile critic on money/security/data-integrity,
regression ledger on every fix. Update the Status column in place; record decisions in
`docs/DECISIONS.md`.*

## Routing policy (token efficiency is a core principle)

Per `docs/COMPETITIVE_GAP_PLAN.md` §3. Pricing (per MTok in/out): Fable 5 $10/$50 · Opus 4.8
$5/$25 · Sonnet $3/$15 · Haiku 4.5 $1/$5. Output tokens dominate agentic sessions.

- **Fable 5 (effort high/xhigh)** — ONLY: new money-math/routing semantics, architecture
  decisions, hostile-critic passes on money/security/data-integrity. Costs 2× Opus; spend it
  exactly where a silent bug is most expensive.
- **Opus 4.8 (effort medium default, high for engines)** — the daily driver: feature slices,
  server wiring, refactors, routine critic cycles. ~80% of Claude sessions.
- **Sonnet (or Opus at effort: medium)** — well-specified mechanical slices, copy variants,
  test scaffolds, docs.
- **Haiku `explorer` subagent** — ALL heavy reads/exploration, on every task, regardless of the
  main model. Never paste whole files into a Fable/Opus context.
- **Cursor / Grok 4.5** — UI polish, route-specific empty states, e2e authoring from existing
  recipes (`docs/lessons/mutation-form-recipe.md`), chip/copy plumbing, test scaffolds. Binds
  to AGENTS.md like every agent. **Never** on money-math engines, categorization routing,
  authz, or critic passes — Claude owns those; Grok's output there still costs a Fable review,
  which erases the savings.

**Session hygiene (all models):** explorer-first for anything >2 files; state in ledgers, not
scrollback; one task = one session where possible; `high/xhigh` effort only for engine/critic
work. Est. budget = rough output-token ceiling for the session (LOOP_ENGINEERING rule 7); at
the ceiling without a verified result, write findings to PROGRESS.md and stop.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done (verify green) · `[!]` blocked.

---

## Wave 0 — Ship what's built (this week; ops-bound, highest leverage in the repo)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 0.1 | Push #171–#182 to GitHub; confirm CI (#181) runs verify.sh green. Single-machine loss risk until done. | Human + Sonnet (assist) | low | 10k | [ ] |
| 0.2 | Quarantine mobile-380 Playwright flake on Windows (skip-if-local tag or CI-only gate) so local verify can exit 0 again; CI is the arbiter per docs/lessons. | Opus 4.8 | medium | 40k | [ ] |
| 0.3 | Deploy: Vercel + Neon, set `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SIGNUP_ALLOWLIST`, `CRON_SECRET`, `RESEND_API_KEY`, `VAPID_*`, `SENTRY_DSN` per docs/DEPLOY.md. Verify crons fire. | Human (keys) + Haiku (checklist walkthrough) | low | 10k | [ ] |
| 0.4 | Live SimpleFIN + Plaid sandbox spot-checks per walkthrough docs; flip UNVERIFIED labels with logged output. | Human (tokens) + Sonnet | low | 20k | [ ] |
| 0.5 | Operator "activation checklist" panel in /settings: reads env-var *presence* (never values) and lists which dormant systems (push/email/digest/Sentry/crons) are live. Pure presence-map engine + tests. | Sonnet | medium | 40k | [ ] |
| 0.6 | Neon scheduled backups per BACKUP_AND_RECOVERY.md. | Human (ops) | — | — | [ ] |

## Wave 1 — The return loop (30 days; retention)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 1.1 | **Return moment**: "Since you were away" dashboard interstitial composing Money Review + radar status + auto-filed count + price changes (all already computed; pure composer engine + one card, dismissable, shown when lastSeen > 7d). Engine-first + known-answer tests. | Opus 4.8 | medium | 60k | [ ] |
| 1.2 | **Contextual follow-up chips** after every Ask answer: static intent→chips map (spend → "vs last month / by merchant / largest"), rendered from the existing suggestions plumbing. No new parsing. | Cursor/Grok 4.5 (map + UI) | — | — | [ ] |
| 1.3 | **Value receipts ledger**: persist each radar catch, reminder delivered, price-increase flag as a receipt row; cumulative "what Aimplifi caught" on /coach + digest line. Engine computes nothing new — copies amounts verbatim (notify/select.ts idiom). Money-adjacent copy ⇒ critic pass. | Opus 4.8 build; **Fable 5 critic pass** | med / high | 80k + 30k | [ ] |
| 1.4 | Savings-rate streaks + small-win celebration copy (data exists in trend series; COACH_COPY additions guardrail-tested). | Sonnet | medium | 40k | [ ] |
| 1.5 | Route-specific empty states (coach/goals/calendar get their own framing instead of the shared EmptyDashboard card). | Cursor/Grok 4.5 | — | — | [ ] |
| 1.6 | Glass-Box shareable snapshot (redacted PNG/clipboard of a reconciled trace; no live data leaves the client). | Cursor/Grok 4.5 UI; Opus review (privacy) | medium | 30k | [ ] |
| 1.7 | Personalized triage alternatives: `suggestAlternatives` consults the user's Correction history before the generic list. Pure function change + tests. | Opus 4.8 | medium | 40k | [ ] |

## Wave 2 — Ask grows a memory (90 days)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 2.1 | **Conversation frame engine**: pure, deterministic ellipsis resolution — hold `{lastIntent, timeframe, category, merchant}` per session; "what about last month / and groceries / same for Amex" re-runs the frame with one slot swapped. New parser semantics on a money-displaying surface. | **Opus 4.8 (high)** build; **Fable 5 critic** | high | 120k + 40k | [ ] |
| 2.2 | UnknownQuestion ledger: log unroutable + LLM-rescued phrasings (PII-scrubbed: strip digits/emails/amounts), tiny additive table, golden-safe. | Sonnet | medium | 40k | [ ] |
| 2.3 | VocabEntry table + weekly mining pass (cron): cluster unknowns, promote to shadow→flagged→active per the audit §4.2 loop-2 gates (held-out replay before promotion). Routing-semantics change ⇒ critic. | Opus 4.8 build; **Fable 5 critic** | high | 100k + 30k | [ ] |
| 2.4 | Per-user vocab in the LLM classifier prompt (top merchants + custom categories injected into the closed-set prompt; closed set unchanged). | Sonnet | low | 20k | [ ] |
| 2.5 | Evaluate local Qwen (OpenAI-compatible endpoint) as the runtime intent/label picker per COMPETITIVE_GAP_PLAN §3 — provider addition behind existing validation. | Opus 4.8 | medium | 60k | [ ] |

## Wave 3 — The self-improving layer (90 days, follows audit §4)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 3.1 | EngagementEvent capture: one generic additive table + thin record hooks on card view/dismiss/expand/act. First-party only, user-visible, no third-party analytics. | Opus 4.8 | medium | 60k | [ ] |
| 3.2 | Weekly self-audit snapshot (cron): per-user review-rate, unknown-rate, alert act-rate → metrics table, surfaced on the AI-trust panel (#177). This is the Critic that gates every other loop. | Opus 4.8 | medium | 60k | [ ] |
| 3.3 | Adaptive dashboard order: derive card weights from EngagementEvent at read time (learn.ts idiom — recompute-from-scratch, no ratchet); chronically-ignored cards collapse behind "More". Critical alerts never demotable. | Opus 4.8 build; Cursor/Grok UI | medium | 80k | [ ] |
| 3.4 | Tenure/tone coach-copy variants: pre-written COACH_COPY variants (guardrail-test-scanned) selected by tenure bucket + dismissal history. Runtime picks *which approved sentence*, never what it says. | Sonnet (variants) + Opus (selector) | medium | 60k | [ ] |
| 3.5 | Notification cadence adaptation: repeatedly-dismissed-without-action alert kinds demote a level (never below critical floor); acted-on kinds hold. Extends notify/select.ts quiet rules. | Opus 4.8; **Fable 5 critic** (alert suppression = safety surface) | high | 60k + 30k | [ ] |
| 3.6 | **Bounded per-user threshold tuning**: nudge AUTO_FLAGGED_BPS ±500bps from per-user Brier, clamped, recomputed-from-scratch, auto-revert on Brier regression. Money-routing change. | **Fable 5** (xhigh) + hostile critic | xhigh | 150k | [x] |
| 3.7 | Learned-rule recency decay in learn.ts (stale intent fades; undo already handles reversal). | Opus 4.8 | medium | 40k | [ ] |

## Wave 4 — Structural bets (6 months; each needs an owner decision in DECISIONS.md first)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 4.1 | **Household architecture spike**: partner logins, scoped account sharing, joint cash-needed, per-partner money dials; authz model across every server action. Decision doc + schema design only. | **Fable 5** (xhigh) | xhigh | 150k | [ ] |
| 4.2 | Household MVP slices per 4.1 (multiple sessions; each slice engine-first). | Opus 4.8 per slice; Fable critic on authz | high | 100k/slice | [ ] |
| 4.3 | Plaid `/investments/holdings` parity with the SimpleFIN path. | Opus 4.8 | medium | 60k | [ ] |
| 4.4 | Crisis-mode coach framing (multi-collision radar state → triage-order copy; guardrails extended, not bypassed). | Opus 4.8 + Sonnet copy | medium | 50k | [ ] |
| 4.5 | Widen the allowlist deliberately; watch Wave-3.2 metrics as the first real cohort lands. | Human | — | — | [ ] |

---

## Standing rules for whoever picks up a task

1. Read `AGENTS.md` → `LOOP_ENGINEERING.md` → `CLAUDE.md` → `docs/lessons/INDEX.md` first, every session.
2. One task per session; explorer (Haiku) for all reconnaissance; budget above is the output ceiling — at the ceiling, checkpoint to PROGRESS.md and stop.
3. Anything touching money display, routing, authz, or alert suppression ends with a hostile-critic pass on the model marked in its row — no exceptions for Cursor/Grok work.
4. Additive schema only (golden/demo byte-identical); every adaptation user-visible and undoable per audit §4 constitution.
5. Done = verify green + tests + ledger entries + Status flipped here in the same commit.
