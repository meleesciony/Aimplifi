# An unknown you can still fill beats a guess you can't unfill

**Summary:** U.6 added a column recording the class each balance was read under, and shipped an obviously-sensible one-off to backfill the rows that predated it from the account's current class. Two fresh-context critics killed it, and the argument that settled it was not "the guess might be wrong" — it was that **an un-backfilled NULL row self-heals when the misclassification is corrected, and a stamped row never can.** Measured through the real engine as a $40,000.00 swing.

## What happened

`BalanceSnapshot` gained `accountType`: the class an account was in when its balance was read. Rows written before the column existed carry NULL, and every reader signs those by the account's *current* type — precisely the pre-U.6 behaviour, kept only where there is nothing better.

Backfilling them looked like pure upside. The window was days. The value came from the account row, not from user input. The script only ever filled NULLs, never rewrote a recorded value, was idempotent, and was verified on a scratch database: 36 rows filled, 0 remaining, a no-op on rerun. Its own docblock was candid that the value was an inference.

Both critics attacked it anyway, and between them produced three separate reasons it was wrong:

1. **It asserted a class it could disprove from its own table.** Grouping only by `accountId`, it stamped `CREDIT` onto June and July rows while an August row three lines down recorded `CHECKING` for the same account — a timeline that never happened, reported as success. The evidence to refuse was one query away and unused.
2. **Nothing rendered carries the hedge.** The panel prints a non-null value as *"counted as checking"* and the delta refuses a comparison on it. `accountType !== null` is the exact predicate every downstream claim branches on, so after a run an inference is indistinguishable from an observation — permanently, and unmarkably.
3. **The asymmetry that decides it.** A NULL row is re-derived at every read. If a feed had miscategorised an account and later corrects itself, every NULL row silently becomes right again. A stamped row is read literally by `series.ts` forever; the correction cannot reach it, and a second run of the script won't repair it because it only fills NULLs. The engine put a number on the difference: $40,000.00 across four points.

The script was deleted, not fixed. The schema comment now records *why* those rows are never backfilled.

## The rule

Before converting "we don't know" into a stored value, ask two questions in this order:

- **What does the value CLAIM to its readers?** Not what you meant by it — what the surfaces branch on. If any reader treats non-null as evidence, writing a guess there is writing a fabrication, however honest the docblock is.
- **Which state is recoverable?** An absence that is re-derived on every read tracks the truth as the truth improves. A written value is frozen at the moment of the guess. Prefer the state that can still be fixed by someone who learns more than you know now, even when it means carrying the unknown longer.

A corollary for the copy: once you decide to carry the unknown, the surfaces have to say so. The same critic cycle caught a note asserting the trend "counts every balance the way it was recorded" — an absolute the NULL fallback falsifies, rendered exactly where the unmarked rows sit. Carrying an unknown honestly costs a sentence; it is not free.

## Also from this cycle (smaller, same shape)

A guard against a distorted figure must test whether the figure actually **moves**, not whether the distorting condition occurred. `netWorthDelta` refused any comparison where an account changed class, and so deleted a true +$2,000.00 over a paid-off card at $0.00 that a feed had moved between classes. The term a class change distorts is exactly 2 × the *previous* balance; at $0.00 there is nothing to distort. A false refusal is as much a defect as a false number.
