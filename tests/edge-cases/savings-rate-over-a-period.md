## §A savings rate over the period the reader names (DECISIONS #796)

Engine: `src/lib/engine/fi/savings-period.ts` (`savingsOverPeriod`, `firstFullMonthOnRecord`), words
`answerSavingsRatePeriod` in `src/lib/engine/assistant/answer.ts`, the period reader `readSavingsWindow` /
`savingsFromQuestion` in `src/lib/engine/assistant/intent.ts`, wiring in `src/server/assistant.ts`
(`savings_rate` with a `timeframe`). Tests: `tests/unit/ask-savings-period.test.ts`,
`tests/unit/ask-savings-period-server.test.ts` (seeded demo), `tests/e2e/ask.spec.ts` (#796 test).
Every amount is invented. Unit `today = 2026-10-07`; demo and e2e `today = 2026-06-10`.

**The rule.** Rate = (Σ income − Σ expenses) ÷ Σ income over the period's months, each month being
`monthlyFlows`' own figure (the /coach chart's bar). Pooled, never a mean of monthly rates. A month with spending
and no income keeps its spending (the coach card's average drops it; over a period that flatters). Months
left out, and named: the month in progress; every month before the first FULL month on record (the month of
the first transaction counts only if that transaction is on the 1st). A finished, on-record month with no
counted row stays in, adds $0, and is named. Rounded to whole basis points by `savingsRateBps` itself
(`Math.round` of the ratio × 10000 — a half rounds up, toward +∞, on either sign).

**Fixture (unit).** Records start 2025-03-14. Months (income / expenses):

| Month | Income | Expenses |
|---|---|---|
| 2025-03 | $1,000.00 | $200.00 — partial month, never counted |
| 2025-04 | $5,000.00 | $4,000.00 |
| 2025-05 | $5,000.00 | $4,500.00 |
| 2025-06 | $0.00 | $2,100.00 — no income |
| 2025-07 | — | — no counted row |
| 2025-08 | $5,200.00 | $3,000.00 |
| 2025-09 … 2025-12 (each) | $5,000.00 | $4,000.00 |
| 2026-01 … 2026-09 (each) | $6,000.00 | $4,500.00 |
| 2026-10 | $3,000.00 | $1,000.00 — in progress, never counted |

**Hand-verified cases.**

| Asked | Months measured | Σ income | Σ expenses | Kept | Rate |
|---|---|---|---|---|---|
| 2025 | Apr–Dec 2025 (9) | 5,000 + 5,000 + 0 + 0 + 5,200 + 4×5,000 = $35,200.00 | 4,000 + 4,500 + 2,100 + 0 + 3,000 + 4×4,000 = $29,600.00 | $5,600.00 | 5,600 ÷ 35,200 = 15.909…% → **1591 bps, 15.9%** |
| 2025, June dropped (coach-card basis, for contrast) | 8 | $35,200.00 | $27,500.00 | $7,700.00 | 7,700 ÷ 35,200 = 21.875% → 2188 bps — NOT the answer |
| Last 12 full months | Oct 2025–Sep 2026 | 3×5,000 + 9×6,000 = $69,000.00 | 3×4,000 + 9×4,500 = $52,500.00 | $16,500.00 | 16,500 ÷ 69,000 = 23.913…% → **2391 bps, 23.9%** |
| This year | Jan–Sep 2026; October named in progress | $54,000.00 | $40,500.00 | $13,500.00 | **2500 bps, 25.0%** |
| May–June 2025 | 2 | $5,000.00 | $6,600.00 | −$1,600.00 | −1,600 ÷ 5,000 = **−3200 bps, −32.0%** |
| June–July 2025 | 2 | $0.00 | $2,100.00 | — | **no rate** ("No income is on record … $2,100.00 of spending is.") |
| March 2025 | — | — | — | — | **before-records**: only from the 14th is on record |
| March 2025, records from 2025-03-01 | 1 | $1,000.00 | $200.00 | $800.00 | **8000 bps, 80.0%** |
| 2024 | — | — | — | — | **before-records**, then the nearest: the latest 12 full months (23.9%) |
| October 2026 (this month) | — | — | — | — | **unfinished**, then the last full month: September 2026, $1,500.00 of $6,000.00, 25.0% |
| Apr 2025–Sep 2026 (>12 months) | 18 | per year | | | 2025 (Apr–Dec) 15.9%; 2026 (Jan–Sep) 25.0% |

**Demo (seeded, `today = 2026-06-10`).** "The last 12 months" = June 2025 – May 2026 and equals the twelve
/coach chart bars added up (`tests/unit/ask-savings-period-server.test.ts`); "last month" through the period
path equals the coach card's stored rate for May 2026; "last year" covers all twelve months of 2025 (records
start in December 2024).
