# A rule written as two directional walks is blind to everything related but not ordered — and its tiebreak is the money

*U.9, 2026-08-12 (DECISIONS #453).*

**The bug.** The reconciliation boundary decides which recorded balance survives when the same real
bank account arrives from two providers. It expressed that rule as two walks: `upstreamsOf(X)` and
`downstreamsOf(X)`. A link means "these two rows are the same real account", and the schema
deliberately allows one live account to supersede MANY stale rows. Two such siblings are neither
upstream nor downstream of each other, so each was compared against the successor — which it
correctly beat — and never against its twin. Both survived, and one real $5,000.00 account
contributed $10,000.00 to the net-worth trend.

**The generalisation.** "Same as" is an EQUIVALENCE: reflexive, symmetric, transitive. A directional
walk models an ORDER. Whenever you implement an equivalence with an order, you silently exclude
every pair that is related but not ordered, and the exclusion is invisible in every test whose
fixture happens to be a chain. The unit of de-duplication is the connected COMPONENT. The tell that
this had already happened once: the statements rule in the same file had hit the identical blind
spot and fixed it *locally for statements* — a comment even named the sibling shape — and nobody
generalised it, so the other three rules in the file kept the bug.

**The part that cost more than the bug: the tiebreak.** The fix ranked candidates by tier, then
cutover, then ACCOUNT ID. Both hostile critics, independently, found the same P0 there. When a
chain's two cutovers are EQUAL — valid data, since the write guard refuses only a *strictly earlier*
downstream cutover, and a successor with no transactions gets today as its handover — the mid-chain
account's ownership window `(cut..cut]` is empty, so the upstream owns the date. The comparator had
no notion of chain position and fell through to the id, so the same data produced a $4,000.00 or a
$9,000.00 trend point depending only on how two opaque cuids sorted.

> A tiebreak inside a money rule is part of the rule. Breaking a tie on an identifier the user
> cannot see makes the figure nondeterministic across users holding identical data — and it can
> hand a date to a row whose window the rule's own comment says is empty.

**And the probe could not have caught it.** The slice shipped an exhaustive property probe —
210,120 cases, every link shape, union-find grouping, confirmed discriminating (43,648 violations
against the old engine). It asserted: exactly one survivor per component per date, never zero, order
independent. It never asked WHICH row wins. So it printed `INVARIANT HOLDS` on the exact shape that
was broken. Every pre-existing chain fixture in the test file also used distinct cutovers, so the
tests were structurally blind too.

> An invariant probe is only as strong as the property it names. "Exactly one survived" is strictly
> weaker than "the right one survived", and a green exhaustive sweep reads like proof of both.

**Three habits this session earned:**

1. When a fix makes a BORROWED invariant load-bearing, guard it where you now rely on it. The
   component key's soundness needs out-degree <= 1, which the schema's `@unique` provides. The same
   file already re-checks cycles and monotonicity at read time although both are refused at write
   time; out-degree was the one invariant still taken on trust, and without a guard a forked
   predecessor reproduced the very double-count being fixed, through another door.
2. Fix the SHAPE or file it with its measurement. The identical sibling blindness double-counts
   TRANSACTIONS (measured: −$100.00 for one real −$50.00 purchase). It was deliberately not fixed,
   because a snapshot is a STOCK — a second row for one date is provably a duplicate — while a
   transaction is a FLOW, where two $50.00 charges in a day are ordinary and de-duplicating by claim
   span would silently delete a row only one feed ever saw. That is a failure-direction decision, not
   an inheritance. It is locked as `it.fails` asserting the CORRECT number, never as a
   characterization asserting the wrong one: a test whose `expect` is the wrong value teaches the
   next reader that the wrong value is intended.
3. A disclosure inherits the scope of the rule it explains, and the sweep must leave the file you
   already opened. Widening "a pair" to "a component" falsified every clause that named the pair,
   counted it, or pointed at it — four wrong claims in ONE sentence — plus the drilldown's "a pair
   you have combined" on the surface that actually shows the money, and a combine-card promise that
   "a date is never counted twice" which the slice's own new measurement disproves.
