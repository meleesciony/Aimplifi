## P0.4 assign-to-zero line (DECISIONS #525)

The leftover C6 affordance — highlight existing `leftToSpendCents` as
leftover after Fixed and savings, no new math — closes as one sentence
on the /budgets conscious-spending strip via pure
`assignToZeroLineFor(leftToSpendCents, inflation)` →
`COACH_COPY.assignToZero(cents)` (pinned byte-identical in
`tests/unit/assign-to-zero.test.ts`). The amount is the guilt-free
bucket by construction (`mapToConsciousBuckets`); it is monthly
capacity (income − fixed − savings), not cash still sitting unspent.
The copy names both vocabularies so the page does not claim leftover is
assigned and not. Known-inflated leftover (uncounted bills, card notes)
is refused, not certified:

| # | Inputs | Expected |
|---|--------|----------|
| AZ1 | `assignToZeroLineFor(150_000, clean)` | `$1,500.00 of this month's income pattern is leftover after Fixed and savings — that's the guilt-free remainder, a monthly capacity, not cash still sitting unspent. Giving every dollar a job is the plan, not a verdict.` |
| AZ2 | leftover `0`, clean | `null` — a $0 leftover is an absence, not a leftover-to-assign claim |
| AZ3 | leftover `< 0` (overspent), clean | `null` — `consciousOverspent` already speaks; a negative remainder is not leftover to assign |
| AZ4 | leftover `> 0` + `uncountedFixed` or `cardNotesPresent` | `null` — leftover this card already knows is inflated / direction-unknown must not be certified as assignable (critic P1-2) |
| AZ5 | regression lock | one dollar amount (the leftover), no "You have" / "still unassigned" remaining-cash claim (critic P1-1), no "should/must/zero out" imperative, `consciousSpending` and `consciousOverspent` byte-identical; unset savings still prints (genuine unassigned, not inflation) |
