# A repeated request is usually about the GESTURE, not the data

One-line: the owner asked three times for expandable rows while the rows already linked to
every transaction behind them — "I can't see what's in this bucket" and "I don't want to
leave this page to find out" are different complaints, and shipping the reachable data a
fourth time would have answered neither.

**What happened.** O.6 and its follow-ups made every category name and figure on /budgets,
/reports and /trends a link into the register, filtered to that category and that month,
with a builder that refuses to produce a link it cannot honour. That work was correct,
tested, pushed and live. The owner then wrote: *"I've asked you many times to make rows
expandable so I can see what exactly system is classifying spending as. Not just the stuff
in the photo but every table. You haven't done it."*

The first move was the right one and it is the transferable part: **establish what is
deployed before deciding the report is wrong.** `main` was level with `origin/main`, so the
links really were live, which killed the comfortable hypothesis ("he hasn't seen it yet")
and forced the uncomfortable one — the thing he asked for is not the thing that shipped.

**The distinction.** A link and an expander answer the same question with different costs.
A link leaves the page, drops the table the reader was comparing rows in, and answers one
category per round trip. "Is this bucket right?" is a question about several buckets at
once; it stays answerable only if the answer opens in place. `the-affordance-existed-and-was-lossy`
is the sibling of this lesson and not the same one: there the existing claim was BROKEN, here
it was perfectly good and simply the wrong interaction. Both look identical from the outside —
a user repeating themselves — so the diagnostic question is not "does the data exist and is it
reachable" but "what gesture did they describe", and *expandable* is a gesture.

**The build rule that fell out of it.** An expandable panel makes a claim a link does not: it
prints the rows AND their total beside the figure, so it asserts equality on screen where
nobody has to take it on trust. That claim is only safe if the panel is built from the very
array the surface summed, through the very predicate it summed with — never a second query.
Here `spendingByCategory` already exported its per-row predicate for exactly this reason, so
the builder consumes it rather than copying it, the caller passes the figure it RENDERS, and
`reconciles` becomes falsifiable. Mutation-proving it (neuter the shared predicate → 7
assertions die) is what separates that from a comment claiming it.

**Three states, not two.** Rows that add up; an empty panel for a category that fell to
nothing (the most interesting row on /trends, and the one the first e2e tripped over by
taking the topmost mover); and the documented net-refund CLAMP, where both figure builders
deliberately hold a category at zero rather than print negative spend. Rendering the third as
"we can't reconcile this" would report a defect where the engines are doing exactly what they
say — the `a-zero-is-a-claim` rule applied to a panel instead of a row.

**Two self-inflicted findings worth keeping.**
1. I wrote a code comment citing a lock — `trends-breakdown-parity` — before writing it. That
   is the same failure as a comment asserting something "is recorded in docs/STATUS.md" before
   the record exists, and I caught it only by reading my own diff. Write the test, then cite it.
2. A hostile-critic subagent left its mutation in the tree (`excludeFromTotals: false` under a
   comment reading "restored after the run") — the second recorded instance of that, so it is
   not a fluke. Never run the gate while a critic is live, and diff every source file against
   your own intent before committing after ANY agent has touched the checkout.
