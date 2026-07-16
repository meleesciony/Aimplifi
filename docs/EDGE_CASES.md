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

## §Threshold tuning (per-user AUTO_FLAGGED, DECISIONS #190)

Engine: `src/lib/engine/categorize/tuning.ts`; tests: `tests/unit/tuning.test.ts`,
`tests/unit/threshold-tuning-labels.test.ts`. All values hand-verified below.

- **Inputs** — the user's USER-labeled `CategoryPrediction` rows (`labeledAt` set; seed
  labels carry none), chronological by label time, restricted to COMMITTED filings:
  `predicted ≠ 'uncategorized'` (abstentions routed to review are the queue working as
  designed — counting them as misses would tighten exactly the users who review most, a
  feedback loop) and `actual ≠ 'uncategorized'` (a deleted custom category rewrites
  labels to it; not ground truth).
- **Per-sample Brier contribution** is (p − outcome)², p = confidenceBps/10000:
  hit@0.9 → 10 milli, miss@0.9 → 810; hit@0.8 → 40, miss@0.8 → 640; hit@0.7 → 90,
  miss@0.7 → 490.
- **Offset map:** `clamp((brierMilli − 150) × 5, ±500)`; tuned threshold =
  7000 + offset ∈ **[6500, 7500]**. Pivot 150 milli ≈ 17–18% of committed filings
  corrected at ~0.9 confidence (mean ≈ hitRate·10 + missRate·810); full loosening −500
  at ≤50 milli (~5% corrected), full tightening +500 at ≥250 milli (~30%).
- **Known answers:** `< 20` committed samples → 7000 (`insufficient-samples`).
  20@0.9 with 2 misses → (18·0.01 + 2·0.81)/20 = 0.090 → 90 milli → **6700**.
  20@0.8 with 10 misses → 6.8/20 = 0.340 → 340 → raw +950 → clamp → **7500**.
  20@0.7 with 3 misses → (17·0.09 + 3·0.49)/20 = 0.150 → exactly the pivot → **7000**
  (`baseline`).
- **Regression auto-revert** (only when n ≥ 40): newest 20 vs everything prior;
  revert iff recent > prior + 25 milli (strict). Prior 20@0.9/1 miss = 50 milli, recent
  20@0.9/8 misses = 330 → 330 > 75 → **7000** (`reverted-regression`). One-sided: bad
  prior 330 then good recent 50 stays tuned (overall 190 → +200 → **7200**). Brier
  granularity at 0.9 is 40 milli per extra miss (10 + 40m per 20), so the margin's
  strictness is exercised at 50→90 (reverts) vs 50→50 (holds).
- **Invariants:** 7500 = flagged ceiling < AUTO_SILENT (9000) — and pipeline.ts keeps
  `aiBadge < AUTO_SILENT_BPS` against the global constant, so NO flaggedBps value can
  create a new silent filing (locked for absurd inputs 0 and 10000-adjacent).
  Recompute-from-scratch: identical input → identical output; undo deletes the label +
  stamp and the tuning fades on the next read. Demo/golden safety: seed labels have
  `labeledAt = null` → demo user is permanently `insufficient-samples` → global
  thresholds, byte-identical behavior.
- **Production bite today:** confidences in the tunable window are Plaid PFC MEDIUM
  hints (7200) — a tightened user (≥7201) stops auto-filing those; 'STORE CARD
  PURCHASE' (6000) stays in review even fully loosened (6500). Merchant defaults
  (9600), generic keywords (8500), Toast priors (8000) and vocab (7500) are outside the
  reachable window, so tuning cannot touch them.

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

## Loan/mortgage payment obligations + Plaid mortgage/student ingest (DECISIONS #134)

The loan-obligation engine (`engine/loans/obligations.ts::selectLoanObligations`) and the Plaid
mortgage/student mappers. All money is integer cents; the business-day rule is the SAME the
cash-needed engine applies to cards (`priorBusinessDayIfNonBusiness`, clamped never-before-today).

### LO-A. Weekend + observed-holiday roll-back (the demo Auto Loan)
`{ type:'LOAN', minimumPaymentCents:38500, dueDayOfMonth:5 }`, today 2026-06-10. Next due-day-5
on/after today = **2026-07-05** (a Sunday). Walk back: Sun → Sat → Fri **2026-07-03**, which is the
OBSERVED Independence Day (Jul 4 = Saturday) → Thursday **2026-07-02**. Obligation: dueDate 2026-07-05,
effectiveDueDate 2026-07-02, paymentCents 38500. Verified end-to-end on the seed (phase4.test.ts).

### LO-B. MORTGAGE included; plain business-day due date unchanged
`{ type:'MORTGAGE', dueDayOfMonth:15, minimumPaymentCents:210000 }`, today 2026-06-10 → dueDate
2026-06-15 (a Monday, a business day) → effectiveDueDate 2026-06-15 (unchanged). MORTGAGE surfaces on
the calendar/reminders exactly like LOAN (both are liabilities); it is excluded from the debt snowball.

### LO-C. Exclusions — nothing fabricated
A CREDIT or CHECKING account, a loan with `minimumPaymentCents` null or 0, or a loan with
`dueDayOfMonth` null all produce NO obligation (no payment/date to surface; the engine never invents one).

### LO-D. Clamp to today
today = Sunday 2026-07-05, dueDay 5 → dueDate 2026-07-05; its prior business day (2026-07-02) is BEFORE
today, so effectiveDueDate clamps UP to today (2026-07-05) — the cash-needed "never before today" rule.

### LO-E. Plaid mortgage → loan fields
`{ next_monthly_payment:1850.00, next_payment_due_date:'2026-07-15', interest_rate:{percentage:6.49} }`
→ `{ aprBps:649, minimumPaymentCents:185000, dueDayOfMonth:15 }`. Nested `interest_rate.percentage`
(percent→bps via integer ×100); `next_monthly_payment` (dollars→cents); due day = the date's day component.

### LO-F. Plaid student → loan fields (FLAT rate field; deferment)
`{ minimum_payment_amount:250.00, next_payment_due_date:'2026-07-21', interest_rate_percentage:4.53 }`
→ `{ aprBps:453, minimumPaymentCents:25000, dueDayOfMonth:21 }`. Student uses the FLAT
`interest_rate_percentage` (not the nested mortgage object) and `minimum_payment_amount`. In deferment
(`minimum_payment_amount`/`next_payment_due_date` null) the known rate still maps; payment + day stay null.

