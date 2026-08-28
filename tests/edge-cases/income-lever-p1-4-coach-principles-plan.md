## §Income lever (P1.4 — COACH_PRINCIPLES_PLAN)

A hypothetical annual raise, saved at the **current** savings rate
(`savingsRateBps` on monthly income vs implied expenses), then the same
`monthsToFI` walk the FI card uses (real return, end-of-month
contributions). The FI **target is unchanged** — this does not restate
the number from a bigger lifestyle. A non-positive rate saves **$0** of
the raise (dissaving is not applied as a negative extra). Monthly raise
= `roundHalfAwayFromZero(raiseAnnual / 12)`. Engine:
`src/lib/engine/fi/income-lever.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| I1 | portfolio $0; income $5,000/mo; savings $1,000/mo (20%); return **0%**; FI $120,000; raise **$12,000**/yr | monthly raise **$1,000**; extra **$200**/mo; baseline **120** mo; raised **100** mo; monthsSooner **20** |
| I2 | portfolio = FI $120,000; any raise | baseline **0**; raised **0**; monthsSooner **0**; alreadyThere **true** |
| I3 | raise **$0** | extra **$0**; monthsSooner **0** |
| I4 | income **$0**; savings $0; portfolio $0; FI $120,000; raise $12,000 | noIncome **true**; rateBps **null**; extra **$0** |
| I5 | income $5,000; savings **$0** (0% rate); raise $12,000 | rateNonPositive **true**; extra **$0**; monthsSooner **0** |
| I6 | portfolio $0; income $9,000; savings $90 (1%); return **0%**; FI $120,000; raise **$24,000**/yr | baseline **null** (1334 mo > 1200); extra **$20**/mo; raised **1091** mo; newlyReachable **true**; monthsSooner **0** |
| I7 | raise **$10,000**/yr at 20% | monthly raise **$833.33** (1,000,000/12 → 83,333¢); extra **$166.67** (16,667¢) |
| I8 | income $5,000; savings **−$500** (−10%); raise $12,000 | rateNonPositive **true**; extra **$0** (negative rate is not applied) |
| I9 | portfolio $0; income $5,000; savings $50 (1%); return **0%**; FI $120,000; raise **$1,200**/yr | extra **$1**/mo; baseline **null**; raised **null**; monthsSooner **0**; newlyReachable **false** |

---
