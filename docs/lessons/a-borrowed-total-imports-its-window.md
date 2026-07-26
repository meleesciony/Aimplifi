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

Corollaries from the same critic cycle:
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
