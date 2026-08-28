## §Fulfillment curve (W.6(c) — TASKS W.6)

Life-energy by **discretionary category** across complete months before
`today`. Wage ≤ 0 → engine returns `null` (hours are the lens). Same
`countsInFlows` + discretionary gate as `averageDiscretionaryCategorySpend`.
Trend = second-half median monthly spend vs first-half, in bps (creep's
half-split). Hours via `hoursOfWork` only. Engine:
`src/lib/engine/fi/fulfillment.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| F1 | wage **0** or negative; any txns | `null` |
| F2 | wage **$38/hr**; dining **$190**/mo × 6 complete months (flat); dials include dining | 1 category; **5.0** hrs/mo; totalHours **30.0** (= sum of monthly); trendBps **0**; measured; isMoneyDial **true**; categoryCount **1** |
| F3 | shopping $100/mo × 3 then $200/mo × 3 | trendBps **10000** (+100%); total spend **$900**; totalHours = sum of monthly `hoursOfWork` |
| F4 | one real dining outflow + transfer + split-parent + loan-excluded id | only the real outflow counts |
| F5 | rent (non-disc) + uncategorized + dining | categories = **[dining]** only |
| F6 | windowMonths **1**; spend in May + June (today Jun 10) | months = **[2026-05]**; June ignored |
| F7 | six discretionary categories; topN **3** | ranked by total spend; length **3** |
| F8 | wage set; only rent (non-disc) | curve non-null; **categories = []** |

---
