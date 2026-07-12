# Widening a single-actor field to multi-actor requires re-auditing every consumer that assumed owner == actor

**One-line hook:** when a row's `userId` column stops always equaling "the row's owner"
and starts meaning "whoever acted on it," every OTHER piece of code that filters a
cross-referencing query by that same `userId` (assuming it's the owner) needs re-checking
— the compiler and the original tests can't see the assumption because it was never
written down anywhere.

## What happened (TASKS 4.2 slice 6, DECISIONS #219)

`Correction.userId` had one meaning since the column existed: the transaction's owner,
because every write path required `account: { userId }` before creating a correction.
Slice 6 deliberately widened this — a household partner may now one-off recategorize a
transaction they don't own, and the `Correction.userId` records the ACTING user, which
can now differ from the transaction's owner for the first time in the app's history.

That change was fully reasoned through at the write site (the new
`recategorizeSharedTransaction` action never mints a rule, never stamps
`CategoryPrediction.labeledAt`, attributes the correction to the actor — all correct).
What got missed on the first pass: **Plaid's pending→posted id-churn transplant**
(`src/lib/providers/plaid.ts`), a completely different, pre-existing piece of code that
also touches `Correction` rows — re-pointing them from a deleted predecessor transaction
id to its successor during a sync. That code had always filtered
`tx.correction.updateMany({ where: { transactionId: predecessor.id, userId } })` using
the SYNCING OWNER's id, because until this slice that was a no-op distinction (every
correction on an owner's transaction had `userId === owner`). After the slice landed, a
partner's correction — `userId === partner`, on a transaction the OWNER'S sync now
processes — silently failed to match that `where` clause, so the correction was orphaned
on the about-to-be-deleted predecessor row instead of transplanting to the new one. The
partner's fix would have been silently reverted on the very next Plaid re-sync.

This was caught by a fresh-context hostile critic dispatched as an independent agent
(not by the implementer re-reading their own diff), which is the whole point of that
practice: the bug was zero lines from the diff under review and would never surface from
staring harder at the new function itself.

## The general lesson

Before widening any column's "who does this belong to" semantics from single-actor to
multi-actor (userId, accountId, whatever the ownership key is), **grep every OTHER
consumer of that column across the codebase** — not just the write path being changed —
for a `where` clause that filters by the SAME id under the old single-actor assumption.
Concretely: `grep -rn "\.correction\." src/` (or the equivalent for whatever table is
widening) and read every hit, not just the ones in the file being edited. A hit that
filters by an id assumed-but-never-declared to equal the row's owner is a candidate for
the same bug class. This is the same root cause the REGRESSION_LEDGER's
"read-guard-vs-write-where drift" entries describe (a guard that exists only in one
place isn't a guard everywhere it needs to be) — but generalized to "a semantic
assumption baked into a `where` clause is a guard too, and it can drift the same way a
literal one can."

## Why this is worth its own lesson (not just a REGRESSION_LEDGER row)

The specific bug is recorded in DECISIONS #219 (caught pre-commit, never shipped, so no
REGRESSION_LEDGER row per that ledger's convention). This file exists because the
*pattern* will recur: HOUSEHOLD_ARCHITECTURE's remaining slices (7: joint digest, 8:
full-surface critic) and any future feature that widens a personal table to
household/shared scope will hit the same class of bug in a DIFFERENT pre-existing
consumer each time, unless the next implementer thinks to grep outward from the widened
column, not just review the new write path in isolation.
