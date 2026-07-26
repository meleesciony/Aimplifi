# A dead branch is a claim that something is handled — and a disclosure of a gap can entrench it

One-line summary: L.22 shipped an ANNUAL `/12` rule with a passing unit test, an explaining
docblock and a critic-approved disclosure sentence, and **nothing in production could hand it an
annual row** — the rule was worth $0 for eleven months of every year, the docblock named a
capability (user-entered scheduled rows) the app has never had, and the disclosure made the dead
branch look deliberate.

## What happened

`monthlyRateCents(amountCents, 'ANNUAL')` returned `amountCents / 12`, with a test asserting
`monthlyRateCents(120000, 'ANNUAL') === 10000` and a docblock explaining that an annual bill must
cost something every month instead of nothing for eleven. All true, all green, all irrelevant:
`toScheduledTransactions` filtered detected series to WEEKLY/BIWEEKLY/MONTHLY, and
`src/server/recurring.ts` is the **only** writer of the ScheduledTransaction table in the app
(the seeder is the only other source, and its three rows are BIWEEKLY/MONTHLY). So the branch was
dead for **every row in production**, and a detected $1,200/yr premium overstated guilt-free
spending by $100 every month — the dangerous direction, for exactly the population the rule was
written for.

The L.22 cycle-2 critic found the *copy* overstating coverage and fixed the copy: "an annual bill
**entered by you** counts 1/12; a DETECTED annual bill is not projected yet." Accurate about the
code, shipped, and it did two harmful things — it made the gap read as a design choice, and it
invented a feature, because there is no form, route or action that lets a user enter a scheduled
row at all.

## The transferable rules

1. **A unit test on a pure converter proves the arithmetic, never the intake.** For every branch
   keyed on an input CLASS, name the real path that produces that class — the detector, the
   ingest, the form — and write one test that starts *there*. If you cannot name the path, the
   branch is dead and every sentence around it is fiction. (Same family as "a pure-builder test
   cannot catch a wiring bug", one level earlier: this one cannot catch a *never-wired* bug.)
2. **When a critic finds copy that overstates coverage, ask why the coverage is missing before
   describing its absence.** Narrowing the sentence is the cheap fix and it entrenches the gap —
   the prevention-is-not-a-remedy family, in copy form. A disclosure is an admission, not a fix.
3. **A qualifier invented to describe a gap can invent a capability.** "Entered by you" was never
   checked against a write path. Grep for the writer before you write a clause about who writes.
4. **When two engines normalize the same class differently, the disagreement IS the bug report.**
   `/recurring`'s `PER_MONTH` already counted ANNUAL at 1/12 while the plan's term dropped it
   entirely — two surfaces, one fact, $100/month apart. Before concluding a class is unsupported,
   grep for the OTHER normalizer of it.
5. **Classify every consumer's `default:`/`else`, then EXECUTE the classification.** A delegated
   map called the three cadence expanders' catch-all branches a "CRITICAL 12× underestimate".
   Reading them, plus grepping every concrete horizon in the repo (all ≤ 90 days), showed the
   catch-all was **already correct** for an annual row — one dated occurrence per sub-year window
   is the truth — and the fail-old run proved it, because those two locks pass on the old code.
   The blast radius collapsed from "the whole projection stack" to comment-sized edits plus an
   explicit 12-month step that only matters past a 366-day window. A subagent's severity is a
   hypothesis exactly like its green.
6. **Failure direction per ROLE decided the shape of the fix** (the L.14 rule): annual EXPENSES
   are projected, because a bill can only ask the reader to hold more cash; annual INCOME is not,
   because a bonus dated from a single 365-day gap offsets a projected dip and silences a warning,
   and dividing it into the plan's no-history fallback would manufacture the phantom monthly
   income the L.22 re-spec exists to kill.
7. **A smoothed figure owes the reader the month that is not smooth.** Reserving 1/12 monthly
   makes eleven months conservative and the twelfth optimistic; found by self-critique, and the
   residual is recorded rather than shipped silently. The first wording said a twelfth *is set
   aside* every month — which the copy critic killed, because nothing is: the plan is stateless
   per month, and "set aside" already meant the L.11(D) reservation (a real carried term with its
   own visible row) three paragraphs down on the same page. **Reusing a phrase that already names
   a mechanism asserts that mechanism.** Grep the phrase, not just the fact.

## What the two critics added (both FAIL; they converged on the same P1 independently)

8. **Un-dropping a row makes every gate that row skipped suddenly load-bearing.** The filter
   tested cadence and sign, and `detectRecurring` has no staleness gate at all — so a policy last
   charged in 2021 detected today with `nextExpectedAt` next August, and the fix would have made
   the plan subtract $100/month for a cancelled policy *forever* while `/recurring` filed it under
   "no longer charging" at $0. The disagreement the slice existed to fix would have come back
   **inverted**. When you start using data that was previously discarded, enumerate what the
   discard was silently protecting you from — and share the *predicate*, not the arithmetic: the
   active/lapsed rule now lives in one place both surfaces import, so they cannot drift again.
9. **An amount and a date rendered together are one instruction.** The radar's cover transfer
   pairs the worst dip over the *whole horizon* with a deadline one business day before the
   *first* shortfall. That is coherent only while the two are the same event — and an annual bill
   is the first cadence that can drop a lump 80 days out behind a small early dip, so it rendered
   "move **$1,250.00** by Fri, Jun 12" where $50.00 was what Jun 12 needed, under the header "the
   smallest move". The amount was *sufficient*, which is why no overdraft test caught it. A
   sufficient instruction is not a correct one, and "smallest" is a claim you must be able to
   prove.
10. **Mutation-test the change, not the feature.** The three expanders got a "one occurrence in a
    90-day window, zero in 60" lock each — which the *old* catch-all `else` also satisfies. The
    critic reverted `assemble.ts` entirely and the file stayed green (10 mutations, 2 escaped).
    Only a window longer than a year distinguishes the new code, and that was the one expander
    feeding the dashboard hero. If a test passes with your diff reverted, it is testing the
    feature's neighbourhood, not your change.
11. **Two critics with different lenses beat two passes of one.** They converged on the lapsed
    series (the finding that mattered most), and everything else they found was disjoint: the
    money lens found the instruction decoupling and the mutation gap; the copy lens found five
    false or missing claims across four surfaces the money lens never opened. Both refuted things
    too — double-counting was clean, and every other cadence consumer degraded safely — which is
    how you learn the blast radius is really as small as you hoped.
