# An invariant can be the defect — and every re-implementation of it is a place the fix does not reach

*One-line summary: R1 promised "exactly one side owns each date, no overlap, no gap" and that promise was
itself the bug, because the handover happens INSIDE a day; and when the rule finally changed, the two
places that had quietly re-implemented it stayed on the old semantics — one of them a guard that then
refused the exact transaction the fix existed to save.*

## What happened (U.13, DECISIONS #454)

A retiring bank feed's transaction claim covered its whole final day. A real **$2,086.40** deposit that only
the live feed reported on that day was therefore dropped from the register, budgets, reports and the tax
export, with nothing replacing it.

The task row prescribed a remedy: drop a row only when a counterpart is proven on the claiming side, by
amount within ±3 days. Measuring the corpus first killed that remedy twice over. At ±1 day there were
**zero** mid-span losses — the other rows the original probe flagged were true duplicates the two feeds had
posted a day apart — so every real loss sat on the handover day and the counterpart machinery solved a
problem the data did not have. And it was not expressible where the rule lives: an `(accountId, date)`
predicate with ~20 call sites, several applying it to windowed row sets that never hold the claiming side's
rows.

The real cause was the invariant. A business date here carries no time; a handover is an instant inside a
day. So **no assignment of that day to one side can be correct**, and the measurement showed both were
expensive: predecessor-owns lost $2,086.40, successor-owns would have lost **$25,574.13 across 24 rows**,
because eight links had a successor that reported nothing that day while the retired feed posted its final
trades. Ten times the money rode on the direction that looked obvious.

## The three lessons

**1. When a rule loses money in both directions, suspect the invariant, not the branch.** "Exactly one side
owns each date" sounds like a correctness property. It is an assumption that ownership is resolvable at the
granularity you happen to store. When it is not, the honest rule is to let the ambiguous unit be claimed by
neither — accept a bounded, visible overlap exactly where the data cannot decide. Price it: 9 rows /
$374.40 of visible duplication against a silent loss, on a system whose stated direction is already "a
visible, advisory-covered double, never a silent loss."

**2. Grep for every re-implementation of the rule before you believe the fix landed.** Two files had copied
the claim window. One was a pre-flight guard whose own docblock forbade "a window of its own invention" and
cited an earlier critic P0 for exactly that drift — and it still drifted, because a copy does not move when
the original does. Left inclusive, it over-predicted loss on the handover day and **refused the combine**
with *"1 charge totalling $2,086.40 appears on only one of them, and combining would stop it being
counted"* — blocking the very case the fix existed to protect. Note the shape of the correct repair: the
two sides now need **different** predicates (`succLoses` exclusive, `predKeeps` inclusive), because the
asymmetry is the change. A single shared predicate was the thing that made them look identical.

**3. A change that is right for a TOTAL can be wrong for a COUNT.** Releasing the day is right for every
figure that sums money — dropping either side deletes what only that side reported. It was wrong for
cadence detection, which infers a rhythm from gaps between dates: the duplicate injects a **0-day gap**.
Executed against the real detector, that fabricated a BIWEEKLY series out of two monthly sightings,
**destroyed** a real quarterly bill, and turned a biweekly $3,000 paycheck into weekly income — which
understates the shortfall, the direction this codebase calls the expensive one, and those series persist
into forecast and cash-needed. Before shipping a rule change, ask which readers are counting occurrences
rather than adding money; they need the duplicate collapsed, and collapsing it costs them nothing, because
a cadence is not a total.

## The bonus lesson, from the critic

**A test updated to match new output can stop testing anything.** The sibling fixture gave each predecessor
one day of history. Post-change both claims went empty, so the critic could **delete either link and the
test still passed** — it no longer exercised sibling composition at all. The tell is mechanical and worth
running by hand on any expectation you edit: remove the input the test is named for; if it still passes, it
is no longer a test. (Same family as `a-fix-that-cannot-fail-a-test-is-a-hypothesis` and
`a-directional-walk-cannot-see-a-sibling`, whose 210,120-case probe asserted how MANY rows survive and
never WHICH.)

Also: the first draft of the new docblock claimed the released date was "the only date that may be counted
twice." A chain sharing one cutover releases it at every generation — one $999.99 charge measured at
$3,999.96. A bound stated in a comment is a claim; execute it.
