# Sharing a basis is not sharing a scope — and a task row's premise is a hypothesis

**One line:** O.8 unified *which rows count as spending* across two surfaces and then claimed the two
figures agree, but agreement also needs *which rows belong to the merchant* — a second, unshared
dimension that made the shipped claim false by 5.2× on the demo seed; separately, both of the task
row's stated grounds for its other half turned out to be false, so the proposed fix would have been a
money regression.

## The unification that wasn't

O.6 and O.7 established a good rule: one question gets one basis. O.8 applied it to the last surface
still holding out — /trends' "New this month" amount — by giving it the reports engine's own exported
predicate instead of a private one. That part was right, and it was locked, mutation-proven, and
demo-golden-safe.

Then I wrote that the amount now reads "the exact rows Ask's `merchantSpend` counts" and that the two
"cannot drift". Both critics executed it and both found the same thing: `merchantMatches` takes a
**bidirectional whole-word prefix**, so a question about "Costco Gas" also sweeps every "Costco"
warehouse row. On the shipped seed that is **$37.38** on /trends against **$195.82** in Ask — answered,
worse, under the name *Costco*, a different store.

Two independent dimensions decide whether two merchant figures agree:

- **the row basis** — posted/pending, refunds, category, window. This is what a shared predicate buys.
- **the merchant scope** — which rows belong to the merchant at all. A shared predicate says nothing
  about it, because it is applied *before* the predicate ever runs.

Unifying the first while asserting the second is a new way to commit the original sin. The tell is a
parity claim whose two sides resolve their subject differently: one keys on an exact canonical string,
the other on a fuzzy match. **Check what selects the rows before you claim two engines agree on how it
counts them.**

The gap predated the slice — the old settled-gross figure was the same $37.38 — so what shipped was a
false *claim*, not a regression. That distinction decided the fix: narrow every claim, and **pin the
divergence with assertions** (including the wrong display name) so that closing it later means changing
a test that explains why it exists, rather than discovering it a third time.

## A lock whose fixture cannot express the failure certifies nothing

The test written to catch exactly this class used **one merchant string in every case**. With one
merchant in the universe, exact-key lookup and prefix matching are trivially identical — the file
advertised itself as "the assertion the divergence could only have been caught by" and was structurally
incapable of catching the divergence that was live in the repo it shipped into.

Its twin, from the other direction: the seed assertion `expect(m.amountCents).toBeGreaterThan(0)` became
**tautological** the moment I added a `net <= 0 → drop` rule to production code. A guarantee added to the
code silently converted an existing assertion into a restatement of it. Golden literals cannot rot this
way; a predicate that mirrors the implementation always can.

Ask of any new lock: *what value would make this fail, and can my fixture even represent it?*

## A "zero instances" measurement is not a claim about the mechanism

The other half of O.8 proposed excluding the `credit-card-payment` category from spending. Two grounds
were given and **both were false**: `NON_BUDGETABLE` turned out to gate which categories may carry a
budget *target*, not which rows count (so the two surfaces it claimed disagreed never had), and a
read-only production probe showed every such row already carrying `isTransfer: true` — the pair detector
catches them whenever we hold the card, which is the only case that double-counts. Excluding them would
have deleted the sole trace of money leaving for a reader paying a card the app cannot see, understating
a page that prints an instruction. Measuring beat reasoning, and the fix as specified would have been a
regression in the direction that costs a reader money.

But I then generalised that measurement into "excluding would fix nothing", and a critic falsified it by
execution: pairing needs opposite amounts **within ±3 calendar days**, so a payment leaving checking on
the 28th whose card credit posts on the 3rd escapes — only the card side gets flagged, and the phantom
spend is never repaid because the next month's net-refund rule drops the offsetting credit. One dataset
at one instant showed zero instances; the *mechanism* has a window that dataset never probed.

A sample tells you about the sample. Read the mechanism for its boundaries before you describe the
mechanism. And when a decision is genuinely a trade-off, say so — "declined because it would fix
nothing" and "declined because the other failure direction costs more" are different arguments, and only
the second survives contact with the window.

## Smaller things that were true anyway

- **A disclosure written for the rule you intended is not a disclosure of the rule you shipped.** The
  card said "a merchant appears here once a purchase settles" while the same slice's drop rule removes a
  settled purchase that was fully refunded — and a *pending* refund can veto a merchant a settled
  purchase confirmed, so pending money cannot name an event but can un-name one.
- **An honesty-critical sentence needs a lock.** Neither the card nor its basis paragraph was referenced
  by any test; both could have been deleted with every suite green.
- Counts belong in the status doc, not in source comments where nothing can falsify them; a probe
  should not print user emails into a transcript; and a pulled production credential should not be left
  at the repo root after the probe that needed it.
- The e2e written for the new copy failed on first run against a **stale build** — the recorded tell is
  "my change had no effect at all" — and passed after a rebuild.
