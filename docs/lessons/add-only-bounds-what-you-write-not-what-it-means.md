# "Add-only" bounds what you WRITE, not what your write MEANS to everything downstream

**One line:** H.5's backfill created rows and never updated one, and two independent critics
still found it destroying user data — through a derived claim window that widened when the
new rows moved a `MIN(date)`, and through a derived pass that rewrote settled rows the moment
a new row supplied a counterpart. "I only call `create`" is a statement about the writer, and
the failure was never in the writer.

## What happened

H.5 backfills three years of SimpleFIN history onto a connection pinned to a ~90-day floor.
The design decision was good and was made for the right reason: **do not route it through the
live ingest**, because that path answers an already-stored row with `guardedVerdictRefresh`,
which rewrites `categoryId` / `needsReview` / `isTransfer` on every row without an explicit
`Correction`. Over the incremental path's 5-day overlap that is a refresh. Over 1095 days it
is a silent re-filing of the user's whole history against today's rules. *The same code means
something different at a different overlap width.*

So the slice shipped a pure planner that emits only rows that do not exist, and a writer that
calls `prisma.transaction.create` and nothing else. The docblock said: *"the worst this can
do is add less than the bank holds — never disturb a verdict, a split, or a correction."* A
whole-record before/after test over a three-year re-pull passed. Both statements were true
about the writer.

Two fresh-context critics then found the same shape twice, in two different subsystems:

1. **A derived CLAIM WINDOW moved.** `AccountReconciliation` makes a superseded predecessor
   read-only history: the boundary claims `[predecessor.span.first, cutover]` — where
   `span.first` is that account's **full-history minimum date** — and DROPS every *successor*
   row inside it. Adding three years of rows to the predecessor drags `span.first` back three
   years, so three years of the successor's rows (the ones carrying the reader's corrections
   and splits) vanish from every figure. No row was updated. The app already had the rule
   written down — `refuseManualWriteToSuperseded` blocks manual entry and CSV import onto
   these accounts — and a feed write simply wasn't one of the writers anyone had listed.

2. **A derived PASS rewrote settled rows.** The backfill called `refreshTransferFlags`,
   copied from the live sync. That helper writes `isTransfer: true` onto **already-stored**
   rows whenever a new row supplies a missing counterpart, on a coincidence rule (equal
   magnitude, opposite sign, within 3 days). Three extra years of rows is three extra years
   of chances for that rule to fire against transactions the reader had already settled —
   silently removing them from every spending total.

## The rule

When you claim a write path is safe because it is additive, the claim is only about the
INSERT. Before believing it, enumerate separately:

- **What reads an aggregate over this table?** A `MIN`/`MAX`/`COUNT` that feeds a decision is
  a value your insert can move. Grep for aggregates over the table you are adding to, and ask
  what each one gates. `span.first` was a `_min.date` deciding which *other* account's rows
  count.
- **What does this path call after it writes?** Every helper inherited from a sibling caller
  arrives with that caller's assumptions about volume and recency. Read each one for
  `update`/`updateMany`/`delete` — a "refresh" in the name does not mean read-only.
- **Who else already refuses to write here, and why?** An existing guard on a *different*
  writer (`refuseManualWriteToSuperseded`) is a rule about the TABLE, not about that writer.
  A new writer does not inherit the exemption just because nobody added it to the list.

## Two corollaries this slice also paid for

- **Never record that work is done on the strength of work that has not run.** Setting the
  "backfilled" flag at connect time looked free (a fresh connection already pulls the full
  window). But a first sync that *succeeds and returns nothing* still advances
  `lastSyncedAt`, pinning every later sync to a 5-day window while the pre-set flag blocks
  the only mechanism that could ever widen it — the reported defect, made permanent by its
  own fix.
- **A retry converges only if each attempt COMMITS.** The unbounded LLM assist ran over the
  entire plan before the first `create`, so a serverless timeout — which is not catchable,
  and therefore leaves no audit row either — committed nothing and repeated identical work
  forever. Bound the unit of work, not just the total, and mark done only when the plan is
  actually consumed.

## Where this bit before

Same family as `deleting-a-predicate-deletes-every-job-it-had` and
`the-narrowing-you-did-not-list`: the defect is never in the thing the name describes, it is
in the job nobody wrote down. Here the undocumented job was *"this account's earliest
transaction date is load-bearing for a different account's visibility."*

## The second half: three cycles, and every P0 after the first was the previous fix

This slice took four critic cycles, and cycles 2 and 3 each opened with a P0 that the
*previous cycle had just created*. Both were the same mistake in different clothing:

- **Cycle 2's P0** was cycle 1's "reconnect clears the backfill flag" sitting next to a
  pre-existing `lastSyncedAt: null`. Separately each was defensible; together they drove
  the 1095-day window through the live ingest *and* fetched three years twice.
- **Cycle 3's P0** was cycle 2's own fix. Its comment named the dangerous route in
  prose — *"`Disconnect` deliberately KEEPS the history, so disconnect→connect is a
  shipped route into it"* — and then applied the fix to the upsert's `update:` branch.
  But `disconnectSimplefin` DELETES the row, so that route takes `create:`. **The comment
  described the door; the code closed a different one.**

The transferable habits:

- **Follow the route your own comment names, in the code, before believing the fix.** If
  you can write "the dangerous path is X", open X and check which branch it actually
  executes.
- **A fix that removes a trap can install a loop.** Cycle 2 stopped a permanent
  "backfill done" from stranding a user by making the state retry forever — which meant a
  three-year fetch and an audit write on every sync, with nothing on that data able to end
  it. The right shape for a reversible condition is neither: make the state terminal, and
  make the REVERSAL re-open it (the undo action clears the flag).
- **A test for a limit must cross the limit.** Two tests named after cycle-2 findings were
  proven no-ops by sabotage — one exercised 30 rows against a cap of 2000. Sabotaging your
  own fix and watching the suite stay green is cheap and is the only thing that
  distinguishes a lock from a label.
