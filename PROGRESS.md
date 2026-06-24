# PROGRESS.md — session resume log

## 2026-06-23 — Spending Trends / insights (#74, surpass feature #7) — DONE ✅
User "cont" → continued the match-and-surpass series after the #73 SimpleFIN bug
fix. Chose feature #7: the "what changed" lens (movers/pace/largest/new merchants)
the category/recurring/forecast views never exposed. Engine-first: pure
`engine/trends/trends.ts` as a thin exact layer over the tested
`spendingByCategory` (one spend definition, no model calls) → `server/trends.ts`
(shared ownership-scoped snapshot) → `/trends` page + dashboard
`SpendingInsightsCard` + reciprocal /reports link (no 8th nav icon, #71).
Verify: typecheck/lint clean, **807 unit/65 files, 46 e2e**, build clean (✅ GREEN).
Hostile critic (wf_a12a2a9e, 4 dims + adversarial verify): fin 7/edge 7/sec 9/UX 8;
1 P1 (Store Card as "new merchant") resolved as a docstring over-claim — this repo
deliberately treats Store Card Purchase as a real rule-eligible merchant
(assign.ts + triage e2e), so corrected the doc + added an integrated normalize→engine
test instead of breaking that decision. Cheap P2s fixed; rest accepted (STATUS #74).
Earlier e2e caught a real dark-mode contrast miss (opacity-80 % label) → fixed.


Session goal (user: "lets go one by one and do all"): build three roadmap threads
in order, each engine-first → verify green → hostile critic → commit.

Baseline at session start: `bash scripts/verify.sh` → **GREEN** (647 unit / 42 files,
typecheck+lint clean, next build clean). E2E opt-in (VERIFY_E2E=1).

## Feature 1 — Manual card statements (IN PROGRESS)
**Why:** a manual CREDIT card (DECISIONS #45) has `type==='CREDIT'` so the cash-needed
engine treats it as a card, but with no Statement AND no cycle days `buildObligation`
returns null (engine.ts:83) → the card is DROPPED from "how much do I need & when",
counting only toward net worth. Goal: let a manual card carry a current statement
(+ APR + autopay) so it runs the PRECISE path.

**Key facts found (ground truth):**
- No schema change: `Statement` already exists for any account; `@@unique([accountId, cycleEnd])`.
- `getFinanceSnapshot` loads ALL statements/autopays `where: { account: { userId } }`,
  so a manual statement flows into the engine with zero plumbing changes.
- Engine picks up `accounts.filter(a => a.type === 'CREDIT')`; `current` = newest stmt
  whose dueDate ≥ today OR with unpaid remainder; else estimate (needs cycle days) else null.
- `assemble.ts` precise path uses statement.{statementBalanceCents,minimumPaymentCents,dueDate,cycleEnd}.
- Money: `centsFromDollarString` throws on junk; "24.99" → 2499 (reusable for APR bps).
  Dates: `isoDate` throws on invalid; `addMonthsClamped`, `compareDates`, `daysBetween`.
- /accounts data = `getAccountsView` (no statement info today); UI in `accounts-list.tsx`
  (`ManualRow`). Integration-test idiom: `tests/unit/networth-actions.test.ts` (throwaway user).

**Plan / steps:**
1. [x] `src/lib/engine/cards/manual-statement.ts` — pure `parseManualStatement` (+ derived
   cycleStart, cycleCloseDayOfMonth, dueDayOfMonth, autopay), all-errors-at-once.
2. [x] `tests/unit/manual-card-statement.test.ts` — parser known-answer + END-TO-END (10 tests).
3. [x] `src/server/card-actions.ts` — set/clear, owned-manual-CREDIT guard, atomic ARRAY
   `$transaction` (interactive form timed out under parallel SQLite — array form is the
   house pattern, triage-actions.ts:315). `tests/unit/card-actions.test.ts` (6 tests).
4. [x] `getAccountsView`+AccountsView carry `cardBilling`; `accounts-list.tsx` ManualRow
   "+ Add statement" / summary + `manual-card-statement-form.tsx`.
5. [x] `tests/e2e/manual-card-statement.spec.ts` — $0 statement (headline-neutral) round-trip.
6. [~] DONE: `VERIFY_E2E=1 bash scripts/verify.sh` → GREEN (663 unit / 44 files, 33 e2e).
   IN FLIGHT: multi-agent hostile critic (wf_786483e0). TODO after: apply confirmed P0/P1,
   re-verify, write DECISIONS #46 + ROADMAP/STATUS, commit.

## Feature 1 — DONE ✅ (commit dc223fe, verify+e2e green, critic 0 P0/P1)

## Feature 2 — Payment reminders (ROADMAP #6) — IN PROGRESS
**Why:** calendar badges due days but there's NO notification mechanism. Add a
credential-free notification pipeline + an in-app reminders surface.
**Found:** cron pattern = CRON_SECRET Bearer + per-user sweep + audit + no-abort
(api/cron/sync). No email infra exists. DEMO_TODAY=2026-06-10; demo cards due
Jun 23–26 (~13–16 days out) → dashboard panel needs the whole cycle (no tight window);
cron email uses a short imminent window. calendar/build.ts already lays obligations on days.
**Plan:**
1. [ ] `engine/reminders/select.ts` — pure `selectPaymentReminders` (obligations within
   window, urgency today/soon/upcoming, autopay-covered, dismissed) + `buildReminderEmail`
   (pure text, educational/no-shame). Known-answer tests.
2. [ ] `lib/email.ts` — `sendEmail` dormant fallback (no RESEND_API_KEY → {sent:false} no
   network; with key → Resend POST; never throws). Tests: no-key + mocked success/fail.
3. [ ] `api/cron/reminders/route.ts` — CRON_SECRET-guarded sweep: per user build+dispatch
   reminders (email dormant → logs would-send), audit, summary. Route test (auth gate + dormant).
4. [ ] dashboard `PaymentRemindersCard` (derived from payInFull obligations, whole cycle),
   wired below the cash-needed card (above-the-fold unaffected). e2e: panel renders.
5. [x] DONE — critic ran (wf_3889cb35): 2 P1s FIXED (F1 cards/upcoming double-count →
   pass cards only + selector dedup + e2e uniqueness; PR6-001 autopay-topup disclosure
   → both-portions in email+card + fixture). P2s fixed: shared constant-time cron compare
   (SEC-1), keyed-send cron test, tomorrow/soon-boundary tests, long email dates, calendar
   footer copy. `VERIFY_E2E=1 verify.sh` → GREEN (686 unit/48 files, 35 e2e). DECISIONS #47
   + ROADMAP #6 done + STATUS written.

## Feature 2 — DONE ✅ (verify+e2e green, critic 2 P1s fixed)

## Deferred hardening (post-"do all three", user-requested) — DONE ✅
(A) Always/Undo orphan-rule race: `undoCorrections` rule deletion now lineage-scoped
(`createdFrom: correction.id`) — `tests/unit/undo-orphan-rule.test.ts`. (B) Sign-in
throttle redesigned to kill the targeted-account lockout (#48 residual): per-IP cap
before auth + per-account-FAIL after, so a correct password is never blocked
(`src/lib/request-ip.ts` + `tests/unit/rate-limit-durable.test.ts` no-lockout proof).
Focused adversarial review: both PASS, 0 P0/P1 (1 accepted P2: shared 'unknown' bucket
local-only). `VERIFY_E2E=1 verify.sh` → GREEN (702 unit/52 files, 35 e2e). DECISIONS #49
+ ROADMAP #9 done + STATUS #10 + REGRESSION_LEDGER updated. Deferred: alreadyUndone TOCTOU
(append-only audit, no UI path).

## Feature 3 — DONE ✅ (verify+e2e green, critic 3 P1s fixed). ALL THREE SHIPPED.
**Built:** (#9) splitTransaction conditional-claim guard inside the tx. (#8) new RateLimit
table + `rateLimitDurable` on export + per-account sign-in throttle. Critic (wf_f2438c81):
split fix 10/10 (20/20). 3 P1s in the limiter FIXED: (CONC-1/SEC-1) reset branch returned
true unconditionally → concurrent burst bypassed → decide from an atomic increment count
(12-burst→4 allowed); (OPS-1) unbounded RateLimit growth → `@@index([resetAt])` +
self-pruning. P2s fixed: export 401/429 test, undo→resplit test, fail-closed comments,
lockout doc. Deferred: Always/Undo orphan-rule race (STATUS #10). `VERIFY_E2E=1 verify.sh`
→ GREEN (698 unit/51 files, 35 e2e). DECISIONS #48 + ROADMAP + STATUS + REGRESSION_LEDGER done.

## 2026-06-23 (session: "aimplifi") — Ask Aimplifi: grounded NL assistant (#75, surpass #8) — IN PROGRESS
User "cont" after renaming the session "aimplifi". Baseline `bash scripts/verify.sh` →
**GREEN** (807 unit/65 files, typecheck+lint+build clean). Next surpass feature = the
AI-native conversational surface the app is literally named for (nav brand "Aim·plifi"),
which none of the match-and-surpass features (#1–#7) provided.

DESIGN (engine-first, no-fabrication soul): a grounded financial Q&A where **the LLM
never originates a fact**. Deterministic NL→typed-intent parser (no model calls — rule #5)
→ routes to the EXISTING tested engines (spendingByCategory/spending-plan/cash-needed/
recurring/forecast/monthlyFlows/netWorthCents) → pure answer formatters. The LLM is an
OPTIONAL routing fallback for genuinely-unknown questions only, gated on a key, and its
proposed routing is re-resolved + validated deterministically before any data is touched
(mirrors the categorize/llm.ts pattern: provider-agnostic xAI→Anthropic→null, never throws).
Zero-key demo is fully functional (deterministic parse + answers). No new dep (hand-written
validator like parseLlmCategory, not zod). No 8th nav icon (#71/#74) — dashboard card + /ask.

Files: engine/assistant/{intent,answer,llm}.ts (pure) + server/{assistant,assistant-llm}.ts
+ components/finance/{ask-view,ask-aimplifi-card}.tsx + app/(app)/ask/page.tsx + dashboard wiring.
Tests: assistant-intent (hand-derived intents), assistant-answer (hand-computed $),
assistant-grounding (buildSeedData: answers == dedicated engine outputs, no drift),
assistant-llm (parse + no-key no-network), e2e ask.spec.

### Update — verify GREEN + hostile critic cycle 1 (6 P1s fixed)
Gate (real, 2026-06-24): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ GREEN** —
typecheck/lint/build clean, **899 unit / 70 files** (+92), **51 e2e** (+5; off-topic
case 7.0s confirms the LLM 7s-timeout→deterministic fallback), axe AA.
Hostile critic (wf_0df635e6, 12 agents): fin 7 / sec 8 / code 6 / UX 8 — **6 P1s
confirmed + FIXED**, each with a locking regression test:
- P1 net-worth used a truncated liability set → now canonical `isLiabilityType`
  (CREDIT/LOAN/MORTGAGE/OTHER_LIABILITY); facts reconcile to headline (test: MORTGAGE/OTHER_LIABILITY).
- P1 income/savings dropped categoryId+isSplitParent → income now `monthlyFlows(snap.transactions)`
  (full rows; refunds net, splits excluded — F3 synthetic regression); savings_rate delegates to
  `getCoachData` → byte-identical to /coach.
- P1 largest omitted POSTED filter → now POSTED-only; grounding test pins top-5 == /trends `computeLargest`.
- P1 off-topic misroute (key set) → LLM prompt offers `none` abstention → answerUnknown; LLM gated by
  per-user `rateLimitDurable`; question clamped 500 chars; `interpreted` flag surfaced in UI.
P2s fixed: dead answerUnknown source line, 3rd-party disclosure footnote (assistEnabled), no-flicker
re-ask, dashboard card non-interactive example text. Confirmation critic (wf_83f7b0a3) running.
