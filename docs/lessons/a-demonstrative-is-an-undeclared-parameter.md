# A demonstrative is a parameter you forgot to declare — and the author count in the task row is a guess

**One line:** O.18f unified four hand-rolled copies of one disclosure onto a single author, and the
two things that nearly shipped wrong were both invisible at the extraction site: the task row's
claim about how many copies existed, and a trailing "that amount" whose antecedent silently changed
meaning the moment the noun in front of it became a parameter.

## The author count in the row is a hypothesis, and so is the one in the docblock

The task row said the excluded-card disclosure had **three** authors. So did the docblock of the
function filing the residual, in as many words: *"this is the class's THIRD author."* Both were
written by someone who had just read three of them.

There were four. `answer.ts` hand-rolled all four facts for the Ask safe-to-spend answer and
appeared in neither list. It took one grep of the distinctive phrases — not of the function name,
which the fourth copy did not use — to find it.

The general form, which this repo has now recorded several times: **a count of call sites is a claim
like any other, and it decays.** Grep the phrases, not the identifier; identifiers are what shared
code uses, and the whole problem is the code that is not shared. Had I trusted the row, the
"unification" would have shipped with a fourth copy still drifting, which is the failure mode the
slice existed to remove, restated by the fix meant to remove it.

## Parameterizing a noun re-points every pronoun after it

The four copies ended their frozen-card sentence differently. The one I generalized read:

> A card behind this figure stopped being shared by the bank, so **the card-payments amount** may be
> stale.

The extraction turned the noun into a `container` parameter and kept the tail fixed — "so **that
amount** may be stale" — which is correct while `container` is *the card-payments amount*, and
false the moment it is *this figure*: on the dashboard the demonstrative resolved to the guilt-free
headline, telling the reader the wrong figure was stale. tsc cannot see this. Every test passed. A
fresh-context critic found it by reading the rendered sentence with each argument substituted in.

**The rule:** when you parameterize a noun, every pronoun, demonstrative and definite article
downstream of it in the same sentence is now a dangling reference. Either bind them to something the
caller supplies, or — better — re-anchor them to a noun the *data* carries rather than the surface
does. The fix here was to let the referent follow the CARD ("so its amount / their amounts may be
stale"), which is true regardless of what any surface calls the container.

Corollary: read the shared sentence out loud once per call site, with that call site's arguments
substituted. Four readings caught what four green test files did not.

## The compact/named split is a real distinction, not laziness

Lesson 19 warns that not every duplicate is duplication. Here the four copies collapsed to exactly
two shapes — **compact** (one line per fact, cards counted, the two exclusion mechanisms merged) and
**named** (cards named, mechanisms split, one sentence per duplicate pair) — because two surfaces
have room to name cards and two do not. That is a genuine per-surface fact, so it became a required
field rather than a default. The test that the shapes stay distinct is worth more than the test that
either one is correct: `detail: 'compact'` emitting a `named`-only fact would make the dashboard,
which selects notes by fact, silently drop a disclosure entirely.

## What the drift was actually hiding

The point of diffing before extracting (lesson 19) is not tidiness. Three of the four copies said
"**Two** of the cards may be the same card counted twice" with the number hardcoded, because each
author had pictured exactly one pair; the detector has no cap, so a reader whose card pairs with two
others was told a false count, and Ask's copy said "Two cards" while naming four of them in the same
breath. Nobody was looking for that bug. It fell out of putting the four sentences side by side —
which is the whole argument for doing that first.
