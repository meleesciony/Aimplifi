# A sweep bounded by the surfaces you already had in mind is not a sweep

*One-line summary: L.20's thesis was "the fact is dropped at NARROWINGS", and its critic cycle found
one it had never listed — a hand-built payload over a closed three-field type, feeding the single
most confident sentence in the app, on the one card that renders only for users returning after a
week away. Enumerate narrowings by TYPE SHAPE, not by the surfaces you are already looking at.*

## The finding

L.20 fixed three surfaces that stripped `feedDroppedAt` on the way to the reader, and named its own
disease precisely: a fact rides the money out of the providers and is dropped at a server-side
narrowing — a payload built as an explicit field list, a `select` that omits a column, a closed
field set with no slot for it. It then swept the surfaces it had in mind, and stopped.

`ReturnMomentRadarInput` has three fields and is built by hand from `RadarResult`. It is the same
shape, one file over. It dropped `startingBalanceFrozen` — a field L.20 had *itself just added* —
and `ReturnMomentRadar.kind === 'clear'` is exactly `firstNegativeDate === null`, which is exactly
what a balance frozen HIGH manufactures. So the card printed *"Your cash flow looks clear — no
shortfall ahead on the horizon"* over a projection blind to the account it was projecting.

The aggravating detail is the one that makes it worth a lesson: that card renders **only** for a
reader who has been away more than seven days. A feed drop is precisely the thing that happens while
you are not looking. The narrowing nobody listed was the one whose audience was most exposed to it.

**The rule.** When a slice's thesis is "the fact is lost at narrowings", the sweep is defined by the
narrowings, not by the surfaces. Grep for the SHAPE — hand-built payload objects, `Pick`-like
interfaces with a "minimal … the composer needs" comment, every `select` over the table — and list
them before choosing which to fix. A surface you have never opened cannot occur to you; a type shape
can be enumerated.

## Four more, from the same cycle

**A sentence that fires on either of two conditions may not describe both as true.**
`selectUndatableFrozenLoans` admits a loan missing a due day **or** a payment amount, and the copy
said *"we have no due date or payment amount for it"* — read as "neither", and false on the COMMONEST
shape a bank sends (a loan reported with a payment and no next due date, whose payment the app
prints on /accounts). A disclosure whose entire job is precision about what we hold cannot be wrong
about which field it is. Carry the discriminator on the row; rows that disagree about it cannot share
a clause, exactly as a card and a loan cannot.

**Extracting copy out of a binary artifact makes the STRING testable and leaves the RENDERING
untested.** L.20 lifted the PDF's copy into pure exports with an explicit rationale — money copy
inside a PDF is otherwise testable only by grepping compressed bytes. Correct, and it moved the
assertion one layer *away* from the artifact. `pdf-lib` does not wrap text: measured against the
report's real geometry the disclosure was **861.6pt wide against 516pt of usable page**, so the scope
clause and the entire remedy rendered off the edge and the visible half ended mid-word on "still co".
The only failure mode unique to a PDF is layout, and it was the only one with no test. Measure with
the real font metrics.

**A cleanup that extracts an expression must test the cases the extraction makes reachable.** The
PDF's account line compared `type === 'CREDIT' || type === 'LOAN'` while `netWorthCents` subtracts all
four `LIABILITY_TYPES` — so a mortgage printed as a POSITIVE number and the rows disagreed with the
report's own headline by twice the mortgage, in a document handed to a lender. Pre-existing; but L.20
extracted the line into a newly exported, newly golden-tested helper and attached a money caveat to
it, testing `CHECKING` and `INVESTMENT` only. Use the canonical classifier, never a hand-written
subset of it.

**A disclosure gated on the engine's guess about what will render is gated on the wrong thing.**
`emptyReason` was `headline ? null : …`, while the component recomputes `headline` over its own
session-dismiss filter — so dismissing the last row fell through to a client-side literal that knew
none of the qualifiers, restoring a bare all-clear over a card the engine had just said it could not
date. The engine composes the qualified sentence unconditionally; deciding whether to show it is the
surface's business. (L.20 got this right one field over — `fundingFrozen` is deliberately ungated —
and the sibling twenty lines above was never revisited. Two opposite decisions about the same failure
mode, in one commit, is a smell worth grepping for.)

## On running the critics

Three parallel fresh-context critics with **different lenses** (copy honesty; wiring and narrowings;
the silent half) — not three of the same. All three independently found the mixed-case gap, which is
the signal that it was real and central; each found P1s the other two missed entirely, which is the
argument for diversity over redundancy. Every one of them was explicitly told to label anything it
had not executed as a HYPOTHESIS, and to state what it did **not** check — and the reports were
better for it: one critic **refuted** a residual that L.20's own STATUS had recorded as open, with an
executed test, which un-ranked a queue item that would otherwise have cost a future session a pass.

Then pay the repro cost. Every finding here was traced to real code before it entered a fix, and the
two most expensive ones were settled by executing a measurement rather than reasoning about it. The
gate ran **alone**, and the mixed-case fix was fail-old proven by mutating it out and confirming that
exactly one test — the new one — turned red.

Parallelise for finding, serialize for proving.
