# A new writer inherits every surface its ABSENCE was hiding — and a change in coverage is not a change in wealth

**One line:** U.4 started writing `BalanceSnapshot` rows for live users, and its worst defect was in
a figure the slice never touched: the net-worth delta had never rendered for a real user, because
with no snapshots the trend held exactly one point and `prev` was `null` — the moment rows existed,
a subtraction between two points built from *different account sets* printed −$251,200.00, or
+$50,000.00 in green depending only on which account the user had linked first.

## What happened

Before U.4 only `prisma/seed.ts` wrote snapshots. Two consequences nobody had written down:

1. Every live user's trend was a single point. `net-worth-card.tsx` and `accounts-list.tsx` both
   computed `prev = trend[trend.length - 2]` and rendered nothing when it was missing. **The delta
   was demo-only.** It had been correct for two years for exactly one reason: the seeded demo writes
   all nine accounts into all eighteen buckets, so every pair of points covers the same set.
2. Every rendered sentence about the trend was written against month-end rows, because those were
   the only rows that had ever existed — including the heading on the exported PDF handed to a
   lender.

The slice's own design work was careful and, per two critics, correct: one date per user per month
across every account, because `netWorthSeries` sums a date bucket and `reconcile-boundary` only
de-duplicates a reconciled pair on an exact-date collision. The planner, the writer, the fence, the
concurrency, the signs — all clean. The defects were in what the new rows *reached*.

The delta is the sharp one. A user signs up on Jun 3 with checking and savings; the writer claims
June. On Jun 20 they type in the mortgage that the /accounts placeholder literally advertises. That
account cannot join June's bucket — the month is claimed, and opening a second bucket would be the
partial-bucket defect the design exists to prevent. So the two most recent points are:

```
2026-06-03      $50,000.00   [checking, savings]
2026-06-20    -$201,200.00   [checking, savings, mortgage, card]
```

Subtracting them is arithmetic over two different questions. Nothing on either surface disclosed
it; the only sentence that said so lived inside a drilldown panel the reader had to tap.

## The rules

1. **When a feature's absence was suppressing a surface, that surface is now yours.** Ask of any new
   writer: *what rendered nothing before, only because this table was empty?* An empty table is a
   silent feature flag, and filling it is the deploy. Grep for the readers, then ask which of their
   branches were unreachable — not just which are wrong.
2. **A difference between two aggregates is a change in the thing measured only if both aggregates
   cover the same set.** Otherwise it is a change in coverage wearing the units of money. Where the
   producing engine already carries its constituents (this one does, by the O.18c carry-out rule),
   the check is free: compare the id sets, and when they differ return *no figure* with a named
   reason. `deltaCents: null` plus "No comparison — 1 account joined since Jun 3" is worth more than
   any number you can compute there.
3. **The correctness a fixture guarantees is not correctness.** The demo's buckets are complete, so
   the demo could never expose this. When a golden dataset satisfies an invariant *incidentally*,
   write the test that breaks it — every case in the first draft of this slice's suite held the
   account set constant, which is exactly why the suite stayed green through the bug.
4. **A shape claim outlives the shape.** "Month-end" was true of every row in existence when each of
   those sentences was written. Five surfaces still said it — including a PDF, which is the one
   artifact that leaves the app and can never be corrected afterwards. When a slice changes the
   shape of stored data, grep the *vocabulary* of the old shape, not the files you edited.
5. **A disclosure elsewhere on the page cannot qualify a figure.** The frozen-feed P0: monthly rows
   of an identical carried-forward balance rendered under "Recorded balance history", forty pixels
   below the amber note saying the bank had stopped sharing the account. Two true sentences, one
   false impression — a flat *measured* line reads as evidence the connection works. The fact has to
   ride the row that carries the money.

## Where this bites next

Any writer that begins populating a table some reader already queries: holdings history, a sync
audit trail, per-account observation timestamps. The question is never only "are my rows right" —
it is "which sentences and which branches were resting on there being none".
