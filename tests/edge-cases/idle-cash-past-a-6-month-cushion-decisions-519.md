## §Idle cash past a 6-month cushion (DECISIONS #519)

Checking + savings (`liquid`, same sum as runway) vs a **6-month
cash cushion** (classic ceiling the room-for-error band already
calls "past"). Raw gap = liquid − (6 × monthly expenses). Monthly
expenses are the same average the runway figure uses. No invented
yield — this is a surplus lens, not a HYSA calculator. Unknown
expenses are not a $0 cushion. `excessCents` is named only when the
raw gap is **at least one extra month** of those expenses ("far",
not a rounding nick). Engine: `src/lib/engine/fi/idle-cash.ts`.
Cushion months = `IDLE_CASH_CUSHION_MONTHS` (6). Runway months =
`monthsOfRunway` (one author).

| # | Inputs | Expected |
|---|--------|----------|
| IC1 | liquid **$24,000** (2,400,000¢); expenses **$3,000**/mo (300,000¢) | cushion **$18,000.00** (1,800,000¢); excess **$6,000.00** (600,000¢); runway **8**; `idle` false |
| IC2 | liquid **$18,000**; expenses **$3,000**/mo | cushion 1,800,000¢; `idle`; `excessCents = null` (exactly the cushion is not surplus) |
| IC3 | liquid **$18,000.01** (1,800,001¢); expenses **$3,000**/mo | `idle`; `excessCents = null` (1¢ is not far) |
| IC3b | liquid **$21,000** (2,100,000¢); expenses **$3,000**/mo | excess **$3,000.00** (300,000¢); runway **7**; `idle` false |
| IC4 | expenses **$0**; any liquid | `noExpenses`; `cushionCents = null`; `excessCents = null` |
| IC5 | liquid **$0**; expenses **$3,000**/mo | `idle`; cushion 1,800,000¢; `excessCents = null` |
| IC6 | liquid **−$500** (−50,000¢); expenses **$3,000**/mo | negative liquid is kept; `idle`; `excessCents = null` (this note does not invent a shortfall) |
| IC7 | identity | `runwayMonths === monthsOfRunway(liquid, expenses)`; `cushionCents === monthly × 6` when expenses > 0 |

---
