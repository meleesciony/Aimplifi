# PROGRESS.md — session resume log

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

## Feature 2 — Payment reminders (ROADMAP #6) — PENDING
## Feature 3 — Harden for production (#9 locks + #8 durable rate-limit) — PENDING
