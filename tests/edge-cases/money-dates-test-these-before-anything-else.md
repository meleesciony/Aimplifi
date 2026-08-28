## §Money & dates (test these before anything else)

- Sign conventions: outflow negative, inflow positive; liability balances stored
  positive; net worth = Σ assets − Σ liabilities. One test fixture exercises all types.
- Rounding rule: round-half-away-from-zero to cents, applied at every materialized
  step. Test: 296500 × 0.005 / 12 style cases land deterministically.
- `addMonthsClamped('2026-01-31', 1)` → `2026-02-28`. Cycle anchored on the 31st
  produces 28/30/31-day cycles correctly across a year.
- Business-day walk-back over a weekend AND an adjacent holiday (case E2).

---
