## §Debt-payoff (Wave 3 — hand-verified amortization)

Engine: `src/lib/engine/debt/payoff.ts` `planDebtPayoff`. Monthly periodic interest =
`round(balance × aprBps / 10000 / 12)` (roundHalfAwayFromZero, integer cents). Total monthly
budget = Σ minimums + extra, held constant; minimums freed by paid-off debts roll into the focus
debt (snowball/avalanche). Default ordering = **avalanche** (least interest), per DECISIONS #95 / Conflict A.

### A. Single loan, $300 @ 12% APR, $100/mo minimum, $0 extra (the pinned case)
1%/month periodic rate. Worked month by month (interest then a $100 payment, last payment is the residue):

| month | start | +interest | balance | payment | end |
|---|---|---|---|---|---|
| 1 | 30000 | +300 (30000×.01) | 30300 | 10000 | 20300 |
| 2 | 20300 | +203 | 20503 | 10000 | 10503 |
| 3 | 10503 | +105 (105.03→105) | 10608 | 10000 | 608 |
| 4 | 608 | +6 (6.08→6) | 614 | 614 | 0 |

→ `monthsToDebtFree = 4`, `totalInterestCents = 300+203+105+6 = 614`,
`totalPaidCents = 30000 + 614 = 30614`.

### B. 0% loan, $1000, $100/mo → pure principal division
No interest; 100000 / 10000 = `monthsToDebtFree = 10`, `totalInterestCents = 0`, `totalPaid = 100000`.

### C. Extra payment accelerates
$300 @ 12%, $100/mo + $100 extra (budget $200/mo): M1 30300−20000=10300; M2 10300+103=10403−10403=0 →
`monthsToDebtFree = 2` (< 4 without the extra).

### D. Negative amortization → never (null), no overflow
$1000 @ 36% APR (3%/mo = $30 interest) with a $10/mo minimum and no extra: the balance grows every
month. The per-debt progress guard detects that no owed debt shrank this month and returns
`monthsToDebtFree = null` — and a $1B per-balance overflow valve breaks BEFORE any balance compounds
past `Number.MAX_SAFE_INTEGER` over the 1200-month cap (regression: the unguarded loop threw in
`roundHalfAwayFromZero`).

### E. Snowball vs avalanche (Conflict A), two debts + $100/mo extra
A = $500 @ 24% APR, $50/mo min; B = $200 @ 6% APR, $50/mo min. Budget = $200/mo.
- **Snowball** focuses B (smallest balance): B clears in month 2 — the early win — so
  `firstPayoffMonth` is sooner than avalanche's.
- **Avalanche** focuses A (highest APR): `totalInterestCents` ≤ snowball's (never more).

### F. Zero-budget plan → no plan, no phantom interest (DECISIONS #98)
A LOAN with no stored minimum and no extra ⇒ total budget = 0. Nothing is ever paid, so the engine
short-circuits to `monthsToDebtFree = null`, `totalInterestCents = 0`, `totalPaidCents = 0` rather than
accruing one phantom month of interest on a $0 plan.

### G. Mixed portfolio — one debt clears while another never amortizes (DECISIONS #98)
A = $10,000 @ 24% APR, $100/mo min; B = $300 @ 0%, $100/mo min. Budget = $200/mo (snowball, focus B).
A's $100 min is far below its ~$200/mo interest and it gets no rollover (budget = Σ minimums), so A
grows every month; B is 0% and its $100/mo pays it straight down: 30000 → 20000 → 10000 → 0, clearing
in month 3. The **per-debt** guard (not the old portfolio-total test, which broke in month 1 because A
grows more than B shrinks and wrongly reported BOTH as never paid off) keeps the plan alive while B is
clearing: `firstPayoffMonth = 3`, B's `payoffMonth = 3`, A's `payoffMonth = null`, overall
`monthsToDebtFree = null` (A remains).

Covered by `tests/unit/payoff.test.ts` (8 cases).
