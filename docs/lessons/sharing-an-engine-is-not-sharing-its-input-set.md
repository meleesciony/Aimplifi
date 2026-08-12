# Sharing an engine is not sharing its answer — the input set is part of the algorithm

**One line:** U.5 fixed a surface that bypassed the shared reconciliation boundary by calling that
boundary, and then re-broke it twice at the INPUT — once by narrowing the snapshot set to an
account's direct counterparts (the rule walks chains transitively, so a 3-link chain got both a
wrong verdict and a wrong dollar figure), once by disagreeing with the trend about which accounts
exist at all. The call site was right both times; the argument was the bug.

## What happened

`getAccountDetail` read `BalanceSnapshot` raw while the net-worth trend on the same page read it
through `applyReconciliationBoundary`, so a combined pair's panel could name a balance the chart
did not count. The fix is the one this repo already established at #274: don't re-derive the money
rule, call the same engine with the same inputs.

That was done. Then, tidying up a payload concern, the snapshot query was scoped from "every row
this user has" to "this account plus its direct counterparts" — which reads like an obviously safe
narrowing, because the collision rule only ever compares an account against a counterpart.

It is not safe. `keepsSnapshot` resolves counterparts through `upstreamsOf` / `downstreamsOf`,
which are TRANSITIVE. In a chain A→B→C, a row of C's can be dropped in favour of A's — an account
that is not C's direct counterpart at all. With A missing from the input, the engine could not see
the collision, so it reported C's row as kept. The panel then printed two false things at once: a
balance marked as counted that the chart counts nothing of, and, on the neighbouring row, "your net
worth counts −$14,000.00 from Loan B" where the chart had actually used −$14,300.00 from Loan A.

The same class of mistake, in the other direction, was already sitting in the first draft: the
trend's input excludes non-USD accounts (the #135 currency withhold), so an input built without
that filter would compute links as effective that the trend treats as inert, and mark rows
uncounted that the chart counts.

Both bugs are invisible at the call site. `applyReconciliationBoundary(...)` is right there, with
the right name, returning the right shape.

## The rule

When you reuse a shared engine to make two surfaces agree, **parity is a property of the inputs,
not of the function call.** Before narrowing, filtering, windowing, or paginating what you feed it,
ask what the engine's own closure is:

- Does the rule traverse a graph? Then the input must contain every node the traversal can reach —
  not the ones the caller happens to care about. The safe scope is usually the set the engine
  builds internally (here, every account appearing in an effective link), not a set derived from
  the target row.
- Does the sibling surface filter its input before calling? Then you must apply the identical
  filter, or you are comparing two different worlds. Mirror the filter, don't re-decide it.
- Is your filter uniform over the dimension the rule compares on? A date-window filter that removes
  whole dates leaves same-date collisions intact and is safe; a filter that removes some ACCOUNTS
  on a date is not. State which kind yours is, in the code, next to the query.

A narrowed input is a re-implementation of the engine's traversal, written accidentally, in a
different file, with no test naming it as such. That is exactly the drift the "call the shared
engine" discipline exists to prevent — so the discipline is only half-applied until the input set
is justified too.

## How it was caught, and how it is locked

A fresh-context critic reproduced it on a real 3-link chain against the real engine and printed the
divergence: the dates the panel called counted versus the dates the trend actually counted the
account on. The lock is a real-Prisma test with A and C holding a date that B deliberately does not
hold — the only shape where a transitive walk and a direct-counterparts walk give different
answers. Reverting the input to direct counterparts turns exactly that test red.

**Corollary worth keeping:** the performance instinct that caused this ("don't read the whole
user's rows for one panel") was reasonable, and the fix kept most of the win — the input is scoped
to link participants, which is small — but only after the correct set was named. Narrow to the
engine's closure, never to the caller's mental model of it.
