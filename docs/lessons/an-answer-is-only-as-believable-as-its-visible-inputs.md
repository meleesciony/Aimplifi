# An answer is only as believable as its visible inputs — and every fix to that is a provenance claim

**One line:** the owner called the wealth-target card's figures "arbitrary" when they were
arithmetically correct and mutually consistent; what was missing was the *origin* of the numbers,
and once we started printing origins, two fresh-context critics returned 12 findings between them
of which **every single P1 was a false claim about where a number came from** — not one was a
computation.

## The report, and why the obvious reading was wrong

> *"I set 10 mil and it gave me some arbitrary savings for arbitrary time."*

The instinct is "the math is broken." It was not. Solving backwards from the two printed answers —
$23,888.10/month reaching $10M in 12y10m, and 25 years requiring $349.41/month — gives implied
starting balances of $1,472,908 and $1,495,242. The same number twice, to within whole-month
rounding. The card was right, and it agreed with itself.

**What made it read as arbitrary is that it computed from four inputs and rendered a control for
one.** The reader typed the target; the portfolio, the pace, the horizon and the two rate dials
all arrived invisibly. $349.41/month reaching $10,000,000 is an unbelievable sentence *unless you
can see the $1.48M already working* — and that figure was printed in exactly one branch
(`already-there`), which this reader was not in.

Corollary worth keeping: **check whether a "wrong number" report is actually a provenance report.**
Back-solve the printed figures for the hidden input. If they agree with each other, the arithmetic
is not the defect and rewriting the engine is wasted work.

## The constant nobody chose

`DEFAULT_HORIZON_YEARS = 25` produced the "arbitrary time" half. It was rendered in the same
visual weight as the computed figures, with nothing to distinguish a number the app picked from a
number the reader set. The fix was to seed it from the reader's own arrival
(`ceil(monthsAtCurrentRate / 12)`), which also makes the card *open self-consistent*: the pace
sentence and the required-contribution sentence describe the same landing before anything is
touched.

Three details that mattered more than the seeding itself:

- **`ceil`, not `round`.** Rounding down opens the card demanding money on top of a pace it has
  just called sufficient — the two halves contradict each other in the untouched state.
- **Refuse, don't clamp.** A 70-year arrival parked on the control's 40-year ceiling presents the
  ceiling as the reader's trajectory. Three states return `seeded: false` instead, and the copy
  then says nothing picked the date. (Same shape as `a-clamped-output-may-not-print-its-inputs`,
  one control over.)
- **Three facts need three states.** `horizonSeeded` was a boolean covering *seeded* and
  *fallback*, so a reader who had just dragged the slider was told, one line beneath it,
  *"Nothing has picked this date for you — drag it to the year you actually want."* Both critics
  found this independently, and the first version of the e2e **asserted the false sentence as
  correct behaviour**. Count the states before choosing the type; a test written against a
  two-state model locks the missing third.

## The part that generalises: printing an origin creates new claims

Every P1 from both critics was a sentence *added to make a figure believable* that asserted more
than the code delivered:

| The sentence | Why it was false |
| --- | --- |
| "averaged over your last 6 complete months" | the divisor is `last6.length`, and `monthlyFlows` emits only months that *contain* rows — 3 for a reader three months in, and a span of eight calendar months when two are empty |
| "Both rates above are your own settings" | `User.inflationBps` is nullable; the settings page one tap away calls the same 2.50% *"our defaults"* |
| "this rate is a return on invested money, not on cash" | the very next sentence compounds the monthly leftover — which is cash — at that rate |
| "Checking and savings balances are not counted" | presented as *the* exclusion, while the currency guard silently drops non-USD investment accounts too |
| "every figure on this card moves" | false of four figures, all of them inputs from elsewhere |

The pattern: **a disclosure is a claim, and adding disclosures adds claims faster than it adds
safety.** The pre-change copy ("Saving $23,888.10/month") stated no window and therefore could not
be *wrong* about one; naming the window is still right, but it converts a silent gap into a
falsifiable assertion, and the assertion has to be true.

Two rules taken from it:

- **Plumb the real value rather than vaguening the sentence.** The tempting fix for the window
  claim was "averaged over the months Aimplifi has" — true, and useless to a reader trying to judge
  the figure. We passed `monthlySavingsMonths` up from the server instead. A checkable sentence
  that names a real number beats an unfalsifiable one.
- **A possessive is a claim.** "Your dials" may not be said until the code knows the reader set
  them. A required prop (`inflationIsDefault`) forces the caller to answer — and, per
  `a-required-argument-makes-a-caller-answer-not-answer-correctly`, forcing the question is not
  the same as getting it right, so it is locked by a test on both branches.

## The scan that had quietly stopped scanning

`coach-copy.test.ts` opens by claiming it scans *"EVERY string COACH_COPY can produce"*. It is a
hand-maintained array, and **nothing checked that it was complete.** This slice first shipped three
new copy entries with zero rows, so the shame sweep, the projection-assumption sweep and the ticker
sweep all skipped them — and the moment they were registered, one failed on the spot ("which is
what grows at 7.50%" asserts a market return with no hedge).

Adding the completeness assertion immediately found **seven pre-existing unscanned keys**. Those
are pinned in a `KNOWN_UNSCANNED` list that may only shrink, with the pin itself asserted so a
registered key must leave it.

> A hand-maintained list of everything is only as good as the check that it IS everything. If a
> test's docblock says "every", write the assertion that makes it true.

## Method notes

- **Two critics with different lenses (money-math vs claims/UI) earned their cost in the overlap
  AND the non-overlap.** They converged on five defects independently — which is the strongest
  signal available that a finding is real — and each found P1s the other missed (the currency-guard
  exclusion was money-lens only; the guardrail-scan evasion was claims-lens only).
- **A delegated finding is a hypothesis.** Both critics asserted the `monthlyFlows` month-emission
  mechanism; verifying it took one `sed` and was worth it, because the fix depended on the exact
  divisor.
- **The money-lens critic tried to falsify the seed's self-consistency and failed** — analytically,
  then over 140,067 random seeded cases with zero violations. A critic reporting that it *could not*
  break something, and saying how hard it tried, is more useful than one reporting a pass.
- **The stale-build trap bit again** (`e2e-runs-a-stale-build`): a spec run after editing copy
  failed on a case-sensitive `toContainText` because Playwright reused the build from before the
  edit. The tell was that the assertion failed on a string the source plainly contained.
- **Write generated text with file tools, not shell heredocs** — a heredoc containing the docs for
  this very slice died on quoting, exactly as `windows-codegen-via-shell` records.
