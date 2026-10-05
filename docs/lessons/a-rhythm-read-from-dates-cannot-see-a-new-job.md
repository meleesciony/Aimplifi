# A rhythm read from dates cannot see a new job — bound the figure by the lowest count the reading allows

**One line:** #786 let one change of pay keep "regular pay", and two critic cycles found the same hole from two sides: the payday rhythm is inferred from dates, and a new job under the same payroll name can sit on the old rhythm's grid for months — so any figure that multiplies by the inferred count (26, 52) must also be bounded by what the LOWEST rhythm that fits those dates would pay.

## What happened

- Cycle 2: every-two-weeks pay, then twice-a-month pay from a new job under the same payroll name. The detector kept reading "biweekly" — a maker brute force over every alignment fits **six** twice-a-month paydays to a 14-day grid (February's 14-day gaps), and **eight** 1st/8th/15th/22nd paydays to a 7-day grid. Waiting for more paychecks could not fix it; the wait would have voided the feature.
- Cycle 3: a single newest paycheck can be the first payday of a job paid LESS often (monthly behind a two-week reading). One date carries no rhythm at all.
- The fixes were structural, not more detection: hold the month to a usual month (× 2 / × 4) of the smallest new paycheck — exactly what the lowest same-family rhythm pays — and require two new paydays, because the gap test catches a less-frequent job at its second payday.

## The rule

When a money figure multiplies by a count inferred from data (paychecks a year, bills a year), ask: **which other counts fit the same evidence, and for how long?** Measure it (brute-force the alignments) rather than reason about it, then bound the figure by the lowest count that still fits — or wait until the evidence can tell them apart, if that wait is short.

## Also from this slice

- An exhaustive enumeration proves only what it compared. The maker enumerated "chosen split vs minimum over all splits" (0 differences) and wrote "the same whichever split is read" — false on ties, which a critic found by mutating `<` to `<=`. Write the claim the probe actually checked, or make the code independent of the choice.
- Shell heredocs mangled generated test/runner code twice more (real newlines inside JS strings); see [windows-codegen-via-shell](windows-codegen-via-shell.md). Write/Edit only.
