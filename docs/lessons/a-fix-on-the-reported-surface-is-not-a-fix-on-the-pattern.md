# A fix on the reported surface is not a fix on the pattern

C.12 (2026-08-04). The audit executed "Shortfall of **$10,001.00** on Aug 10" on four
surfaces — dashboard hero, a `critical` Today-feed nudge with nothing beside it, the Ask
answer, and the calendar dip cell — when Aug 10's true shortfall was **$1.00**. The whole
window's worst dip had been paired with the FIRST short date.

The same defect had already been fixed once: the radar's cover transfer got the
`firstShortCents` / `worstDipDate` split (L.23, "an amount and a date rendered together
are one instruction") — but the fix was scoped to the surface the bug report named. The
cash-needed engine kept shipping `shortfallCents: worstDip` beside
`shortfallDate: firstNegativeDate`, and every consumer inherited the lie. **A fix applied
where the defect was reported is not applied to the pattern.** When a defect is a SHAPE
(amount×date pairing), the fix is not done until the sweep question is answered: *where
else does this pair travel together?* Four surfaces answered here, and the sibling engine
was the source of three of them.

The slice's other three findings are the same root in different clothing — an instruction
that drifted from the figure it qualifies:

- /cards promoted a next-cycle ESTIMATE to "Do this first" while the total beside it
  excluded estimates. The selection for the imperative (urgency sort over every card) was
  a different set than the selection for the figure (`cycleObligations`). The gate is now
  the engine's own membership test — `paintedHeroCards`, the same one the hero uses — so
  the imperative cannot drift from the total again.
- /forecast disclosed "doesn't include card payments" after every figure it qualified,
  three screens below the hero. Its two siblings already enforced the placement rule:
  the reader meets the caveat before the figure (cash-needed-card) and before the
  imperative (/cards). A caveat's position is part of its truth.
- The radar's "Clear" never mentioned balance-carrying cards the engine could not date,
  while the hero on the same page named them. The verdict covers only what the walk can
  see; a Clear that cannot see money owed is the expensive direction (the card-side twin
  of the frozen-start rule, which the codebase already states unconditionally for the
  same reason).

**The general rule:** when you fix an instruction/figure mismatch, name the INVARIANT the
pair must satisfy ("this amount is needed by this date", "the imperative's card is inside
the printed total", "the caveat precedes what it qualifies"), put the membership test in
one shared place both sides import, and then grep the shape — not the symptom — across
every surface that pairs the same two kinds of thing.

**And test the fix against the shape, not the example.** The first cut of the two-step
split sentence ("the rest covers the low point on Jun 10, so it can be moved in two
steps") passed every fixture built from the REPORTED case (small first dip, large later
lump, nothing between) — and the copy critic executed one with rent landing in between:
step 1 leaves the account overdrawn before the named date, so the fix re-introduced the
exact amount×date decoupling it existed to repair. The soundness condition (every day
before the low point stays covered by step 1) is checkable only because the walk has
every day; the split is now OFFERED only when the walk proves it, and withheld otherwise
(the single sufficient instruction always stands). A convenience sentence derived from a
projection needs the projection's own proof behind it, or it is a guess wearing the
fix's clothes.

Related: [[a-dead-branch-is-a-claim-that-something-is-handled]] (point 9, the radar
instance), [[a-disclosure-written-for-a-page-is-false-in-an-email]] (where the reader
stands), [[the-narrowing-you-did-not-list]] (sweeps bounded by what you had in mind).
