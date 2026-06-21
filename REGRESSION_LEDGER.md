# REGRESSION_LEDGER.md

Per LOOP_ENGINEERING.md: every fix ships a regression test plus one line here
(`date | symptom | root cause | rule broken | locking test`). Append-only. Earlier
phase regressions live as named tests (tests/unit/critic*.test.ts) + docs/DECISIONS.md;
this ledger starts at the 2026-06-21 hardening session.

| date | symptom | root cause | rule broken | locking test |
|---|---|---|---|---|
| 2026-06-21 | Manual card statement set/clear timed out under parallel test load | interactive `prisma.$transaction(async tx…)` holds SQLite's single writer lock across app round-trips | "fail loudly / verify under real load" — the timeout only surfaced in the full parallel suite | `tests/unit/card-actions.test.ts` (array-form `$transaction`; green in the full suite) |
| 2026-06-21 | Dashboard listed an estimated card payment TWICE | both callers spread `[...result.cards, ...result.upcoming]` but the engine's `cards` already includes `upcoming` (a subset) | "know your data shapes before composing them" | `tests/unit/reminders.test.ts` (dedup test) + `tests/e2e/payment-reminders.spec.ts` (no-duplicate-card assertion) |
| 2026-06-21 | Reminder email/card said "you'll pay $Y yourself", hiding the autopay portion under a larger headline | the partial-autopay (top-up) case wasn't disclosed; `PaymentReminder` carried no autopay portion | coaching guardrail "every projection states its assumptions inline" | `tests/unit/reminders.test.ts` (top-up known-answer fixture) |
| 2026-06-21 | `rateLimitDurable` let a CONCURRENT burst bypass the limit entirely (50/50 at limit 8) — the brute-force/export throttle did nothing under the conditions it exists for | the reset branch did `upsert{count:1}` + `return true` unconditionally, never reading a post-write count (TOCTOU) | "a security control must hold under its own threat model (concurrency)" | `tests/unit/rate-limit-durable.test.ts` (12-call `Promise.all` burst → exactly 4 allowed) |
| 2026-06-21 | `RateLimit` table grew unboundedly — one permanent row per attacker-guessed `signin:<email>`, no prune, no index (CWE-770, unauthenticated) | no reclamation path + attacker-controlled key space | "bound any attacker-reachable allocation" | `tests/unit/rate-limit-durable.test.ts` (`pruneExpiredRateLimits` deletes expired, keeps live) + `@@index([resetAt])` |
| 2026-06-21 | Two concurrent `splitTransaction` calls could double-split a row (children created twice → doubled in every aggregate) | `isSplitParent` was read BEFORE the transaction; both racers passed the pre-read | "guard data-integrity invariants inside the atomic boundary, not before it" | `tests/unit/split-race.test.ts` (parallel splits → exactly one set of children; verified to fail on pre-fix code) |
