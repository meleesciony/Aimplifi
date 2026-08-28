## §Drawdown on FI date (W.6(d) — TASKS W.6)

One-time portfolio shock, then the same `monthsToFI` walk the FI card uses
(real return, end-of-month contributions). Savings and the FI target are
unchanged. Default shock = **30%** (keep 70%). Engine:
`src/lib/engine/fi/drawdown.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| D1 | portfolio $100,000; savings $1,000/mo; return **0%**; FI $120,000; shock 30% | baseline **20** mo; shocked port **$70,000**; shocked **50** mo; monthsLater **30** |
| D2 | portfolio $1,500,000 (= FI); savings $0; return **4.50%**; shock 30% | baseline **0**; shocked port **$1,050,000**; shocked **98** mo; monthsLater **98** |
| D3 | portfolio $500,000; savings $0; return **7.2%** geo; FI $1,000,000; shock 30% | baseline **120** mo (EDGE §FI anchor 2); shocked port **$350,000**; shocked **182** mo; monthsLater **62** |
| D4 | portfolio $0; savings $1,000/mo; return 0%; FI $120,000; shock 30% | shocked port **$0**; baseline = shocked = **120**; monthsLater **0** (nothing to drop) |
| D5 | portfolio $50,000; savings $0; return **0%**; FI $100,000; shock 30% | baseline **null** (never); shocked **null**; monthsLater **0**; newlyUnreachable **false** |
| D6 | portfolio $100,000; savings $0; return **0%**; FI $100,000; shock 30% | baseline **0**; shocked **null**; newlyUnreachable **true**; monthsLater **0** |

---
