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
| 0.1 | Push #171–#182 to GitHub; confirm CI (#181) runs verify.sh green. Single-machine loss risk until done. | Human + Sonnet (assist) | low | 10k | [x] DONE 2026-07-09. Pushed #171–#194 to origin/main. CI was disabled (owner saw no runs); owner ENABLED GitHub Actions, and the `verify` workflow run **#15** (triggered by the #194 push) was **owner-confirmed GREEN** on the clean Linux runner — first confirmed CI-arbiter pass. Single-machine-loss safety net + "CI is the arbiter" now hold. (History: #193 diagnosed the disabled-Actions root cause; workflow file itself was correct/pushed since #181.) |
| 0.2 | Quarantine mobile-380 Playwright flake on Windows (skip-if-local tag or CI-only gate) so local verify can exit 0 again; CI is the arbiter per docs/lessons. | Opus 4.8 | medium | 40k | [x] done 2026-07-09 (#193). No quarantine needed — the premise was a MISATTRIBUTION: local full-e2e was blocked by a DETERMINISTIC `auth.spec.ts` strict-mode locator bug (the #182 "Sign out of all devices" button made a bare `getByRole('button',{name:'Sign out'})` match 2 elements), not the viewport flake. Scoped the locator → `VERIFY_E2E=1` exits 0 (93 e2e); viewport flake did not reproduce across 3 full runs. See STATUS §Wave 0.2 + REGRESSION_LEDGER + lesson correction. |
| 0.3 | Deploy: Vercel + Neon, set `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SIGNUP_ALLOWLIST`, `CRON_SECRET`, `RESEND_API_KEY`, `VAPID_*`, `SENTRY_DSN` per docs/DEPLOY.md. Verify crons fire. | Human (keys) + Opus (guided walkthrough) | low | 10k | **[~] PARTIAL 2026-07-10 (#198/#203/#204).** Core + allowlist/cron/VAPID/Resend live; Resend domain **owner-verified** + test Delivered (#204). Sentry deferred (#203). Cron *fire* still UNVERIFIED. **Do not seed.** |
| 0.4 | Live SimpleFIN + Plaid sandbox spot-checks per walkthrough docs; flip UNVERIFIED labels with logged output. | Human (tokens) + Sonnet | low | 20k | [x] done 2026-07-09 (#191). Plaid `plaid:validate` → ✅ PASSED (12 accts/50 signed txns/1 statement) — label flipped UNVERIFIED→VERIFIED. SimpleFIN demo re-confirmed via access URL (3 accts, cents/signs OK); demo setup token found single-use→consumed, validator extended to accept an access URL. |
| 0.5 | Operator "activation checklist" panel in /settings: reads env-var *presence* (never values) and lists which dormant systems (push/email/digest/Sentry/crons) are live. Pure presence-map engine + tests. | Sonnet | medium | 40k | [x] done 2026-07-09 (#194). Pure `engine/ops/activation.ts` (7-system map, compound cron+provider gates) + 7 known-answer tests; RSC panel on /settings (`activation-card`) renders booleans + env-var NAMES only, no value crosses to client. Gate: VERIFY_E2E green — 2092 unit/159 files, 94 e2e (+1 coherence/secret-free/axe). See STATUS §Wave 0.5. |
| 0.6 | Neon scheduled backups per BACKUP_AND_RECOVERY.md. | Human (ops) | — | — | [!] BLOCKED (owner-only): Neon dashboard/ops, no `NEON_API_KEY`/`psql` in this env. Neon already keeps managed backups (BACKUP_AND_RECOVERY.md); this is the owner setting PITR retention / a scheduled dump. |

## Wave 1 — The return loop (30 days; retention)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 1.1 | **Return moment**: "Since you were away" dashboard interstitial composing Money Review + radar status + auto-filed count + price changes (all already computed; pure composer engine + one card, dismissable, shown when lastSeen > 7d). Engine-first + known-answer tests. | Opus 4.8 | medium | 60k | [x] done 2026-07-09 (#195, DECISIONS #195). Pure `engine/return-moment/build.ts` (verbatim composer, null ≤7d gap) + `server/return-moment.ts` (reads/stamps additive `User.lastSeenDate` calendar date, silent-band auto-filed count, no re-fetch) + dismissable `ReturnMomentCard` under the cash-needed answer. Golden-safe: fixed-today demo → gap 0 → no card. Gate VERIFY_E2E green — **2109 unit / 161 files** (+17: 9 engine + 8 integration), **95 e2e** (+1 demo golden-safety). See STATUS §Wave 1.1. |
| 1.2 | **Contextual follow-up chips** after every Ask answer: static intent→chips map (spend → "vs last month / by merchant / largest"), rendered from the existing suggestions plumbing. No new parsing. | Cursor/Grok 4.5 (map + UI) | — | — | [x] done 2026-07-09 (#197, DECISIONS #197). Pure `followUpQuestions` map + server merge onto `suggestions`; UI `ask-follow-up` chips. Gate: verify green — **2113 unit / 162 files**, ask.spec e2e **9/9**. See STATUS §Wave 1.2. |
| 1.3 | **Value receipts ledger**: persist each radar catch, reminder delivered, price-increase flag as a receipt row; cumulative "what Aimplifi caught" on /coach + digest line. Engine computes nothing new — copies amounts verbatim (notify/select.ts idiom). Money-adjacent copy ⇒ critic pass. | Opus 4.8 build; **Fable 5 critic pass** | med / high | 80k + 30k | [x] done 2026-07-10 (#206). Additive `ValueReceipt` (userId+key unique) + pure `engine/receipts` (verbatim copy, channel-agnostic keys) + delivery-gated minting in reminders/notify crons + /coach "What Aimplifi caught" card + digest tally via shared `receiptLines`. Honesty rule structural: per-kind counts/totals only, no cross-kind $ claim (copy-guardrail-locked). Built+criticized on Fable in one session. |
| 1.4 | Savings-rate streaks + small-win celebration copy (data exists in trend series; COACH_COPY additions guardrail-tested). | Sonnet | medium | 40k | [x] done 2026-07-10 (#205). Pure `computeSavingsStreak` + COACH_COPY + SavingsRateCard lines. |
| 1.5 | Route-specific empty states (coach/goals/calendar get their own framing instead of the shared EmptyDashboard card). | Cursor/Grok 4.5 | — | — | [x] done 2026-07-10 (#199, DECISIONS #199). `ConnectOnboardingPanel` extract + `EmptyCoach`/`EmptyGoals`/`EmptyCalendar`; auth.spec locks route h1 + connect affordances. Gate: verify green — **2113 unit / 162 files**, auth.spec **3/3**, guided-onboarding **1/1**. |
| 1.6 | Glass-Box shareable snapshot (redacted PNG/clipboard of a reconciled trace; no live data leaves the client). | Cursor/Grok 4.5 UI; Opus review (privacy) | medium | 30k | [x] done 2026-07-10 (#202). Pure redact + client clipboard/PNG (Canvas 2D, no third-party). Gate: verify **2117/163**; glass-box.spec share redaction. Opus privacy pass still welcome. |
| 1.7 | Personalized triage alternatives: `suggestAlternatives` consults the user's Correction history before the generic list. Pure function change + tests. | Opus 4.8 | medium | 40k | [x] done 2026-07-10 (#207). `deriveCorrectionHints` + triage wiring; golden empty history unchanged. |
| 1.8 | **Cross-provider duplicate-account guard**: the app has no cross-provider dedup, so the same real account linked via both Plaid and SimpleFIN double-counts. Pure detector + advisory /accounts warning. | Opus 4.8 | medium | 60k | [x] done 2026-07-09 (#192, DECISIONS #192). `engine/account/duplicates.ts` + `duplicate-accounts-warning` card; display-only, never auto-deletes. 2085 unit / 158 files, verify green. |

## Wave 2 — Ask grows a memory (90 days)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 2.1 | **Conversation frame engine**: pure, deterministic ellipsis resolution — hold `{lastIntent, timeframe, category, merchant}` per session; "what about last month / and groceries / same for Amex" re-runs the frame with one slot swapped. New parser semantics on a money-displaying surface. | **Opus 4.8 (high)** build; **Fable 5 critic** | high | 120k + 40k | [ ] |
| 2.2 | UnknownQuestion ledger: log unroutable + LLM-rescued phrasings (PII-scrubbed: strip digits/emails/amounts), tiny additive table, golden-safe. | Sonnet | medium | 40k | [x] done 2026-07-10 (#208). Pure `scrubQuestionText` + `UnknownQuestion` + `recordUnknownQuestion` on parser-unknown Ask; money engines never read it. |
| 2.3 | VocabEntry table + weekly mining pass (cron): cluster unknowns, promote to shadow→flagged→active per the audit §4.2 loop-2 gates (held-out replay before promotion). Routing-semantics change ⇒ critic. | Opus 4.8 build; **Fable 5 critic** | high | 100k + 30k | [ ] |
| 2.4 | Per-user vocab in the LLM classifier prompt (top merchants + custom categories injected into the closed-set prompt; closed set unchanged). | Sonnet | low | 20k | [ ] |
| 2.5 | Evaluate local Qwen (OpenAI-compatible endpoint) as the runtime intent/label picker per COMPETITIVE_GAP_PLAN §3 — provider addition behind existing validation. | Opus 4.8 | medium | 60k | [ ] |

## Wave 3 — The self-improving layer (90 days, follows audit §4)

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 3.1 | EngagementEvent capture: one generic additive table + thin record hooks on card view/dismiss/expand/act. First-party only, user-visible, no third-party analytics. | Opus 4.8 | medium | 60k | [x] done 2026-07-10 (#209). Closed-set `EngagementEvent` + `logEngagement` hooks on dashboard dismiss/expand/act; PRIVACY + AI-trust disclosure; writes-only (3.3 reads later). |
| 3.2 | Weekly self-audit snapshot (cron): per-user review-rate, unknown-rate, alert act-rate → metrics table, surfaced on the AI-trust panel (#177). This is the Critic that gates every other loop. | Opus 4.8 | medium | 60k | [x] done 2026-07-10 (#211). Pure `computeSelfAuditSnapshot` + `SelfAuditSnapshot` + `/api/cron/audit` (Mon 15:00) + AI-trust `SelfAuditMetrics`. Alert act-rate is an engagement proxy until 3.5. |
| 3.3 | Adaptive dashboard order: derive card weights from EngagementEvent at read time (learn.ts idiom — recompute-from-scratch, no ratchet); chronically-ignored cards collapse behind "More". Critical alerts never demotable. | Opus 4.8 build; Cursor/Grok UI | medium | 80k | [ ] |
| 3.4 | Tenure/tone coach-copy variants: pre-written COACH_COPY variants (guardrail-test-scanned) selected by tenure bucket + dismissal history. Runtime picks *which approved sentence*, never what it says. | Sonnet (variants) + Opus (selector) | medium | 60k | [ ] |
| 3.5 | Notification cadence adaptation: repeatedly-dismissed-without-action alert kinds demote a level (never below critical floor); acted-on kinds hold. Extends notify/select.ts quiet rules. | Opus 4.8; **Fable 5 critic** (alert suppression = safety surface) | high | 60k + 30k | [ ] |
| 3.6 | **Bounded per-user threshold tuning**: nudge AUTO_FLAGGED_BPS ±500bps from per-user Brier, clamped, recomputed-from-scratch, auto-revert on Brier regression. Money-routing change. | **Fable 5** (xhigh) + hostile critic | xhigh | 150k | [x] |
| 3.7 | Learned-rule recency decay in learn.ts (stale intent fades; undo already handles reversal). | Opus 4.8 | medium | 40k | [ ] |

## Wave 4 — Structural bets (6 months)

> **Household mode GREEN-LIT (owner decision #196, 2026-07-09):** family/household is
> in scope this year — the Wave-4 owner-decision gate is satisfied. Schedule 4.1 (the
> architecture spike + decision doc) sooner rather than later; authz retrofit cost only
> grows. Monetization is intended-but-later (household is the natural paid tier).


| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| 4.1 | **Household architecture spike**: partner logins, scoped account sharing, joint cash-needed, per-partner money dials; authz model across every server action. Decision doc + schema design only. | **Fable 5** (xhigh) | xhigh | 150k | [x] done 2026-07-10 (#200, DECISIONS #200). `docs/HOUSEHOLD_ARCHITECTURE.md`: household entity + membership (one/user v1) + per-account read-only sharing Boolean; all 41 existing actions' authz untouched; one central `visibleAccountsWhere`; joint cash-needed via query-scoped `getSharedSnapshotSlice` + pure merge; lazy-repair lifecycle; code+DB-email invites. Fresh-context Fable critic cycle 1 FAIL (5 P1) → all fixed in doc; T1–T12 invariants each mapped to a locking test. 6-slice MVP plan feeds 4.2. |
| 4.2 | Household MVP slices per 4.1 (8 slices in HOUSEHOLD_ARCHITECTURE.md §5; each engine-first, verify green): 1 membership core (Opus + **Fable critic** on state machine) · 2 visibleAccountsWhere + /accounts shared section · 3 register shared rows · 4 joint cash-needed (**Fable critic**, money) · 5 cards/calendar + copy (Sonnet) · 6 partner categorization per #201 boundary (**Fable critic**, categorization routing) · 7 joint household digest (#201) · 8 full-surface hostile critic (Fable). | Opus 4.8 per slice; Fable critic on authz/money/routing | high | 100k/slice | [~] slices 1–6 DONE. Slice 1 2026-07-10 (#210). Slice 2 2026-07-10 (#212). Slice 3 2026-07-10 (#213): `getSharedTransactionsView` SEPARATE path + `categoryNamesByIds` (never getCategoryMeta widen) + read-only SharedTransactionList + T1/T3/F3 locks + consent copy. Slice 4 2026-07-11 (#215): `getSharedSnapshotSlice` + pure `mergeSnapshots`, `getCashNeeded`/`getDashboardData` scope param, dashboard toggle. Fresh-context Fable critic cycle 1: 1 P0 (funding account could resolve to a partner's shared checking) fixed + regression-locked. Slice 5 2026-07-12 (#218): /cards + /calendar wired to the existing scope support (pure plumbing, no engine change); `HouseholdScopeToggle` generalized (basePath + extraParams, calendar carries `month`); `cardId → ownerLabel` map built server-side (no owner field on `CardObligation`); cross-app copy audit extracted every household disclosure into `src/lib/copy/household-copy.ts` with a new guardrail test. No Fable critic this slice (Sonnet-lane per the plan — no money math or categorization routing touched, scope param threads the already-critiqued slice-4 merge verbatim). Slice 6 2026-07-12 (#219): `recategorizeSharedTransaction` (`src/server/household-actions.ts`) — one-off only, system categories only, acting-user-attributed Correction, `CategoryPrediction.labeledAt` never touched, authz re-derived fresh inside the tx (TOCTOU-closed); `SharedTransactionList` upgraded to an interactive one-off picker. Fresh-context Fable critic (dispatched as an independent agent) cycle 1 FAIL — 2 P1 (Plaid pending→posted correction transplant scoped by the syncing owner's userId stranded a partner's correction and let a re-sync silently revert it; missing scalar-input validation + audit meta logging raw input instead of the resolved row) + 7 P2, ALL FIXED + re-verified (see DECISIONS #219, STATUS §Wave 4.2 slice 6). Slice 7 2026-07-12 (#220): joint household digest — a member with a live partner gets ONE household-scope weekly email instead of the personal one (dues via the slice-4 merge at `'household'` scope + a shared-account movement summary + the §4.4 assumptions copy inline). New pure `engine/household/digest.ts` (`summarizeSharedMovement`; excludes transfers, split parents, PENDING — the same exclusion set as coach/radar) + Prisma-only `server/household-digest.ts` (no NextAuth in the cron import graph); `buildWeeklyDigest` gains an optional `household` field, absent which the personal digest is byte-identical (T6, deep-equality locked). Household copy guardrail scan is now EXHAUSTIVE over `HOUSEHOLD_COPY`'s keys. Deliberate DEVIATION from a literal reading of #201(b), recorded in DECISIONS #220: the joint email is composed PER RECIPIENT, because household scope is viewer-relative by §4.4's own definition — one byte-identical email could only be built by leaking a partner's unshared card (T1) or by dropping each member's own private-card reminders. Next: slice 8 — full-surface hostile critic over T1–T12 (Fable, fresh context). |
| 4.3 | Plaid `/investments/holdings` parity with the SimpleFIN path. | Opus 4.8 | medium | 60k | [ ] |
| 4.4 | Crisis-mode coach framing (multi-collision radar state → triage-order copy; guardrails extended, not bypassed). | Opus 4.8 + Sonnet copy | medium | 50k | [ ] |
| 4.5 | Widen the allowlist deliberately; watch Wave-3.2 metrics as the first real cohort lands. | Human | — | — | [ ] |

## Wave S — Skills, scripts & docs hygiene (see docs/SKILLS_PLAN.md for full specs)

Cheap-model wave: removes repeated AI work from every future session. Do S-tasks between
feature waves; none blocks Wave 0.

| # | Task | Owner/Agent | Effort | Est. budget | Status |
|---|------|-------------|--------|------------|--------|
| S.1 | `scripts/ledger.ts` (decision/regression/progress appender + DECISIONS_INDEX.md generator) + package.json aliases (`verify`, `verify:e2e`, `verify:fast`, `eval:categorize`). Plan §2 S2+S4. | Sonnet | medium | 40k | [x] done 2026-07-10 (DECISIONS #214). `scripts/ledger.ts` (decision/regression/progress appenders, CRLF-safe, DECISIONS_INDEX.md generator) + package.json `verify:e2e`/`verify:fast`/`ledger` aliases (`verify`/`eval:categorize` already existed). Also restored TASKS.md itself, which had lost Waves 0-4 completed-status history in the working tree before this session (see PROGRESS.md). Gate: `bash scripts/verify.sh` → VERIFY GREEN, 2271 unit/177 files, build clean. |
| S.2 | Docs de-dup pass D1–D8 (plan §5): archive START_HERE/SESSION_CONTEXT×4/REVIEW_CYCLES/categorization one-offs; HISTORICAL banners on SPEC/PHASE_0/SCHWAB sketch; finish Pulse→Aimplifi rename (frozen seed strings excluded); README test-count + review-rate honesty fix; one-status-home rule added to CLAUDE.md. | Sonnet (or Cursor/Grok) | medium | 50k | [x] done 2026-07-11 (DECISIONS #216). D1: hardcoded test counts removed from README/ROADMAP/COMPETITIVE_GAP_PLAN, replaced with pointers to docs/STATUS.md; one-status-home rule added to CLAUDE.md §Conventions. D2/D4: HISTORICAL banners added to docs/archive/START_HERE.md, SPEC.md, docs/PHASE_0_ARCHITECTURE.md, docs/SCHWAB_PROVIDER_SKETCH.md, and (closing a gap from the earlier D5 archive pass) the 6 other docs/archive/*.md files that docs/archive/README.md already claimed all carried a banner. D3: README review-rate line now also points to `eval:categorize` for the messy-corpus number. D6: renamed remaining Pulse→Aimplifi prose leaks in docs/DEPLOY.md, docs/PRIVACY.md, docs/PLAID_WALKTHROUGH.md, docs/SIMPLEFIN_WALKTHROUGH.md (frozen `demo@pulse.finance` seed string + cosmetic Neon example DB name left untouched, out of scope). D7 needed no change. D8: DECISIONS_INDEX.md confirmed current; quarterly megafile rotation NOT built (accepted follow-up, doesn't block this row). D9 remains owner-only (S.9). Doc-only change — no code touched, so the code-facing verify gate is unaffected; re-ran `bash scripts/verify.sh` anyway as a sanity check (see PROGRESS.md). |
| S.3 | `scripts/docs-lint.ts` (Pulse-leak allowlist, hardcoded-count ban, archive banners, command phrasing) + warning step in verify.yml. Locks S.2 permanently. | Sonnet | medium | 40k | [x] done 2026-07-11 (DECISIONS #217). `scripts/docs-lint.ts` walks every tracked `*.md` file for: unallowlisted "Pulse" mentions, hardcoded test-count claims outside docs/STATUS.md, missing `> HISTORICAL` archive banners, and stale verify-command phrasing. Ledgers + anything bannered HISTORICAL are exempt (frozen records, not living docs). `npm run docs:lint` alias; non-gating `continue-on-error: true` step added to .github/workflows/verify.yml (does not touch the required verify job). Ran clean against the full repo (0 findings, 49 files) — confirms S.2 already holds. Gate: `bash scripts/verify.sh` → VERIFY GREEN, 2285 unit / 178 files, build clean. |
| S.4 | Skills K3 `mutation-form`, K4 `e2e-recipe`, K5 `schema-change` (.claude/skills/) + their .cursor/rules mirrors. Extraction from lessons/precedents. | Sonnet; Opus reviews K5 golden-safety wording | medium | 60k | [ ] |
| S.5 | Skills K1 `hostile-critic` + K6 `session-close` — the biggest per-session token savers. | Opus 4.8 | medium | 60k | [ ] |
| S.6 | `scripts/scaffold-engine.ts` + skill K2 `new-engine`. | Sonnet | medium | 40k | [ ] |
| S.7 | Skills K7 `categorization-tuning` + K8 `deploy-runbook`. | Sonnet | low | 30k | [ ] |
| S.8 | Define `.claude/agents/explorer.md` (haiku, read-only) + `.claude/agents/critic.md` in-repo so the routing policy works on every machine/CI. | Sonnet | low | 20k | [ ] |
| S.9 | Owner reconciliation D9: Vercel team name ("reiforge" vs "Mike's projects") — confirm and fix the wrong doc. | Human | — | — | [ ] |


## Standing rules for whoever picks up a task

1. Read `AGENTS.md` → `LOOP_ENGINEERING.md` → `CLAUDE.md` → `docs/lessons/INDEX.md` first, every session.
2. One task per session; explorer (Haiku) for all reconnaissance; budget above is the output ceiling — at the ceiling, checkpoint to PROGRESS.md and stop.
3. Anything touching money display, routing, authz, or alert suppression ends with a hostile-critic pass on the model marked in its row — no exceptions for Cursor/Grok work.
4. Additive schema only (golden/demo byte-identical); every adaptation user-visible and undoable per audit §4 constitution.
5. Done = verify green + tests + ledger entries + Status flipped here in the same commit.
