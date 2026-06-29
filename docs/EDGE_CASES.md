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

## §Debt-free-by-date (DECISIONS #125 — inverse planner, hand-verified)

`solveDebtFreeByDate` BISECTS the monotone `planDebtPayoff` for the minimal extra/mo that clears all
debt by a target date (the `coastFI` idiom). Every figure below is hand-derived and pinned in
`tests/unit/debt-free-by-date.test.ts` (today = 2026-06-10 unless noted).

### A. Zero-interest, $1,200 over 12 months → exactly $100.00/mo extra
1 debt: balance 120000c, apr 0, min 0. Budget = extra (min 0); cleared at `ceil(120000 / extra)`.
`≤ 12 ⇔ extra ≥ 10000`. Minimal extra = **10000c** ($100.00/mo); monthsToDebtFree = 12; at
safeToSpend 100000c the share = 1000 bps (10%), withinSafeToSpend = true; outcome `reachable`.

### B. On-track — minimums alone make the date → $0 extra
1 debt: 120000c, apr 0, min 20000. extra 0 clears in `ceil(120000/20000) = 6 ≤ 12` ⇒ the bisection
converges to 0: requiredExtra = **0**, monthsToDebtFree = 6, outcome `on-track`.

### C. Unreachable — a date today or in the past
targetMonths < 1 (the date is this month or earlier). No non-zero debt can clear in 0 months, so
outcome `unreachable`, requiredExtra = null, monthsToDebtFree = null, share/affordability null. (The
ONLY unreachable case for non-zero debt: paying everything in month 1 always works for targetMonths ≥ 1,
so "too soon" means strictly < 1 cycle.)

### D. Reachable but OVER budget — honest figure, flagged unaffordable
$12,000 (1200000c) at 0% in 3 months: `ceil(1200000/extra) ≤ 3 ⇔ extra ≥ 400000`. Minimal extra =
**400000c** ($4,000/mo). At safeToSpend 100000c the share = 40000 bps (**400%**, NOT clamped) and
withinSafeToSpend = false. Outcome stays `reachable` — the real number is reported with an honest
"more than your whole safe-to-spend" flag, never a fake yes and never a figure-less refusal.

### E1. With interest — $1,000 @ 24% APR in 1 month → exactly $1,020.00
month 1 interest = round(100000 × 2400 / 10000 / 12) = round(2000) = 2000 ⇒ owed 102000; cleared iff
extra ≥ 102000. Minimal extra = **102000c**; monthsToDebtFree = 1.

### E2. With interest — $1,000 @ 24% APR in 2 months → exactly $515.05
m1 leaves `102000 − E`; m2 clears iff `(102000−E) + round((102000−E)×0.02) ≤ E`. Max remaining 50495
(2×50495 + round(1009.9 = 1010) = 102000) ⇒ E = 102000 − 50495 = **51505c**; monthsToDebtFree = 2.
(MINIMALITY is locked independently: `worksIndependently(required)` true and `worksIndependently(required−1)`
false, recomputed straight from `planDebtPayoff` — proving the bisection returns the true minimum.)

### F. Already debt-free — nothing to solve
No debts (or all balances ≤ 0) ⇒ outcome `already-debt-free`, requiredExtra 0, monthsToDebtFree 0,
totalBalanceCents 0.

### G. Overspent — safe-to-spend ≤ 0
The required figure is unchanged by safe-to-spend (e.g. still 10000c in case A), but
shareOfSafeToSpendBps and withinSafeToSpend are both `null` (a share of a non-positive budget is
meaningless), never a divide-by-zero or a negative percent.

### Monotonicity (why the bisection is valid)
`planDebtPayoff.monthsToDebtFree` is non-increasing in `extraMonthlyCents` (more budget ⇒ each debt's
balance trajectory is pointwise ≤ the lower-budget one ⇒ payoff never later; null = never = +∞). A
property test sweeps extra 0…400000 over a mixed portfolio and asserts the months never increase.

## §Savings-goal-by-date (DECISIONS #126 — inverse planner, hand-verified)

