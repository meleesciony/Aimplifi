## §Giving YTD (Reports — COACH_PRINCIPLES_PLAN C14)

YTD given = `spendingByCategory` over `givingYtdWindow(today)`
(Jan of `today`'s year → `today`'s month, `asOf` = today), summed on
the two leaves `gifts` / `charity` only — never a custom category
that sits in the Giving group, never the rest of spend. Same calendar
window as interest-and-fees (`givingYtdWindow === interestFeeYtdWindow`).
No 30-year illustration: giving is a dial, not a leak. Engine:
`src/lib/engine/reports/giving-ytd.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| GY1 | gifts **$400** (40,000¢) + charity **$600** (60,000¢) | given **$1,000.00** (100,000¢); contributing `gifts`, `charity` (taxonomy order) |
| GY2 | given **$0**; empty breakdown | `givingYtd` → `null`; `givenYtdCents` → **0** |
| GY3 | charity **$250** (25,000¢) only | given **$250.00**; contributing `['charity']` |
| GY4 | gifts **$100** + custom Giving-group row **$900** | given **$100.00** (10,000¢) — the group is not the figure |
| GY5 | gifts **$100**; charity net ≤ 0 (absent from breakdown) | given **$100.00**; contributing `['gifts']` |
| GY6 | today **2026-06-10** | window `{ fromYm: '2026-01', toYm: '2026-06', asOf: '2026-06-10' }` |

---