### LO-G. Preserve-on-null (never zero a known value)
Any mortgage/student field Plaid reports null/non-finite/non-positive maps to null, and the Account UPDATE
OMITS null fields — a deferment loan or a transient missing field PRESERVES the last-known APR/payment/
due-day (the #130 discipline). A null student `account_id` (Plaid allows it) is skipped, never throws.

### Surface boundary (no headline drift)
Loan obligations feed the calendar (`loan-due` event) + reminders + — as of the #134 follow-up below —
the /forecast BALANCE PROJECTION; the cash-needed engine (`type==='CREDIT'` filter, `requiredCents`,
`cardsDueCount`, projection) is untouched. The seed has no shortfall, so removing the `sched-autoloan`
stand-in leaves every cash-needed headline golden byte-identical.

### LO-H. Loan payments in the /forecast balance projection (#134 follow-up, DECISIONS #151)
The forecast reads only checking scheduled rows, and a loan payment is NOT a scheduled row (it surfaces
as a loan-due obligation), so removing `sched-autoloan` starved the demo forecast by $385/mo — the
projection over-stated checking and disagreed with the calendar/reminders that DID show the loan.
`loanObligationsToScheduledFlows` maps each obligation to a MONTHLY outflow on its RAW `dueDate` (never
`effectiveDueDate` — a business-day-shifted anchor would drag the shift into every future month), and
`getCashFlowForecast` folds them onto the payment-account projection. The loan's **ISOLATED contribution**
— a bare `$3,400.00` (340000¢) start with ONLY the auto-loan, which is the exact known-answer
`forecast.test.ts` pins (demo: today `2026-06-10`, Auto Loan `$385.00` = 38500¢ due day 5; horizon 90d →
occurrences 2026-07-05, 08-05, 09-05):
- one payment by 2026-07-10 (30d) → `340000 − 38500 = 301500` (`$3,015.00`) = **−$385** vs no-loan
- two payments by 2026-08-09 (60d) → `340000 − 77000 = 263000` (`$2,630.00`) = **−$770**
- three payments by 2026-09-08 (90d) → `340000 − 115500 = 224500` (`$2,245.00`) = **−$1,155**
- total loan outflow over the horizon = `3 × 38500 = 115500` (`$1,155.00`)

**These are the loan's isolated effect, NOT the on-screen /forecast milestone balances.** The real demo
projection also carries biweekly payroll (+$2,450), rent (−$1,800), and the savings auto-transfer (−$500),
so the balance shown on /forecast at those dates is much higher — do NOT diff the `$3,015`-style figures
above against the screen (that reads a phantom regression). The **server** read-path (loan folded in ×3 @
−$385, correct account/count) is locked by `tests/unit/forecast-server.test.ts`; the isolated per-milestone
deltas are locked by `tests/unit/forecast.test.ts`.

NO cross-source de-dup: no structural key links a checking scheduled row to a loan Account, and heuristic
money-matching is rejected (STATUS #134). The narrow residual — a loan whose ACH is ALSO recurring-detected
as a non-transfer checking row double-counts (now on forecast too, same population already doubling on the
calendar) — is pinned by a regression test that documents the accepted limitation. Not demo-reachable
(`refreshRecurringForUser` runs only on real Plaid/SimpleFIN sync, never for the seeded demo).

## §Cash Flow Radar (DECISIONS #172 — AI plan §1.2, hand-verified)

`computeRadar` merges /forecast's committed events with cash-needed card obligations (plus
synthesized future cycles, always `isEstimated`) into one committed-only walk; the burn band is a
separately-labeled estimate that can raise at most `watch`, never `alert`. All cases below use
today = `2026-06-10` (June 1 2026 is a Monday) and are pinned in `tests/unit/radar.test.ts` /
`tests/unit/radar-burn.test.ts`.

### A. Clear — no dip, no proposal
Start 100000¢; payroll +50000¢ on 06-15; one card due 30000¢ on 06-20; horizon 30. Walk:
100000 → 150000 (06-15) → 120000 (06-20). `firstNegativeDate` null, lowest 100000¢ @ 06-10
(the day-0 anchor), ending 120000¢, status `ok`, coverTransfer null.

### B. Dip after a card — named card + minimum timed cover
Start 100000¢; "Sapphire" due 70000¢ Fri 06-19; rent −60000¢ Wed 06-24; horizon 30, no holidays.
Walk: 30000 (06-19) → **−30000** (06-24). firstNegative 06-24, worst dip 30000¢ →
`roundUpToNext50Dollars(30000) = 30000` ($300 — exact multiple stays), byDate =
`previousBusinessDay(06-24)` = Tue **06-23**. No card due ON 06-24 ⇒ colliding card = the most
recent due before it: **Sapphire (06-19)**. daysUntil = 14 ⇒ pushWorthy false. Sources: savings
500000¢ sufficient; an INVESTMENT brokerage is NEVER a source (adjudicated condition 2); the
payment account itself is never a source.

### C. Due TODAY comes off the day-0 anchor
Start 20000¢; card due 30000¢ ON 06-10 (today). `computeForecast` applies only future-dated
events, so the engine subtracts today's dues from the anchor: day-0 balance −10000¢ ⇒
firstNegative = **today**, daysUntil 0, pushWorthy **true**, colliding = that card. Cover:
dip 10000¢ → amount 10000¢ ($100); ideal 06-09 is in the past ⇒ byDate clamped to **06-10**.

### D. Future-cycle synthesis (projectCardDues), July-4 walk-back, statement basis
"Freedom", cashRequired 40000¢ (no mid-cycle payment ⇒ basis = cashRequired), raw due Sat
2026-07-04, cash-needed effective 07-02 (Sat→Fri 07-03 = observed Independence Day→Thu 07-02);
horizon 90 (end 09-08), holidays = [2026-07-03]. Dues: 07-02 (real, 40000¢) + synthesized
**08-04** and **09-04** (raw +1/+2 months from 07-04; both business days), each 40000¢
`isEstimated: true`; 10-04 is past the horizon. Stale anchor: raw due 2026-05-08 (passed;
effective clamped to today) ⇒ k=1 lands 06-08 ≤ today and is SKIPPED; an occurrence landing
exactly ON today is also skipped (the clamped current due already covers it); k=2 gives 07-08.
**Statement basis (critic #172 P1-1):** future cycles repeat `cycleBasisCents` (the FULL
statement balance, supplied by the server), never this cycle's post-mid-cycle-payment residual:
statement 100000¢ with 40000¢ paid ⇒ current due 60000¢ but future cycles **100000¢** each. A
card fully paid THIS cycle (cashRequired 0, basis 100000¢) still projects future cycles at
100000¢; a card with basis ≤ 0 (credit balance, or $0-due with no statement) projects nothing.

### E. Burn pace (weekly nearest-rank percentiles ÷ 7)
Real checking spend is sparse (most days $0), so pace comes from complete WEEKLY totals — a
daily percentile collapses to a false $0/day (critic #172 P1-2). Weeks are 7-day chunks counted
BACK from the most recent complete day, clamped to `min(lookback, historyDays)`; typical = p50
weekly ÷ 7, heavy = p80 weekly ÷ 7 (nearest-rank: rank = ceil(p·n); the ÷7 is one
`roundHalfAwayFromZero`).
- 8 weeks [0,0,7000,7000,14000,14000,21000,70000]: p50 rank 4 → 7000 → **1000/day**; p80 rank
  ceil(6.4)=7 → 21000 → **3000/day**.
- $70 once a week × 8 (six $0 days each week): typical = heavy = **1000/day** (not $0).
- 1000¢/wk → 1000/7 = 142.857… → **143/day** (half-away-from-zero).
- 10 dailies → 1 complete week (the most recent 7; the older partial is dropped); sampleDays 7.
- History clamp: 28 old days @2000/day + 28 new @1000/day — historyDays 28 ⇒ only the newest 4
  weeks count (typical=heavy=1000); historyDays 56 ⇒ weekly totals [7000×4, 14000×4]: typical
  1000, heavy **2000** (p80 rank 7 → 14000).
- hasEnoughHistory: historyDays 28 → true; 27 → false (BURN_MIN_HISTORY_DAYS = 28).
`discretionaryDailyOutflows` window = the 56 COMPLETE days [today−56, today−1] (today's partial
day would bias low); zero-days count as 0; PENDING / transfers / split parents / inflows / other
accounts / excluded canonicals (scheduled + recurring merchants) are all excluded.

### F. Burn band walks the committed path; watch vs ok
Committed flat 100000¢, no events, horizon 10, typical 1000¢/day, heavy 3000¢/day (history ok):
expected ending 100000−1000×10 = **90000**; conservative ending **70000**; both clear ⇒ `ok`.
Start 20000¢ instead: heavy line 20000−3000d < 0 first at d=7 (−1000) ⇒ conservative
firstNegative **06-17** while committed + typical stay clear ⇒ status **`watch`** (the burn band
can never produce `alert` — adjudicated condition 1). With hasEnoughHistory false both band
lines are null and status falls back to `ok`.

## §Notifications (DECISIONS #173 — Gap 2 §2, `selectNotifications`)

Materiality = actionability + urgency (no dollar floor); dedup = the caller passes keys already
delivered and they're excluded. Every amount is copied verbatim from the source engine. today =
`2026-06-10`; pinned in `tests/unit/notify-select.test.ts`.

### A. Payment reminder — surfaced vs suppressed
- Actionable + imminent: Freedom `userActionCents` 45000¢ due 06-12 (daysUntil 2 ≤ 3) ⇒ ONE
  `payment_due` notification, key `payment_due:a1:2026-06-12`, level `warning`, amount **45000¢**
  ($450.00), url `/accounts`.
- Due today (daysUntil 0) ⇒ level **`critical`**.
- Autopay-FULLY-covered (`userActionCents` 0, `autopayCents` 90000¢) ⇒ **suppressed** (nothing to
  do).
- PARTIAL autopay (`userActionCents` 20000¢, `autopayCents` 50000¢) ⇒ **surfaced** at the
  user-action **20000¢** ($200.00), NOT the full bill — the exact case a `<=`-vs-`autopayCovered`
  slip would wrongly drop.
- Beyond the window (daysUntil 5 > 3) ⇒ **suppressed** (`upcoming` stays in-app only).
- Estimated ⇒ `isEstimated:true` + "(estimated…)" in the body.

### B. Radar alert — the pushWorthy gate
- `pushWorthy` true, firstNegative 06-14, colliding Sapphire, cover 30000¢ ⇒ ONE
  `cash_flow_alert`, key `cash_flow_alert:2026-06-14`, amount = **coverTransfer 30000¢** verbatim,
  names Sapphire, url `/dashboard`. daysUntil ≤ 1 ⇒ `critical`, else `warning`.
- `pushWorthy` false (e.g. the seed's own radar dip is 14 days out) ⇒ **no radar notification**
  (only payment reminders can push in the demo).
- `coverTransfer` null ⇒ amount **0**, no crash, no cover phrase.
- radar null ⇒ nothing.

### C. Dedup + cooldown + ordering
- A key present in `sentKeys` ⇒ that notification is **excluded** (idempotent daily sweep).
- `radarAlertOnCooldown` true ⇒ the `cash_flow_alert` is **suppressed** even when pushWorthy (the
  dip-DATE wobble guard; the cron sets it from a 4-day recency check). Payment reminders are
  **unaffected** — their keys (accountId+dueDate) are stable.
- Ordering: level `critical` → `warning` → `info`, then earliest date, then title. A due-today
  payment (critical) sorts before a same-window radar warning.

### D. Delivery dedup (cron, `tests/unit/cron-notify.test.ts`)
A `NotificationSent` row is written ONLY after a real delivery to ≥1 live device: dormant (no
VAPID) / zero subs / all-subscriptions-410 all deliver nothing and record **nothing** (so a later
opt-in still fires); a real send records the key, and the next sweep selects **0** for that subject
(the @@unique makes a concurrent duplicate insert a no-op, not a double-send).

## §Weekly Digest (DECISIONS #174 — Gap 2 §3, `buildWeeklyDigest`)

Pure composition over `getCoachData().review` (the Money Review) + `selectPaymentReminders` (7-day
dues); no number is computed here. today = `2026-06-10`; pinned in `tests/unit/digest.test.ts`.

### A. Composition
- Review + dues ⇒ subject `Your week with Aimplifi`; body contains `review.improvement`,
  `review.creep`, `review.nextAction` **verbatim** and each due rendered by the SHARED `reminderLine`
  (byte-identical to the reminder email), plus "…never moves your money".
- Review + NO dues ⇒ "Nothing due in the next 7 days — a clear week ahead." (no `•` bullets).
- NO review + dues ⇒ still sends (dues only; no savings-rate lines).
- NO review + NO dues ⇒ **null** (a brand-new user with no history and nothing due gets no digest).
- An estimated due carries `[estimated]` (same `reminderLine`).

### B. Week-key dedup (cron, `tests/unit/cron-digest.test.ts`)
- Key = `weekly_digest:<Monday>` where Monday = `addDays(today, -((dayOfWeek(today)+6)%7))`;
  dayOfWeek 0=Sun..6=Sat ⇒ Mon→−0, Sun→−6, Sat→−5, every weekday lands on the ISO Monday.
- Dormant (no RESEND) ⇒ digest composed, **nothing sent, nothing recorded** (activation later still
  delivers). A real send records the week key ONCE; a second run the same week is skipped
  (`already-sent-this-week`), no duplicate email.

### C. First-week user — no "Infinity" (critic #174 P2-1)
A user with a checking account but zero transactions ⇒ empty flows ⇒ `monthsOfRunway(_,0) = Infinity`.
`COACH_COPY.runway(Infinity)` and `reviewImprovementRunway(Infinity)` render the "runway fills in as
spending is tracked" line, NOT the literal "Infinity months" — so neither /coach nor the emailed
digest ever shows it.

## §Value-Receipts (DECISIONS #206 — TASKS 1.3, `engine/receipts/receipts.ts`)

The module NEVER computes a money value at catch time — every `amountCents` is a verbatim copy
(reminder → `cashRequiredCents`; radar → the alert's own `coverTransfer.amountCents`, 0 when the
alert had none; price increase → `Opportunity.monthlyCents`). The only arithmetic anywhere is the
summary's per-kind sums. Pinned in `tests/unit/receipts.test.ts`.

### A. Hand-verified summary (per-kind sums, unknown kinds ignored)
Rows: reminder 123456 + reminder 50000 · radar 50000 · price 250 + price 1000 · unknown-kind 999999
⇒ `total 5` (2+1+2; the unknown row counts nowhere), `remindersAmountCents 173456`
(123456+50000), `priceIncreaseMonthlyCents 1250` (250+1000). Radar carries a COUNT only.
**Structural honesty lock:** the summary type has NO cross-kind dollar field — reminder amounts are
bills covered and price amounts are monthly deltas, so any cross-kind "$ total" would be a
meaningless "we saved you $X" claim (also banned in copy by a coach-copy guardrail test).

### B. Keys (idempotency, channel-agnostic)
- reminder: `payment_due:<accountId>:<dueDate>` — the notify-engine key builder itself, so a
  reminder EMAIL and a payment_due PUSH about the same due payment mint ONE receipt.
  **Estimated reminders mint nothing** (critic #206 P2-3): a projection must not enter the
  permanent tally unmarked, and the real statement's different due date would otherwise mint a
  second receipt for the same payment. Undercount-safe; the real statement's reminder is the one
  true receipt.
- radar: `cash_flow_alert:<firstNegativeDate>`; gate identical to the push (`pushWorthy` +
  a projected-negative date), so a receipt exists iff an alert could.
- price: `price_increase:<merchant>:<fromCents>><toCents>` — keyed on the PRICE TRANSITION
  (Netflix ⇒ `price_increase:Netflix:1549>1799`), NOT the detection date, because
  detectRecurring's change date is a detection artifact that can shift under re-import churn and
  a shifted date must not re-mint the same increase (critic #206 P2-2). A genuinely new hike —
  even with the same +$2.50 delta (1799>2049) — keys distinctly. `occurredOn` is the change date
  (the business date of the event), not the view date.

### C. Delivery/surfacing-gated minting (locked in the cron tests)
Dormant email/push runs mint NOTHING ("delivered" means delivered); a 410-pruned phantom push
mints nothing; a repeat delivery about the same subject leaves the count unchanged. Price
receipts mint where the flag is actually surfaced: the /coach render, and the digest cron ONLY
after a real send (critic #206 P2-1 — its Money Review creep line names the increase; a dormant
sweep mints nothing). Seed's only price increase is Netflix $15.49→$17.99 ⇒ demo /coach shows
exactly "1 catch … $2.50/mo in total." (e2e-pinned).

## §Glass-Box (DECISIONS #178 — Gap 4 §1, `traceCashNeeded` / `traceSafeToSpend`)

A trace never recomputes a number: it reshapes the engine result's OWN rows and computes their
plain sum, so `reconciles` (sum === headline, integer cents) is a real check with no parallel
derivation that can drift. Pinned in `tests/unit/glass-box.test.ts`; e2e reconciliation in
`tests/e2e/glass-box.spec.ts` parses the RENDERED row amounts off the DOM and sums them.

### G. Cash-Needed rows (today 2026-06-10, PAY_IN_FULL unless noted)
- **G1** Amex $2,100.00 (autopay STATEMENT_BALANCE) + Chase $2,712.33, both due 06-15:
  rows [210000, 271233], sum **481233** = headline (the §A anchor). Amex row carries the
  engine's "Autopay handles this payment" note; Chase has none. Basis empty.
- **G2** same cards, MINIMUM: Amex cash = max(min $35, autopay $2,100) = **210000**;
  Chase = min **3500**; sum **213500** = headline. The autopay-max path reconciles.
- **G3** estimated-only (no statement anywhere; balance $500, next due 06-20): one row,
  `isEstimated`, sum **50000** = headline; basis states the statement-not-generated estimate.
- **G4** real Chase + estimated Store: rows = [Chase 271233] only; the estimated card is
  `upcoming` (next cycle), EXCLUDED from the headline and disclosed in basis — sum **271233**.
- **G5** past-due (due 06-05 → clamped today) and weekend (Sat 06-13 → Fri 06-12) rows carry the
  EFFECTIVE date and still reconcile.
- **G6** no cards ⇒ 0 rows, $0, vacuously reconciled; a fully-paid card ($1,000 statement,
  $1,000 applied) contributes NO row and the rest still reconcile.
- **G7 (fail-loud)** a doctored result (headline +1¢) ⇒ `reconciles=false`, `sumCents` keeps the
  TRUE row sum 481233 — the mismatch is reported, never clamped.

### S. Safe-to-spend rows (signed identity: +income −spent −bills −savings)
- **S1** +500000 −123456 −78900 −50000 = **247644** = `leftToSpendCents` (500000−252356).
- **S2** overspent: +100000 −150000 = **−50000** = headline (negative reconciles).
- **S3** empty month: four $0 rows, 0 = 0. UI signs are by ROLE (income '+', others '−') so a
  $0 row never flips to "+ $0.00".

## §Duplicate-Accounts (DECISIONS #192 — `engine/account/duplicates.ts`)

Cross-provider duplicate detection is advisory. A pair is flagged only when the two accounts
are **different providers** (neither `demo`), **same `type`**, **same `currency`** (null = USD),
AND at least one signal fires. Confidence = `high` if last-4 or non-zero balance matches, else
`medium` (shared name token only). Hand-verified cases (mirrored in
`tests/unit/account-duplicates.test.ts`):

| A (provider, name, type, mask, bal¢, cur) | B (provider, name, type, mask, bal¢, cur) | Flagged? | Confidence | Reason |
|---|---|---|---|---|
| plaid, "Chase Total Checking", CHECKING, 1234, 50000, USD | simplefin, "CHASE Checking", CHECKING, —, 48000, USD | yes | medium | shared name: “chase” |
| plaid, "Savings", SAVINGS, 2222, 21000, USD | simplefin, "My Savings", SAVINGS, —, 21000, USD | yes | high | identical balance |
| plaid, "Chase", CHECKING, 1234, 50000, USD | manual, "Chase Bank", CHECKING, 1234, 30000, USD | yes | high | same last-4 (1234) · shared name |
| plaid, "Checking Account", CHECKING, —, 0, USD | simplefin, "My Bank", CHECKING, —, 0, USD | no | — | zero balance + no shared distinctive token |
| plaid, "Chase", CHECKING, —, 5000, USD | simplefin, "Chase", CREDIT, —, 5000, USD | no | — | different `type` |
| plaid, "Chase", CHECKING, —, 5000, USD | simplefin, "Chase", CHECKING, —, 5000, EUR | no | — | different `currency` |
| plaid, "Chase", CHECKING, 1234, 5000, USD | plaid, "Chase", CHECKING, 1234, 5000, USD | no | — | same provider (ingest already dedups) |
| demo, "Plaid Checking", CHECKING, 0000, 11000, USD | simplefin, "Plaid Checking", CHECKING, —, 11000, USD | no | — | `demo`/seed rows never compared (golden-safe) |

Name tokens: lowercased, non-alphanumeric split, then stopwords (bank/checking/savings/account/
credit/card/the/my/…), pure numbers, and 1-char tokens dropped. So "My Savings Account" and
"SimpleFIN Demo SimpleFIN Savings" both yield **no** distinctive tokens.

## §Household Joint Cash-Needed (DECISIONS #215 — TASKS 4.2 slice 4, `mergeSnapshots`)

`mergeSnapshots(today, mine, partners[])` unions the viewer's own cash-needed inputs with 0+
live partners' shared-account slices (`getSharedSnapshotSlice`), mirrored in
`tests/unit/household-cash-needed.test.ts`.

- **Two-partner union:** viewer has 1 card (id `mine-1`); partner A shares 1 card (`p1-1`);
  partner B shares 2 accounts (`p2-1`, `p2-2`). **Expected:** merged `accounts` =
  `[mine-1, p1-1, p2-1, p2-2]` — mine first, then each partner in call order, nothing dropped,
  nothing duplicated.
- **Overlap-impossible-by-construction proof:** an account row has exactly one `userId`, so
  the viewer's own slice and a live partner's `sharedToHousehold` slice can only overlap if
  something upstream is broken (a share-flag/authz defect leaking the SAME account id into
  both). `mergeSnapshots` does not assume this is impossible — it asserts it: the same account
  id appearing in `mine` and a partner slice, or in two different partner slices, **throws**
  rather than silently double-counting a balance. Locked: `tests/unit/household-cash-needed.test.ts`
  "T9: the SAME account id in both the viewer slice and a partner slice fails loudly" +
  the two-different-partners variant.
- **Drift guard:** a partner slice tagged with a `today` different from the viewer's throws
  rather than merging across business days. Nearly vacuous today (one server clock drives
  every `businessToday`), honest scaffolding for future per-user timezones.
- **#192 dedup-guard interaction:** a shared account seen via a partner must NOT trip the
  cross-provider duplicate-account detector for the OWNER's own `/accounts` view — the
  detector's input stays the viewer's OWNED set (`getAccountsView`), a separate query path
  never touched by the household merge. Locked in both `tests/unit/household-sharing.test.ts`
  (T9 original) and `tests/unit/household-cash-needed.test.ts` ("T9: household cash-needed
  merge does not perturb the #192 duplicate detector").
- **Funding-account regression (hostile-critic P0, fixed same session):** the payment account
  that funds the household answer must always be the VIEWER'S OWN, resolved from their
  pre-merge snapshot — `resolvePaymentAccount`'s CHECKING/first-account fallback must never be
  allowed to search the merged (mine + partners') accounts array, or a viewer with no checking
  account of their own could have the answer silently funded from a partner's shared checking.
  Hand case: owner owns only a CREDIT card (no CHECKING, no stored `paymentAccountId`); partner
  shares a CHECKING account with a $99,999.99 balance. **Expected:** `input.paymentAccount.name`
  = the owner's own card name (their only account), never the partner's checking, and
  `balanceCents` = the owner's own $150.00, never the partner's $99,999.99. Fail-old proven by
  temporarily removing the explicit override — the leak reproduced deterministically.

## §Household Digest Movement (DECISIONS #220 — TASKS 4.2 slice 7, `summarizeSharedMovement`)

`summarizeSharedMovement({ rows, accountCount, since, today })` tallies the household's
SHARED-account activity for the joint digest. Pure; mirrored in
`tests/unit/household-digest.test.ts`. Window is INCLUSIVE at both ends; the cron passes
`since = today - 6` so the window is exactly 7 calendar days ending today.

- **Window boundaries (inclusive):** `since` = 2026-06-04, `today` = 2026-06-10. Rows on
  2026-06-04 (−$10.00), 2026-06-07 (−$240.55) and 2026-06-10 (+$500.00). **Expected:**
  `transactionCount` = 3, `outflowCents` = 25055, `inflowCents` = 50000. Both boundary dates
  count; 2026-06-03 and 2026-06-11 do not.
- **Exclusion set (the same one every other money surface uses — `coach.ts`, `radar.ts`,
  `engine/transactions/query.ts`):** in-window rows of −$800.00 `isTransfer`, −$700.00
  `isSplitParent`, −$600.00 `status: 'PENDING'`, and one real −$25.00 spend. **Expected:**
  `transactionCount` = 1, `outflowCents` = 2500, `inflowCents` = 0. A transfer is neither
  spend nor income; a split PARENT is a container whose children carry the money (counting
  both double-counts); PENDING is not money that has moved and its amount can still change.
- **Empty week:** no rows, `accountCount` = 0. **Expected:** every figure 0, never undefined
  (the digest then renders the "nothing shared" or "no movement" copy, never "$NaN").
- **Sign convention:** `amountCents` is outflow-negative / inflow-positive (schema line 249),
  and `outflowCents` is reported POSITIVE-signed, so `$1,240.55 out` reads as a magnitude.

Account-set fixtures (server read, `getHouseholdDigestContext`, same test file): household of
A + B; A shares a checking, B shares a card, B also holds a PRIVATE card and a PRIVATE
checking. **Expected:** `accountCount` = 2 (both shared accounts, never the private ones — T1),
and B's private-account rows are absent from every figure. Both partners' contexts return
IDENTICAL movement figures (the one symmetric section of the joint digest).

Slice-8 additions (critic F-4): B also shares a LOAN (inert for dues). **Expected:**
`sharedAccountCount` = 3 (ALL supported shared accounts, any type — drives the "is anything
shared?" branch) while `movement.accountCount` stays 2 (the SPENDING tally set). A household
sharing ONLY the loan renders `digestNoSpendingShared`, never "no accounts are shared".

## §Household Duplicate Detection (TASKS 4.2 slice 8 — critic F-5 / T9(b), `detectHouseholdDuplicateAccounts`)

Not money arithmetic — set logic over the household's visible accounts (viewer's own +
partners' shared, supported currencies only). Same signals as the personal #192 detector
(same type + same currency prerequisites; last-4 / identical non-zero balance / shared
distinctive name token), with ONE deliberate difference: the same-provider skip applies only
within one owner, because "same-provider ingest already dedups" is true per user and false
across two users (both partners linking the same bank through Plaid is the most likely shape).

- **Joint-account twins:** A owns `plaid` "Chase Joint Checking" mask 1234, balance 512,345¢
  ($5,123.45); B shares `simplefin` "CHASE Joint Checking" mask null, same balance, both
  USD CHECKING. **Expected:** exactly one pair, HIGH (identical non-zero balance), spanning
  both owners.
- **Same-provider cross-owner:** both rows `plaid`, same mask. **Expected:** still one pair
  (the relaxed-skip regression lock). Same owner + same provider: **no pair.**
- **Advisory only, by decision:** the merged figures deliberately still contain BOTH twins
  (locked by a fail-old test) — the heuristic has false positives, and silently dropping a
  REAL account from money math is strictly worse than a disclosed possible double-count.
  Disclosure surfaces: the household scope toggle (dashboard/cards/calendar) and one line in
  the joint digest.

## §Ask Timeframes: bare years, since, ranges, numeric dates (DECISIONS #230 — TASKS 2.7, `parseExplicitTimeframe`)

All hand-verified with `today = 2026-07-14` (so the current year is 2026 and the
current month is July). Windows are inclusive month-key ranges `[fromYm, toYm]`.

| Input | Window | Label | Why |
|---|---|---|---|
| "in 2025" | 2025-01 … 2025-12 | `in 2025` | a past year is that whole calendar year |
| "in 2026" | 2026-01 … 2026-07 | `2026 so far` | the current year runs through today (the YTD window) |
| "in 2027" | — (abstain) | — | a FUTURE year is not a window; a past-tense figure under it answers a different question |
| "since 2024" | 2024-01 … 2026-07 | `since 2024` | "since" runs through today |
| "since march" | 2026-03 … 2026-07 | `since March 2026` | most recent past occurrence (March ≤ July) |
| "since september" | 2025-09 … 2026-07 | `since September 2025` | September > July → last year's |
| "since last month" | 2026-06 … 2026-07 | `since last month` | spans both months (the bare "last month" rule alone claimed June only) |
| "since last year" | 2025-01 … 2026-07 | `since last year` | last January through today (critic F5) |
| "between 2024 and 2025" | 2024-01 … 2025-12 | `in 2024–2025` | both years, whole span |
| "from 2024 to 2026" | 2024-01 … 2026-07 | `since 2024` | a range ending in the CURRENT year IS "since lo" — labeled so, so frame staleness re-labeling covers it (critic F8) |
| "between 2024 and 2027" | — (abstain) | — | a future endpoint poisons the whole set; never half-answer 2024 |
| "on 3/5" | 2026-03 … 2026-03 | `March 2026` | US M/D → the containing MONTH window (the shipped worded "on March 5" rule); March ≤ July → this year |
| "on 12/25" | 2025-12 … 2025-12 | `December 2025` | December > July → last year's |
| "in 3/2025" / "on 3/5/2025" | 2025-03 … 2025-03 | `March 2025` | explicit year |
| "on 13/5" / "on 3/45" / "on 2/30" / "on 3/5/26" | — (abstain) | — | invalid month (we never guess DD/MM), invalid day, two-digit year |
| "in march 2027" / "since march 2027" | — (abstain) | — | an explicitly-dated FUTURE month resolves nothing (critic F3) |
| "in fy2025" / "the 2025/26 season" | — (abstain) | — | date SHAPES no rule windows; must abstain, never the this-month default (critic F6) |

**The date-shape guard (`unresolvedDateShape`):** a question containing one of
these shapes that `parseExplicitTimeframe` could NOT window abstains every
timeframe-carrying route (spend family, income, largest, `intentFromKind`, the
conversation frame) instead of falling back to the silent this-month default.
Pre-2.7, "groceries in 2025" answered the unhedged THIS-MONTH Groceries figure
and "since 2024" the this-month total.

**The licence stays in lock-step:** `unconsumedSpendObject` consumes exactly the
tokens the parser can window ("in 2025" ✓, "on 3/5" ✓, "2024-2025" ✓) and never
the ones it can't ("in 2027" ✗, "on 13/5" ✗) — same recognizer functions, so the
guard reads what the parser reads.

## §Ask Largest-Purchases Merchant Scope (DECISIONS #230 — TASKS 2.7, `largestScope` / `largestPurchases`)

| Input | Result | Why |
|---|---|---|
| "biggest purchase at costco" | largest scoped to merchant `costco` | at/with/from after the noun is the merchant construction; same `merchantMatches` semantics as merchant_spend |
| "biggest purchase from costco" | scoped to `costco` | "from" joined the anchor (critic F2) |
| "biggest purchase at the moment" | GLOBAL ranking | a licensed idiom is not a store (critic F1; was "No purchases at Moment") |
| "biggest purchase at the end of last month" | GLOBAL, window last month | idiom falls through; the timeframe rule reads the window |
| "biggest purchase at least $100" | abstain | a threshold we cannot represent — never merchant "least 100", never the unfiltered global answer |
| "at best buy" (largest or spend) | merchant `best buy` | a head word from idiom vocabulary + a real word is a store, not an idiom |
| "At Costco, what was my biggest purchase?" | abstain | fronted objects never anchor (mirrors the spend family) |
| "biggest purchase with amex" / "with my credit card" | abstain | #168 — payment methods are not merchants |
| "biggest purchase at 星巴克" / "at 🍕" | abstain | unreadable names abstain everywhere |
| "biggest grocery purchase" | abstain | a category-scoped ranking no engine computes |
| "biggest costco/walmart/bank purchase" | abstain | an attributive scope we cannot resolve (critic F2; was the GLOBAL ranking, unhedged) |
| "my single biggest purchase" | GLOBAL | benign intensifiers keep the global answer |
| "biggest charges last month" | GLOBAL, last month | "charges" is the fees synonym's word but sits in NOUN position — never category-abstained |
| "the most expensive thing i bought" | GLOBAL | an intervening largest-noun word means the real noun sat adjacent — no modifier |

Scoped ranking + copy: `largestPurchases(rows, tf, limit, today, meta, merchant?)`
filters by `merchantMatches` before ranking (unscoped call byte-identical);
scoped headline "Your biggest purchase at <top-match canonical> <label> was $X.",
scoped empty "No purchases at <TitleCase query> <label>.". The frame carries the
merchant on window swaps and re-scopes on "what about at X?" (supersedes #223
P2-5, which abstained because no engine computed it).

**Deliberate ambiguity trade (critic cycle 2, N-2):** a bare single idiom word
after at/with reads as the IDIOM, not a store — "how much did I spend at
most/at max/at best" answers the total (before 2.7 every one of them answered a
confident-wrong "No spending at Most…"). A store literally named "Max" or
"Best" loses that phrasing (reachable via "at Max's" / any multi-word form:
head-word + a real word stays a store — "best buy", "top golf", "first watch"
all keep their merchant answers). And account self-reference is a payment
SOURCE, never a store (critic N-1): "from my checking account" abstains; the
cost is "at Bank of America" also abstaining (honest redirect, recorded).

---

## §Nudge feed (AI plan §2.2 — tier-then-rank, hand-verified orderings)

The Smart Notification & Nudge Engine is a pure reshape+order over existing engine
outputs (NUDGE_PLAN.md slice 1). It does ZERO money arithmetic — every cents/date on
a proposal is copied verbatim from its source. Severity is an ORDERING, not a scalar
score. Tier rank: `critical(0) < action(1) < opportunity(2) < handled(3)`. Within a
tier: `sortDate` ascending (undated last), then `centsAtStake` descending, then `key`
ascending. Total and deterministic. `today = 2026-06-10` throughout.

### Tier assignment (each source row → exactly one tier)
- **payment_due:** `userActionCents <= 0` → HANDLED (autopay covers it, never pushed);
  else `daysUntil <= 3` (the notify/select push window) → CRITICAL; else → ACTION.
  A card with autopay=MINIMUM leaving a top-up (`autopayCovered=true` **and**
  `userActionCents > 0`) tiers by daysUntil like any actionable due — `autopayCovered`
  is a display flag, `userActionCents` is the gate (matches the push floor exactly).
- **cash_flow_dip:** emitted only when `radar.pushWorthy && firstNegativeDate != null`
  → always CRITICAL (pushWorthy already encodes the committed-only within-window test).
- **cash_needed_shortfall:** emitted only when `shortfallCents > 0` → CRITICAL.
- **opportunity** (unused-subscription / price-increase / insurance-reshop /
  negotiable-bill): OPPORTUNITY, undated (`sortDate = null`).

### Hand-verified orderings
- **O1 — shortfall vs due-tomorrow (both CRITICAL).** payment_due due 2026-06-11
  ($500 action); cash_needed_shortfall date 2026-06-15 ($1,412.33). Both CRITICAL →
  order by date ascending: **[payment_due (06-11), cash_needed_shortfall (06-15)]**.
  The nearer deadline ranks first even though the shortfall is larger — the tie-break
  is date, then cents, never a blended score.
- **O2 — estimated vs real, same day (both CRITICAL).** Amex real $1,800 due
  2026-06-12; Chase **estimated** $2,000 due 2026-06-12. Same date → `centsAtStake`
  descending: **[Chase ($2,000, estimated), Amex ($1,800, real)]**. Ordering is
  estimate-agnostic — the larger stake wins; `isEstimated` is a display flag only
  (the push floor likewise never reorders by estimate).
- **O3 — price-increase vs unused-subscription (both OPPORTUNITY, undated).**
  price-increase Netflix $24.99; unused-subscription GymPass $40.00. Both undated →
  `centsAtStake` descending: **[unused-subscription ($40.00), price-increase ($24.99)]**.
- **Full tier order.** critical due (06-12, $500) + action due (06-30, $300) + unused-sub
  ($40) + handled autopay (06-11, $900) → **[critical, action, opportunity, handled]**.
  The handled autopay sorts LAST despite its earliest date — HANDLED is never the
  headline and never above a user-action proposal (autopay silence).

### Dismissal honesty
- CRITICAL dismissKey = `<key>:<today>` (per-day): dismissing collapses it for today
  only; on the next build the per-day key no longer matches, so it returns un-dismissed
  while the condition persists. It is NEVER suppressed from the feed regardless of
  dismissal state — a material warning is never buried.
- ACTION/OPPORTUNITY dismissKey = `<key>` (per-fact): stays suppressed until the
  underlying fact changes. A price-increase key embeds the `from→to` transition, so a
  NEW price change mints a new key and the opportunity returns despite the old dismissal.

### Push lockstep (the load-bearing safety invariant)
Every `selectNotifications` candidate has a feed proposal with the SAME key, tiered
CRITICAL. payment_due reuses `paymentNotificationKey`, cash_flow_dip reuses
`radarNotificationKey` — keys are reused from notify/select, not re-minted, and the
CRITICAL window is the shared `NOTIFY_DUE_WINDOW_DAYS` constant. A feed that buries a
push candidate, or a push the feed can't resolve, fails the lockstep test in both drifts.

### Slice-2 display copy — `centsAtStake` means a DIFFERENT thing per kind
The feed engine copies `centsAtStake` verbatim, but its SEMANTIC is not uniform, so the
`TodayFeedCard` copy (today-feed-copy.ts) labels each kind correctly — copying a value is
not copying its meaning (critic cycle-1 P1-1):
- **payment_due:** `userActionCents` — the amount to pay AFTER autopay, NOT the statement
  total. When autopay covers part, the card shows the split "$500 to pay · (autopay covers
  $100)" from the verbatim `Proposal.autopayCents` — the two parts are shown, never summed,
  so it agrees with the reminders card and never presents the remainder as the total.
- **cash_flow_dip:** `coverTransfer.amountCents` — the recommended cover transfer.
- **cash_needed_shortfall:** `shortfallCents` — the projected dip. `isEstimated` is derived
  `perDueDate.some(cards estimated)` (the engine makes the cycle homogeneous), disclosed
  INLINE "(estimated)".
- **price-increase:** the monthly INCREASE (delta) — "Up $X/mo", never "Now $X".
- **unused-subscription:** the actual monthly cost.
- **insurance-reshop / negotiable-bill:** an ESTIMATED monthly SAVING (~15% / flat $20),
  labeled "could save around $X/mo (estimated)".
Titles are obligation-neutral ("Payment due" covers cards AND loans — the proposal drops
the discriminant), and no copy addresses the reader as the payer (a partner's row can flow
in at household scope — the #221 lesson).

### Slice-2 dismissal store + demo fence
Nudge dismissals persist to a DEDICATED `NudgeDismissal` store (keys embed merchant+cents,
so EngagementEvent's closed-set no-money contract can't hold them — #236 P1-1), read into
`NudgeInput.dismissedKeys` and fed ONLY to `buildNudgeFeed` (never `selectPaymentReminders`
— the push-but-absent-from-feed bury failure). The shared demo user never WRITES and never
READS the store (double fence, independently tested) — dismissal is session-only for
`user-demo`, so one visitor's "hide this" never leaks to the next. The write path is
rate-limited (40/60s/user), key-length-capped (≤200), and read-bounded (newest 500;
re-dismiss bumps recency). CRITICAL is exempt from all suppression regardless of the store.

## §Why-This-Category provenance (AI plan §3.1 — `describeProvenance`, hand-verified)

The pure resolver maps stored facts to a display verdict. The one path to `ai-guess` is a
persisted `source === 'llm'` on a row whose current category still matches the prediction and
that the user has not labeled — origin is NEVER inferred from confidence or category. Branch
order matters; this table is the resolver's spec (`categorize-provenance.test.ts` sweeps it).

| userLabeled | hasRow | source | txnConf | predicted===current | → kind | needsConfirm |
|---|---|---|---|---|---|---|
| true | any | any | any | any | user-set | no |
| false | false | — | 10000 | — | user-set | no |
| false | false | — | <10000 | — | not-recorded | no |
| false | true | null | any | — | not-recorded | no |
| false | true | (set) | any | **false** | not-recorded | no |
| false | true | llm | any | true | ai-guess | **yes** |
| false | true | user-rule | any | true | your-rule | no |
| false | true | merchant-default | any | true | merchant-default | no |
| false | true | provider-category | any | true | provider | no |
| false | true | transfer | any | true | transfer | no |
| false | true | fallback | any | true | uncategorized | no |

Load-bearing invariants (each a critic fix):
- **10000 is reserved for user-dictated.** An LLM pick at confidence 1.0 would round to 10000
  (`parseLlmCategory`), collide with the "you set this" sentinel, get dropped by the `<10000`
  prediction-log filter, and render as a HUMAN fact. Fix: `parseLlmCategory` caps at 9900
  (RULE_CONFIDENCE_BPS) — the model's most confident guess stays logged, auto-filed, and
  labeled `llm`. (Critic P0-1.)
- **The prediction is the FIRST verdict; the current category can move** (backfill LLM re-file,
  sync verdict refresh, household-partner correction at 9900 without `labeledAt`). When
  predicted ≠ current, the stored source is stale → `not-recorded`, never a false origin.
  (Critic P1-3.)
- **CSV import correlates provenance by pre-assigned id**, not `createManyAndReturn` row order
  (SQLite/Prisma give no ordering contract). (Critic P1-2.)

Accepted / deferred (each honest — never a false origin, never a wrong $):
- **User corrections on pre-#190 rows** (no prediction row, confidence 9900) read
  `not-recorded`, not `user-set` — a false NEGATIVE (honest direction). Slice 2 can enrich via
  a `Correction` join; the `labeledAt` path already covers post-#190 owner corrections. (P2-4.)
- **Manual-entry LLM path** (`createTransaction`) calls `pickAssistedCategory` directly, missing
  the transfer/income-sign guards the batch overlay enforces (#163/#165). Pre-existing; the
  `source='llm'` stamp is honest. Tracked for a separate fix. (P2-5.)
- **No Postgres migration artifact** for the additive `source` column — repo convention is
  `db push` (frozen `_init`), same as the #237 `NudgeDismissal` addition. (P2-7.)
- **Backfill LLM re-files read `not-recorded`, not `ai-guess`.** `runBackfillForUser` knows the
  new `source:'llm'` but writes only the Transaction (never the create-only prediction row), so
  a backfilled LLM re-file drifts predicted≠current → the guard returns `not-recorded`. Honest
  direction (never a false origin; inferring `llm` from drift is the forbidden fabrication) but
  the same "source computed then discarded" class this slice fixes at ingest. A future slice can
  log/stamp when the FIRST verdict was an abstention (`predicted==='uncategorized'` — a non-claim
  safe to update). (Cycle-2 critic P2-1.)
- **A partner re-confirming the SAME category doesn't quiet the badge.**
  `recategorizeSharedTransaction` sets category+9900 without `labeledAt`; when it re-confirms the
  already-predicted category, predicted===current so the guard doesn't fire and an `ai-guess`
  keeps asking for an OK. Honest direction (over-asks, never under-asks); slice-2 copy note.
  (Cycle-2 critic P2-2.)

### Slice 2 — the register surface + the demo AI-guess fixture (#239)

The register renders one provenance badge per row (the resolver's own label, verbatim) and, for
the single `ai-guess` kind, a one-tap **Confirm**. Behaviors worth pinning:
- **Badge == verdict, always.** The badge label is `describeProvenance(...).label` copied
  verbatim by `provenanceBadgeView`; tone (attention vs muted) and the confirm control are a
  function of `needsConfirm` alone. There is no display-only re-derivation, so a row can never
  show an origin that disagrees with the resolver. The e2e asserts the rendered kind on real demo
  rows; the render unit test pins label + tone + confirm per kind.
- **Confirm files the CURRENT category.** For an `ai-guess` the current category equals the
  predicted one by construction (the resolver returns `ai-guess` only when predicted===current),
  so `confirmGuess` files `t.categoryId` through `recategorize({scope:'one'})` — a same-category
  Correction that stamps `labeledAt`, flipping the row to `user-set` on reload. No rule is minted
  (confirming one charge is not "always for this merchant"). This same-value Correction is
  identical to re-picking the current category on the register today (accepted, Fable P2-2).
- **No fabricated confidence.** No badge renders a percentage or any digit — only the qualitative
  band copy from `LABELS` (swept by the render test over every kind × confidence).
- **Demo AI-guess fixture is an AMBIGUOUS merchant, never a name brand.** The demo has no
  auto-filed unknown-merchant row (every real-category row is a known merchant → merchant-default,
  which beats the LLM overlay), so an `ai-guess` badge on a known brand would fabricate an
  impossible origin (Fable P2-1). The seed instead PROMOTES one uncategorized, unknown-merchant
  review row to an llm-resolved row (real category, source 'llm', auto-filed) — the authentic
  overlay path. The seed-contract test pins: exactly one demo `ai-guess`, unlabeled,
  predicted===current, on a merchant with no real default (null or 'uncategorized'). Moving that
  one row out of uncategorized/review is the slice's only deliberate golden change and broke no
  money/accuracy/e2e golden.
- **Register-only scope.** `ai-guess` rows are auto-filed (LLM overlay files ≥ `AUTO_SILENT_BPS`),
  so they surface in the register, not the triage review queue; triage suggestions derive from the
  LIVE pipeline (a different provenance path than the persisted prediction). Provenance is not
  threaded into the partner `SharedTxnRow` — "You set this"/"Your rule" must never render on
  someone else's data (the #221 second-person-copy fence). A triage provenance badge is a noted
  follow-up, not this slice.

## §Balance-Move Explainer (AI plan §2.3 — `explainBalanceMove` / `validateTemplate` / `validateSentence`, DECISIONS #240)

A grounded one-liner over the tested trends movers. The LLM never authors a number: it returns a
TEMPLATE of ATOMIC placeholders ({primary}/{second} each substitute "Label, up $X (+Y%)" — a label
fused to its own figure) joined by purely ADDITIVE connectives; the engine substitutes. Reshaping is
hand-verified; the safety rails are what four fresh-context Fable critic cycles hardened.

### Reshaping (hand-verified, `balance-move.test.ts`)
Mover Dining current 84000 / baseline 60000 / delta +24000 / pct 0.4, direction up →
`formattedAbs "$240.00"`, `formattedSigned "+$240.00"`, `formattedPct "+40%"`, `deltaPhrase "up
$240.00"`, atomic `phrase "Dining, up $240.00 (+40%)"`. Gas delta −6000 / pct −0.2 →
`phrase "Gas, down $60.00 (-20%)"`. New factor (baseline 0) → no pct, `phrase "Travel, new at
$500.00"`. `primaryDriverId === movers[0].categoryId` ALWAYS (never a model choice). Pct is omitted
at the ±0 rounding edge (no "+0%"/negative-zero). Comparison window stated inline from the baseline
count: 3 months → "your 3-month average".

### The template grammar (`validateTemplate` — the model's only degrees of freedom)
Placeholders MUST appear in the exact order `{primary}` → optional `{second}` → `{window}` (window
required, last, no duplicates/reorder). Non-placeholder words must be in the purely-additive
`ALLOWED_CONNECTIVES`; a literal digit/$/% in the template is rejected. Rejections (each locked):

| template | reason | closes |
|---|---|---|
| `{second}, and {primary}, {window}.` | missing-primary | figure-swap-by-reorder (critic P0-1) |
| `{primary} {window} and {second}.` | placeholder-order | reorder / window-not-last |
| `{primary} and {primary} {window}.` | missing-window | duplicate placeholder |
| `The change was {primary}, with {second}.` | missing-window | window must be disclosed |
| `spending shifted from {primary} to {second} {window}.` | non-connective:shifted | false inter-category FLOW (critic P1-1) |
| `{primary} compared to {second} {window}.` | non-connective:compared | false comparison basis |
| `{primary} up $240.00 {window}.` | literal-number | model may not type a figure |
| `the new {primary} {window}.` | non-connective:new | ranking claim word |

### The final scan (`validateSentence` — runs on the substituted sentence AND the deterministic fallback)
Category labels are USER FREE TEXT, so the deterministic fallback is scanned too; on failure the
surface is SUPPRESSED (empty sentence, the movers list still carries the figures). Rejections:

| rendered sentence | reason | closes |
|---|---|---|
| `Dining moved up 240.00 vs your average.` | stray-number | bare numeral w/o $ (critic P0-1) |
| `Dining is up $240.00 compared with your 12-month average.` | stray-number | fabricated window |
| `Dining rose two hundred dollars…` / `…forty percent…` | banned:* | word-form numbers |
| `Dining is up ＄999.00…` | non-ascii | full-width/unicode currency |
| `Starbucks pushed Dining up $240.00…` / `…(Netflix)…` | proper-noun:* | invented merchant (pos-0 & parenthesized) |
| `Consider Dining…` / `…again.` / `…because of meals.` | banned:* | advice / habit / causal |
| `Dining rose $240.00 due  to meals.` | banned:due to | double-space phrase evasion |
| label "Because You Overspent" (top mover) | fallback-banned:because | hostile label via fallback (critic P1-3) |
| label "Save $500 Fund" (top mover) | fallback-stray-number | money-lookalike label |

Deliberately NOT suppressed (fail-open on the user's own real labels): a benign custom category
sharing a word with the sentence ("Spare Change" → the word "change"; no foreign-category scan —
the atomic grammar makes model category-injection impossible, critic P1-2), and a benign
digit-bearing finance label ("401k Contributions" — the factor's own label tokens are masked before
the stray-number check, critic P2-1). Demo is deterministic by CONSTRUCTION (never calls the LLM).

## §Monthly Money Review (AI plan §2.4 — `buildReviewCandidates` / `selectReview`, `money-review.test.ts`)

The recap is a CLOSED candidate set: each candidate is `{id, role, priority, material, line}` where
`line` is a verbatim COACH_COPY string with engine cents substituted in code. The optional key-gated
LLM returns ONLY an ordered id list; it cannot author a line, a number, or an id outside the set.
One line per ROLE (improvement / watch / action).

### Deterministic floor (zero-key / demo) — byte-equal to `generateMoneyReview`
Pinned 3-branch matrix (hand-verified in `money-review.test.ts`):
- Rate up (2500→3750 bps) + price-increase + pending transfer 42000c by 2026-06-14 →
  `[improvement-savings-rate, watch-price-increase, action-transfer]`.
- Rate down (3750→1250 bps) + creep flagged (1800 vs 200 bps) + unused sub (Peloton 4400c/mo) →
  `[improvement-runway, watch-creep, action-cancel-sub]` (down month → runway line, no shame).
- Flat rates, nothing flagged → `[improvement-runway, watch-clear, action-automate]`.
- Empty flows → same honest minimal triple; no savings-rate/streak/best candidate is fabricated.

### Selection invariants (`selectReview(candidates, orderedIds)`)
- **Material pin:** `action-transfer` (`material: true`, exists iff a pending cover-transfer) appears
  for EVERY selection input — omitted → appended; truncation to `max` drops non-material lines first
  and never the pin; a non-material action pick is OVERRIDDEN by the material line for that role.
- **Never below the floor:** every role the deterministic floor would show is backfilled — a
  valid-vocabulary reply naming an ABSENT id (`["action-transfer"]` with no pending transfer) or an
  empty array yields exactly the floor, never a shrunken or empty recap.
- **Closed set:** unknown ids and duplicates are dropped (`parseReviewOrder` + presence filter);
  `["totally-made-up", "improvement-runway", "improvement-runway", "watch-clear"]` →
  `[improvement-runway, watch-clear, action-automate]`.

### Candidate emission honesty
- `improvement-streak` needs ≥2 trailing months with strictly positive rates; a positive-but-lower
  month keeps the streak (37.5%→12.5% = streak 2), a negative month breaks it.
- `improvement-personal-best` needs the last rate to be the strict max AND ≥1 PRIOR month with a
  non-null rate (all-null priors → no "best" — a single measurable month is not an achievement).
- Streak/personal-best live in the LLM pool only — the deterministic floor never shows them, so the
  zero-key recap is unchanged from pre-§2.4.
- The "Personalized" badge renders only when the LLM selection's lines DIFFER from the floor's
  (reorder counts; identical output → no badge), and only the /coach path
  (`getCoachData(userId, {orderReview: true})`) ever makes the model call — dashboard, goals,
  investments, assistant, and the digest cron always get the floor with no egress.

## §AI Trust Center audit trail (AI plan §3.2 — `parseAiAuditRow` / `describeAiEntry`, DECISIONS #242)

Pure formatter over persisted `ai.<touchpoint>.<outcome>` AuditLog rows
(`src/lib/engine/ai-audit/describe.ts`; tests `ai-audit-describe.test.ts`,
`ai-audit-sink.test.ts`, `ai-audit-recorder.test.ts`).

### Sink contract (all four `*ViaLLM` modules)
- Exactly ONE sink call per ATTEMPTED provider call; no key → no call → NO sink report (a trail
  row must mean a model was actually consulted).
- Outcomes: `replied` (passed the closed-set validator), `rejected` (validator discarded the
  reply — the guardrail firing IS the trust signal), `unavailable` (non-OK status / network
  throw / 7s timeout abort / malformed body).
- Meta is closed-set only: categorize `{categoryId, confidenceBps}` (both pinned by
  `parseLlmCategory`), intent `{kind}` (pinned to `LLM_ROUTABLE_KINDS`), review_order `{count}`,
  move_draft `{}` — the draft is only SHAPE-checked at that point, so its strings are still
  model-authored text and must never persist.
- A THROWING sink never changes the returned value (fire-walled both inside the module and inside
  `aiAuditSink`); recording is subordinate to answering.
- `orderReviewViaLLM([])` and an untriggered balance-move make NO call and NO report.

### Recorder / demo fence
- `aiAuditSink(DEMO_USER_ID, …)` writes NOTHING — the shared demo row records no trail, and the
  seed plants none, so the demo Trust Center ledger is honestly empty by construction.
- A DB fault in the recorder is swallowed (the user's action still completes unrecorded).

### Formatter honesty (hand-verified)
- `parseAiAuditRow` returns null for any non-`ai.*` action, unknown touchpoint/outcome
  (`ai.telepathy.replied`), wrong segment count, or a non-timestamp createdAt — unknown rows are
  DROPPED, never guessed at.
- Malformed meta JSON → empty meta → generic line; non-closed-set meta values are dropped
  field-by-field (categoryId 42, confidenceBps "high", count −3 → all gone).
- Confidence renders as whole % clamped to [0,100]: 7250 bps → 73%, 99999 → 100%, −5 → 0%.
- An unknown categoryId in meta renders "a category", never the raw id string.
- Every touchpoint × outcome is a total function (a non-empty line, no throw).