`solveSavingsGoalByDate` is the sibling of the debt planner above. Savings funding is LINEAR (no
investment growth — a near-term envelope is cash, not a portfolio), the SAME flat model the /goals
card uses (`goalFundingMonths` = `ceil(remaining / monthly)`), so the minimal monthly is closed-form:
`requiredMonthly = ceil(remaining / targetMonths)` is exactly the smallest integer m with
`ceil(remaining / m) ≤ targetMonths`. `share = round(requiredMonthly / safeToSpend × 10000)` bps,
identical to the debt twin's rule. Every figure below is hand-derived to the cent and pinned in
`tests/unit/savings-goal-by-date.test.ts` (today = 2026-06-10 unless noted). `remaining =
max(0, goalAmount − currentSavings)`; the app passes currentSavings = 0 (a fresh envelope, like
createGoal's savedCents), but the engine is general and the already-funded case is tested.

### SG-A. Simple — $6,000 over 12 months → exactly $500.00/mo
goal 600000c, current 0, 12 whole months, safeToSpend 200000c. remaining = 600000;
requiredMonthly = ceil(600000 / 12) = **50000c** ($500.00); monthsToGoal = ceil(600000/50000) = 12;
share = round(50000/200000×10000) = 2500 bps (25%); withinSafeToSpend = true; outcome `reachable`.

### SG-B. Already-funded — current ≥ goal → $0/mo
goal 100000c, current 200000c. remaining = max(0, −100000) = 0 ⇒ outcome `already-funded`,
requiredMonthly = 0, monthsToGoal = 0, share = 0 bps, within = true, remainingCents = 0.

### SG-C. Non-divisible — $5,000 over 7 months → exactly $714.29/mo (ceil)
goal 500000c, current 0, targetDate 2027-01-10 (7 whole months), safeToSpend 100000c.
requiredMonthly = ceil(500000 / 7) = ceil(71428.57…) = **71429c** ($714.29); check 7 × 71429 =
500003 ≥ 500000, and required−1 (71428) funds in ceil(500000/71428) = 8 > 7 (minimal). monthsToGoal =
ceil(500000/71429) = 7; share = round(71429/100000×10000) = round(7142.9) = 7143 bps (71%); within = true.

### SG-D. Reachable but OVER budget — honest figure, flagged unaffordable
goal 1200000c ($12,000), current 0, 2 months, safeToSpend 50000c. requiredMonthly = ceil(1200000/2) =
**600000c** ($6,000/mo); share = round(600000/50000×10000) = 120000 bps (**1200%**, NOT clamped) and
withinSafeToSpend = false. Outcome stays `reachable` — the real number is reported with an honest
"beyond a single month's budget" flag, never a fake yes and never a figure-less refusal.

### SG-E. Unreachable — a date today or in the past
remaining > 0 and targetMonths < 1 (the date is this month or earlier). Outcome `unreachable`,
requiredMonthly = null, monthsToGoal = null, share/affordability null; remainingCents is still
reported for the answer copy. (Unlike debt there is no "too high an APR" unreachable — any remaining
is reachable in ≥ 1 month at a large enough monthly — so "too soon" is the ONLY unreachable case.)

### SG-F. Overspent — safe-to-spend ≤ 0
The required figure is unchanged by safe-to-spend (e.g. still 50000c in SG-A), but
shareOfSafeToSpendBps and withinSafeToSpend are both `null` (a share of a non-positive budget is
meaningless), never a divide-by-zero or a negative percent.

### SG-G. Early finish — integer rounding can land a month before the deadline
goal 10c over 6 months: requiredMonthly = ceil(10/6) = 2c, which funds in ceil(10/2) = 5 months ≤ 6.
So `monthsToGoal` (5) can be strictly < `targetMonths` (6) — honest ("you'd actually hit it a touch
early"), never later than the deadline. Always `monthsToGoal ≤ targetMonths`.

### Card consistency (why no new Goal.kind is needed)
A goal saved at the solved monthly renders an IDENTICAL timeline on /goals, because the solver's
`monthsToGoal` and the card's `goalFIImpact.monthsToGoal` call the SAME `goalFundingMonths` — pinned by
a test that drives the real card path. (This is the #125 lesson — there a NEW debt-aware card was needed
because debt amortization contradicts the flat card; here the flat card is already correct.)

## §Retire-at-age (DECISIONS #131 — inverse planner, hand-verified)

`solveRetireAtAge` is the THIRD inverse planner (after debt #125 and savings #126). State a target
retirement AGE ("can I retire at 60?") and it SOLVES for the minimal monthly contribution that makes
the portfolio LAST through the plan-through age, with honest feasibility. Unlike the flat savings
twin, the portfolio COMPOUNDS, so there is no closed form — it BISECTS the boolean
`projectRetirement(...).outcome === 'sustained'` (the #122 decumulation engine, assembled through the
SAME `buildRetirementInputs` the /investments outlook uses; the solver never re-implements
compounding/withdrawal math). The depleted→sustained flip is one-directional (more money never
un-sustains), so the predicate flips at most once and the bisection is exact. `shareOfSafeToSpendBps`
is computed on the ADDITIONAL money (required − current), identical bps rule to the twins. Pinned in
`tests/unit/retire-at-age.test.ts`.

**Why the "+1":** the engine treats a balance reaching exactly 0 after a withdrawal as DEPLETED
(`p <= 0`), so the minimal SUSTAINING contribution is one cent above the break-even. In the
real-return-0 cases below (nominal = inflation ⇒ growth is the identity) the math is closed-form:
`balanceAtRetirement = accumMonths × monthly`, and sustained ⇔ `balanceAtRetirement > decumMonths × W`
where `W = round(annualSpending / 12)`.

### RA-0PCT. Reachable, real-return 0 — exactly $2,000.01/mo
currentAge 40, targetAge 50 (accum 120mo), endAge 70 (decum 240mo), portfolio 0, currentMonthly 0,
annualSpending 1,200,000c ⇒ W = 100,000c, nominal 250 = inflation 250 ⇒ real 0, swr 400, safeToSpend
300,000c. decum need = 240 × 100,000 = 24,000,000c. sustained ⇔ 120·monthly > 24,000,000 ⇔ monthly >
200,000 ⇒ **requiredMonthly 200,001c**; requiredAdditional 200,001c (current 0); balanceAtRetirement =
120 × 200,001 = **24,000,120c**; endBalance = 24,000,120 − 24,000,000 = **120c**;
sustainableAnnualWithdrawal = round(24,000,120 × 4%) = **960,005c**; share = round(200,001 / 300,000 ×
10000) = **6,667 bps**; within = true; outcome `reachable`.

### RA-CURRENT. The current rate is subtracted from the required TOTAL
RA-0PCT with currentMonthly 50,000c. The minimal TOTAL is unchanged (200,001c — it depends only on the
goal, not the current rate); requiredAdditional = 200,001 − 50,000 = **150,001c**; share =
round(150,001 / 300,000 × 10000) = **5,000 bps**; within = true.

### RA-ONTRACK. Already-on-track — the current rate already sustains
RA-0PCT with currentMonthly 250,000c. sustains(250,000): 120 × 250,000 = 30,000,000 > 24,000,000 ⇒
outcome `already-on-track`; requiredMonthly = currentMonthly 250,000c (echo); requiredAdditional **0**;
balanceAtRetirement 30,000,000c; endBalance 30,000,000 − 24,000,000 = **6,000,000c**;
sustainableAnnualWithdrawal round(30,000,000 × 4%) = **1,200,000c**; share 0 bps; within true.

### RA-D. Reachable but OVER budget — honest figure, flagged unaffordable
currentAge 40, targetAge 41 (accum 12mo), endAge 61 (decum 240mo), portfolio 0, annualSpending
1,200,000c (same 24,000,000c need), safeToSpend 100,000c. 12·monthly > 24,000,000 ⇔ monthly >
2,000,000 ⇒ requiredAdditional **2,000,001c**; share = round(2,000,001 / 100,000 × 10000) = **200,000
bps** (2000%, NOT clamped); within = false; outcome stays `reachable` (a real figure, never a fake yes).

### RA-G. Overspent — safe-to-spend ≤ 0
requiredAdditional is unchanged (still 200,001c in RA-0PCT), but shareOfSafeToSpendBps and
withinSafeToSpend are both `null` (a share of a non-positive budget is meaningless).

### Unreachable branches (the ONLY three)
With ≥ 1 accumulation month an unbounded contribution ALWAYS sustains, so a near-term aggressive age
is `reachable` (over-budget), NOT unreachable. The only honest `unreachable` cases:
- **age-in-past** — targetAge < currentAge (e.g. 39 < 40). Pre-checked before the engine (which throws).
- **age-after-end** — targetAge > endAge (e.g. 100 > 95). Pre-checked before the engine.
- **cannot-sustain** — targetAge == currentAge (accum 0 ⇒ no contribution can land) AND the seed
  portfolio alone can't cover the spend. requiredMonthly/Additional/share/within all `null`;
  plannedAnnualWithdrawal is still echoed for the copy.

### Minimality + monotonicity (why the bisection is valid)
The test pins `sustains(required)` true AND `sustains(required−1)` false, recomputed INDEPENDENTLY
straight from `projectRetirement` — including a real-compounding case (nominal 700 − inflation 250 =
4.5% real, no closed form). A property sweep confirms the sustained predicate flips false→true once as
the contribution rises.

### Card consistency (why no Goal row — persist the age instead)
Unlike the debt/savings slices, a retire-at-age plan persists the chosen age to the existing
`User.retirementAge` dial (`saveRetirementAge`), NOT a flat savings `Goal`. The decumulation engine
compounds returns net of inflation, so a flat `ceil(remaining/months)` Goal would CONTRADICT it (the
§Savings "card consistency" precedent inverted). `User.retirementAge` already feeds the same engine the
/investments outlook + what-if recompute live, so the plan can't drift and nothing is duplicated.

## SimpleFIN holdings — authoritative total vs per-share round-trip (DECISIONS #129, live-ingest backlog #5)

SimpleFIN reports a position's TOTAL `market_value` + a share count. A Holding stores a per-share
`priceCents` for display AND the authoritative `marketValueCents` total. The engine
(`valuePosition`) uses `marketValueCents` verbatim when present; a manual holding (no total) derives
`round(quantity × priceCents)`. The bug #5 fixes: storing ONLY a rounded per-share price loses
low-price / high-quantity lots. All values hand-verified.

### H-A. Penny lot — per-share rounds to $0 but the position is worth 1¢
1,000,000 shares, `market_value` "$0.01" (1¢ total). priceCents = round(1 ÷ 1,000,000) = round(0.000001)
= **0**. Per-share-only model: marketValue = round(1,000,000 × 0) = **$0.00** (WRONG — the position
disappears). Authoritative model: marketValueCents = **1** (1¢, exact). The fix's headline case.

### H-B. Sub-dollar lot — per-share rounding inflates ~2×
10,000 shares, `market_value` "$50.00" (5,000¢ total) → $0.005/share. priceCents = round(0.5) = **1**
(half-away-from-zero). Per-share-only model: round(10,000 × 1) = 10,000¢ = **$100.00** (2× the truth).
Authoritative model: **5,000¢** = $50.00, exact.

### H-C. VOO sub-cent drift — the documented #124 9999 is now exact
3 shares, `market_value` "$100.00", `cost_basis` "$90.00". priceCents = round(10,000 ÷ 3) = round(3,333.33)
= **3,333**. Per-share-only model: round(3 × 3,333) = **9,999¢** (the #124 documented −1¢ drift).
Authoritative model: **10,000¢** exact; unrealized gain = 10,000 − 9,000 = **1,000¢** off the real total.

### H-D. Clean lot — round-trip already exact (no behavior change)
10 shares, "$2,000.00" → priceCents = round(200,000 ÷ 10) = 20,000; derived round(10 × 20,000) =
200,000 = authoritative 200,000. For whole-cent-divisible lots the two models agree, so the common case
is unchanged.

### H-E. Manual holding — null total, derive path (golden-safe)
A hand-entered holding carries no `marketValueCents` (null). The engine derives
`round(quantity × priceCents)` exactly as before, so the demo seed portfolio (5 manual holdings summing to
$142,000.00) and every golden value are byte-identical. `addHolding` writes `marketValueCents: null` on
create AND update, so re-entering a previously-fed symbol by hand clears the stale feed total and the
user's per-share price wins.

### Net-worth invariant (unchanged)
Net worth and /coach `portfolioCents` use each INVESTMENT account's authoritative
`currentBalanceCents`, NOT `summarizePortfolio`. So this change touches ONLY the /investments
position breakdown (totals, allocation weights, unrealized gain) — never net worth, FI, retirement,
goals, or any dashboard golden.

### H-F. DB Int column ceiling — a single position over $21,474,836.47 is skipped, not silently dropped (critic P1-1)
A persisted cents column is Prisma `Int` = Postgres 32-bit INTEGER, max **2,147,483,647¢** = $21,474,836.47
per position. A SimpleFIN total above it would overflow the column and be SWALLOWED by the reconcile's
per-row try/catch — vanishing from /investments in production (invisible on 64-bit SQLite in CI). So the
mapper bounds **every** persisted value (priceCents, costBasisCents, marketValueCents) to this ceiling:
e.g. 1,000 sh @ "$22,000,000.00" → total 2,200,000,000¢ > ceiling → **skipped + counted** (priceCents
$22,000 fits, but the total doesn't). Boundary: "$21474836.47" (= 2,147,483,647¢) is KEPT; "$21474836.48"
is skipped. Degrades visibly (skip count), never a silent vanish. Widening these totals to BigInt is the
documented follow-up if such single positions come into scope (the cost-basis column has always had this
same ceiling).

### H-G. Approximate per-share display — the row never contradicts its authoritative total (critic NWBR-1)
For a sub-cent / fractional lot the rounded per-share price can't rebuild the authoritative total
(`round(quantity × priceCents) ≠ marketValueCents`): 10,000 sh / $50.00 shows "$0.01/share" but the total
is $50.00 (not 10,000 × $0.01 = $100). The pure `isPerShareApproximate` flags exactly this case, and the
/investments row renders "≈$0.01" so the per-share figure reads as approximate beside the exact total. For
a derived (manual) position the two agree by construction → not flagged. Demo seed lots are all
whole-cent-divisible → never flagged → display unchanged.
