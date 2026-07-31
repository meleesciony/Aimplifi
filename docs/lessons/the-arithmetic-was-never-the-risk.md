# A new money engine's risk is at its boundaries, not in its arithmetic

**One line:** W.1's wealth-target planner was pinned against an independent closed-form
annuity oracle and its compounding was never wrong once — two parallel hostile critics
still returned FAIL with 1 P0 + 10 P1 between them, and **every single finding was at a
boundary**: what the engine accepted, what it refused, what a floor hid, and what the copy
called the numbers.

## The four that mattered, and what they have in common

1. **A 14-digit paste destroyed the whole page.** `parseDollarInput("90000000000000")`
   returns a *valid safe integer*, so the `!== null` guard passed, state updated, and the
   growth simulation materialized a balance past `Number.MAX_SAFE_INTEGER` — `cents()`
   threw inside a `useMemo` **during render**, so React unwound `/coach` to the error
   boundary and every other card vanished. It was horizon-dependent (1y/5y/25y threw, 40y
   did not), so it presented as *"dragging the slider killed the page."*
2. **A negative balance printed as money the reader has.** The engine deliberately returns
   `withinSafeToSpend: null` where there is no positive guilt-free figure; the card wrote
   `?? false` and fell through to a branch that formats the figure as a pool — *"more than
   the **-$2,432.33** of monthly guilt-free spending you have."* Live on the shared demo,
   at the default target, with no typing required.
3. **An unparseable edit was swallowed.** `if (parsed !== null) setState(parsed)` left every
   figure describing the previous target while the box read `""` or `ten million`.
4. **A floor presented as an assumption.** `realReturnBps` clamps at 0, and the copy printed
   both operands beside the clamped result: *"assuming 0.00% growth after inflation — your
   7.00% return assumption less 10.00% inflation"* — arithmetic the reader can do in their
   head and get a different answer, on 820 of 2,501 legal dial pairs. Worse than cosmetic:
   the floor runs **optimistic**, understating a $2M target by 3× in years and 33% in
   required dollars, because the truth behind the clamp is a *negative* real return.

The common shape: **a value crossed a boundary and lost the thing that made it safe.** A
parser's `null` became "skip". An engine's `null` became `false`. A clamp became an
assumption. A safe integer from one function was an unsafe input to the next. None of it is
visible from inside the engine, which is why an engine test suite — even a good one, even
one with an independent oracle — cannot find any of it.

## Rules taken from this

- **A boundary that takes a typed number must BOUND it, in the engine.** The range check
  belongs where every future caller inherits it (`MAX_TARGET_CENTS` + a
  `target-out-of-range` refusal), not at each surface that must remember it. This is
  `fence-by-construction-not-per-call-site` applied to a numeric range.
- **An engine's `null` is a value, not an absence.** A surface that coerces it answers a
  question the engine explicitly declined. Give the third state its own copy branch; if
  the sentence would have to name a figure that does not exist, it must not be that
  sentence.
- **A parser's `null` is a state the UI must be able to be in.** Skipping it leaves a
  figure with no visible subject — the reader sees an answer and cannot see its question.
- **A clamped output may not print its inputs.** Either show the working or show the clamp,
  never both; and say which DIRECTION the clamp errs in, because a clamp that flatters is
  the expensive one.
- **Ask what the copy claims when the data is degenerate.** The sensitivity table's intro
  promised *"the spread between them is usually wider than any budgeting change you could
  make"* — true, and false of the 561-of-2,501 dial pairs where all three rows floor to the
  same rate and print identically. A true sentence beside figures it is not true of.

## Method notes

- **Two critics with DIFFERENT lenses (money-math vs claims/UI) earned their cost in the
  non-overlap.** Both found the crash and the negative pool independently — which is the
  strongest signal available — and each found four the other missed. The money critic swept
  2,501 legal dial pairs and 20,000 randomized solves (finding **zero** non-monotone
  sensitivity rows, an attack I would not have thought to run); the UI critic drove a real
  browser and measured 380px overflow per element (clean) plus the `aria-live` churn.
- **They also cleared attacks, and said so.** `coastFI`'s `null → 0` mapping was probed at
  the exact coast threshold for three deadlines and is continuous; its bisection converges
  for a $10M target with `hi` seeded at the target. A critic that reports what it *could
  not* break is more useful than one that only reports hits.
- **Mutation-prove each fix or it is a hypothesis.** Forcing `outOfRange = false` failed
  exactly 4 tests; restoring `?? false` failed exactly the negative-pool assertion;
  re-adding the `if (p !== null)` guard failed exactly the stale-answer spec. Three fixes,
  three named deaths.
- **Assert the hard case is present in the fixture.** The demo's `leftToSpendCents` is
  −$2,432.33 with `overspent: true`, so the e2e genuinely exercises the null-affordability
  branch — and the spec asserts that branch RENDERED, so the lock cannot decay into
  measuring only the affordable case if the seed changes.
- **A critic's tree side effects are part of its output.** Both left scratch probe files
  mid-run and cleaned up after themselves; both flagged a `TASKS.md` edit they had not made
  (mine, concurrent). Reading `git status` and the full diff against your own intent before
  committing caught nothing this time — which is the point of doing it every time.

## The one I decided NOT to fix, and why that is not the same as ignoring it

Both critics independently rated the **two bases on one page** a P0/P1: `/coach`'s FI card
grows the portfolio at the **nominal** dial toward a target built from **today's** expenses
— a mixed basis, and an error rather than a defensible choice — so it prints an earlier
date than the new card, and a *smaller* target on the new card can read as taking longer
(16 vs 21 years, measured). Fixing the FI card in this slice would have silently changed a
figure readers have been looking at for months, inside a slice about something else. The
resolution was to make the new card **name the difference and its direction** in its own
words, and file the FI card's basis as its own task with its own critic pass. *A known
contradiction that is disclosed is not a closed one — but disclosing it beats changing a
months-old money figure as a side effect.*
