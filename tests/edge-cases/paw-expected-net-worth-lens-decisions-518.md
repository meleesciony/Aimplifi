## §PAW expected-net-worth lens (DECISIONS #518)

Stanley & Danko expected net worth = **age × yearly income ÷ 10**.
Yearly income is the FI card's average monthly income × 12 (same
annualization as the income-lever slider). Age is an input the reader
sets — not a stored date of birth. Age 0 / unset and income ≤ 0 produce
**no expected figure** (unknown is not $0). Near = |actual − expected|
/ expected ≤ 10% inclusive (`PAW_NEAR_BPS = 1000`). Bands are
above / near / under — not PAW/UAW labels. Engine:
`src/lib/engine/networth/paw-lens.ts`.

| # | Inputs | Expected |
|---|--------|----------|
| PAW1 | age **40**; yearly **$100,000** (10,000,000¢); NW **$400,000** | expected **$400,000.00** (40,000,000¢); band **near** |
| PAW1b | same income/age; NW **$800,000** | expected 40,000,000¢; band **above** |
| PAW1c | same income/age; NW **$100,000** | expected 40,000,000¢; band **under** |
| PAW2 | age **1**; yearly **$1.05** (105¢) | 105 / 10 = 10.5 → **11¢** (`roundHalfAwayFromZero`) |
| PAW3 | age 40; yearly $100,000; NW **$360,000** (exactly −10%) | band **near**; NW **$359,999.99** (35,999,999¢) → **under** |
| PAW4 | age **0**; any income | `idle`; `expectedNetWorthCents = null`; `band = null` |
| PAW5 | age 40; yearly **$0** | `noIncome`; `expectedNetWorthCents = null`; `band = null` |
| PAW6 | age 40; yearly $100,000; NW **−$5,000** | expected 40,000,000¢; band **under** (negative is not rewritten to $0) |
| PAW7 | age 1; yearly **$0.04** (4¢) | expected rounds to **0¢**; `band = null` (no "above $0.00") |

---
