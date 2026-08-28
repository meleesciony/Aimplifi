## §Interest & fees YTD (Reports — COACH_PRINCIPLES_PLAN)

YTD paid = `spendingByCategory` over `interestFeeYtdWindow(today)`
(Jan of `today`'s year → `today`'s month, `asOf` = today), summed on
the four leaves `fees` / `fees-interest` / `atm-fee` / `late-fee` only
— never the rest of Financial (taxes, loan-payment, investment). The
30-year illustration treats that YTD total as **one year's amount**
(`roundHalfAwayFromZero(paid / 12)` each month for
`OPPORTUNITY_HORIZON_MONTHS[2]` = 360), grown with `opportunityFVCents`
and printed as today's money via `opportunityValueTodayCents`. Not an
annualized remaining-year pace, not their APR, not a prepay nudge.
Engine: `src/lib/engine/reports/interest-fees-ytd.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| IF1 | paid **$1,200**; 30y; return **0%**; inflation **0%** | monthly **$100.00** (10,000¢); valueToday = valueNominal = **$36,000.00** (10,000 × 360) |
| IF2 | paid **$0**; any rates | `null` |
| IF3 | paid **$0.05** | monthly rounds to **$0.00**; result non-null; valueToday = valueNominal = **$0** (copy must not invent a 30-year sentence) |
| IF4 | identity: any illustrated result | `valueNominalCents === opportunityFVCents(monthly, months, nom)`; `valueTodayCents === opportunityValueTodayCents(monthly, months, nom, inf)` |
| IF5 | paid **$1,200**; 30y; return **7.00%**; inflation **2.50%** | monthly **$100.00**; valueToday / valueNominal from the same primitives as IF4 |

---
