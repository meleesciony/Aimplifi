# A borrowed total imports the other engine's window — share ROWS, not totals

L.11(C) built "guilt-free spending" (a CALENDAR-MONTH budget) by copying the cash-needed
headline `requiredCents` verbatim — the verbatim-copy rule, applied faithfully. The critic's
sharpest finding (F1): that total is windowed by STATEMENT CYCLE, so a statement due Aug 10
was reserved against July's income (open all cycle) AND August's (until paid) — $1,000 of
income spoken for by one $500 bill, on the commonest issuer pattern (due date early in the
month). The verbatim-copy rule guarantees the NUMBER; it says nothing about whether the
number's window matches the borrowing surface's window.

The fix that held: take the other engine's ROWS (`perDueDate`), filter them to your own
window (`date <= endOfMonth`), and sum. The figures still cannot disagree about what any
single card demands — they are the same rows — but each surface now owns its window and
states it ("card payments due this month" vs "cash needed by DATE"). Coherence between two
surfaces is a claim about rows, not about totals.

**The mirror error, six days later (L.11(D), owner-reported: "It's worse now").** Filtering the
rows to your own window is correct and is not sufficient, because a window has an EDGE and money
does not reset when it is crossed. All seven of his cards were dated Aug 5; July's window ends
Jul 31; so the term was $0.00 and the plan offered his entire month's income - $22,254.09, at
$3,709.01 a day - directly beneath the same app's own sentence saying $18,814.14 had to be in the
account by Aug 5. Each figure was right about its own window, and the PAIR was an instruction to
overdraft. A payment dated just past the edge is in no plan the reader can ever see: this month
calls it next month's business, and next month arrives after the money is spent.

The fix is the same prescription applied once more - take the other engine's ROWS - but from the
OTHER side of the same filter: the rows past the edge become their own subtraction, so a payment
already dated is reserved from the moment it is known. A flow bounded by flows.

**The wrong fix, worth recording because it looked right for an hour.** The first attempt CAPPED
the answer at the funding account's projected low point - the very number the dashboard prints
beside it, which made the two surfaces coherent by construction. Two fresh-context critics broke it
independently and identically: it caps a FLOW (a month's income allocation) with a STOCK (one
account's worst projected balance), and because the balance walk records its minimum on day one,
the cap silently became *"you may never be told you can spend more than is in your checking account
right now."* On a $200 pre-payday float with $6,000 landing on the 31st and one $1,000 card, it held
back $6,000, reported $28.57/day, and blamed cards for a date carrying no obligation at all. Worse,
the amount it subtracted was a RESIDUAL - allocation minus balance - so it absorbed savings sweeps,
unarrived income and money in other accounts, while five surfaces printed it as "held for card
payments" (the verbatim-value / verbatim-meaning failure). Three tells, each general:

- **A "conservative" error is only safe while it is small.** The rationale said the cap could only
  make the figure too small; at 30x that is not a hedge, it is a different feature.
- **Mixing units hides inside a subtraction.** `flow - stock` type-checks and reads fine; the
  residual is where every unmodelled difference goes to live, and it inherits the label of whatever
  the subtraction was named for.
- **A cap applied outside the rows falsifies the panel that adds the rows up.** The Glass-Box trace
  claims "these N lines add up to exactly the amount above"; keeping that claim true forced the
  adjustment INTO the rows, where its label had to be honest - and the label could not be made
  honest, which was the design telling us it was wrong.

Also from this pass: name the END of a projection's walk, not the point where it bottoms out (they
differ whenever the largest payment is not the last one), and print the EFFECTIVE due date in the
product's own date voice - a Sunday due date is paid on the Friday, and a raw `2026-08-05` in the
middle of a sentence is a tell that a value escaped its surface.

Corollaries from the L.11(C) critic cycle:
- A boundary drawn for ONE column of a two-column flow re-draws the other: excluding card
  purchases from EXPENSES while leaving card positives in INCOME turned every cashback into
  income that also shrank the next statement (double-benefit). Draw the account-set boundary
  once, for the whole flow.
- When a term can come from two mechanisms (real statement / estimate), the excluded set has
  two mechanisms too — enumerate disclosures by MECHANISM (no dates at all; estimate parked
  behind a real statement), or one of them is excluded silently.
- A fact made to ride the money (`cardObligationsEstimated`) must be CONSUMED at every
  surface that prints the money; the UNTRACED surface (Ask) is exactly the one that cannot
  inherit a trace's caveat, so it needs its own sentence (cycle-2 P1).
- A direction word ("the real figure may be lower") is relative to THE FIGURE THE BRANCH
  RENDERS: the overspent branch prints the negation (the overage), so every shared qualifier
  must flip with the branch, on every surface (cycle-1 P1, three surfaces).

## C.2 extension — the money you ADD needs the same passport as the money you borrow

L.11(C) was about borrowing a total whose window did not fit. C.2 was the inverse: the
pace projection was *missing* the bills the app already owned, and the fix had to ADD
money into a figure that is compared against another figure. Same rule, other direction —
**a value may only enter a total on the basis that total is compared against.**

The trap that made it concrete: `snap.scheduled` holds an auto-loan ACH, because
`detectRecurring` deliberately keeps that one `isTransfer` class. Those charges are in
NEITHER side of the pace comparison (both sides are `spendingByCategory`, which drops
transfer rows), so adding that bill would have reported the month as heavier than the
month it is measured against — a defect nothing in the arithmetic could reveal.

Three transferable moves:

1. **Prove admission from the data, not from a category list.** The rule shipped is "a
   bill enters only if the app has EVER counted a purchase at that merchant, on this very
   basis". One executable predicate, and it covers the auto-loan ACH, a savings sweep, and
   a hand-authored seed label that no merchant can match — including future classes nobody
   has thought of. A hand-maintained exclusion list would have covered the one case I knew.

2. **A window has an edge, so decompose by ROWS, not by dates.** The first design split
   bills at `today` — "dated before today, so it is already inside spent-so-far". That is
   false on the day itself and for every ACH lag, and on the owner's own month it answered
   $578.79: it deleted the mortgage from BOTH terms. Counting occurrences over the whole
   calendar month and crediting them against `min(posted at that merchant, the bill's own
   amount)` has no edge to be wrong at, and the `min` is what stops a merchant that is also
   a shop ($15 of Prime inside $415 of Amazon) from swallowing real discretionary spend.

3. **Stability across days is the observable, and it belongs in a test.** The old model
   read $8,681.85 on the 2nd and $27,282.00 on the 10th off the same month, green to red,
   because a lump entered a rate. The lock that matters is not one golden figure but the
   PAIR: two fixtures, same underlying month, asserting the projections land within a
   dollar of each other. It fails for every model that extrapolates a bill.

Corollary about the demo: the seeded scheduled rows are hand-authored labels, so the
public demo admits no bills and its pace is unchanged. That is the right answer and it
means the demo cannot exercise the feature — so pin the zero explicitly (a test asserting
the demo admits none) and write the e2e against a throwaway user with a real stored row,
or the surface quietly stops being covered. And when the whole design rests on two writers
agreeing about a KEY, test the writers: transactions -> `detectRecurring` ->
`toScheduledTransactions` -> the consumer, in one test, or the match is an assumption.
