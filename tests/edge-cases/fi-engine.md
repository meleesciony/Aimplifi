## §FI engine

- **FI number:** expenses $60,000/yr, SWR 400 bps → **$1,500,000.00** exactly.
  SWR 350 bps → 60000 × 10000/350 = **$1,714,285.71** (round to cent).
- **Years to FI, anchor 1 (zero return, exact):** portfolio $0, savings $1,000/mo,
  return 0%, FI $120,000 → **exactly 120 months**.
- **Years to FI, anchor 2 (pure compounding):** portfolio $500,000, savings $0,
  return 7.2%/yr (geometric monthly rate (1.072)^(1/12) − 1), FI $1,000,000 →
  doubling: m/12 ≥ ln 2 / ln 1.072 = 9.968 yr → first month where portfolio ≥ target
  is **month 120**.
- **Opportunity-cost FV, anchor (exact):** $100/mo, 12 months, 12%/yr nominal,
  i = 1%/mo, end-of-month contributions:
  FV = 100 × ((1.01^12 − 1)/0.01) = 100 × 12.682503 = **$1,268.25**.
- **Opportunity-cost regression:** $189/mo, 25 yr, 7%/yr nominal (i = 0.07/12,
  end-of-month) ≈ **$153,101** — recompute exactly with the implemented formula, verify
  it lands within $153,000–$153,300, then pin the exact cent value as the regression
  expectation and record it here.
  **Pinned (Phase 3):** FV = 18,900 × ((1 + 0.07/12)^300 − 1)/(0.07/12) =
  **$153,103.55** (15,310,355¢) — inside the verification window; encoded in
  `tests/unit/fi.test.ts`.
- **Opportunity value in TODAY'S money (W.10), anchor (exact):** $18.00/mo, 360 months,
  7.00%/yr return, 2.50%/yr inflation. Two steps, one rounding at the end:
  annuity factor ((1 + 0.07/12)^360 − 1)/(0.07/12) = 1,219.970996 → FV = 1,800¢ ×
  1,219.970996 = 2,195,947.79¢ ($21,959.48 in future dollars); deflator 1.025^30 =
  2.097568 → 2,195,947.79 / 2.097568 = **$10,469.02** (1,046,902¢). This is the figure
  the /coach opportunity row prints, and the two intermediate values are recorded so the
  step that is wrong is identifiable if it ever drifts. Encoded in
  `tests/unit/fi-real-basis.test.ts` (golden sentence) — the nominal FV above it stays
  pinned separately because it is still the primitive this is built from.
- **Savings rate:** month with after-tax income $6,000.00 and expenses $4,200.00 →
  **30.00%**. Transfers between own accounts excluded from both sides (test with a
  $500 savings transfer present — rate unchanged).
- **Coast FI:** current portfolio $200,000, FI $1,000,000, return 7.2% geometric,
  target age in 25 yr: need (1.072)^t ≥ 5 → t = ln 5 / ln 1.072 = 23.15 yr ≤ 25 →
  **already Coast FI today**. Negative case: portfolio $100,000 → t = ln 10 / ln 1.072
  = 33.1 yr > 25 → not Coast FI; engine reports the contribution still required.

---
