# A narrowing belongs at the consumer that needs it — and widening it back is not symmetric across sign

One-line: the spending plan subtracted expenses summed over ONE account from income summed over ALL
accounts; the fix (widen the writer) was right for expenses and wrong for income, because an expense
is a figure and income is an instruction's input.

## The bug: two columns of one subtraction, two different account universes

`/spending-plan` showed the owner **$21,117.48 of income and $0.00 of "Fixed & recurring expenses."**
Both figures were doing exactly what their code said:

* income summed **every non-credit account** (`spending-plan.ts` — `nonCreditTxns`),
* fixed expenses summed the detected scheduled rows, which `toScheduledTransactions` filtered to
  **the single resolved payment account**.

Neither figure is wrong on its own. The *subtraction* is wrong, and nothing in either module could
see it, because the account set is a property of the flow and each column only knows its own. This is
the L.11(C) rule ("draw an account-set boundary for the whole flow, not one column") arriving as a
concrete money bug rather than a design note: **when two terms are subtracted from each other, they
must be computed over the same set, and that has to be checked at the subtraction, not at either
term.**

## The narrowing was in the wrong place, which is why it looked load-bearing

The obvious objection to widening is that the scheduled rows feed a projection that walks the payment
account's running balance — a savings-paid bill subtracted from a checking balance would invent a
shortfall. That objection is real and it is already handled: `assemble.ts`, `forecast.ts` and
`radar.ts` (three sites) each **re-filter to the payment account at their own read site**. The
writer's filter was redundant for every consumer that needed it, and was the only thing stopping the
two consumers that legitimately span accounts — the plan's fixed term and the calendar, which has no
balance walk at all and simply paints dated events.

Generalised: **a narrowing applied at a shared writer is invisible to the consumers it starves.** Put
the filter where the assumption lives. Before removing one, enumerate the consumers and check which
already re-filter — the answer is often "all the ones that matter," and then the shared filter is
pure loss.

## The half that is not symmetric: sign

Widening the account filter widened **both signs at once**, because the WEEKLY/BIWEEKLY/MONTHLY
branch carries no `isIncome` test (only the LONG-cadence branch does). So the first draft also began
projecting detected recurring **income** on savings. Every comment, test title and docblock in the
change said *"a bill."* A fresh-context claims critic found it in the diff and executed it.

The direction matters and it is the axis L.14 already named:

* An **expense** on any account is a **figure** — money that leaves. Wherever it is charged, it
  reduces what the reader may spend, so counting it can only make the plan more complete.
* **Income** on another account is an **instruction's input** — the beyond-month reservation nets
  scheduled income against card payments that must leave the *payment* account. Counting a deposit
  that lands in savings shrinks the reservation on the assumption the reader will move the money.
  Failure mode: under-funded checking, bounced autopay.

So the rule is not "widen the scope." It is: **re-ask the failure-direction question for each sign
separately, because one filter served two directions.** Income kept its old scope, which also made
every claim already written for the change true as written.

## Closing the gap falsified six claims that were still true

The conclusions survived; their stated **mechanisms** did not. The reconciliation boundary argued
double-count-safety "because detected scheduled rows are full-replaced to a SINGLE payment account" —
retired premise, and the real reason (detection groups by merchant, so one merchant yields one row;
and the full replace is per-USER, not per-account) had to be re-derived and written where the re-key
lives. The demo seed's "parked on savings so projections are untouched" held only because that series
is *income*. Two `docs/STATUS.md` OPEN items described the closed gap as open. Even the changed
docblock's own one-line summary still said "on the payment account."

Corollary to the closing-a-gap lesson: **a claim that states a mechanism dies when the mechanism
changes, even when its conclusion survives** — and those are the dangerous ones, because nothing
fails and the next reader trusts a retired guarantee.

## A recorded hypothesis hardens into a diagnosis

The previous session recorded payment-account scope as "the leading candidate" for the owner's
`$0.00`. This session found the scope defect, fixed it, and nearly shipped a test file asserting that
it *was* the owner's cause. The critic falsified the ranking: reaching `$0.00` by scope alone
requires **every** bill to sit off the payment account, whereas the amount-stability rule
(`distinct.length > 2`) drops any series with three different amounts — i.e. **every variable utility
bill** — on its own. Verified by execution: four monthly power-bill charges at four amounts detect as
nothing at all, on every account.

Write a recorded hypothesis with its disconfirming test attached, or it becomes next session's
premise. "Leading candidate" in a status file reads as "cause" three sessions later.
