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

## Extended by W.10 / W.10a — the same defect one card down, and what fixing it taught

The opportunity list below the FI card was still printing 30-year **nominal** future values
("$X of future wealth … assuming 7.00%") under a card that now compounds in today's money. The
lesson above says to trace every consumer of the payload; this was one, one scroll away, and it
survived W.2 because it was on a *different card with its own copy*. Two dollar figures on one
page, ~2× apart, with only the word "future" distinguishing them. **Adjacency is itself a
claim** — two money figures on one screen assert they are comparable unless something says
otherwise.

### There is more than one "today's money", and the choice is a modelling claim

Deflating is not one operation. For a monthly stream there are two answers ~23% apart:

- compound at the **real** rate → a contribution *level in today's dollars* (one the reader
  raises with inflation every year);
- compound at the **nominal** dial and deflate the whole total → a contribution *level in
  nominal dollars* (the reader redirects that amount and never raises it).

The first shipped, and two independent critics killed it on the same row. `findOpportunities`
mints a `negotiable-bill` opportunity as a **hard-coded flat $20.00/mo** retention offer, so the
justification for indexing it — "the money you free up is a price, and prices rise" — is a claim
about a price where there is no price. It printed 30.6% more than that reader will ever hold.
The argument was true of two of the four kinds, approximately true of a third (insurance
re-shop is 15% *of* a premium, so it scales for free) and false of the fourth.

**A modelling assumption that has to be argued per row is the wrong assumption.** Prefer the one
convention that is conservative for every row and whose premise is the literal sentence printed
beside the figure ("you invest that amount every month and never raise it"). Then name the
direction it errs in, which is what lets the printed number stay the conservative one instead of
compounding the optimism in and disclosing nothing.

It paid a second dividend: the conservative model has **no clamp**. The real-rate version
inherited `realReturnBps`'s floor at 0, which is why the first draft rendered *"assuming 0.00%
average annual growth after inflation — compounding does the work, not willpower"* beside a
figure that was pure addition. Both critics found that independently too.

### Gate a sentence about a computed figure on the COMPUTATION, not on a rule about its inputs

The basis paragraph tells a reader whose figures land below the money they hand over that this
is the assumptions working, not a bug. It was gated on `inflationBps >= nominalBps` — inflation
at or above the return assumption — which *sounds* like the same condition. Sweeping every dial
pair the app permits, across all three printed horizons:

- **1,579 horizon-cases** have inflation strictly **below** the return assumption and still
  trail the contributions. 10.25% against 10.00% trails by 62% at thirty years, and the sentence
  said nothing.
- **149 pairs** trail at ten or twenty years but not at thirty — so "every figure" and "the
  shorter horizons" are two different sentences, not one with a soft edge.

The mechanism the guess missed: each annuity dollar is invested for less than the whole horizon
while the deflator runs all of it, so break-even sits well above equal dials *and moves with the
horizon*. The fix is a predicate computed from the same engine the figures come from, asked once
per horizon — a guard reading exactly what it guards. It is the same disease as the lesson above
one level down: there, a rate was inferred rather than derived; here, a *claim about a rate's
consequences* was inferred rather than computed.

**And check the claim against the ROUNDED display, not the exact value.** The predicate is
exact; the figure is printed in cents. At 14.00%/8.00% over ten years the value trails by
0.0008% — under a cent on a $2.50/mo row — so it prints as *exactly* what was paid in and
"below" is false. The sweep that proved the predicate is what caught the tie; re-reading the
sentence never would have. One word ("at or below") rather than a per-row predicate inside a
sentence that qualifies a whole list.

### Two more that cost nothing to find and would have shipped

- **A critic swapped the 30- and 20-year figures into each other's template slots and every
  assertion in the repo stayed green** — each lock was `toContain(oneFigure)`, which cannot see
  *where* the figure landed. A reader would have been told the 20-year total was the larger. Pin
  a **golden sentence** or an ordered equality, not three containments; a figure in the wrong
  slot is the same class of defect as a wrong figure.
- **Two of the four row kinds had never parsed** — "…(an estimate, assuming a standard offer):
  is $15,187.72…", a verb with no subject, shipping since Phase 3. The copy sweeps scan for
  shame words and stated assumptions, not grammar. Asking a critic to *read each branch out
  loud with real arguments substituted* found both in one pass.

### Method notes (these two slices)

- **A critic that did not run is not a pass.** Both cycle-2 critics died on a platform session
  limit. Running their assignment by hand found two real defects — so the work was worth doing —
  but it is weaker than an independent pass, because the checks were chosen by the author of the
  code. Say which cycles actually ran when recording a slice; "criticized" is a claim like any
  other.
- **Check `git log` before assuming the tree is yours.** Mid-session, a concurrent session in
  the same checkout committed this work, deployed it, and moved on to the next task. The first
  sign was `git diff --stat` shrinking from eleven files to four. Establish what is *committed*
  before writing a commit, or you will describe a change that is already shipped as if it were
  new — and the follow-up correction, which is what was actually left in the tree, is the thing
  that needs the honest message.
- **Verify a deploy by the commit SHA, not by a 200 or by timing.**
  `vercel ls <project> --meta githubCommitSha=<sha>` returning exactly the READY production
  deployment, plus `vercel inspect` showing the apex domain among its aliases, is the proof.
