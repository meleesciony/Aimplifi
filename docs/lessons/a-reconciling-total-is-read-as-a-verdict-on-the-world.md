# A check that reconciles is read as a verdict on the world, not on the arithmetic

**Hook:** the glass-box panel listed one real charge twice and printed "matched to the penny" underneath, and every sentence on the screen stayed literally true — both rows ARE counted, the panel DOES list both — so a reader auditing the figure was shown a duplicate with a tick beside it. Silence next to a passing check is not neutral; it is the check answering a question it was never asked.

## What happened

U.13 deliberately released the single "handover day" between a retired bank feed and the live one that replaced it to BOTH sides, because a handover is an instant inside a day and a business date carries no time. It is the right answer and it was measured: either whole-day award silently lost real money. Its stated price was "9 rows / $374.40 of VISIBLE duplication".

The visibility never shipped. U.16 found the panel doing something worse than staying quiet. `reconciles` is a genuine internal check — the rows the panel lists, summed, equal the figure above — and it was TRUE, because both copies really were counted into that figure. So the panel rendered:

```
Jul 21   KROGER    $50.00
Jul 21   KROGER    $50.00
Total              $130.00
These 3 rows add up to exactly $130.00 — matched to the penny.
```

A reader who opened that panel opened it to ask "is this figure right?". The only sentence answering them was a penny-match. It means "this app's arithmetic is self-consistent". It reads as "both of these belong".

The repo had already learned this once and written it down, in `glass-box/trace.ts`:

> two rows for one card therefore read as CONFIRMATION that both belong. `reconciles` stays true because it is a check on the engine's internal consistency, not on whether the world has two cards — and conflating the two is exactly what this line prevents.

That comment sat four files away from the panel that needed it, and the lesson did not transfer, because the CARD duplicate is a defect the app is trying to detect while the handover duplicate is a decision the app deliberately made. Being right about it is precisely what made it feel like nothing needed saying.

## The rule

**Whenever a surface both (a) certifies a figure with a consistency check and (b) can legitimately contain the same real-world event more than once, the check must be accompanied by a sentence naming that possibility.** The check does not have to be weakened or suppressed — it is true, and suppressing it would hide a real guarantee. It has to be scoped out loud: say what it is a check ON.

Three corollaries, each of which cost a critic finding on this slice:

1. **The disclosure's count must be summed from the same array as the figure.** Counting in a pass before a filter the figure applies after produces a sentence about rows the figure excludes. Here `spendingByCategory` drops any category netting `<= 0`, so a handover-day purchase cancelled by a refund left the total while still being counted in the note beside it — a $20.00 figure qualified with "2 transactions in this figure fall on a day…", which is a new false claim wearing a fix's clothes.

2. **A surface with no row list needs its own author.** The panel sentence says "N rows here", "the figure above", and reassures about a tally the reader can see. In an Ask answer — one number, nothing else — all three clauses are false. Same fact, different standing point (`a-disclosure-written-for-a-page-is-false-in-an-email`).

3. **The nouns carry direction.** Calling a released row a "charge" is false of a refund twice over: it is not a charge, and a duplicated refund makes a spending figure too LOW rather than too high. "Transaction" is the only noun true of every row that can reach the sentence.

## How to find these

Make the fact a REQUIRED field on the shared row type and let the compiler enumerate the surfaces. On this slice the ticket named four; `tsc` named three more transaction panels that print the identical penny-match line, and a critic found an eighth figure (an Ask period total) that states a number with no drilldown at all. A sweep bounded by the surfaces someone already listed is not a sweep (`the-narrowing-you-did-not-list`) — and unlike a grep, a required field cannot be satisfied by forgetting.

Give the non-applicable surfaces a real answer rather than a stub: allocation holdings, forecast projections and net-worth constituents all answer `false` here with the reason recorded on the field, because in six months a stub and a considered `false` are indistinguishable.

## The second cycle found more than the first, and both of its P0s were scope

A second pair of fresh-context critics ran against the fixed tree. Two findings are worth carrying forward on their own:

**A set you reuse carries the scope it was built for.** The released days already existed as `getReconciliationHandoverDates`, built by the previous slice for the tax export. Reusing it for a per-row marker looked free. But that CSV has no account column, so unscoped dates are exactly right there — and a released day is an ordinary shopping day on every *other* account the reader owns. Measured: six rows on that date, two of them from the combined pair, and all six were marked under "6 rows here fall on a day one of your combined accounts was changing connections". The unit of the claim was `(account, day)` and the set was `day`. Before reusing a set, ask what it is a set **of**, and whether that is the unit of the sentence you are about to write.

**A trace is a second selector, and it is the one that prints the check.** The disclosure was threaded into the answer path and not into the drilldown four lines beneath it, which re-derives the same figure and then certifies it. Both critics found it independently. When a slice qualifies a figure, every path that *re-derives* that figure inherits the obligation — and the path that renders a green check inherits it most.

The general form of both: this slice's own thesis is that a check certifies more than it checks. Both misses were the same mistake one level up — reusing something correct in a context that silently widens what it claims.
