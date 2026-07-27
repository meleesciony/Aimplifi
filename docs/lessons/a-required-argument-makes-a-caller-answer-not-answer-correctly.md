# A required argument makes a caller answer, never answer correctly — and an empty table is not an empty world

One-line summary: L.30 fixed a direction bug in Ask by making the direction a REQUIRED argument, wrote a
docblock claiming it was "locked both ways", and then passed the wrong value at the third caller in the same
slice — while the branch it was proudest of read an empty table as proof of an empty world.

## The required-argument illusion

L.30's shared disclosure sentence said the guilt-free figure was "too generous". That is backwards on Ask's
overspent branch, which renders the OVERAGE — the negation of left-to-spend — where a missing bill makes the
printed number BIGGER. I caught that myself, made `headline` a required parameter, locked both directions and
both absences, and wrote that the direction "is now required and locked both ways".

Then I added a third caller, `/budgets`, and passed `overspent ? 'overage' : 'left-to-spend'`. That surface
renders `plan.leftToSpendCents` **itself**, sign and all — `-$1,000.00 · -20%` in an overspent month. It never
prints an overage. A fresh-context critic reproduced it in one run: the strip printed a figure that gets
*smaller* beside a sentence saying the number was *bigger* than shown, and "than shown" had no referent.

The type system did its whole job. `tsc` forced me to supply an argument; it cannot know which argument is
true. **A required parameter converts a silent default into a visible question, and a visible question can
still be answered wrong** — so the fix for a per-surface fact is not only to require it, but to derive it from
something the surface can be *asked*. Here the discriminator was never `overspent` (a property of the plan);
it was WHICH FIGURE THE SURFACE PRINTS (a property of the surface). The same slice added a second such
argument for the same reason — `lineName`, because /budgets prints no "fixed-expenses line", only a "Fixed
costs" bucket that also holds card payments, so a sentence naming a line pointed at nothing.

Corollary for docblocks: I wrote "locked both ways" about a lock that covered two of three callers. A comment
asserting an invariant is a claim like any other, and the moment a third call site exists it is stale. Grep the
call sites before writing the sentence, and count them.

## An empty table is not an empty world

The branch L.30 was built for said `Fixed & recurring expenses (no repeating bills found yet)` when
`detected === 0`. L.29 had deliberately refused that claim for want of proof; L.30 believed the stored
`RecurringSeries` count WAS the proof, and a test asserted so in as many words.

Both critics, independently, executed the counterexample: a series is stored only if its merchant has a
`Merchant` row, and while the Plaid and SimpleFIN ingests upsert one, the manual-add and CSV-import writers do
not. So a reader who TYPED IN his own monthly bills got "no repeating bills found yet" on the guilt-free panel
while `/recurring` listed them — a false all-clear on a $0 line, which is exactly the failure the whole
L.26→L.30 thread exists to remove, restated by the fix meant to remove it.

The rule: **before reading a count of rows as a fact about the world, enumerate every writer that can decline
to create a row.** An emptiness with two causes proves neither. And when a critic finds such a case, delete the
branch rather than narrow it (the L.24 rule): a narrowed sentence keeps asserting the part you have not
checked. Deleting it cost the slice its nicest copy and left the honest fallback in place; the ROOT cause — a
merchant-less series being invisible to the reason ledger at all, so the alarm has zero coverage for that
reader — is recorded in `docs/STATUS.md §OPEN after L.30` rather than papered over.

## Two smaller ones from the same cycle

**A claim that another surface holds the money must be resolved against that surface acting.** "All charged to
a card" asserted the card-payments line held those bills — false whenever a card is undated, its statement
ungenerated, or its currency withheld, because then its obligation is excluded from the term entirely and BOTH
lines print $0.00.

**A new derived column must join the change signal that governs what it rewrites.** `derivedProjectionDigest`
did not select the new `projectionStatus`, so L.28's own defect returned for the new field: the first
post-deploy sync — the one that closes the null window for every existing row — reported `changed: false` and
the page repainted the stale sentence. When adding a column that a rendered sentence derives from, add it to
the digest in the same edit.

## Process notes that paid off

- Running the two critics with DIFFERENT lenses (copy honesty; wiring and narrowings) rather than two copies
  of one: they converged on two findings — the signal those were real — and each found P1s the other missed.
- Running an explorer subagent *beside* the verify gate caused 4 phantom e2e failures with the documented #287
  strict-mode signature. `serialize for PROVING` is not advice; the gate must run alone.
- The settling move on a suspected regression is a stashed clean-tree run BEFORE writing any diagnosis. It
  proved my filter chip really did break `transactions.spec.ts:357` (it passes clean, fails with only that
  button rendered), which is why that work sits on a branch instead of on `main`.
