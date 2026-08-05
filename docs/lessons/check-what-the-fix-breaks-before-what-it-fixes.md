# Unifying two figures can break a stronger invariant than the one it fixes — check the links before you change the basis

**One line:** C.13's "two 'spent this month' figures over two windows" fix was correct arithmetic
and was reverted anyway, because clamping the figure left its register link pointing at the
unclamped month — $120.00 clicked, $520.00 of rows — and in this codebase a figure disagreeing
with its own destination outranks two figures disagreeing with each other.

## What happened

The audit (P1-28) was right: `computePace` filtered rows to `<= today` and `spendingByCategory`
did not, so `TopSpendingCard` ("this month") and the Trends card ("spent this month") sat one
card apart on the dashboard over two windows. `merchantSpend` had carried the clamp since O.7
*with the argument already written out in a docblock* — "'You spent' is a claim about money
already gone" — so the fix looked like propagating a rule the repo had already decided.

It was implemented as `spentAsOf` applied to the array in `getReports` and the three Ask
category intents, with the Glass-Box panel builders fed the identical array so `reconciles`
could not go false. Full verify green: tsc 0, eslint 0, 5956 unit, build clean. Targeted e2e
46/46.

A fresh-context critic then executed five P1s. The one that killed it:
`categoryMonthRegisterHref` derives its `to` from `monthWindow(month)` — the last day of the
month — and the register applies no `<= today`. So every clamped figure on /reports now linked
to a destination that summed more than it did. Measured, not argued: $120.00 clicked, landing
on $520.00 of rows.

## The rule

**Before changing what a figure counts, enumerate what that figure is a claim ABOUT.** In this
codebase a figure is routinely three claims at once: its own arithmetic, the rows a Glass-Box
panel recomposes it from, and the row set its register link opens. Changing the basis satisfies
the first two automatically (pass one array) and silently breaks the third, because the link's
window is built by a different module from a different input.

The corollary is a triage rule, not just a design rule. When a fix trades divergence A for
divergence B, rank them by the repo's own precedent before shipping: `a-link-on-a-figure-asserts-
two-engines-agree` and the O.5/O.6 cycle treat "the destination does not sum to the figure" as a
P0-class defect, while "two figures on one screen answer slightly different questions" is a P1
that a qualifier can hold. A fix that moves a defect *up* the severity ladder is worse than the
defect.

## What to do instead

Either (a) make the link window come from the same author as the figure's window, so both move
together, or (b) leave the basis alone and disclose the difference in the label. Do not clamp one
surface and leave its siblings — the sibling comparison is what the reader will actually make.
The full five-finding spec is in the `C.26` task row; it is a large slice, not a medium one, and
the row that scoped it as medium was wrong.

## Also confirmed here (again)

The critic ran `git checkout` on a source file mid-audit to restore its own mutation experiment
and destroyed a newer edit of mine, then reconstructed it in different wording. The tests passed
on the reconstruction, because my lock asserted a regex the substitute happened to satisfy. It
was caught by reading `git diff`, not by the gate. See `a-subagents-green-is-a-hypothesis`:
**read the diff of every file a subagent touched before you trust the tree**, and give critics
worktree isolation when they need to mutate.
