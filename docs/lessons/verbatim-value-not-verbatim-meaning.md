# Copying a value verbatim is not copying its meaning — label each case at the display boundary

**One-line:** A field carried "verbatim" through an engine can still mean a DIFFERENT thing
per kind/branch; the verbatim-copy rule guarantees the number is right, never that a single
display template describes it honestly — the false-money-copy risk moves to the UI boundary.

The nudge feed's grounding story is verbatim-copy: `Proposal.centsAtStake` is copied
byte-for-byte from the source engine, "so the feed can never disagree with the dashboard."
That is true of the NUMBER. It says nothing about the NUMBER'S MEANING, which the flat
`centsAtStake` field flattens away — and the slice-2 card mislabeled it twice:

- **Cycle 1 (opportunity kinds):** `centsAtStake = Opportunity.monthlyCents`, verbatim. But
  `findOpportunities` sets `monthlyCents` to the monthly INCREASE (delta) for price-increase,
  an ESTIMATED ~15% saving for insurance-reshop, a flat $20 estimate for negotiable-bill, and
  the actual monthly cost for unused-subscription. One template ("Now $X/mo") turned a $2.50
  Netflix increase into "Now $2.50/mo" — a false price. The value was correct; the label was a
  fabrication.
- **Cycle 2 (partial autopay):** `centsAtStake = userActionCents`, verbatim — the amount to
  pay AFTER autopay, not the statement total. "Payment due — $500" for a $600 statement with
  $100 autopay disagreed with the reminders card's "$600 due · you pay $500" on the SAME
  dashboard — the exact "can never disagree" promise, broken at the label.

Both are the #221 false-money-copy class, one level down: not a false SUBJECT (who pays) but
a false PREDICATE (what the number is).

**What to do when a value crosses into display:**
1. For every kind/branch that shares a flattened field, ask what that field MEANS in this
   case — trace it back to the producer, don't assume the field name.
2. Label each case at the boundary (an exhaustive `switch`, not one template); if a case is an
   estimate or a partial figure, disclose that INLINE where the number is (coaching guardrail),
   not only in a collapsed panel.
3. If a case needs sibling context to be honest (autopay split, gross vs remainder), carry that
   context verbatim too (`Proposal.autopayCents`) and SHOW the parts — never recompute/sum them
   (that would reintroduce arithmetic the engine forbids), and check the result agrees with the
   other surface that shows the same fact.
4. Lock it with a direct copy test, not only an engine field test — a rendered-output test that
   fails if a branch regresses to summing or relabeling (tests/unit/nudge-feed-copy.test.ts).

**Extended #250 (merchant lens critic F1/F2 — the intake side of the same disease):** reusing an
ENGINE'S OUTPUT in a new surface carries that engine's conventions with it, and both bit in one
cycle: `RecurringItem.typicalAmountCents` is SIGNED (negative for expenses) so the lens printed
"typically −$1,800.00" under a positive typical line; and the lens fed the engine PENDING rows
where every sibling caller (`getRecurring`) is POSTED-only, so a pending charge moved "typically"
and minted a phantom price change. Neither was caught by unit tests because the fixtures were
hand-shaped (positive amount, posted-only rows) rather than PRODUCTION-shaped. So: (5) when a new
consumer adopts an engine, re-read the producer's field docs for sign/status/scope conventions
AND copy the sibling callers' input predicates — then (6) shape at least one locking fixture
exactly like production emits it (signed value, a pending row present), not like the happy path
you designed. A fresh-context critic found in minutes what three green suites had masked.
