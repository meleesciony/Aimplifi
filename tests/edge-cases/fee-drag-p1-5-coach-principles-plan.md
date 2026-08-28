## §Fee drag (P1.5 — COACH_PRINCIPLES_PLAN)

1% of **today's** invested balance, leaked every year as a **level**
monthly contribution for 30 years (`OPPORTUNITY_HORIZON_MONTHS[2]` =
360), grown with `opportunityFVCents` and printed as today's money via
`opportunityValueTodayCents`. This is **not** a 1% AUM fee on a growing
pile (`FV(r) − FV(r−1%)`) and **not** the reader's actual fund fee
(uncollected). Monthly leak =
`roundHalfAwayFromZero(portfolio × feeBps / 10000 / 12)`. Engine:
`src/lib/engine/fi/fee-drag.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| FD1 | portfolio **$100,000**; fee **1%**; 30y; return **0%**; inflation **0%** | monthly leak **$83.33** (8,333¢); costToday = costNominal = **$29,998.80** (8,333 × 360) |
| FD2 | portfolio **$0**; any rates | `null` |
| FD3 | portfolio $100,000; fee **0%** | `null` |
| FD4 | portfolio **$0.50**; fee 1% | monthly leak rounds to **$0.00** → `null` |
| FD5 | identity: any non-null result | `costNominalCents === opportunityFVCents(monthly, months, nom)`; `costTodayCents === opportunityValueTodayCents(monthly, months, nom, inf)` |
| FD6 | demo brokerage **$142,000**; fee 1%; 30y; return **7.00%**; inflation **2.50%** | monthly leak **$118.33** (11,833¢); costToday **$68,822.18** (6,882,218¢); costNominal **$144,359.17** |

---
