# Edge-Case Inventory & Hand-Verified Expected Values

Every scenario below becomes one or more named unit tests. Expected values here were
computed by hand; **Claude Code must re-verify each by hand before encoding it** (the
test asserts the doc's value; if code and doc disagree, resolve on paper first — never
adjust the expected value to match the code).

All amounts in cents in tests; shown here in dollars for readability.
Calendar references use real 2026 dates (June 13, 2026 = Saturday; June 15 = Monday).

---

## §Cash-Needed Engine

### A. Autopay card — included in cash, excluded from action
- Today 2026-06-10. Checking $3,400.00, no scheduled flows, no pending.
- Amex: statement $2,100.00, due 2026-06-15, autopay = STATEMENT_BALANCE.
- Chase: statement $2,712.33, due 2026-06-15, no autopay.
- **Expected:** required by 2026-06-15 = **$4,812.33**; shortfall = **$1,412.33**;
  transfer recommendation = **$1,450.00** (round UP to next $50) by **2026-06-12**
  (1 business day before due); action list contains only Chase (Amex marked "autopay
  handles payment — ensure funds present"). Amex counted exactly once.
- Variant A2: Amex autopay = MINIMUM ($35.00), scenario PAY_IN_FULL → required still
  $4,812.33 but action list = Chase full + Amex top-up of $2,065.00 ($2,100 − $35
  autopay).
- Variant A3: Amex autopay = FIXED_AMOUNT $500.00 → autopay covers $500, user action
  $1,600.00 remainder; total cash unchanged.

### B. Mid-cycle manual payment
- Statement $1,000.00; CardPayment $400.00 on 2026-06-05 applied to that statement.
- **Expected remaining due = $600.00.**
- B2 (overpayment): statement $500.00, payments $600.00 → remaining = **$0.00**
  (floored; never negative cash need).

### C. Statement not yet generated → estimate
- No statement; current balance $1,234.00; cycle closes 2026-06-20, due ~25 days later.
- **Expected:** estimated due **$1,234.00**, `isEstimated = true`, assumptions array
  contains an "estimated from current balance" string, UI shows "est." badge.

### D. Two cards due the same day
- Card1 $1,234.56 + Card2 $765.44 both due 2026-06-15.
- **Expected:** single ObligationPoint on 06-15 totaling **$2,000.00**, listing both.

### E. Weekend/holiday due date
- Issuer due date 2026-06-13 (Saturday). **Expected effective date = 2026-06-12
  (Friday)**, with an assumption string noting the conservative adjustment.
- E2: due 2026-07-04 (Saturday, also Independence Day) → effective **2026-07-02?**
  No — walk back: 07-04 Sat → 07-03 Fri is the observed federal holiday → effective
  **2026-07-02 (Thursday)**. Holiday table must include observed dates.

### F. Refund/credit after statement close
- Statement $800.00 closed 06-01; $50.00 refund posts 06-03.
- **Expected v1:** due remains **$800.00** (refund reduces current balance / next
  statement); engine attaches an informational note ("a $50.00 credit posted after
  close"). Test asserts both.

### G. Card with $0 due
- Statement balance $0.00. **Expected:** contributes $0, excluded from headline card
  list, still visible on the card detail page.

### H. Intra-period dip (the killer test)
- Today 2026-06-01. Checking $2,000.00.
- Scheduled: rent −$1,800.00 on 06-03; payroll +$2,500.00 on 06-05.
- Card1 $500.00 due 06-04; Card2 $2,000.00 due 06-10. No autopay.
- Day walk: 06-01 $2,000 → 06-03 $200 → 06-04 pay Card1 → **−$300** → 06-05 $2,200
  → 06-10 pay Card2 → $200.
- **Expected:** endpoint (06-10) is fine, but shortfall = **$300.00 on 2026-06-04**;
  headline reports the 06-04 need; intraPeriodMinimum = (2026-06-04, −$300.00 before
  remedy); transfer recommendation **$300.00 by 2026-06-03**.

### I. Minimum-payment path interest (average-daily-balance method)
- Method: for each card NOT paid in full, interest accrues on the average daily
  balance of the next cycle [statement close → next close], at the daily periodic
  rate DPR = aprBps / 10000 / 365. The balance is the full statement balance until
  the minimum posts on the due date, then the carried balance after; new purchases
  are not projected. Interest = round(DPR × Σ daily balances), where
  Σ = startBalance·daysUntilDue + carried·(cycleDays − daysUntilDue), and
  cycleDays = daysBetween(close, close+1mo). Paying in full (incl. STATEMENT_BALANCE
  autopay) carries nothing → **$0** (grace period preserved).
- Anchor: statement $3,000.00, min $35.00, APR 24.00% (2400 bps); cycle close
  2026-05-18 → 2026-06-18 (31 days), due 2026-06-15.
  - full $3,000 for 28 days (close→due), carried $2,965 for 3 days (due→next close).
  - Σ = 300000·28 + 296500·3 = 9,289,500; interest = round(9,289,500 × 2400 / 10000 / 365)
    = round(2,229,480 / 365) = round(6108.16) = **$61.08**.
- The value depends on the cycle dates: the same statement on a 2026-06-01 → 07-01
  cycle (30 days, due 06-15 → 14 days at full) gives Σ = 300000·14 + 296500·16 =
  8,944,000 → 2,146,560/365 = **$58.81** (critic5 §I). Both are pinned.
- Seed (MINIMUM): Sapphire $57.50 (271233·28 + 267733·3 = 8,397,723 × 2499/10000/365)
  + Platinum $0 (STATEMENT_BALANCE autopay) + Freedom $9.86 (600 carried constant
  30 days × 1999/10000/365) = **$67.36** (was $59.30/$65.76 under the retired
  simple-monthly formula). Store Card is an estimate (upcoming) → excluded.
- Supersedes the v1 simple-monthly approximation (carried × APR/12); see DECISIONS #29.

### J. Pending transactions affect projection
- Checking $1,000.00 with a pending −$250.00 → projection starts from effective
  **$750.00**. Test asserts pending is applied once (not again when it posts in seed).

### §Seed-headline (computed in Phase 1 — worked arithmetic)

Seed `--asOf 2026-06-10` (Wednesday). Calendar facts: 2026-06-12 Fri, 06-15 Mon,
06-24 Wed, 06-26 Fri, 06-28 Sun. Juneteenth (Fri 06-19) is a federal holiday but no
due date or recommendation lands on it.

**Inputs at asOf:**
- Everyday Checking (payment account): posted **$3,400.00**, pending **−$250.00**
  → effective start **$3,150.00** (edge case J).
- Sapphire: statement **$2,712.33**, closed 05-18, due **06-15** (Mon), no autopay,
  APR 24.99%. A $50.00 refund posted 05-20 (2 days after close) → informational note
  only (edge case F); due unchanged.
- Platinum: statement **$2,100.00**, closed 05-21, due **06-15**, autopay
  STATEMENT_BALANCE (edge case A), APR 29.24%.
- Freedom: statement **$1,000.00**, closed 06-01, issuer due **06-28 (Sunday)** →
  effective **Fri 06-26** (edge case E); mid-cycle payment **$400.00** on 06-05 →
  remaining **$600.00** (edge case B). APR 19.99%.
- Store Card: statement NOT generated (skipped — $0 activity last cycle); current
  balance **$43.50**; cycle closes 06-20, estimated due 07-15 → next-cycle estimate,
  excluded from this cycle's headline, shown as upcoming (edge case C / G; DECISIONS #9).
- Scheduled flows on checking inside the window [06-10 … 06-26]:
  payroll **+$2,450.00** on 06-12 and 06-26 (biweekly Fridays); rent **−$1,800.00** on
  06-24 (2 days before the second payroll Friday). The $500 savings auto-transfer
  (next 07-01) and $385 auto-loan ACH (next 07-05) fall outside the window.

**PAY_IN_FULL day walk (scheduled flows post before card draws):**

| date | event | balance after |
|---|---|---|
| 06-10 | start 3,400.00 − 250.00 pending | **3,150.00** |
| 06-12 | payroll +2,450.00 | 5,600.00 |
| 06-15 | pay Sapphire 2,712.33 + Platinum 2,100.00 (= 4,812.33) | 787.67 |
| 06-24 | rent −1,800.00 | **−1,012.33** ← first negative, worst dip |
| 06-26 | payroll +2,450.00, then pay Freedom 600.00 | 837.67 |

**Expected headline (golden test values):**
- requiredCents = 2,712.33 + 2,100.00 + 600.00 = **$5,412.33** across **3 cards**
- byDate = **2026-06-26** (last effective due date this cycle)
- intraPeriodMinimum = (**2026-06-24, −$1,012.33**) — endpoint due dates are both
  positive (787.67 and 837.67): this is a pure intra-period dip, mirror of edge case H
- shortfallCents = **$1,012.33**, shortfallDate = **2026-06-24**
- recommendation = round-up-to-$50(1,012.33) = **$1,050.00** by **2026-06-23**
  (Tuesday, 1 business day before 06-24)
- perDueDate: 06-15 → day total 4,812.33, cumulative 4,812.33, projected 787.67;
  06-26 → day total 600.00, cumulative 5,412.33, projected 837.67
- upcoming: Store Card estimated **$43.50** due 07-15, `isEstimated = true`

**MINIMUM scenario:** minimums = max($35, 1% of statement): Sapphire $35
(1% = 27.12), Platinum $35 (21.00), Freedom min already satisfied by the $400 payment
→ $0. Autopay STATEMENT_BALANCE still pulls Platinum in full. Required =
35.00 + 2,100.00 + 0 = **$2,135.00** by 06-15; walk 3,150 → 5,600 (06-12) →
5,600 − 2,135 = 3,465.00 → **no shortfall**, recommendation null.
Interest (average-daily-balance method, per card, round-half-away-from-zero;
DPR = APR / 10,000 / 365 applied to Σ daily balances over the next cycle):
- Sapphire (2499 bps, close 05-18 → next close 06-18 = 31 days, due 06-15):
  full 271,233 for 28 days, carried 267,733 for 3 days → Σ = 271,233·28 +
  267,733·3 = 8,397,723; × 2499 / 10,000 / 365 = 2,098,590.98 / 365 = 5,749.56
  → **$57.50**
- Platinum: autopay STATEMENT_BALANCE pays full → carried 0 → **$0.00**
- Freedom (1999 bps, close 06-01 → 07-01 = 30 days): min already satisfied, so
  $600 stays outstanding the full cycle → 60,000·30 = 1,800,000; × 1999 / 10,000 /
  365 = 359,820 / 365 = 985.81 → **$9.86**
- Total = **$67.36** (see §I; supersedes the retired simple-monthly $65.76)

**Net worth at asOf:** assets = 3,400 + 18,500 + 1,200 + 142,000 = 165,100.00;
liabilities = 2,948.11 (Sapphire) + 2,260.45 (Platinum) + 743.20 (Freedom) +
43.50 (Store) + 14,300.00 (auto loan) = 20,295.26 → net worth = **$144,804.74**.

---

## §Money & dates (test these before anything else)

- Sign conventions: outflow negative, inflow positive; liability balances stored
  positive; net worth = Σ assets − Σ liabilities. One test fixture exercises all types.
- Rounding rule: round-half-away-from-zero to cents, applied at every materialized
  step. Test: 296500 × 0.005 / 12 style cases land deterministically.
- `addMonthsClamped('2026-01-31', 1)` → `2026-02-28`. Cycle anchored on the 31st
  produces 28/30/31-day cycles correctly across a year.
- Business-day walk-back over a weekend AND an adjacent holiday (case E2).

---

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
- **Savings rate:** month with after-tax income $6,000.00 and expenses $4,200.00 →
  **30.00%**. Transfers between own accounts excluded from both sides (test with a
  $500 savings transfer present — rate unchanged).
- **Coast FI:** current portfolio $200,000, FI $1,000,000, return 7.2% geometric,
  target age in 25 yr: need (1.072)^t ≥ 5 → t = ln 5 / ln 1.072 = 23.15 yr ≤ 25 →
  **already Coast FI today**. Negative case: portfolio $100,000 → t = ln 10 / ln 1.072
  = 33.1 yr > 25 → not Coast FI; engine reports the contribution still required.

---

## §Categorization (Phase 2 targets)

- Normalization fixture (≥40 rows) — examples that MUST map correctly:
  `SQ *BLUE BOTTLE 0042 OAK` → Blue Bottle Coffee; `TST* HATTIE BS - ATL` → Hattie B's;
  `AMZN Mktp US*2K4XY1` → Amazon; `PAYPAL *SPOTIFYUSA` → Spotify;
  `HMSHOST-ATL-T4-POS118` → Airport Dining; `COSTCO GAS #1234` → Costco Gas (distinct
  merchant from `COSTCO WHSE #1234` → Costco).
- Review-rate test: most recent 60 seed days, `needsReview` count / total **< 5%**.
- Contextual rules: Amazon < $40 → Household, > $400 → Electronics, between → review;
  weekend-only rule; account-scoped rule; priority ordering test (user rule > merchant
  default > suggestion).
- Recurring: detects ≥8 subscriptions, the engineered price increase (old vs new amount
  + `priceChangedAt`), the 90-day-unused subscription, biweekly payroll cadence.

## §Coach copy guardrails

`coach-copy.test.ts` asserts: no banned phrases (e.g., "you wasted", "stop buying",
"guilty", "shame", "you should have"), and every projection string matches
`/assum(es|ing|ptions)/i` or renders with an attached assumptions component.

## §Money-Dials (per-user settings — parse + bounds, hand-verified)

The `src/lib/engine/settings/dials.ts` validator is the single boundary where the
free-text settings form becomes the typed `swrBps` / `expectedReturnBps` /
`hourlyWageCents` the FI and cash-needed engines already consume. Parsing is
string-only (no float math): a percent has exactly 2-decimal resolution (1 bps =
0.01%), dollars reuse `centsFromDollarString`.

- **Percent → bps:** `"4"` → 400; `"4.25"` → 425; `"0.5"` → 50; `"7%"` → 700;
  `" 6.5 "` → 650; `"100"` → 10000 (parses, then bounds-rejected). Malformed → reject:
  `"4.255"` (>2 dp), `"1000"` (≥4 integer digits), `"-4"`, `"4."`, `"%"`, `"1,000"`.
- **Dollars → cents:** `"38"` → 3800; `"38.50"` → 3850; `"0.05"` → 5. Malformed →
  reject: `"$38"`, `"38.555"`, `""`.
- **Bounds (reject outside; the FI engine stays well-defined inside):**
  - SWR 100–1000 bps (1%–10%). `fiNumberCents` THROWS on `swrBps ≤ 0`, so `0` MUST be
    rejected. Sanity check at the floor: `fiNumberCents($12,000/yr, 100)` =
    12,000 × 100 = **$1,200,000.00** (finite, no throw).
  - Expected return 0–1500 bps (0%–15%). `0` is accepted (the FI engine's explicit
    "no growth" branch).
  - Wage 1–1,000,000 cents ($0.01–$10,000.00/hr); empty clears it (→ null).
  - Money dials: ≤ 12 entries, each ≤ 40 chars after trim; control chars stripped,
    case-insensitive dedupe (first casing wins).
  - Payment account: must be one the user OWNS and of type CHECKING/SAVINGS.
- **Error accumulation:** all invalid fields report at once (one round-trip), so the
  form never plays whack-a-mole.
- **Display round-trip:** `bpsToPercentInput`/`centsToDollarInput` (integer math)
  invert the parsers for every in-range value: 400↔"4", 425↔"4.25", 3850↔"38.50".

Covered by `tests/unit/settings-dials.test.ts` (80 cases) and the
`tests/e2e/settings-dials.spec.ts` round-trip.

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
