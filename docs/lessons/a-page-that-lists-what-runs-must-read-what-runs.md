# A page that claims to list what the engine runs must read the engine's own query — and a "narrow sibling" write is how the same dead end ships twice

**Hook:** `/rules` listed the rules it could RENDER (`NOT: { matchKeywords: null }`)
while the categorizer loaded the rules it RUNS (every `CategorizationRule` row). Same
question, two queries, and the gap was exactly the rules the reader authored most
often — every "Always" tap. They filed his money for as long as the account existed
on a page that said *"You haven't written any rules yet"*, and the delete action was
scoped to the same subset, so the omitted rules were precisely the undeletable ones.
(O.15 slice 3 / TASKS O.13d, DECISIONS #343.)

## The shape to recognize

A read-side filter added for a rendering reason silently becomes a claim about the
domain. `listKeywordRules` filtered to typed rules because the builder could only
render typed rules — a true statement about the COMPONENT that reads as a false
statement about the ACCOUNT the moment the list is titled "Your rules".

The tell is two functions answering one question over different WHEREs. Grep for the
other readers of the table before writing a list; if the engine's loader and the
page's loader are not the same call, the page is a hypothesis about the engine.

The fix that holds: the page reads the engine's own query, and the engine's mapper
gains ONE decision point that returns either the result or a NAMED refusal
(`mapStoredRule` → `{ok:true, likes}` | `{ok:false, refusal}`). Then "this rule files
nothing, and here is why" is the engine's own silence read back, and it cannot drift.
Assert it: *union of the page's lists === the ids the engine loads, intersection
empty*, over real rows.

## The second half, which cost a whole critic cycle

The new delete was written as a deliberately "narrow sibling" of the existing one —
exact complementary WHEREs (`matchKeywords: null` / `NOT null`), justified by this
repo's own lesson that widening a single-actor field means re-auditing every consumer.
It was wrong, and it re-shipped the defect one screen later: the list also renders a
TYPED rule whose key decoded to nothing, and `''` is not `null`. The WHERE matched
zero rows, returned `{ deleted: false }` **without throwing**, so the button spun,
`router.refresh()` re-rendered the same row, and no error appeared — beside copy
reading "Delete it and write the rule again."

Generalize: **scope a mutation to what its own surface RENDERS, not to the kind its
name suggests.** Containment is worth something only when the two scopes are known to
partition the rendered set; here they didn't, and a silent `count: 0` is
indistinguishable from a broken button. The invariant to test is *every row this list
renders is removed by the action its button calls* — enumerated over row shapes, not
argued.

## A refusal must not suppress the identity the reader needs to act

First version nulled the merchant name for every refused rule ("never print an
identity the engine refused to honour"). That produced a row saying *"always file **a
payee that is no longer here**"* directly above *"This payee name stands for many
different people — like Venmo, Zelle or a check"*. Two contradictory claims about one
rule, and the only string that identified it was the one suppressed.

Refusing to **file** on a name is not a reason to refuse to **show** it. Carry the
refused identity in a separate field so nothing downstream can match on it, and phrase
the row from the REFUSAL, never from the row's origin — an origin-first branch is how
the same defect survived into cycle 2, swallowing a typed rule refused for a merchant
reason and announcing "whose words are gone" when the words were right there.

## The measurement worth stealing: assert the fix in BOTH directions

Cycle 2's most useful finding was not a bug. Three of the five cycle-1 fixes were
locked by no test that could fail if they were reverted:

- a partition test asserting `isBuilderListed(e) === isInventoryListed(e)` is false —
  `x === !x`, true of every possible implementation, including the one the fix existed
  to avoid;
- `isDemo` asserted only TRUE, so hardcoding it would have told every real user "the
  demo account is shared by everyone trying Aimplifi";
- `hasLearnedRules` asserted only FALSE, so hardcoding it would have silently deleted
  the one paragraph where the page admits its list is not everything filing your money.

A boolean asserted in one direction is not locked. Write the expected side out per
case rather than deriving it from the code under test — and when two formulations are
genuinely equivalent over every reachable input (as the two `isBuilderListed`s were),
say so in the module instead of letting a test imply a discrimination it cannot make.

## And a count is a claim about money

`learnedCount: learned.length` would have told a reader who taught the app ONE payee
that it "picked up 2 patterns" — `learn.ts` emits a signature-keyed rule AND a
canonical-keyed one per payee (#331). Before printing a number derived from an
engine's output, check what one unit of the reader's action produces in that output.
When the honest count is hard, ship the claim the data supports: a boolean.
