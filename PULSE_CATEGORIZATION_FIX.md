# Aimplifi — Categorization Inbox: Diagnose & Rebuild

You are Claude Fable 5 running in Claude Code with multi-day autonomy, self-testing, and browser control. Use all of it. This is not a small tweak — the categorization inbox as built does not meet its own spec, and the goal is to make it genuinely 10x better than Mint or Simplifi's triage flow, not incrementally better.

**Ground rule: no declaring victory on vibes.** Every claim of "fixed" or "better" must be backed by real command output, real test results, or a real browser-verified screenshot loop. If you can't produce evidence, the phase isn't done.

---

## Phase 1 — Diagnose (read-only, do not write code yet)

Read the actual current implementation of categorization end to end:
- Merchant normalization: does it exist? Where? What does it actually do to raw descriptors like `SQ *STARBUCKS #4471` vs `STARBUCKS 4471 SEATTLE WA`?
- Confidence scoring: what's the auto-apply threshold, and is "user already categorized this merchant before" treated as certainty (auto-apply, no review) or just another confidence signal?
- Queue construction: is the review queue built per-transaction or per-normalized-merchant? This is very likely the root cause if the queue is showing hundreds of items.
- Compare what you find against the original spec's targets: <5% of transactions needing review after 60 days, a week's triage completable in under 60 seconds / 15 taps on a 380px viewport.

Output a short written diagnosis: what's implemented, what's missing, and specifically why a real account is producing a 420-item queue instead of a ~30-50 unique-merchant queue.

## Phase 2 — Reproduce the pain with evidence

Seed or use existing demo data to generate a realistic messy dataset (400+ transactions, same real-world merchants appearing under multiple raw descriptor variants, mix of recurring bills / one-offs / ambiguous ones). Use browser control to actually walk through the current triage flow as a user would. Screenshot each state. Count real taps and real time to clear it. This is your baseline — write it down with numbers, not impressions.

## Phase 3 — Rebuild to these mechanics

- **Queue unit = normalized merchant, not transaction.** Categorize "Starbucks" once, it applies to all 14 transactions under every descriptor variant, past and future.
- **Trust on repeat = instant auto-apply, not high confidence.** If the user has categorized this normalized merchant before, it's certain — apply silently, never re-surface it.
- **Chunked review, capped at ~15-20 visible at once**, framed as "X merchants left," not a raw transaction count.
- **Bulk + fast interaction**: swipe or single-keystroke categorize per merchant group, with corrections retroactively applying rules to matching history in that same action.
- **New-merchant defaults**: seed common normalized merchants (Amazon, major grocery/gas chains, common recurring bills) with sane starting categories so day-one experience isn't a blank slate.

## Phase 4 — Test it for real

Write unit tests for normalization, grouping, and the trust/confidence logic. Write an end-to-end test against the 400+ transaction seeded dataset asserting: unique-merchant queue count, % auto-applied without review, and simulated taps/time to clear. Loop — fix, re-run, re-test — until targets are actually met, not approximately met.

## Phase 5 — Verify visually and report

Use browser control again to run the new flow exactly as a real user would, on the same seeded dataset as Phase 2. Screenshot it. Report before/after side by side: queue size, taps, time, % needing manual review. This comparison is the deliverable — it's how you prove "10x better" instead of asserting it.

---

**Stop condition:** don't stop at "it works." Stop when the before/after evidence shows the queue collapsed from raw-transaction-count to unique-merchant-count, and a full week's real-world triage is demonstrably under a minute.
