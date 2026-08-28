## §Mortgage early-payoff (DECISIONS #517)

Engine: `src/lib/engine/debt/mortgage-early-payoff.ts`. Two calls to `planDebtPayoff`
on one `MORTGAGE` (minimum-only vs minimum + extra). No second amortizer.
Unknown APR is not 0%. Interest saved and months saved are reported only when
**both** legs clear — an unfinished walk is not a comparable total. The stored
minimum is the **cash payment due**; the walk applies all of it to the loan
after interest (same as the debt planner). Escrow or other add-ons in that
figure are not split out.

### ME1. Same pinned loan as §Debt-payoff A, $0 extra
$300 @ 12%, $100/mo → `baselineMonths = extraMonths = 4`, `interestSavedCents = 0`,
`monthsSaved = 0`.

### ME2. Same loan + $100 extra (§Debt-payoff C)
M1 30300−20000=10300; M2 10300+103=10403−10403=0 → `extraMonths = 2`,
`extraInterestCents = 300+103 = 403`, `interestSavedCents = 614−403 = 211`,
`monthsSaved = 2`.

### ME3. Known 0% is principal division
$1,000 @ 0%, $100/mo, +$100 extra → 10 months vs 5. Interest 0. A missing rate
is a different state (the picker returns `incomplete`), not this one.

### ME4. Baseline never-clears; extra that clears does not invent months-saved
$1,000 @ 36%, $10/mo min never amortizes (`baselineMonths = null`). +$40 extra
does clear. `monthsSaved` and `interestSavedCents` stay null — subtracting from
an unfinished walk would fabricate a savings figure.

### ME5. Extra that still cannot clear
Same loan, +$5 extra: both legs null; no interest-saved figure.

Covered by `tests/unit/mortgage-early-payoff.test.ts`.
