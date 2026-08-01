# A rate and the target it aims at must share a unit — and changing a basis breaks every sentence and every surface that shared the old one

**One line:** W.2's defect was that `monthsToFI` was called with the right portfolio, the right
savings, the right target and the **wrong third argument** — a nominal return aimed at a
present-value goal — and the expensive part of fixing it was not the fix (one variable) but the
blast radius: two hostile critics returned seven P1s, and *none* of them were about the new
arithmetic.

## The defect

`fiNumberCents(annualExpenses, swrBps)` builds the FI target from the reader's last six
complete months of actual spending. That is a **present value** — today's dollars. The server
then grew the portfolio toward it at `user.expectedReturnBps`, the **nominal** dial, and
stopped when the compounding balance crossed the target. Future nominal dollars compared
against today's dollars: a unit mismatch, erring in exactly one direction (early) by exactly
the inflation gap. At the default dials, 7.00% against 4.50%.

Every engine test passed. They always would have — the arithmetic was never wrong, and no
test of `monthsToFI` can see that its caller handed it the wrong kind of rate.

**The tell to look for elsewhere:** any place a *rate* and a *target* meet. Ask what each is
denominated in and say the answer out loud. If the target came from the user's own historical
spending, or from anything measured in what things cost now, the rate must be real. If the
target is a future nominal amount, the rate must be nominal. Mixing them is not conservative in
either direction — it is just wrong, and it usually flatters.

## The part that cost the most: a basis is not local

The rate lives in one variable. What it *means* was spread across the whole product:

- **Sentences that described the old basis** — "assuming 7.00% average annual returns" — became
  false. Easy; caught by types.
- **A sentence written specifically to disclose the old contradiction** became false in the
  opposite direction. `wealthTargetVsFiCard` existed to tell the reader "the card above assumes
  7.00% before inflation, so its date is earlier than anything here." Fixing the FI card left
  that sentence asserting a difference that no longer exists, pointing at a card whose date had
  moved the *other* way. **A disclosure of a known defect is a liability the moment the defect
  is fixed** — grep for the disclosures before you fix the thing they disclose.
- **Its lock survived.** Both the unit test and the e2e pinned the retired words (`toContain('before inflation')`)
  and would have gone on passing while the page told the reader something false. A copy lock
  that survives the change it should have caught is worse than no lock; the replacements assert
  the new claim *and* `not.toContain` the old one.
- **A dollar figure silently changed meaning without changing a character.** By this repo's own
  engine convention, a level contribution compounded at a *real* rate is denominated in today's
  dollars — so the Coast card's "$1,454.62/month" went from a standing order you can set up
  once to an instalment that must escalate, and the sentence around it never moved. The sibling
  card already carried that caveat for the identical figure. **Changing a rate re-denominates
  every dollar derived from it; the units are part of the copy.**
- **A neighbouring route kept the old basis.** `/goals` ran the *identical* simulation against
  the *identical* present-value target at the nominal rate — 181 months where the card the
  reader had just left said 221. The slice's own thesis is that one page may not carry two bases
  for one question; leaving it made that true across two pages instead. **Trace every consumer
  of the payload, not every consumer of the line you edited.**
- **A settings page described the dial's reach.** `inflationBps` was documented as affecting the
  retirement outlook on /investments. It now moves the FI date, the Coast line and every goal.

## `null` is not one fact

`monthsToFI` returns `null` both for "savings ≤ 0" and for "saving, but past the 1200-month
cap", and the card rendered *"Contributions aren't outpacing spending yet"* for both. Lowering
the rate widened the second set — at a floored 0% real return the cap binds on a clean
threshold (savings below `fiTarget / 1200`), so a reader putting away $500 a month was told
they were not saving. **Both critics found this independently**, from different lenses.

The fix was four states. The *test* for the fix was the interesting part: the first version
re-implemented the card's ternary chain inside the test file, which would have passed happily
while the component regressed. The selector is now one exported function (`fiHeadline`) that
the card renders and the test calls. **If a test has to restate the logic under test, it is
testing a copy.**

## Method notes

- **Two critics, two lenses, independent convergence on two findings.** That convergence is the
  strongest signal available that a finding is real, and the non-overlap paid for the second
  critic: the money lens found /goals and the unclamped helper; the claims lens found the
  re-denominated dollar figure and measured a 314×16px tap target in a real browser.
- **They also reported what they could not break**, at length — `coastFI`'s bisection converges
  at 0% growth; no NaN/Infinity at any settings-reachable dial pair; the slider agrees with the
  server across ~50,000 swept (income, savings) pairs. That is worth as much as the hits,
  because it stops the next reviewer re-spending it.
- **Mutation-prove or it is a hypothesis.** Reverting the basis killed exactly 3 tests;
  collapsing the four states killed exactly 2; removing the inner clamp killed exactly 1.
- **A guardrail caught the author.** The projection-assumption sweep rejected the rewritten
  reconciliation sentence for dropping the word "assuming". The sweep was right.
- **`Math.max(0, a - b)` clamps one end, not two.** A negative `b` makes it *add*. The helper is
  shared by four surfaces; validation at the single current writer is not a property of the
  function.
