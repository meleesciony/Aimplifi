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
- B3 (**detected** payment — the production case; C.6 / DECISIONS #401): no stored
  `CardPayment` row exists, because nothing writes one. Statement $9,250.93 closed
  07-11; a $9,250.93 card credit on 08-05 pairs with a $9,250.93 Schwab checking
  debit on 08-06. **Expected remaining due = $0.00**, and the card leaves the
  headline entirely rather than being replaced by a next-cycle estimate (B5).
- B4 (**abstention**): the same $9,250.93 card credit with NO visible payer leg — or
  a payer leg on another card, an investment account, or an account the app was not
  told about — is refused. **Expected remaining due = $9,250.93**, demanded in full.
  Over-demanding costs an unnecessary transfer; under-demanding costs a missed
  payment.
- B5 (**settled ≠ never billed**): once B3 settles the only statement, the card has
  no current obligation but HAS been billed. **Expected: headline $0.00**, and the
  $10,700.25 current balance appears only as next cycle's estimate — never as this
  cycle's amount due.
- B6 (**disjoint sentences**): a $4,000.00 detected payment beside a genuine $620.73
  post-close refund on one card. **Expected remaining due = $5,250.93** — the
  payment is subtracted and named "already paid this cycle", the refund is NOT
  subtracted and is named as reducing the next statement. Neither figure appears in
  the other's sentence.

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

## §Upcoming renewals (AI plan §3.4, DECISIONS #246)

Engine: `src/lib/engine/recurring/renewals.ts`; tests:
`tests/unit/recurring-renewals.test.ts`. Pure forward expansion of ACTIVE expense series
from `nextExpectedAt` by cadence (detect.ts's own `nextDate` — one source of cadence
arithmetic) over a 90-day inclusive window, with nested 7/30/90-day buckets. All values
below hand-verified with `today = 2026-07-10` (window end **2026-10-08**: Jul 21
remaining + Aug 31 + Sep 30 + Oct 8 = 90).

- **Predicted amount = |lastAmountCents| verbatim** — the most recent real charge; after
  a two-plateau price change that is the NEW price (Netflix seed: every occurrence
  predicts $17.99, never $15.49) and the occurrence carries `increasedFromCents` (the
  magnitude it rose FROM, via `priceChangeBadge`; null when no increase) so the UI says
  "↑ was $15.49" — a fact the detector records, never a time adverb it doesn't (critic
  P2-1). The engine never computes an amount; the UI labels the whole section
  "estimates, not bills".
- **Monthly** from 07-28: `[07-28, 08-28, 09-28]`, daysOut `[18, 49, 80]`.
- **Weekly** $5.00 from 07-12: 13 occurrences (07-12 … 10-04; next 10-11 is out);
  7d bucket 1 × $5.00; 30d bucket 5 (07-12/19/26, 08-02, 08-09 — boundary inclusive).
- **Biweekly** from 07-15: 7 occurrences (07-15 … 10-07; next 10-21 = daysOut 103 out).
- **Month-end stepping clamps** exactly like detection: 07-31 → 08-31 → 09-30 (and the
  next step is 10-30 — the clamp drift is the shared `nextDate` rule, unchanged).
- **Boundaries:** an occurrence expected TODAY counts (daysOut 0, 7d bucket); exactly
  today+90 (10-08, daysOut 90) is IN; 10-09 is out. A stale `nextExpectedAt` before
  today re-advances by cadence — a past date is never emitted.
- **Included:** active expense series only — subscriptions AND bills (auto-loan, rent);
  ANNUAL only when genuinely detected (detection's ≥3-occurrence gate ⇒ ~3 years of
  history, satisfying the plan's ≥2yr caveat by construction). **Excluded:** income
  (payroll is not a renewal), inactive/lapsed series, and IRREGULAR input (detection
  never emits one, but the exported engine skips it explicitly rather than inventing a
  monthly schedule — critic P2-2, locked).
- **One bucket predicate:** `renewalsWithin` computes the horizon tiles AND the UI's
  next-30-days list, so the 30d tile count equals the rendered rows by construction
  (critic P2-3).
- **Horizon buckets nest** (7d ⊆ 30d ⊆ 90d, counts and totals monotone); combined
  fixture: 7d = 1/$5.00; 30d = 6/$42.99 (5×$5.00 + $17.99); 90d = 17/$217.97
  (13×$5.00 + 3×$17.99 + $99.00 annual).

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

## §Reconciliation Candidates (TASKS 4.6 slice 1 — `detectReconciliationCandidates`, R3)

The pure directional layer over the #192 detector: it turns a suspected duplicate pair into a
predecessor→successor *candidate* using each row's live-connection state. Advisory only — this
slice mutates nothing (schema, assembler boundary, and UI are slices 2–5).

**Direction rule (R3, spec §8).** A candidate exists only when **exactly one** side has a live
provider connection: that side is the `successor` (its live balance will continue the account),
the other the `predecessor` (goes historical). Both ambiguous cases yield **no** candidate:

- Both sides LIVE → a genuine active duplicate; never auto-linked. `detectReconciliationCandidates`
  returns `[]` while `detectDuplicateAccounts` still returns the pair (the advisory warning stays).
- Both sides DEAD → no live row to continue into → `[]` (advisory still fires).

**Payload.** `matchSignal` ∈ {`mask`,`balance`,`name`} is the strongest #192 signal that fired
(priority mask > balance > name), derived from the same booleans that build `reasons` — never
re-parsed. The canonical Plaid↔SimpleFIN pair matches on **name** (medium), because SimpleFIN
carries no last-4; a mask candidate needs both sides to carry an equal last-4 (e.g. plaid+manual).

**Liveness is an INPUT.** The engine stays pure; the caller (slices 2/5) derives `hasLiveConnection`
from the connection rows (`SimpleFinConnection`/`PlaidItem` presence). A never-synced **manual** row
is not live and is therefore predecessor-eligible against a live Plaid row for the same account.
Direction is decided by liveness, **not** input array order (regression-locked). Demo/seed rows are
excluded upstream (#192 `EXCLUDED_PROVIDERS`) and are never proposed.

## §Reconciliation confirm/undo contract (TASKS 4.6 slice 2 — `server/reconciliation.ts`, R7/R9/R10)

The link-table mutation. No money figure changes here (the balance-exclusion + date-split is the
assembler, slice 3); this slice records the user's confirmed decision and locks the ACTION contract.

**Direction re-checked at confirm time (R3 boundary).** The detector proposes a direction, but the
confirm action re-derives liveness inside the transaction and refuses any direction that isn't
predecessor=stale / successor=live: `!isAccountLive(successor)` → "nothing live to reconcile to";
`isAccountLive(predecessor)` (⇒ both live) → "disconnect the old one first". This is the money guard —
zeroing a still-live balance (slice 3) on a wrong direction would fabricate a net worth. `isAccountLive`
is the SAME helper the slice-5 caller feeds the detector (one derivation, cannot disagree).

**Cutover bounds.** `cutoverDate` must be a valid `isoDate`, **≤ today**, and **≥ the predecessor's
first transaction date** (a cutover before the first row would strand pre-cutover history nothing owns).
The half-open ownership split (`predecessor ≤ cutover`, `successor > cutover`) is tested in slice 3.

**Idempotent + reversible (R9).** Confirm is an **upsert on `predecessorAccountId @unique`**: re-confirming
(including after an undo) updates the one row and clears `undoneAt` — same row id, never a duplicate, no
unique crash. Undo sets `undoneAt` (row kept, inert); undoing an already-inert link is a no-op not-found
(`where: undoneAt: null`). Round-trip: confirm → `getActiveReconciliations` has it → undo → empty → re-confirm → active again.

**Authz (R10) + inert-on-delete (R7).** Every account id is re-resolved `where: { id, userId }` inside the
tx (a foreign id is an indistinguishable "Account not found."); undo is scoped `where: { id, userId }`. No
FK to `Account` is declared, so deleting an underlying account leaves the link row intact — the assembler
ignores the dangling ref (proven in slice 3). The demo user is fenced in the core (defense in depth; demo
rows are never proposed anyway).

## §Reconciliation boundary (TASKS 4.6 slice 3 — `engine/account/reconcile-boundary.ts`, R1/R2/R7/R8)

The money core: applied ONCE in `getFinanceSnapshot` (after the currency guard), so every
downstream engine inherits it. Hand-verified fixture (locked in `tests/unit/reconcile-boundary.test.ts`
and re-proven through the real assembler in `reconcile-boundary-assembler.test.ts`). Rules as REWORKED
by critic cycle 1 (F1–F4 — the first draft's "successor keeps only date > cutover" dropped real money):

Accounts: PRED (CHECKING, stale SimpleFIN, cur 240 000¢ / avail 239 000¢), SUCC (CHECKING, live Plaid,
cur 250 000¢ / avail 251 000¢), OTHER (SAVINGS, 100 000¢). One active link PRED→SUCC, cutover 2026-06-30.

**R1 — transactions: the predecessor is authoritative exactly over its own covered span.** PRED keeps
`date ≤ cutover`; SUCC keeps dates OUTSIDE PRED's claim `[PRED's first txn, min(cutover, PRED's last
txn)]`. Fixture (PRED txns span 06-29…07-01 ⇒ claim [06-29, 06-30]): PRED 06-29 (−1000) kept ·
PRED 06-30 (−2000) **kept — the cutover day belongs to the predecessor** · PRED 07-01 (−3000) dropped ·
SUCC 06-30 (−4000) **dropped — inside the claim** · SUCC 07-01 (−5000) kept. Pair total −8000¢; every
claimed date owned exactly once. **F2:** SUCC's deeper backfill (2024-11-05 −120 000¢, 2026-03-15
−80 000¢ — before PRED's first row) is KEPT — Plaid's 24-month backfill must never be dropped against a
90-day SimpleFIN window. **F4 by construction:** a user-set cutover past PRED's last data claims nothing
extra (claim end = min(cutover, last txn)), so the empty tail can't swallow successor rows.

**Balance snapshots are STOCKS, not flows (F3).** A lone observation is a correct single contribution —
dropped ONLY on an exact-date collision with the linked counterpart, where the cutover picks the winner
(PRED on/before, SUCC after). Collision fixture: both at 06-30 → PRED's 240 000 wins (≤ cutover), SUCC's
241 000 dropped; both at 07-31 → SUCC's 252 000 wins. No-collision fixture (cutover 06-25): PRED's real
observed 06-30 snapshot (account live until disconnect) is KEPT → series point 240 000¢, where the first
draft fabricated a dip to 0 for the pair.

**R2 — single balance.** PRED contributes 0 (currentBalanceCents AND availableBalanceCents zeroed on a
copy; the ROW stays — removing it would orphan its snapshot history and its account-id joins). Net worth
= 0 + 250 000 + 100 000 = **350 000¢** (pre-fix double-count: 590 000¢). **F1 — funding account:** a
stored `paymentAccountId` pointing at PRED remaps to SUCC (chains follow to the terminal live side), and
the snapshot's `supersededAccountIds` makes every FALLBACK tier (`resolvePaymentAccount`, the forecast
anchor — the stale row sorts first by creation order) skip PRED — pre-fix, an undesignated user's
cash-needed anchored on the $0 predecessor and fabricated an 80 000¢ shortfall (executed critic repro).

**Inertness (R7/R8) — a bad link changes NOTHING (today's behavior, never a dropped figure).** Inert:
either side missing from the account list (deleted or currency-withheld), self-link, cross-type link
(would sign-flip series history — also REFUSED at confirm), and a direction cycle including links
leading INTO one (A→B + B→A active would zero BOTH sides; the confirm action also auto-undoes the
reverse link when it re-proves the successor live, while legitimate chains Q→P survive a P→S confirm —
both locked). Zero effective links ⇒ the exact input references — demo/golden byte-identity is
structural. Chain A→B→C: B owns exactly (claim end of A, cutover B→C]. Two predecessors → one
successor: each claims only its own span; dates neither covers stay with the successor.

**Documented residuals (deliberate, no fuzzy matching — §3/§6; slice 6 re-audited the whole list):**
(a) inside the predecessor's covered span, the predecessor is authoritative — a successor row on a
mid-span date a SPARSE (e.g. manual) predecessor never recorded is dropped (pinned test; mitigation:
choose an early cutover); (b) the ≤1-day pending/posted straddle at the boundary (§6) — a purchase the
predecessor dates ON the cutover and the successor dates after counts once on each side; (b′, slice-6
critic A-F3) the MIRROR skew at the claim's LEADING edge: a purchase near the predecessor's first
synced day that the successor dates one day EARLIER lands before the claim and doubles — same ≤1-day
class, same decision (amount-matching's false-positive direction is a silent LOSS, which is worse);
(b″, slice-6 critic A-F2) with a USER-SHORTENED cutover (earlier than the predecessor's last
transaction), backward skew ACROSS the chosen cutover can count a purchase zero times — eliminated at
the DEFAULT (cutover = predecessor's last transaction, per §6, now also the UI default) and disclosed
inline in the confirm card ("dated differently right at the boundary… can briefly appear twice"); (c)
two stale predecessors of the same successor can still overlap EACH OTHER in transactions/snapshots (a
pre-existing duplicate the links cannot express — advisory warning still covers it; their re-keyed
STATEMENTS however are deduped per (terminal, cycleEnd), latest-cutover source wins, order-independent
— slice-6 critic A-F6); (d) racing opposite-direction confirms are now closed at the source (the
confirm transaction runs SERIALIZABLE — one racer aborts with a retryable message) with the read-time
cycle guard kept as defense in depth.

**Slice-6 rewrite of the chain rules (critics A-F1/A-F4/A-F8, B-F4 — old residual (e) was WRONG):**
claims and snapshot collisions now compose TRANSITIVELY: the terminal successor of A→B→C is excluded by
A's claim (its deep backfill re-imported history A already holds — the direct-only rule double-counted
it, executed repro), and an A↔C same-date snapshot collision keeps exactly one copy (the side the elder
cutover makes authoritative). A cutover stored BEFORE the predecessor's first transaction (reachable by
deleting its earliest manual row post-confirm) goes CLAIM-INERT — the predecessor keeps everything
(visible, advisory-covered double at worst) instead of silently erasing its whole history (A-F8). A
non-monotone chain (downstream cutover < upstream — the racing-commit shape confirm refuses) is now
also INERT at read time: the downstream link drops, both its sides count fully, never a double-window
(B-F4).

**Slice-6 surface sweep (critics B-F1/B-F2, C-1…C-14 — the #221 "fix the data class" lesson):** every
remaining Prisma-direct transaction surface now applies the assembler's EXACT R1 rule via ONE shared
closure (`getReconciliationTxnKeep` → engine `reconciliationTxnKeepFilter`, spans from a full-history
min/max aggregate, never the surface's own windowed rows): the /transactions register (rows AND summary
— pre-fix an 80% outflow inflation, executed repro), transactions-CSV export, budgets month spend,
triage queue/groups/badge, and recurring re-detection. /investments filters superseded predecessors
(stale balance + holdings no longer roll into "Portfolio value"). Manual entry and CSV import REFUSE a
superseded predecessor (and hide it from their pickers): a hand-typed row dated after cutover was
dropped from every sum — money entered, nothing moved (B-F2/C-4). The assistant's account-balance
answer folds a matched predecessor onto its terminal successor with an inline disclosure — pre-fix it
answered "$0.00" for a real funded account and counted one account as two (C-5). `getAccountsView`
returns the boundary-REMAPPED paymentAccountId (A-F7), enriches each candidate with the predecessor's
txn span (cutover default = span end, min = span start, honest claim-span disclosure — C-6/C-12/C-13),
never re-offers a predecessor already in an active link (one tap must not silently re-target a
confirmed decision — C-8), and never warns about a pair involving a folded predecessor. The #192
detector now flags two plaid rows from DIFFERENT PlaidItems (same bank re-linked = new item = new
providerRefs; same-item and simplefin-simplefin stay skipped — C-10).

## §Reconciliation cards / scheduled / household (TASKS 4.6 slice 4 — R4/R5 + F6)

Slice 4 extends the ONE boundary (`applyReconciliationBoundary`) with two more row families and adds a
per-obligation-surface skip; the household read paths (separate, Prisma-direct — they never touch the
assembler) each subtract the superseded predecessor. Locked in `tests/unit/reconcile-boundary.test.ts`
(pure) and `tests/unit/reconcile-slice4.test.ts` (real assembler + household surfaces).

**R4 — a reconciled CREDIT card owes the successor's figure only.** Two effects, distinct consumers:
- **Statements are RE-KEYED to the successor** (critic cycle-2 CLAIM2 — the first draft full-dropped them,
  which under-counts): a predecessor statement survives iff its `cycleEnd` is NEWER than every statement
  the successor already has (or the successor has none), re-keyed onto the successor. Dropping them all is
  wrong when the live successor is on the ESTIMATE path (a fresh Plaid reconnect that hasn't generated a
  statement yet): the predecessor's real CURRENT statement would demote to the successor's next-cycle
  estimate, dropping the owed amount out of the cash-needed headline (`cycleObligations = real ? real :
  estimated`) and the 5-day reminder window. Re-keying hands the live successor its real current statement;
  the `cycleEnd` filter drops the stale OVERLAP statements the live successor authoritatively owns (so the
  coach cleared-streak, which reads `snap.statements` join-free, never double-counts an overlap cycle, and a
  stale statement never overrides the live due). cash-needed picks ONE current statement per card, so
  re-keying never doubles a due. Fixtures: (a) SUCC has a newer own statement (cycleEnd 2026-07-20) than PRED
  (2026-06-20) ⇒ PRED's is dropped, headline 60 000¢. (b) SUCC has NO statement + PRED has a $2000 current
  statement ⇒ PRED's re-keys onto SUCC as a REAL obligation ⇒ headline includes it (`requiredCents` 210 000¢
  with a bystard $100 card, `isEstimated` false), where the full-drop draft showed 100 000¢... i.e. dropped
  the $2000. A bystander card's statement is never touched.
- **Cash-needed + the forecast skip the superseded account from BOTH obligation surfaces** (cards AND
  loans), because the boundary zeros the balance but NOT the card config/autopay or a loan's
  `minimumPaymentCents` — so an estimate/autopay-path card or a LOAN would still emit a phantom.
  `cashNeededFromSnapshot` filters `snap.accounts` by `supersededAccountIds` once and feeds the filtered
  set to both `assembleCashNeededInput` and `selectLoanObligations`; `getCashFlowForecast` applies the
  same filter to its own `selectLoanObligations` call. Fixture: reconciled MORTGAGE emits ONE obligation
  (successor, 200 000¢/mo, due day 10), never the zeroed predecessor's 190 000¢/mo. Byte-identical when
  nothing is superseded (same array reference → R8).

**F6 — the predecessor's scheduled rows re-key onto the terminal successor.** After the payment account
remaps predecessor→successor, forecast/radar/cash-needed all pin their scheduled filter to the successor
id, so a row still keyed to the predecessor silently falls out (a dropped income/bill). The boundary
re-keys each predecessor scheduled row to the terminal successor (following chains, like the payment
remap). Reversible: undo clears the link, re-key vanishes, rows count on the predecessor exactly as
before (a write-time re-key could not be undone without storing the original id). Double-count-safe —
re-derived in L.25, which retired the original reason (rows are no longer full-replaced to a SINGLE
payment account; expenses now come from every cash account). It holds instead because detection groups
by MERCHANT, so one merchant yields one series and at most one row, and because `refreshRecurringForUser`
deletes every detected row for the USER (not per account) before rewriting, leaving no stale sibling for a
re-keyed row to collide with; superseded predecessors are additionally excluded from the writer outright. Fixture: a MONTHLY
Paycheck (+500 000¢) keyed to the stale funding account re-keys to the live one; the forecast (anchored
on the successor) projects `totalInflowCents ≥ 500 000` where without the re-key the income vanished.

**R5 — household visibility follows the successor.** A partner's reconciled pair appears ONCE (the
successor) across every household read; the stale predecessor is never separately shared. The household
paths are SEPARATE from the assembler (Prisma-direct), so SIX shared-set sites subtract
`activeSupersededPredecessorIds` (the relevant members'): `getSharedSnapshotSlice`, `getAccountSharingView`,
`getSharedTransactionsView`, `getHouseholdDigestContext`, `getHouseholdDuplicateCandidates`, and the
slice-6 `recategorizeSharedTransaction` WRITE-guard (critic cycle-2 CLAIM5 — a read surface that HIDES a
predecessor's row while the write guard lets a member MUTATE it is a read/write asymmetry). In
`getSharedSnapshotSlice` the exclusion rides the account list and cascades to every child row via
`supportedIds` — one filter; the currency-withhold count stays currency-only (a superseded predecessor is
not "withheld", it's the owner's stale duplicate). **EXACT assembler parity (critic cycle-2 CLAIM7):** the
helper reuses `effectiveReconciliationLinks` on the SAME currency-supported account set the boundary runs
on, so a link the personal view treats as inert — a deleted/currency-withheld side, a cross-type pair, or a
cycle — is NEVER effective here, so the household view can't hide a predecessor the owner still counts. The
first draft only checked successor existence, so a crafted USD→EUR link (confirm had no currency guard —
now added, refusing it at the source) would vanish the partner's real USD account from household while the
owner still saw it. One integration test drives a real reconciled+shared CHECKING pair (both sides
`sharedToHousehold`, same mask 4321) through all six surfaces + a cross-currency-inert case so a missed
site or a parity gap fails loudly (fence-by-construction lesson). The viewer's OWN /accounts toggle list
still shows every owned account — a superseded predecessor on the viewer's PERSONAL surfaces is slice-5's
F5 pass, not this one.

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

### Per-touchpoint track record (`tallyTouchpoints` / `describeTouchpointStats` / `getAiTouchpointCounts`)
All-time COUNT of `ai.*` rows grouped by action (server `groupBy`, ownership-scoped), rolled up
per touchpoint for the "Where AI runs" table — distinct from the ledger's most-recent-50 window.
- `tallyTouchpoints([])` → one all-zero entry per touchpoint, in `AI_TOUCHPOINTS` order (the
  honest demo/never-run state; demo persists no trail so its counts are all zero).
- Counts sum per outcome into `total` (replied+rejected+unavailable): e.g. categorize
  {replied 10, rejected 2, unavailable 3} → total 15 (hand-verified).
- Actions that don't parse as a known `ai.<touchpoint>.<outcome>` (non-ai, `ai.telepathy.replied`,
  `ai.categorize.exploded`, wrong segment count) are IGNORED — never guessed into a count. Uses the
  same `parseAiAction` ACTION grammar as the ledger, so both accept/reject the same actions; the
  ledger additionally requires a well-formed date, so the two can differ only on that axis.
- A negative or fractional `count` is dropped, never summed (a corrupt row can't inflate the tally).
- Copy says "Asked", never "Ran": `total` counts every ATTEMPTED call including `unavailable`
  (provider returned nothing), so "Ran" would brand a no-reply as a success — the exact overclaim
  this page exists to prevent (Fable critic P1-1). The `unavailable` clause shows only when > 0 so
  the common case stays clean and the arithmetic stays honest (replied = total − rejected − noReply):
  - total 0 → "Not asked about your data yet."
  - total 1 (replied 1) → "Asked 1 time · 0 discarded by the guardrail."
  - total 12 {replied 9, rejected 2, unavailable 1} → "Asked 12 times · 2 discarded by the guardrail · 1 got no reply."
  - total 40 all unavailable → "Asked 40 times · 0 discarded by the guardrail · 40 got no reply."
  The guardrail-discard count is the §3.2 trust signal. Authors no number — every value is a copied count.

## §Demo bank-connect fence (#242 follow-up — `isDemoUser`/`DEMO_CONNECT_BLOCKED`, `connect-demo-fence.test.ts`)

The shared demo account is ONE row every anonymous visitor logs into, so it must never
ingest a real bank — one visitor's real data would be visible to the next. Fenced at every
ingest entrypoint, proven on a KEYED deployment (keys set, so the demo message is the only
possible refusal):

- `createPlaidLinkToken`, `linkPlaidAccount`, `connectSimplefin`, `syncSimplefinNow` all
  return `{ ok:false, error: DEMO_CONNECT_BLOCKED }` for `user-demo`, BEFORE any provider call
  (zero network) — so no PlaidItem / SimpleFinConnection row for demo can ever be created.
- The fence is demo-specific, not a global off-switch: a real user passes it and hits the
  normal path (the "not configured" refusal when keys are absent).
- `disconnectSimplefin` is intentionally NOT fenced — it removes data, never ingests, and is
  the remediation path for any pre-fence breach residual.
- Sync-path residual: the cron sweep excludes demo at the query (no sync, no `sync.cron` audit
  row); the Plaid webhook skips a demo-owned item — so even a connection created before the
  fence shipped stops ingesting.
- No-shame copy: "The demo is a shared account, so it can't connect a real bank — create your
  own free account to link securely."
- **Scope:** this covers the CONNECTED leg only. The typed/uploaded leg of the same rule
  (`addManualAccount`, `createManualTransaction`, `importTransactionsCsv`, `addHolding`) shipped
  as its own fence — see §Demo manual-entry fence below.

## §Demo manual-entry fence (#243 follow-up — `DEMO_ENTRY_BLOCKED`, `manual-entry-demo-fence.test.ts`)

The typed/uploaded leg of the same shared-account rule: a demo visitor typing their REAL
figures (a house value, a payroll deposit, a pasted bank statement, a brokerage position)
into `user-demo` would show them to the next visitor. Owner confirmed the scope 2026-07-16:
the demo is read-only for visitor-BROUGHT data; playing with the seeded (fake) data stays open.

- `addManualAccount`, `createManualTransaction`, `importTransactionsCsv`, `addHolding` return
  their typed failure shape carrying `DEMO_ENTRY_BLOCKED` for `user-demo`, immediately after
  `requireUserId()` — before any DB lookup, DB write, or provider call (the typed descriptor
  never reaches the categorize LLM, on any deployment; proven with a fetch spy on a KEYED env).
- Load-bearing closure of the update/delete paths: the seed creates no `provider='manual'`
  accounts, so with `add` fenced, `ownedManualAccount` (which requires `provider === 'manual'`)
  can never match a demo-owned row — `updateManualAccountValue`/`deleteManualAccount` are
  unreachable for demo by construction.
- Deliberately NOT fenced: `removeHolding` and the manual delete paths (remove data, never
  ingest — remediation, like `disconnectSimplefin`); edits to SEEDED rows (recategorize,
  review) — that data is fake and exploring it is the demo's purpose.
- The fence is demo-specific: a real user passes it and hits the normal validation path.
- No-shame copy: "The demo is a shared account, so anything you add here would be visible to
  other visitors — create your own free account to enter your own data."
- **Destroy fence (#244 critic P1-3):** `deleteMyData` and `revokeOtherSessions` throw
  `DEMO_DESTROY_BLOCKED` for demo (one visitor must not wipe the shared demo or sign every
  concurrent visitor out); the settings UI renders honest shared-account notes instead of the
  controls. Locked by `demo-destroy-fence.test.ts` + `account-deletion.spec.ts`.
- **Owner-accepted residual (2026-07-16 — do NOT read this section as "demo is fully
  read-only"):** goals (free-text name + target figures), custom category names, money dials
  (incl. hourly wage), budget amounts, and scrubbed Ask-question capture remain open for demo —
  accepted to keep the demo explorable. The honest invariant: bank connections, manual/CSV/
  holding entry, and account destruction are fenced; playful feature input is not.

## §Doc Extractor v1 (AI plan §3.3 reshaped — `engine/doc-extract/statement.ts`, DECISIONS #247)

The model is a span-pointer only — the JSON contract has NO value channel; every prefill
value is derived by code from a span verified to exist verbatim in the (scrubbed) text the
model saw. Every ambiguity abstains (human types the field); the save still runs the
byte-identical `parseManualStatement` gate behind a human confirm. Hand-verified in
`tests/unit/doc-extract-statement.test.ts` + `statement-extract-server.test.ts`:

Scrub (before any egress — digit runs ≥ 9, up to TWO whitespace/dash chars between digits;
best-effort masking, and the UI disclosure says so — critic cycle-1 P1-2):
- `4400 1234 5678 9010`, `4400  1234  5678  9010` (columnar double-space), `4400 1234\n5678
  9010` (PDF line wrap, incl. `\r\n`), `1-800-555-0199`, `123456789` → `[removed]`
- `12345678` (8 digits) survives; `06/15/2026 - 07/14/2026` survives (slash + the 3-char
  ` - ` gap break runs); `$1,234.56` survives (comma/dot break runs)

Validator (`parseLlmStatementExtract`):
- confidence 0.98 → 9800 bps; 1.0 → capped 9900 (10000 reserved for a human origin)
- `{fields:[]}` → replied-empty; non-object / non-array / all-claims-invalid → null (rejected)
- a field claimed twice → dropped ENTIRELY (conflicting claims abstain, no coin flip)
- span empty / whitespace / > 160 chars → claim dropped
- a LABEL-FREE span (no letters, e.g. `$980.11`) → claim dropped — the quoted span must give
  the reviewing human the statement's own wording to check the labeling against (cycle-1 P2-2)

Money derivation (exactly-one-candidate across BOTH tiers):
- `New balance               $1,234.56` → `1234.56` (123456¢); `$1,234` → `1234`;
  bare `35.00` → `35.00`; `$ 35.00` → `35.00` (a bare token inside the `$` token is the same
  candidate); a date in the span cannot shadow the `$` token
- two `$` tokens → abstain; bare integer `35` → abstain; a `$` token COEXISTING with a
  distinct bare token (`Pay 35.00 toward $1,234.56`) → abstain (cycle-1 P2-1)
- malformed money (`$1,234.567`, euro-grouped `$1.234,56`) → abstain, never a truncation
- recognized negative forms → abstain (a credit balance must not lose its sign into a
  plausible positive prefill — cycle-1 P1-3): ASCII `-$45.00` / `$-45.00` / `-45.00`,
  unicode minus/en/em-dash `−$45.00`, accounting parens `($45.00)`, `CR`/`credit`
  suffix `$45.00 CR`, trailing minus `45.00-` / `$45.00−` (ledger style), and a `CR`/`CREDIT`
  word immediately before the token `CR $45.00` (cycle-2 NEW-1). (A longer textual prefix
  like "Credit balance: $45.00" is NOT recognized — the quoted span carries those words for
  the human; this is the recorded residual. Side effect of dash normalization: a lone money
  token followed by ` - text` abstains — safe direction, rare in single-line spans.)

Date derivation (4-digit-year formats only: ISO, M/D/YYYY read US month-first, Month D YYYY):
- `08/10/2026` → 2026-08-10; `July 14, 2026` / `Jul. 14th, 2026` → 2026-07-14
- `08/10/26` (2-digit year) → abstain; `02/30/2026` (non-calendar) → abstain;
  two dates in a dueDate span → abstain
- cycleEnd ONLY: a range of exactly two ascending dates joined by `-`/`to`/`through`
  (`Statement period: 06/15/2026 - 07/14/2026`) → the LATER date (a period's end is
  deterministic); no separator / reversed / three dates → abstain

APR: exactly one %-token (`24.99%` → `24.99`; `0.00%` promo is a real value); bare `24.99`
without `%` → abstain; two %-tokens → abstain.

End-to-end fixture (grounded → `parseManualStatement`): balance 123456¢, min 3500¢,
cycleEnd 2026-07-14 (range end), due 2026-08-10, APR 2499 bps, derived cycleStart
2026-06-14, close DOM 14, due DOM 10. A span quoting the pre-scrub account number cannot
ground (the number is gone from the text the model saw).

Server fences: demo extract is a null no-op with ZERO provider calls (keyed deployment);
the provider request body never contains an unscrubbed account number; no key /
provider error / 7s hang → null → the honest "enter the fields manually" copy;
per-user durable rate limit (`statement-extract:{userId}`, 10/min) → honest error with
ZERO provider calls when exceeded (cycle-1 P1-4).

## §Unusual Charge Radar (AI plan §3-Later #12 reshaped — `engine/anomaly/detect.ts`, DECISIONS #249)

Locked by `anomaly-detect.test.ts` (F-numbers match test names; the seed lock lives
there too). Conventions (integer cents throughout): magnitudes = |amountCents| of
qualifying rows (POSTED, non-transfer, non-split-parent, negative); median = sort
ascending, odd n → middle, even n → floor of midpair mean; MAD = median (same
convention) of |x − median|; flag rule = deviation (magnitude − median, above-median
only) **strictly >** K_MAD·MAD + FLOOR with K_MAD=4, FLOOR=4000¢; baseline needs
≥ MIN_SAMPLE=6 charges at the merchant (all history ≤ today); only charges younger
than RECENT_WINDOW_DAYS=45 (age 0–44) may flag; ≤1 flag/merchant (max deviation, tie
→ later date → txnId); ≤ MAX_RESULTS=3 overall (deviation desc, tie → canonical asc →
txnId asc); aggregate pseudo-merchants (ATM/checks/Zelle/Unknown) excluded entirely.

- **F1 (even n):** [500,600,700,800,900,21436] → median floor((700+800)/2)=**750**;
  deviations sorted [50,50,150,150,250,20686] → MAD floor((150+150)/2)=**150**;
  threshold 4·150+4000=**4600**; 21436−750=**20686** > 4600 ⇒ FLAG
  {typical 750, mad 150, sample 6, deviation 20686}.
- **F7 (odd n):** [500,700,900,1100,1300,1500,21436] → median **1100** (middle);
  deviations sorted [0,200,200,400,400,600,20336] → MAD **400**; threshold **5600**;
  deviation **20336** ⇒ FLAG.
- **F2 (boundary):** [1000×5, 5000] → median 1000, MAD 0, threshold 4000; deviation
  exactly 4000 ⇒ **no flag** (strict >); 5001 (deviation 4001) ⇒ flag.
- **F10 (MAD=0 spike vs price bump):** [1549×4,1799,20000] → median 1549, MAD 0,
  deviation 18451 > 4000 ⇒ flag. [1549×4,1799,1799] → deviation 250 ≤ 4000 ⇒ no flag
  (a $15.49→$17.99 subscription bump is price-increase's job, never an "unusual charge").
- **F3:** 5 samples + any magnitude ⇒ no flag (MIN_SAMPLE). **F4:** [8000×5, 100] ⇒
  median 8000; a small charge is below-median ⇒ no flag. **F5/F5b:** an outlier aged 70d
  is baseline-only; age exactly 45 cannot flag, 44 can. **F6:** PENDING / transfer /
  positive (refund) / split-parent excluded; future-dated rows excluded from baseline
  AND flagging; ATM aggregate never flags.
- **F8:** one flag per merchant — deviations 20686 vs 14250 → larger wins; equal
  deviations → later date wins. **F9:** 4 flagging merchants (deviations
  20686/18686/16686/14686) → top 3. **F12:** equal deviations order by canonical asc.
- **Seed lock (demo-first):** `buildSeedData('2026-06-10')` + detector at today
  2026-06-10 yields EXACTLY one flag: the engineered `SQ *BLUE BOTTLE 0042 OAK`
  −21436 on 2026-06-02 (acct-sapphire). Uniform seed draws cannot flag under
  K=4+floor: for a uniform [min,max] pool, max deviation ≈ half-range while
  4·MAD ≈ full range, so every un-engineered merchant abstains by construction.

## §Merchant Pattern Lens (AI plan §Later #19 reshaped — `engine/merchant/profile.ts`, DECISIONS #250)

Locked by `merchant-profile.test.ts` (L-numbers) and `merchant-lens-copy.test.ts`
(C-numbers). Deterministic per-merchant behavioral profile; NO LLM anywhere; the
narration is a pure template over engine figures. Conventions (integer cents):

- **Qualifying charge** = POSTED, non-transfer, negative `amountCents`, `date ≤ today`
  (split parents are excluded upstream by the register query — same rule as the
  anomaly engine). Refunds (positive), PENDING, transfers, and future-dated rows
  never move any figure.
- **Merchant match** = case-insensitive EXACT equality on the canonical name
  (never substring: "Costco" ≠ "Costco Gas"); the profile echoes the ROW's casing,
  never the query's. Aggregate pseudo-merchants (Zelle/checks/ATM…) → **null**
  (heterogeneous payees are not one relationship). Zero qualifying charges → null.
- **Pattern floor** `LENS_MIN_PATTERN_SAMPLE = 3`: below it the profile keeps plain
  facts (count, total, first/last seen) but `typicalCents` and both windows are
  null — no pattern claim from thin history.
- **typicalCents** = median of magnitudes, the EXACT §Unusual Charge Radar integer
  convention (sort asc; odd n → middle; even n → floor of midpair mean).
- **Trend windows** (full calendar months only; the current partial month is never
  averaged): with `som = startOfMonth(today)`, recent = months [som−3, som−1],
  prior = [som−6, som−4] (via `addMonthsClamped`, day-01 so clamping never bites).
  A window renders only if the relationship spans it at month granularity:
  recent requires `firstYm ≤ recentFromYm`, prior requires `firstYm ≤ priorFromYm`
  — otherwise months before the first charge would read as $0 behavior.
  `avgPerMonthCents = roundHalfAwayFromZero(windowTotal / 3)`.

Hand-verified cases (today 2026-06-10 → recent 2026-03..2026-05, prior 2025-12..2026-02,
unless noted):

- **L1 (rich history, both windows, even-n median):** Cafe Nine charges
  2025-11-14 −1000, 2025-12-05 −800, 2026-01-10 −900, 2026-02-20 −700,
  2026-03-08 −1100, 2026-04-12 −600, 2026-05-25 −1200, 2026-06-03 −500.
  Count **8**, total **6800**; sorted magnitudes [500,600,700,800,900,1000,1100,1200]
  → median floor((800+900)/2) = **850**; firstSeen 2025-11-14, lastSeen 2026-06-03.
  Recent: 3 charges, 1100+600+1200 = **2900**, avg round(2900/3 = 966.67) = **967**.
  Prior: 3 charges, 800+900+700 = **2400**, avg **800**. Interleaved refund (+1500),
  PENDING (−999), transfer (−5000), future 2026-06-15 (−777), and another merchant's
  row change NOTHING. Query "cafe nine" matches; profile echoes "Cafe Nine".
- **L2 (thin history):** 2 charges → count/total/firstSeen/lastSeen present;
  typicalCents null, both windows null.
- **L3 (aggregate):** "Zelle Payment" → null. **L4 (no qualifying rows):** only
  refund/PENDING/transfer/future rows → null.
- **L6 (old merchant, quiet windows):** 3 charges Oct 2025 (−4000 ×3) → typical
  **4000**; recent {0 charges, 0, avg 0}, prior {0, 0, 0} (both render: firstYm
  2025-10 precedes both windows — "no charges" is a true pattern statement).
- **L7 (newer merchant):** 4 charges from 2026-04-02 (−2000, −3000, −2500, −1800)
  → median floor((2000+2500)/2) = **2250**; firstYm 2026-04 > recentFromYm 2026-03
  → BOTH windows null (an average over months before the relationship would lie).
- **L8 (odd-n median + boundary firstYm == recentFromYm):** −500/−700/−900 in
  Mar/Apr/May 2026 → median **700**; recent {3, 2100, avg 700} renders; prior null.
- **L9 (avg rounding):** window totals 10001 → round(3333.67) = **3334**;
  10000 → round(3333.33) = **3333**.
- **L11 (cross-year windows):** today 2026-01-15 → recent 2025-10..2025-12, prior
  2025-07..2025-09; one −1000/month Jul–Dec 2025 → both windows {3, 3000, avg 1000}.
- **L12 (today boundary):** a charge dated exactly `today` counts (count, total,
  lastSeen).
- **Copy (C-cases):** heading "Your pattern at {merchant}"; facts line always;
  typical line discloses its basis "(median of N posted charges)"; trend line
  carries "about" on every divided figure and the "vs" clause only when the prior
  window rendered; window note ("full calendar months; the current month isn't
  counted") present iff the trend line is; cadence line only from an ACTIVE
  non-IRREGULAR recurring series, hedged "around" on the expected date. Guardrail
  scan over every line: no shame/advice lexicon, and — the §Later #19 verdict's
  hard exclusion — no time-of-day or day-of-week vocabulary (the data doesn't
  exist: `Transaction.date` is date-only).

## §Income-Pause Radar (AI plan §Later #20's one groundable signature — `engine/income/pause.ts`, DECISIONS #251)

Locked by `income-pause.test.ts` (P-numbers match test names; the seed lock lives
there) and `income-pause-server.test.ts` (the confirmation → projection-exclusion
integration). Pure detection over `detectRecurring` output; NO LLM anywhere.
Conventions (integer cents throughout):

- **Input** = the recurring series the siblings read (POSTED, non-split,
  SPENDING-type accounts — the same universe as getRecurring #62 and
  refreshRecurringForUser; critic F4 aligned the coach call site). **Lapse
  arithmetic never reads `nextExpectedAt`** — detect.ts forward-steps that field
  past missed occurrences until ≥ today, structurally hiding a lapse. Instead:
  `missedSince = missedSinceOf(lastSeenAt, cadence)` = `nextDate(lastSeenAt,
  cadence)`, EXCEPT a MONTHLY series last seen on the LAST day of its month
  expects the END of the next month (critic F7 — a 31st payday clamped to Feb 28
  must expect Mar 31, not Mar 28, or the grace silently shrinks to 7 for
  month-end payroll; the rule only ever moves the expectation LATER).
  `daysLate = daysBetween(missedSince, today)`.
- **Gates (precision-first — a false "your income stopped" shouts, a false
  negative stays quiet):** isIncome (positive series); cadence ∈ {WEEKLY,
  BIWEEKLY, MONTHLY} — ANNUAL excluded (one missed yearly bonus is not a pause);
  occurrences ≥ **4** (3 confirmed gaps); typicalAmountCents ≥ **10000** ($100
  floor); aggregate pseudo-merchants excluded (shared case-insensitive
  `isAggregateCanonical`, #250 F3); `missedSince < today` strictly (nothing due
  today or later has been missed).
- **Grace** (absorbs payroll jitter before anything is said): flag iff daysLate ≥
  {WEEKLY: **5**, BIWEEKLY: **7**, MONTHLY: **10**}.
- **Alarm vs consent — two different predicates, one lapse arithmetic** (critic
  F1): the ALARM (`detectIncomePauses`) carries all the precision gates plus
  daysLate ≤ **STALE_DAYS = 60** (news, not history). STANDING CONSENT
  (`confirmedPauseState`, per confirmed merchant) carries NO alarm gates and NO
  staleness cap — its three states: `paused` (an income series with a
  projectable cadence exists and has NOT date-fresh resumed → exclusion in force
  + HANDLED feed row), `resumed` (missedSinceOf(lastSeenAt, cadence) ≥ today —
  an actual fresh deposit; only THIS retires consent: the confirmation row is
  deleted), `inert` (no projectable income series under the canonical → nothing
  excluded, consent KEPT — absence of evidence is not resumption). The executed
  F1 failure this encodes: a provider row-removal dropping occurrences 4→3 must
  NOT delete consent or re-project income no deposit revived.
  `incomePausesForFeed` composes both: unconfirmed = alarm rows; confirmed = the
  `paused` state rows, so the feed's disclosure rides the SAME predicate as the
  exclusion (a money mutation may never outlive its own visibility).
- **Order**: typicalAmountCents desc (most material first), then merchant asc
  (locale-free). No count cap — income series are naturally few.

Hand-verified cases:

- **P1 (the seed shape):** MONTHLY ×4, +38000, last 2026-04-10, today 2026-06-10 →
  missedSince addMonthsClamped(04-10, 1) = **2026-05-10**; daysLate 21 (rest of
  May) + 10 (June) = **31** ≥ 10 ⇒ exactly one pause {38000, occurrences 4}.
- **P2–P4 (grace boundaries):** MONTHLY daysLate 9 silent / 10 flags; BIWEEKLY
  (last 2026-05-29 → missed 06-12) 6 silent / 7 flags; WEEKLY (last 2026-06-01 →
  missed 06-08) 4 silent / 5 flags.
- **P5 (staleness):** daysLate 60 (2026-07-09) is news, 61 (2026-07-10) is not —
  but `lapsedIncomeSeries` still returns the 61-day row.
- **P6 (abstentions):** occurrences 3; typical 9999 (vs 10000 flags); expense
  series; ANNUAL; aggregate ("ATM Withdrawal", any casing) — all silent.
- **P7:** missedSince == today or future → silent. **P8:** a current payroll next
  to a lapsed side gig → only the side gig flags. **P9:** order 245000 before
  38000; equal amounts → merchant asc.
- **P11/P12 (confirmation composition):** confirmed+stale kept with
  `confirmed: true`; unconfirmed+stale dropped; a confirmation for a RESUMED
  series yields no row — state is recomputed, never trusted from the
  confirmation. **P13 (month-end):** missedSinceOf(2026-02-28, MONTHLY) =
  2026-03-31; (2026-01-31) = 2026-02-28; mid-month and non-monthly untouched;
  grace boundary holds at the true month-end date. **P14 (consent machine):**
  occurrences 3 / typical $99.99 → still `paused` (gate failure ≠ resumption);
  fresh deposit → `resumed`; vanished / ANNUAL-drifted / expense-only series →
  `inert`; the feed keeps the confirmed row through a gate failure.
- **Server contract (`income-pause-server.test.ts`):** unconfirmed lapse still
  projects (the radar alone never mutates); confirmed lapse → its
  ScheduledTransaction row is gone while non-income series project on and the
  RecurringSeries row remains (/recurring keeps showing it); **2b (critic F1
  regression):** deleting one historical row (occ 4→3) leaves the exclusion in
  force and the consent row intact; a resumed series projects again AND its
  stale confirmation row is deleted (future pauses re-ask); demo can never
  read/write a confirmation (fence by construction). Manual entry/CSV run the
  same best-effort refresh as provider ingest
  (`income-pause-manual-entry.test.ts` — the "returns automatically" claim
  holds without a provider sync).
- **Nudge identity (critic F5):** the unconfirmed ACTION row keys to the missed
  occurrence (`income_pause:<merchant>:<missedSince>`); the CONFIRMED state row
  keys to its own namespace (`income_pause_confirmed:<merchant>`) so a dismissal
  of the earlier alarm can never hide the state disclosure carrying the Undo.
- **Runway passthrough (critic F6):** only finite AND > 0 figures are carried;
  zero/negative (overdrawn cash) render no runway sentence — "covers about −0.5
  months" is unrepresentable.
- **Disclosure rule line (critic F2):** a HANDLED income_pause's "why" rule says
  "You confirmed this income is paused… with Undo" — never the autopay rule
  (`tierRule` in the copy module, per-kind override, unit-locked).
- **Seed lock (demo-first):** `buildSeedData('2026-06-10')` yields EXACTLY one
  pause — `STRIPE PAYOUT ETSY SHOP` → "Stripe Payout" (side-income), +38000 × 4
  monthly (2026-01-10..04-10) on **acct-savings**, which is deliberately NOT the
  demo payment account (acct-checking): the paused series can never reach
  `toScheduledTransactions`, so the cash-needed/§Seed-headline arithmetic is
  untouched by construction. **L.25 narrowed the mechanism:** expenses now project
  from every cash account, so what keeps this series out is that it is INCOME, which
  alone remains payment-account-scoped — not merely that savings isn't the payment
  account. The known ripple: monthlyFlows income for
  2026-01..04 is now 2×245000 + 38000 = **528000**/month for two-payday months
  (insights.test.ts re-hand-verified). Payroll (biweekly, current at asOf) never
  flags.
- **Copy:** the figure is "the expected deposit that hasn't arrived" — never "at
  stake" (whyInputs: "an expected $X deposit"), never "spent". Cadence claim
  carries its basis inline ("based on N deposits"); the runway line says "about",
  names its formula inline ("cash ÷ your 6-month average expenses"), and is
  OMITTED when the caller's monthsOfRunway is absent or non-finite (∞ is
  unrepresentable: select.ts nulls non-finite passthrough). Confirmed/HANDLED
  copy disclosures: the exclusion ("cash projections don't count it"), the
  automatic exit ("returns automatically when a new deposit arrives"), and the
  undo. No-shame scan: no crisis/fired/behind lexicon; the offered outcome is a
  planned pause.

## §Money Signature (AI plan §Later #11 reworked — `engine/fi/signature.ts`, DECISIONS #252)

Hand-verified expected values for `computeMoneySignature` (two habit axes + weather) and the
shared hysteresis walk `resolveConfirmedLabel`. Conventions: shares and spreads are integer bps
via `Math.floor`; median/MAD use the radar integer convention (sorted; odd n → middle element;
even n → floor of the mean of the two middles; MAD = median, same convention, of absolute
deviations from the median). Only FULL calendar months feed the engine — a flow row whose month
equals `ym(today)` is dropped before anything else. Thresholds (exported constants): axis-1
steady ≥ 7500 bps of eligible months saved, variable ≤ 5000, dead zone between, minimum 6
eligible months; axis-2 steady ≤ 1000 bps spread, variable ≥ 2500, dead zone between, exactly
the trailing 6 full months with median > 0; hysteresis persistence K = 3 consecutive identical
contrary raw labels (a dead-zone month RESETS the run); weather: strained iff runway < 1, else
tight iff runway < 3 or latest rate < 0, else bright iff personal-best latest rate ≥ 0 with ≥ 6
eligible months, else calm.

### Axis 1 — saving habit (shareBps = floor(saved × 10000 / eligible), trailing ≤ 12 eligible)

- **S1 (steady init).** 6 full months, rates [500, 300, 1200, 800, 100, 900] bps, all ≥ 0.
  First signal at month 6 (6 eligible): share = floor(6×10000/6) = **10000** ≥ 7500 → raw
  steady → label **steady**, sinceMonth = month 6, savedMonths 6, eligibleMonths 6.
- **S2 (dead-zone hover never flips).** 16 months: m1–m8 rate +100, m9–m16 alternating
  −100/+100 starting with −100. m6–m8: 10000 (steady, init at m6). m9: 8/9 → floor(80000/9)
  = **8888** steady. m10: 9/10 = 9000. m11: floor(90000/11) = **8181**. m12: 10/12 = 8333.
  m13 (window m2–m13, 9 saved): 9/12 = **7500** steady (boundary inclusive). m14 (m3–m14,
  9 saved): 7500. m15 (m4–m15, 8 saved): floor(80000/12) = **6666** → dead zone → raw null,
  label holds. m16 (m5–m16, 8 saved): 6666 dead. **Zero flips**; label steady since m6
  while the share fell 10000 → 6666.
- **S3 (regime change flips exactly once).** 20 months: m1–m8 rate +100, m9–m20 rate −100.
  m9: 8/9 = 8888 steady. m10: 8/10 = 8000 steady. m11: floor(80000/11) = **7272** dead.
  m12: 8/12 = 6666 dead. m13 (m2–m13, 7 saved): floor(70000/12) = **5833** dead. m14
  (m3–m14, 6 saved): 6/12 = **5000** → raw variable, run 1. m15 (m4–m15, 5 saved):
  floor(50000/12) = **4166**, run 2. m16 (m5–m16, 4 saved): 3333, run 3 → **flip at m16**,
  sinceMonth m16. m17–m20: variable raws continue, **no further flip** — exactly one.
- **S4 (null-rate months are invisible).** Rates [+100, null, +100, null, +100, +100, +100,
  +100]: eligible = 6, saved = 6 → share 10000, init at the 6th ELIGIBLE month (m8);
  a null-rate month is neither saved nor unsaved and does not advance the window.
- **S5 (forming below 6 eligible).** 5 eligible months, all saved → label null ('forming'),
  savedMonths 5, eligibleMonths 5, sinceMonth null. Weather still computed.

### Hysteresis walk — `resolveConfirmedLabel(raws)` (raw = 'steady' | 'variable' | null)

- **H1.** [steady, steady, steady] → label steady, sinceIndex 0 (first non-null initializes
  immediately; persistence gates only FLIPS, not initialization).
- **H2.** [null, null, variable] → forming until index 2, then variable, sinceIndex 2.
- **H3 (contrary run interrupted by dead zone resets).** [steady, variable, variable, null,
  variable, variable, variable, …] → still steady after index 2 (run 2 < 3); the null at
  index 3 RESETS the run; flips only at index 6 (the 3rd consecutive of the second run),
  sinceIndex 6.
- **H4 (contrary run interrupted by same-label raw resets).** [steady, variable, variable,
  steady, variable, variable, variable] → flip at index 6, not index 4.
- **H5.** All null → label null, sinceIndex null.

### Axis 2 — spending steadiness (spreadBps = floor(mad × 10000 / med), trailing exactly 6)

- **D1 (constant).** 6 × 300000¢ → med 300000, all deviations 0 → mad 0 → spread **0** ≤
  1000 → steady.
- **D2 (alternating).** [200000, 400000] × 3 → sorted [2,2,2,4,4,4]×10⁵: med =
  floor((200000+400000)/2) = **300000**; every |dev| = 100000 → mad = 100000; spread =
  floor(100000×10000/300000) = **3333** ≥ 2500 → variable.
- **D3 (mild wiggle).** [300000, 310000, 290000, 305000, 295000, 300000] → med 300000; devs
  sorted [0, 0, 5000, 5000, 10000, 10000] → mad = floor((5000+5000)/2) = 5000; spread =
  floor(5000×10000/300000) = **166** → steady.
- **D4 (dead zone).** [300000, 360000, 240000, 370000, 230000, 300000] → med 300000; devs
  sorted [0, 0, 60000, 60000, 70000, 70000] → mad 60000; spread = floor(60000×10000/300000)
  = **2000** → 1000 < 2000 < 2500 → raw null (no signal; label holds).
- **D5 (zero-median guard).** Six months of 0 expenses → med 0 → raw null (never divide).
- **D6 (forming).** Only 5 full months → raw null at every position → label null.

### Weather (evaluated on the latest FULL month; responsive by design — no hysteresis)

- **W1.** runway 0.9, latest rate 3000 → **strained** (runway dominates; rate irrelevant).
- **W2.** runway 2.9, latest rate 2000 → **tight**.
- **W3.** runway 12, latest rate −500 → **tight** (negative month with cushion is tight, not
  strained).
- **W4.** runway 6, ≥6 eligible months, latest rate strictly above every prior non-null →
  **bright** (isPersonalBest via computeSavingsStreak, reused not re-derived).
- **W5.** runway 6, latest rate ≥ 0 but not a personal best → **calm**.
- **W6.** 3 eligible months, runway 5, rate 800 → **calm** (bright requires ≥ 6 eligible;
  a trivial early "personal best" must not celebrate), axes forming.
- **W7.** latest rate null (no income that month), runway 4 → **calm** (null is not < 0;
  the weather line's basis copy cites runway and rate, so the null case reads on runway).
- **W8.** runway = Infinity (zero average expenses) → not < 1, not < 3 → calm/bright reachable.
- **W9 (partial month excluded).** today 2026-06-10 with a 2026-06 flow present → 2026-06 is
  dropped; latest full month = 2026-05; weather and both axes read through 2026-05.
- **W10 (boundaries).** runway exactly 1 → NOT strained (< is strict); runway exactly 3 →
  NOT tight; latest rate exactly 0 → not negative → not tight on the rate arm.

### Critic-cycle additions (#252 cycle 1 — lag honesty, trailing gaps, unreadable windows)

Materialization amendment (critic P2-2): the zero-filled calendar grid is anchored — like
`detectLifestyleCreep`'s — to the month BEFORE `today`, not to the last month with data. A
trailing gap month is a real completed $0/no-income month, so the weather always reads the
true latest full calendar month and the steadiness window sees completed $0 months.

- **S6 / lag-contrary (critic P1-1).** Rates [8 × +100, 7 × −100]: the S3 flip needs a 3rd
  contrary raw (arrives at m16), so at m15 the confirmed label is still steady while the
  latest window is 5/12 = floor(50000/12) = **4166** bps — inside the VARIABLE band. The
  engine sets `latestContrary: true` and the card renders the lag-honest "had been … recent
  months look different" variant; unqualified "steady … has held" copy there is a falsehood
  against its own inline facts. The S2 dead-zone hover must NOT flag (mid-band ≠ contrary).
- **D7 / steadiness lag-contrary.** [8 × 300000, then 900000/300000 alternating ×6]: windows
  through m12 keep med 300000 with ≤2 spike months → mad 0 → steady raws; the m13/m14
  windows are 3×300000 + 3×900000 → med floor((300000+900000)/2) = **600000**, every dev
  300000 → mad 300000 → spread floor(300000×10000/600000) = **5000** → variable raws (run 2
  of 3) → label steady + `latestContrary: true`.
- **D8 / unreadable window (critic P2-1).** 12 × 300000 ending 2025-12, today 2026-06-15:
  the trailing grid materializes 2026-01..05 as $0, the latest window [300000, 0×5] sorts to
  med floor((0+0)/2) = **0** → spreadBps null — but `hasFullWindow: true` (17 full months on
  record), so the UI says "no recorded spending in the recent window", never "needs 6 full
  months of history".
- **W11 / trailing-gap weather (critic P2-2).** Six months ending 2025-06, today 2026-05-15:
  latest full month = **2026-04**, rate null → weather reads the runway arm (calm at 6);
  the habit window still holds the 6 eligible months (copy qualifies the count as "full
  months with income" — critic P1-2), and steadiness is the D8 unreadable state.
- **Copy quantifier (critic P1-2).** Every rendered month-count is "N of your last M full
  months WITH INCOME" — the eligible window skips no-income months, so the unqualified
  phrase is false whenever such months sit inside the span (rates [10 × +100, null, null,
  +100, +100] → savedMonths 12/eligible 12 across 14 calendar months).
- **Pluralization (critic P2-4).** Runway exactly 1 → "about 1 month of typical spending"
  (reachable only as tight; strained is strict < 1).

## §Habit Streaks (AI plan §Later #17 streaks half — `engine/cards/cleared-streak.ts` / `engine/recurring/creep-streak.ts`, DECISIONS #254)

Two pure retrospective walks; no persistence, no LLM. The savings-rate streak (#205,
`savings-streak.ts`) is the sibling convention: streaks are a pure function of history.

### Card cleared-in-full streak (`computeCardClearedStreak`)

Definitions (each a hand-locked test):
- **Resolved** statement: `isEstimated !== true` AND `dueDate < today` (STRICT — on the due
  date itself the statement is still open; an autopay dated that day hasn't "missed").
- **Cleared**: `statementBalanceCents ≤ 0`, OR the sum of its payments **dated ≤ dueDate**
  ≥ `statementBalanceCents`. Late full payment is NOT cleared-by-due-date (interest basis);
  the copy states "paid in full by its due date" inline.
- **Month qualifies**: every resolved statement with `ym(dueDate)` = that month is cleared.
  A month with NO resolved statements qualifies (nothing due = nothing missed) but only
  counts inside the walk span.
- **Full months only (critic #254 F2)**: statements resolving inside the CURRENT partial
  month are excluded from the walk entirely — they neither extend nor break the streak
  until the month completes (the sibling creep walk's lag-honest basis; overdue-now
  urgency belongs to reminders/cash-needed). When the ONLY resolved statements sit in the
  current partial month, `formingThisMonth: true` and the UI renders a forming line —
  "no statement has come due yet" would be false for that user.
- **Walk**: calendar months descending from the latest FULL month containing a resolved
  statement (`latestMonth`) down to the earliest such month; stop at the first month with
  an uncleared resolved statement (`brokeAt`); `streakMonths` = qualifying months counted.
  No resolved statements at all → `streakMonths 0, latestMonth null` → UI abstains.

Hand cases:
- C1: two cards, dues 3/15, 4/15, 5/15 all paid in full on due date, today 6/10 → streak 3.
- C2: latest due 6/15 with today 6/10 is unresolved — neither counts nor breaks (C1 data +
  future statement → still 3).
- C3: 5/15 balance 120000, single payment 120000 dated 5/17 (late) → May fails → streak 0,
  brokeAt 2026-05; the 3/15+4/15 cleared months above it are unreachable (walk stops).
- C4: 5/15 balance 120000, payments 40000+80000 both ≤ 5/15 → cleared (sum rule).
- C5: partial 100000 of 120000 by due → fails.
- C6: balance 0, no payment rows → cleared (Store-card $0 cycles).
- C7: statements due May and March only (April gap), all cleared → streak 3 (gap month
  qualifies inside the span); span floor = March (walk never counts below earliest signal).
- C8: `isEstimated: true` row is invisible (excluded before grouping).
- C9: overpayment (130000 of 120000) → cleared.
- C10 (critic F2): May cleared + a cleared statement due 6/05 with today 6/10 → streak 1
  through May; the partial-month statement is not counted.
- C11 (critic F2): May cleared + a MISSED statement due 6/05, today 6/10 → streak 1,
  brokeAt null; the SAME data at today 7/01 → streak 0, brokeAt 2026-06 (the break
  surfaces when the month completes — lag-honest, not hidden).
- C12 (critic F2): ONLY a resolved 6/05 statement, today 6/10 → streak 0, latestMonth
  null, `formingThisMonth: true` → forming copy, never "no statement has come due yet".
- **Seed lock** (asOf 2026-06-10): historical statements for sapphire/platinum/freedom
  (back 1–17: dues 2025-01-15..2026-05-15 / same / 2025-01-28..2026-05-28) are all
  seed-paid IN FULL ON the due date; store back 0–14 even offsets (dues 2025-03-15..
  2026-05-15 odd months, $0 cycles at back 6 and 12) all cleared; June dues (6/15, 6/15,
  6/28) unresolved at pinned demo today 2026-06-10. Every month 2025-01..2026-05 has ≥1
  resolved statement and qualifies → **streakMonths 17, latestMonth 2026-05, 4 cards,
  brokeAt null**.

### No-subscription-creep streak (`computeNoCreepStreak`)

Definitions:
- Universe: detected series with `isSubscription` (the #246/#249 subscription flag; income
  and non-subscription bills excluded). No subscription series → `streakMonths null`
  (abstain — a vacuous "no creep" over zero subscriptions is not an achievement).
- **Creep event**: `priceChangedAt` set AND `|typicalAmountCents| > |previousAmountCents|`
  (an increase; decreases never break) at month `ym(priceChangedAt)`. The detector retains
  at most one price change per series (two-plateau rule) and drops ≥3-plateau series
  entirely, so within the detector's own history window every knowable increase is visible.
- **Walk**: full months descending from `ym(today)−1`, capped at `windowMonths` (12,
  disclosed in copy — "in the last N full months"); stop at the first month containing a
  creep event; `brokeOn` = that event (same-month ties: largest increase, then merchant
  ascending). An increase inside the CURRENT partial month is invisible to the walk by
  construction — the copy says "full months" (lag-honest, #252 precedent); the
  price-increase opportunity surface (#207/#246) owns same-month news.

Hand cases:
- N1: no subscription series → null (abstain), count 0.
- N2: increase first charged 2026-02-03, today 2026-06-10 → walk May✓ Apr✓ Mar✓ Feb✗ →
  streak 3, brokeOn month 2026-02.
- N3: decrease (1799 → 1549: |typical| 1549 < |previous| 1799) → not an event → cap 12.
- N4: no priceChangedAt anywhere → streak 12 (cap), brokeOn null.
- N5: increase dated inside the current partial month → walk unaffected (streak unchanged).
- N6: two increases, 2026-02 and 2026-04 → walk breaks at the more recent (Apr) → streak 1.
- N7: increase 13+ months back → outside window → 12.
- N8: `isIncome` series with a raise is not creep (isSubscription false by construction).
- N9 same-month tie: events (+200) and (+450) both in 2026-03 → brokeOn is the +450 one.
- **Seed lock** (asOf 2026-06-10): the only seeded subscription price change is Netflix
  1549 → 1799 first charged **2026-02-03** (`netflixIncreaseMonth = asOf−4mo`) → streak
  **3**, brokeOn {netflix canonical, 1549, 1799, 2026-02}, subscription count = the seed's
  detected `isSubscription` series (asserted from the live detector, not hardcoded).

## §Scenario Coherence (AI plan §Later #13 slice 1 — `engine/scenario/scenario.ts`, DECISIONS #255)

The snapshot-coherence engine behind Scenario Studio: ONE canonical state + knob-delta
application, so a knob (pay cut, spending change, extra debt payment) propagates to BOTH
representations the app's engines read — the AGGREGATE figures (coach derivation: monthly
income / savings, annual expenses) AND the PER-FLOW scheduled rows (forecast + cash-needed).
The decision-comparison half of #13 is permanently dropped (plan §4). No knob may ever apply
to one representation only: it applies to both, or not at all with a disclosed note.

Canonical identities (by construction, from the two verbatim coach figures):
- `monthlyExpensesCents = monthlyIncomeCents − monthlySavingsCents` (exact integer identity;
  `annualExpensesCents` stays the separate verbatim coach figure `expenses6×2` — the
  pre-existing rounding divergence between the two is inherited, not resolved here).
- `monthlyNetCents` = income − expenses after knobs (drives the savings RATE; may be negative).
- `monthlyInvestibleCents` = net − extraDebtMonthly (drives FI + retirement contribution).
  At base the two equal the verbatim coach `monthlySavingsCents`. Reallocating surplus to
  debt principal does NOT change the savings rate (income − expenses is unchanged) but DOES
  reduce what compounds — the split is the honest resolution of the ratio-vs-cents hazard.

Fixture SC (hand-built): today 2026-06-10; income 500000¢/mo, savings 120000¢/mo (→ expenses
380000¢), annualExpenses 4560000¢; portfolio 2500000¢; swr 400, expectedReturn 700 (nominal);
paymentAccountId 'acct-check'. Scheduled rows: R1 +250000 BIWEEKLY 'Paycheck' (acct-check),
R2 −150000 MONTHLY 'Rent' (acct-check), R3 +33333 MONTHLY 'Side gig' (acct-check).
Debts: D1 card 450000 @2199bps min 15000; D2 loan 800000 @649bps min 25000.

| # | knobs | hand-verified expected |
|---|-------|------------------------|
| S1 | none | identity: every adapter output deep-equals the base's; scheduled rows byte-identical; assumptions carry only the standing lines |
| S2 | income percent −1500 bps | aggregate delta = rHAFZ(500000×−1500/10000) = −75000 → income 425000, net 45000, investible 45000; expenses/annualExpenses unchanged; R1 → rHAFZ(250000×8500/10000)=212500, R3 → rHAFZ(33333×0.85)=rHAFZ(28333.05)=28333, R2 untouched; no synthetic row |
| S3 | income absolute −50000 | income 450000, net 70000; ONE synthetic MONTHLY row carrying the signed delta: {amountCents −50000, description 'Scenario: income adjustment', accountId 'acct-check', nextDate 2026-07-01 (first of next month)}; existing rows untouched |
| S4 | income percent −1500 AND absolute +20000 | order: percent first on base (−75000), then absolute (+20000) → income 445000, net 65000; rows scaled per S2 PLUS one synthetic +20000 monthly row |
| S5 | expense percent +1000 bps | monthlyExpenses 380000 → delta rHAFZ(380000×1000/10000)=+38000 → expenses 418000, net 82000, investible 82000; annualExpenses 4560000 + 12×38000 = 5016000; R2 → rHAFZ(−150000×1.1)=−165000; income rows untouched; savings-rate adapter = savingsRateBps(500000, 418000) = round((500000−418000)/500000×10000) = 1640 |
| S6 | expense absolute −25000 (cut $250/mo) | NO-OP + note 'a spending cut needs the percent knob' (rule E-CUT below: a cut names no bill, so it has no flow representation; a synthetic +25000 row would fabricate an inflow); aggregates UNCHANGED (both-or-neither rule) |
| S6b | expense absolute +25000 (add a $250/mo commitment) | expenses 405000, net 95000, investible 95000; annualExpenses 4560000+300000=4860000; ONE synthetic MONTHLY row {amountCents −25000, description 'Scenario: added spending', accountId 'acct-check', nextDate 2026-07-01}; existing rows untouched |
| S7 | extraDebt 30000 | net unchanged 120000; investible 90000; toDebtPlan.extraMonthlyCents 30000; synthetic row −30000 MONTHLY 'Scenario: extra debt payment' acct-check 2026-07-01; retirement contribution (builder-floored) 90000; savings rate UNCHANGED at the base 2400 bps |
| S8 | extraDebt 30000, debts all ≤0 balance | knob no-op + note 'no debts to pay'; investible stays 120000; no synthetic row; toDebtPlan.extraMonthlyCents 0 |
| S9 | paymentAccountId null + income absolute −50000 | knob no-op + note (cannot land a synthetic flow); aggregates UNCHANGED (both-or-neither rule) |
| S10 | income percent −10000 (clamp floor −100%) | income 0; net −380000 (negative, NOT floored); investible −380000; savings-rate adapter → null (income ≤ 0); retirement contribution floors to 0 via buildRetirementInputs; R1/R3 → 0-amount rows (kept, 0¢) |
| S11 | income percent −12000 (out of bounds) | clamped to −10000 → same as S10; clamp disclosed in notes |
| S12 | extraDebt −5000 (negative) | clamped to 0 → no-op (extra debt cannot be negative) |
| S13 | expense percent +1000 with NO negative scheduled rows (rows = R1,R3 only) | aggregate moves (expenses 418000 etc.); zero rows to scale is NOT a violation (the flow representation of expenses is empty; factor applied to the empty set); no note needed |
| S14 | income absolute −600000 (below −income) | income floors at 0; the synthetic row carries the EFFECTIVE delta −500000 (never the requested −600000 — both representations must agree); floor disclosed in notes |
| S15 | income percent +5000 on a base with monthlyIncome 0 (savings −380000, a deficit user) but income rows present | aggregate stays 0 (0 × any factor); rows scale (Paycheck 250000 → 375000); the visible asymmetry is DISCLOSED in notes ("average monthly income … is $0, so the percent change shows up only on your scheduled income flows"); same mirror rule on the expense side (critic F2) |
| S16 | NaN / Infinity / non-integer knob values (a cleared numeric form field is exactly NaN) | sanitize-and-note, never throw (critic F1): non-finite → knob ignored with a note; non-integer → rHAFZ-rounded with a note; state and synthetic rows always integer cents; adapters never throw |

Extra-debt duration assumption (critic F3): the synthetic extra-debt row and the investible
reduction have no end date, even though `planDebtPayoff` may clear the debts sooner — so
months-to-FI under an aggressive payoff carries a stated assumption line ("modeled as
continuing for the whole projection, even after the debts would be paid off"), appended
only when the knob actually applied.

rHAFZ = roundHalfAwayFromZero, applied ONCE per materialized value: once for the aggregate
delta, once per scaled row. S5 savings-rate check: savingsRateBps(500000, 418000) =
Math.round(82000/500000×10000) = Math.round(1640) = 1640 bps. S7 base rate:
Math.round(120000/500000×10000) = 2400 bps, unchanged by the extra-debt knob.

Rule E-CUT (settled): absolute expense knob X>0 (new committed spending, e.g. "add a $250/mo
car payment") = aggregate + synthetic −X monthly outflow. X<0 ("cut $250 somewhere") names no
bill, so no flow representation exists; per the both-or-neither rule it is a NO-OP with a
disclosed note steering to the percent knob. Income absolute is representable in both
directions (one paycheck stream more or less is a real dated flow either way).

Adapter conventions (each downstream engine's OWN convention, preserved verbatim):
- FI: un-floored investible; NOMINAL expectedReturnBps; fiNumber from scenario annualExpenses.
- Retirement: RetirementBaseInputs with un-floored figures — `buildRetirementInputs` (the one
  shared builder) floors at 0 and derives the real return; scenario never re-implements either.
- Savings rate: savingsRateBps(income′, expenses′) — null on income ≤ 0, preserved.
- Forecast + cash-needed: BOTH read the SAME adjusted `scheduledRows` (ScheduledLike shape,
  synthetic rows included); statements/cards/autopays pass through UNTOUCHED (an issued
  statement is history — a scenario cannot rewrite it; stated in assumptions).
- Debt: DebtPlanInput with scenario extraMonthlyCents; debts pass through (balances are facts).

## Plaid investment holdings (Wave 4.3, #290)

The Plaid /investments/holdings/get mapper (src/lib/providers/plaid-holdings.ts) mirrors the
SimpleFIN holdings model (DECISIONS #129): the feed's institution_value (a position's TOTAL
market value) is the authoritative marketValueCents, and the per-share priceCents is DERIVED as
round(marketValueCents / quantity) -- never Plaid's own institution_price. quantity is Float
shares; cost basis is best-effort.

Hand-verified maps (dollars in -> integer cents out):
- AAPL, quantity 100, institution_value $20,000, cost_basis $15,000 ->
  marketValueCents 2000000 (authoritative), priceCents round(2000000/100)=20000, costBasisCents 1500000.
- VTI, quantity 200, institution_value $50,000, cost_basis $40,000 ->
  marketValueCents 5000000, priceCents round(5000000/200)=25000, costBasisCents 4000000.
- Penny lot (DECISIONS #129 parity): quantity 1,000,000, institution_value $0.01 ->
  marketValueCents 1 (authoritative), priceCents round(1/1000000)=0. The 1c total survives; a
  per-share-only model would reconstruct round(1000000 x 0)=$0 and lose the position.
- Same-symbol aggregation: two AAPL lots (100sh/$20,000/$15,000 + 50sh/$10,000/$8,000) ->
  one position quantity 150, marketValueCents 3000000, costBasisCents 2300000,
  priceCents round(3000000/150)=20000.

Edge-case rules (each with a test in tests/unit/plaid-holdings*.test.ts):
- Cash sweep (security.type='cash', e.g. ticker CUR:USD): DROPPED, and NOT counted skipped --
  it is not a security position (its value is already inside the account balance).
- Non-USD lot (iso_currency_code not USD, or a crypto unofficial_currency_code): WITHHELD (no
  FX), counted withheldNonUsd (distinct from skipped), never persisted, never summed at 1:1.
- Short/zero quantity, non-finite or negative value, over-ceiling (> $21,474,836.47 = the 32-bit
  Int cap), or a real security with no usable ticker: SKIPPED + counted, never thrown.
- Un-joinable security (security_id absent from securities[]): SKIPPED (cannot key it).

Reconcile safety (PlaidProvider.reconcilePlaidHoldings + the syncHoldings guard):
- Source isolation: writes/deletes ONLY source='plaid' rows; a manual (or other-provider) row of
  the same ticker is off-limits to both the upsert and the delete.
- Prune (delete sold positions) runs ONLY on a CLEAN run (skipped===0): an explicit-empty,
  cash-only, or all-foreign account prunes correctly (sold-all); a run that left un-mappable rows
  (skipped>0 -- e.g. a truncated securities[]) upserts what it can but deletes NOTHING, so a
  still-held position whose security row was dropped this run is never mistaken for sold.
- A malformed 200 (missing/null/non-array holdings) is NOT read as sold-all: syncHoldings leaves
  every account's rows intact and audits plaid.holdings.malformed (the SimpleFIN Array.isArray
  guard, #128 transactions:null hazard).

## Duplicate-detection differing-last-4 rule (#291, refined #292)

A different last-4 means different CARDS, not necessarily different ACCOUNTS: one account can carry
several cards (a spouse authorized-user card) with different numbers but ONE shared balance. So in
duplicateSignals (src/lib/engine/account/duplicates.ts), a differing last-4 disqualifies ONLY the
WEAK name signal, NEVER the strong identical-non-zero-balance signal:
`const masksDiffer = !!lo.mask && !!hi.mask && lo.mask !== hi.mask;` then the shared-name signal is
gated on `!masksDiffer`. Uses the mask COLUMN only (Plaid populates it; SimpleFIN/manual are null).
Applies to BOTH the #192 duplicate warning and the reconciliation candidate path (shared function).

- His Venture ····6271 ($10,218.99) vs spouse Venture ····0966 ($0) — both Plaid, DIFFERENT masks,
  DIFFERENT balances, matched only on the name "venture" -> name disqualified -> NOT flagged.
- His Chase E.LEE (no mask column, SimpleFIN) vs wife M.LEE ····4927 (Plaid), IDENTICAL balance ->
  the identical balance is a real same-account signal (likely his account + her authorized card) ->
  SURFACED so the owner can Combine (one account) or dismiss (genuinely separate). Not hidden.
- The mask-only rule is deliberate: #292 REMOVED an explored name-embedded last-4 extraction because
  parsing a 4-digit from a name mis-reads a parenthesized YEAR ("Roth IRA (2021)") or the x in
  "Amex" as a last-4 and would silently suppress a genuine identical-balance duplicate (critic
  F1/F2/F3, the double-count direction). A real duplicate whose sides differ only by card number but
  share a balance is always surfaced on the balance; the safe direction is a visible dismissable
  pair, never a silent hide.

Dismissal: a user "Not a duplicate" dismissal is stored in NudgeDismissal under a `dup:<sortedIds>`
key and filtered from BOTH the duplicate warning AND the reconciliation candidates (an explicit
judgment binds every surface derived from the same signal — critic DUP-DISMISS-1).

## §Combined-accounts (the /accounts "Combined accounts" card — `components/finance/continued-accounts-view.ts`, DECISIONS #288)

Hand-verified render expectations for `continuedAccountsView`, locked by
`tests/unit/continued-accounts-view.test.ts` and `tests/unit/continued-accounts-critic.test.ts`.
`AccountReconciliation.successorAccountId` is NOT unique (`prisma/schema.prisma:193`), so N
predecessors may fold into one successor; the card renders ONE block per successor.

**A. One old account into one live account (the ordinary case).**
Input: one link, predecessor "Venture Rewards" (simplefin, mask null), successor "Venture" (plaid,
mask 6271), cutover 2026-07-18.
- block title: `Venture` / `(Plaid ····6271)`
- `combinesLine`: null (nothing is being combined that needs counting)
- `chainedLine`: null
- source line: `Continued from your old account Venture Rewards (SimpleFIN) — history kept through
  2026-07-18; this old account's balance no longer counts on its own.`
- Undo face: `Undo` — a bare face is honest only because it is the card's ONLY Undo
- Undo accessible name: `Undo — separate Venture Rewards (SimpleFIN) from Venture (Plaid
  ····6271); that old account counts on its own again`

**B. THE REPORTED DEFECT — two old accounts, one live account, identical names.**
Input: two links, both predecessors named "Venture" (simplefin, mask null), both into successor
"Venture" (plaid, 6271), both cutover 2026-07-18. Nothing in the DATA distinguishes them.
- ONE block (not two rows), `sources.length === 2`
- `combinesLine`: `Combines 2 old accounts into this one. Each is listed below and can be undone on
  its own.`
- source lines differ ONLY by the ordinal, which is what makes them tellable apart:
  `Old account 1 of 2: Venture (SimpleFIN) — history kept through 2026-07-18; this old account's
  balance no longer counts on its own.` and the same with `Old account 2 of 2`.
- Undo faces: `Undo old account 1: Venture` / `Undo old account 2: Venture` — distinct because the
  ordinal sits at a fixed offset ahead of the name, so no name can forge a tie.

**C. Two live accounts that would each render one identical Undo (cross-block tie).**
Input: predecessors both "Venture", successors "A" and "B" (different ids).
- Every control is numbered by card position: `1. Undo: Venture`, `2. Undo: Venture`
- the SAME number is prefixed onto each source line, so the discriminator the user is asked to read
  is anchored in the prose beside the button, not invented on the control alone.
- Why this is unforgeable for ANY input: label `i` becomes `"{i}. " + label`. For i ≠ j, decimal(i)
  and decimal(j) either differ at a digit, or one is a strict prefix of the other — in which case
  the shorter is followed by `.` where the longer has a DIGIT. A digit is never `.`, so the two
  differ at a fixed offset no matter what follows. (The earlier "(copy N)" suffix was NOT safe: it
  appended into the same string space it compared, so a predecessor literally named
  "Venture (copy 1)" tied with a rewritten "Venture" — 39 of 4000 fuzz seeds.)
- A block folding in exactly ONE old account never says "old account 1" — it never enumerated
  anything, so the face is `Undo: <name>`.

**D. Names that differ only in invisible characters.**
Input: predecessors "Venture", "Venture " (trailing space), "Ven<U+200B>ture", "Venture  " (double
space), under four different successors. Provider names are stored untrimmed
(`simplefin.ts:475`, `plaid.ts:344`), so this is ordinary input.
- all four sanitize to the SAME rendered name `Venture` (NFC, strip
  C0/C1/bidi/default-ignorable, collapse whitespace, trim)
- therefore the tie is REAL and the numbering fires: four distinct faces, all containing
  `Undo: Venture`. Comparing raw strings would have found four "distinct" labels that paint
  identically on screen.
- A name of `"\u202eVenture\u202c evil"` renders as `Venture evil` — the override that would have
  reversed the rest of the button face is stripped, not escaped.
- A name that sanitizes to nothing renders as `Unnamed account`, never an empty control face.

**E. Chain Q → P → S (a mid-chain node is NOT live).**
Input: link 1 predecessor "Q old" → successor "P mid" (id P); link 2 predecessor "P mid" (id P) →
successor "S live".
- `getFinanceSnapshot` emits each link with its DIRECT successor (`transactions.ts:525`) and the
  boundary zeroes EVERY predecessor's balance (`reconcile-boundary.ts:419`), so P heads its own
  block while contributing $0 and while being folded into S one block below.
- The P block therefore carries `chainedLine`: `This account was itself later combined into another
  one, shown in its own block below. Its balance does not count here.`
- The S block's `chainedLine` is null.
- No source line in either block claims where the balance WENT — the module receives neither
  successor liveness nor the claim span, so it states only the fact that is true in every state:
  the old account's balance no longer counts on its own.

## §Card-identity (the /cards identity line — `components/finance/card-identity-view.ts`, DECISIONS #289)

Hand-verified expectations for `cardIdentityLabels`, locked by `tests/unit/card-identity-view.test.ts`.
The caller passes the DISPLAY-ordered card list; the map is keyed by `cardId`, which IS `Account.id`
(`cash-needed/assemble.ts:157` → `engine.ts:164`).

**A. Distinct names — the last-4 is additive, not a disambiguator.**
Cards "Venture" (mask 6271) and "Spark Miles" (mask 5154) → `{a: '····6271', b: '····5154'}`.
A uniquely-named card with NO mask gets no entry at all — an identity line that says nothing is noise
on a dense money surface.

**B. THE REPORTED SHAPE — three cards named `CREDIT CARD`.**
Masks 0977 / 2927 / 4105 → `····0977`, `····2927`, `····4105`. The name is unchanged; the
last-4 is the whole discriminator, and it is REAL data — never parsed out of the name (#292: a
parenthesized year and the x in "Amex" both mis-read as a last-4).

**C. Nothing in the data separates them — the numbering fallback.**
Two cards named `CREDIT CARD`, neither masked → `1. no card number on file` / `2. no card number on
file`. EVERY card is numbered once any two would tie, including already-unique ones: a number on only
some cards would read as a property of those cards rather than as a position in the list. Two cards
sharing a name AND a mask → `1. ····0977` / `2. ····0977`.
The number indexes the array it is HANDED, and the component hands it the displayed `ordered` list,
so the numbers read 1, 2, 3 down the page. It is a within-view marker, re-assigned if the toggle
reorders the list — never a durable name, which is why nothing else refers to it.

**D. The tie test compares what is PAINTED.**
Card "Venture" masked 0977 paints "Venture ····0977"; a card literally NAMED "Venture ····0977"
with no mask paints the same thing (those glyphs are copyable off /accounts). A separator-joined key
calls them distinct and skips the numbering — so the comparison is the rendered string, sanitized.
Both are numbered.

**E. The last-4 is validated, and the dots never over-claim.**
`lastFour` keeps digits only and takes the final four: a full PAN `4111111111111111` renders
`····1111`, never the raw value (nothing enforces schema.prisma:155's "last 4 only", and Plaid's
value is stored verbatim). A short issuer mask `12` renders `ending 12` — NOT `····12`, because four
dots would claim four digits. A digitless mask (`"n/a"`, whitespace) is treated as no number at all.
`••••0977` → `····0977` (separators a feed might include are stripped).

**F. Scope coverage.** The map is built server-side from `cashNeededSnap.accounts` — the
household-MERGED snapshot the obligations are computed over — not from the personal `snap`, so a
partner's card carries its identity too. A partner's last-4 is already part of what a shared account
discloses (docs/PRIVACY.md: name, type, last-4 mask, current balance).

**Known limitation.** `Account.mask` is written ONLY by the Plaid path (`plaid-map.ts:121`); SimpleFIN
never sets it and a manual account hardcodes null (`networth-actions.ts:52`), and the demo seed writes
none. So a SimpleFIN-only or manual-only user gets the numbering fallback rather than real last-4s,
and demo mode exercises the fallback only.

## §Recurring cadence → monthly rate, and the projection window (L.23/L.24, hand-verified)

**A. The monthly rate of each cadence.** `monthlyRateCents` on a $120.00/wk, $120.00/2wk,
$250.00/mo and $1,200.00/yr bill: weekly `round(12000 × 52 / 12)` = **$520.00**; biweekly
`round(12000 × 26 / 12)` = **$260.00**; monthly **$250.00** unchanged; annual
`round(120000 / 12)` = **$100.00**. L.24 added two: a $300.00 quarterly bill `round(30000 / 3)`
= **$100.00**, and a $600.00 twice-a-year bill `round(60000 / 6)` = **$100.00**. Half-up
rounding where the amount does not divide: $100.00 quarterly → **$33.33**, $100.01 semiannual →
**$16.67**. IRREGULAR and a null cadence count at face ×1 — the safe direction for the least
predictable shape the detector emits. The SAME six factors live in `summary.ts`'s `PER_MONTH`
(the /recurring headline); the two tables are deliberately unshared — they disagree about
IRREGULAR and this one keeps an exact integer form — and are held together by a test.

**B. Which cadences reach the money at all.** `toScheduledTransactions` projects WEEKLY,
BIWEEKLY and MONTHLY unconditionally, and the three LONG cadences — QUARTERLY, SEMIANNUAL,
ANNUAL — **for expenses only, and only while the series is still charging**. Income on a long
rhythm is held out (a bonus dated from one 365-day gap would offset a projected dip and silence
a warning — the failure direction differs by role). Every other rhythm reaches nothing, because
`cadenceFromGaps`' windows are 5–9, 12–16, 26–35, 84–98, 175–190 and 350–380 days and
`detectRecurring` drops IRREGULAR before the filter is reached — executed, the dropped set
includes 10-day, 21-day (three-weekly), 42-day (six-weekly), 61-day (bi-monthly) and 548-day
rhythms, and each window's edges are sharp: a 349-day gap is dropped, 350 and 380 are ANNUAL,
381 is dropped.

**B1a. The every-gap licence the two NEW cadences must earn (L.24).** QUARTERLY and SEMIANNUAL
are the only cadences whose classification requires EVERY gap to fall inside the band, not
merely their median. With three sightings there are two gaps and their median IS their mean, so
gaps of 30 and 150 days average to 90 and would otherwise read as a quarterly bill; executed,
`[30, 150]`, `[10, 172]` and `[90, 274]` are all dropped, while `[91, 89, 92]` is QUARTERLY and
`[182, 181, 184]` is SEMIANNUAL. **Band membership alone is NOT the rule**, because the quarterly
band is 15 days wide and two gaps can both sit inside it without being a rhythm: the L.24 money
critic broke the first version with three haircuts **84 and 98 days apart** — both gaps in band,
every-gap satisfied — which produced a projected `QUARTERLY` bill, a monthly rate of $15.00 and a
date on the calendar, from three discretionary purchases. It also broke it through the
two-plateau price-change path (three vet visits at $100/$100/$250, 84 and 98 days apart). So the
gaps must ALSO agree with each other: `max(gaps) - min(gaps) <= 7` days. Executed, that rejects
`[84, 98]`, `[98, 84]` and `[175, 190]` while costing no genuine bill — real anchors cluster far
tighter: calendar-quarter billing 89–92 (spread 3), first-business-day-of-quarter 90–92 (spread
2), a real Jan 31 / Apr 30 / Jul 31 / Oct 31 water bill 89–92 (spread 3), semiannual 181–184
(spread 3). The band edge is sharp and was executed rather than described:
`[91, 91, 98]` is QUARTERLY and `[91, 91, 99]` is IRREGULAR, `[91, 91, 83]` (eight days EARLY) is
IRREGULAR, and `[182, 182, 191]` is IRREGULAR — so the rule is "more than about a week off in
EITHER direction", not "late". It applies to every gap in the whole history, not to the first
three: `[90,91,92,92,90,91,105,91,91,92,90,91]` — a thirteen-sighting quarterly bill with ONE
14-day-late cycle years ago — is IRREGULAR permanently, because `detectRecurring` reads all of
history and later on-time cycles cannot retire the bad gap. That is the cost of the licence, and
it is stated on /spending-plan rather than left for the reader to discover. Strictness is the safe direction HERE, which is the opposite of the usual reading: a
missed detection leaves the reader with the status quo (an uncounted bill), whereas a false
positive is a NEW invented obligation that prints a dated outflow on /calendar and can raise a
radar "move $X by <date>" for a bill that does not exist. The four older cadences keep the
median-only rule, deliberately — raising their bar would re-detect every existing user.

**B2. What a long-cadence series costs to detect.** Three sightings at a stable amount: two
points give one gap and no median to infer a cadence from, and three distinct amounts (a premium
that rises every year) fail the two-plateau stability rule. Three yearly sightings span **731
days**, three semiannual ones roughly **365**, three quarterly ones roughly **182** — so a
quarterly bill needs about six months of history, a twice-a-year bill about one year, and an
annual bill is invisible until roughly two years of history exist — which is why the audit
panel's yearly-bill clause is gated on one actually being in the figure, and why the
"What this figure can't see" list states the precondition when it is not.

**B3. When a series stops counting.** `isSeriesActive` — silence longer than `CADENCE_DAYS ×
1.5`, rounded — is shared by the projection filter and the `/recurring` summary, so a lapsed
series cannot be $0/month on one surface and a full monthly rate on the other. At ANNUAL that is
548 days: last seen 2025-01-01 is still charging on 2026-07-03 (548) and not on 2026-07-04 (549).
Executed for the two cadences L.24 added, from the same 2025-01-01 anchor: QUARTERLY's cutoff is
**137** days (active on 2025-05-18, lapsed on 2025-05-19) and SEMIANNUAL's is **273** (active on
2025-10-01, lapsed on 2025-10-02). The gate is applied to the three LONG cadences only; a MONTHLY
series silent for a year is still projected (recorded in docs/STATUS.md §L.23 OPEN #6).

**C. One occurrence per sub-year window.** A $1,200.00 premium next due 2026-08-15, today
2026-06-10: the forecast expands **one** occurrence at a 90-day horizon (window ends 2026-09-08)
and **zero** at 60 days (ends 2026-08-09); the cash-needed assembler, whose default horizon is
60 days, likewise sees zero and sees one at 90. Across an 800-day window (ends 2028-08-18) it
expands **three**: 2026-08-15, 2027-08-15, 2028-08-15 — the explicit 12-month step. No *horizon*
caller exercises it (cash-needed 60, forecast 90, `RADAR_HORIZON_DAYS` 90), but the calendar's
month view is a URL query param with prev/next links, so a window a year or more ahead is twelve
clicks away. The second occurrence appears at ~431 days here, NOT at 366: the bound depends on
the anchor's phase within the window, so "identical below 366 days" is the wrong way to state it.
The step also self-heals a row whose `nextDate` is already in the past — that difference is
date-scoped, not window-scoped.

**C2. A QUARTERLY row does NOT recur inside any horizon this app forecasts (L.24, corrected by
an executed test).** A quarterly PERIOD is 91–92 days, which is longer than the 90-day widest
horizon in the codebase — so in forecast and cash-needed a quarterly row expands to at most
**one** occurrence, exactly like an annual one. A first draft of the L.24 comments claimed the
opposite in three source files ("a quarterly row genuinely CAN recur inside a 90-day horizon")
and the test written to prove it failed instead: next due 2026-06-15 with today 2026-06-10, a
90-day window ends 2026-09-08 and the second occurrence falls on 2026-09-15, seven days outside.
The two places the explicit 3-month step DOES change the answer, both executed: the calendar's
month view (2026-09-15 and 2026-12-15 appear on their own grids — three and six clicks from
today, where the old catch-all `else` left them empty), and a stale anchor self-healing forward
(next due 2026-01-15, already past, now yields 2026-07-15 inside a 90-day window where before it
was dropped entirely). Across a 400-day window the forecast and the assembler both expand five:
2026-06-15, 2026-09-15, 2026-12-15, 2027-03-15, 2027-06-15.

**C3. The rate is a fixed fraction, so a bill at a band EDGE is under-counted by up to ~8%
(L.24 money critic P2-3, executed).** The quarterly band admits 84–98 days but the rate is a flat
1/3. A bill every 84 days charges 4.35 times a year, not 4: a $300.00 bill counts **$100.00**/mo
where its true rate is **$108.71**/mo. Semiannual at 175 days: $600.00 counts $100.00 against a
true $104.36. Direction: under-counting a fixed expense RAISES guilt-free spending — the
dangerous direction — bounded at ~8.7% of that one bill's monthly share. Pre-existing in the same
shape for ANNUAL (a 350-day rhythm counts $100.00 against a true $104.36) and NOT introduced by
this slice, but newly reachable at two more cadences. Recorded rather than fixed: rating by the
observed median gap (`amount × 365.25 / medianGap / 12`) is a different rating model for every
cadence, which would move existing figures — docs/STATUS.md §OPEN after L.24.

**C4. Month-end anchors drift one day per clamp and never recover (L.24 money critic P3-6,
executed).** A real Jan 31 / Apr 30 / Jul 31 / Oct 31 water bill (gaps 89, 92, 92, 92) detects
QUARTERLY with `lastSeenAt 2026-04-30` and `nextExpectedAt 2026-07-30` — one day before the real
2026-07-31 — and the chain compounds (`2024-01-31 → 04-30 → 07-30 → 10-30 → 2025-01-30`). Same
class as the MONTHLY bound already recorded at `plan.ts`'s `scheduledOccurrencesBetween`, now
recorded for the long cadences too. The critic swept 4 cadences × 5 anchors (including 2019-01-31
and leap 2020-02-29): **no infinite loop and never a past date**, max 88 steps.

**D. What the plan does with it.** A detected $1,200.00/yr premium subtracts **$100.00** from
guilt-free spending every month, including the month the full $1,200.00 actually leaves the
account — eleven months are $100.00 conservative and the twelfth is $1,100.00 optimistic. That
is the smoothing the owner's formula asks for ("expenses are also based on patterns"), disclosed
on the audit panel rather than left implicit, and recorded in docs/STATUS.md §L.23 OPEN #3.

## §Exclude-from-totals + Reimbursement tracker (O.15 slice 2 — `engine/transactions/exclude.ts` / `reimbursement.ts`, DECISIONS #342)

Hand-verified expectations locked by `tests/unit/exclude-from-totals.test.ts`,
`tests/unit/reimbursement.test.ts`, and `tests/e2e/action-menu.spec.ts`.

### The exclusion property (one basis, checked by equivalence)

Every summer is tested the same way: the total with a row present-and-excluded
must equal the total with that row physically deleted — exclusion may never
invent a third value. Known answers:

- Reports: rows −21240 (groceries, excluded) + −5000 (dining) → total **5000**,
  byte-equal to the breakdown over the dining row alone.
- Flows: income +500000, spend −21240 excluded → expenses **0**, income
  **500000**; excluding the income row instead → income **0**, expenses 21240.
- Register (e2e, hand-computed): −$40.00 + −$25.00 spend, −$10.00 transfer,
  +$40.00 inflow → Money out **$65.00**; excluding the $40.00 row → **$25.00**;
  row count stays (the badge, not absence, is the disclosure); undo restores
  $65.00 exactly.
- Deliberate NON-appliers, each a reality the reader cannot re-classify away:
  account balances/net worth, cash-needed/statement math, recurring detection,
  tax export (an explicit `taxClass` outranks exclusion — the O.13b silent-
  deduction lesson). Recorded in `exclude.ts`'s header.

### Reimbursement (informational only — no sum ever moves)

- Outstanding line: awaiting outflows only, each once, by |amountCents|:
  12550 + 2450 = **15000**; 'received', inflows, split containers and
  unrecognized states count **0**. An awaiting row that is ALSO excluded still
  counts (cash owed is not a budget figure).
- `monthlyFlows` / `isSpendRow` are byte-identical with and without any
  reimbursement mark (the double-count guard, locked by test).
- Offsetting-inflow match: exact |amount|, POSTED, non-transfer, non-split,
  untracked, on/after the purchase. Window by hand: purchase 2026-06-10 + 90
  days → 2026-09-08 **in**, 2026-09-09 **out**. Earliest wins; same-date ties
  break by id. A match is a SUGGESTION rendered on the detail view — never a
  stored link, never part of a figure.

## §Recurring: the reader's own verdict (O.13f / O.15 slice 4, hand-verified)

All values below are executed in `tests/unit/recurring-override.test.ts` against
today = **2026-06-10**, and the descriptors' canonicals are read from
`normalizeMerchant`, not assumed: `LAKESIDE PROPERTY MGMT RENT` → `Lakeside Property
Mgmt Rent` (category `rent`), `SUPERCUTS 4412` → `Supercuts` (`personal-care`).

**A. What a declaration is allowed to claim.** ONE charge on 2026-05-15 for
**−$1,250.00**, declared MONTHLY, produces a series with `typicalAmountCents`
**−125000**, `lastSeenAt` **2026-05-15**, `nextExpectedAt` **2026-06-15** (one month on,
already ≥ today), `occurrences` **1**, `categoryId` `rent`, `isIncome` false and
`declaredByUser` **true**. Every one of those except the cadence is read off the
reader's real charge by `buildSeries`, the same function detection uses. With no
declaration the same input detects **nothing** — three sightings are the bar.

**B. No price-change claim, ever.** Two charges at two amounts (−120000 on 2026-04-15,
−125000 on 2026-05-15) is exactly the shape the two-plateau rule reads as a price rise
WITH three sightings. Declared, it yields `previousAmountCents` **null** and
`priceChangedAt` **null**, and `typicalAmountCents` **−125000** (the most recent charge,
as detection does). From two rows a price claim would be the app originating a fact.

**C. The declared rhythm steps past today.** Anchor 2026-01-15, today 2026-06-10:
WEEKLY → **2026-06-11**, MONTHLY → **2026-06-15**, ANNUAL → **2027-01-15**. Same
`nextDate` loop as a detected series, so a declaration cannot land a date in the past.

**D. It reaches the money.** The series in (A) through `toScheduledTransactions` with
scope `{paymentAccountId: 'acct-checking', cashAccountIds: {'acct-checking'}}` is
exactly one row: `{accountId: 'acct-checking', description: 'Lakeside Property Mgmt
Rent', amountCents: -125000, nextDate: '2026-06-15', cadence: 'MONTHLY', source:
'recurring'}` — the same shape a detected bill produces, so every downstream expander
(cash-needed, forecast, calendar, the plan's fixed term) treats it identically.

**E. A demotion removes the projection, not just the listing.** Three haircuts on
2025-12-10 / 2026-03-11 / 2026-06-09 (gaps 91 and 90 — inside the quarterly band and
within the 7-day spread licence) DETECT as QUARTERLY and produce one scheduled row.
With `NOT_BILL` for `Supercuts`: **0** series and **0** scheduled rows, while every
other payee in the same input is byte-identical. NOT_BILL also beats a BILL row for the
same payee and beats the evidence — it is the only lever against a false detection.

**F. What is refused rather than half-honoured.** A BILL row whose cadence is not one of
the six projected cadences (including `IRREGULAR`) reads back as NO instruction, at both
the write boundary and `parseRecurringOverride`; a declaration naming a payee with no
charges produces no series (there would be no amount to state and no date to anchor) and
/recurring says so; and a BILL whose payee ALSO detects keeps the DETECTED cadence, with
`declaredByUser` false — the page then reads "Aimplifi now sees the pattern … so removing
this would change nothing" rather than claiming his rhythm is the one running.

## §Rule tag-for-taxes (O.15 slice 6 — `engine/categorize/tax-action.ts`, DECISIONS #346)

Hand-verified expectations locked by `tests/unit/rule-tax-action.test.ts`,
`tests/unit/keyword-rules-server.test.ts`, `tests/unit/backfill-tax-tag.test.ts`
and `tests/e2e/keyword-rules.spec.ts`.

### The stamp decision (`resolveRuleTaxStamp`) — abstentions are the majority

| rule's `setTaxClass` | row's current `taxClass` | result |
|---|---|---|
| `business` | null / undefined / `''` / `'   '` | **`business`** (the only writing case) |
| `business` | `medical` | **null** — never re-answer the reader |
| `business` | `business` | **null** — a no-op is not a write, so no count claims it |
| `business` | `crypto-losses` (unknown) | **null** — overwriting destroys the only record of his choice |
| null / `''` / `BUSINESS` / `not-a-class` | anything | **null** — the read-path gate |

### Which filings may carry a stamp

Typed rule that files → **stamps**. Learned rule carrying the same column →
**null**. Sign-refused rule (outflow into an Income category, so it never filed)
→ **null**. Merchant default, provider-category rescue, transfer, fallback →
**null**. This is what keeps every pre-slice filing byte-identical.

### The apply-to-existing sets, on the three `mirko` rows of the server suite

Base: 3 matched rows, target `dining`, tag `business`.

- All three untagged, none hand-filed, none excluded → `wouldTagCount` **3**,
  `alreadyTaggedCount` **0**, written **3**.
- One row pre-tagged `medical` → **2** tagged, **1** already-tagged, and that row
  still reads `medical` afterwards.
- All three ALREADY filed as `dining` → `affected` **0**, `taxTagged` **3**. This
  is the pair that proves the tag set is not the re-file set.
- Rule targets `income` (all three are outflows) → `signMismatchCount` **3**,
  `wouldTagCount` **0**, written **0**.
- One row hand-filed to `groceries` (a Correction, not in review) →
  `handFiledCount` **1**, `wouldTagCount` **2**, written **2**; the outlier keeps
  `groceries` and stays **untagged**.
- One row `excludeFromTotals: true` → `wouldTagCount` **2**, written **2**; the
  excluded row is still FILED as `dining` and stays **untagged**.
- No category chosen yet → `wouldTagCount` and `alreadyTaggedCount` are both
  **null**: the sign guard is part of the set, so any number shown before a
  category exists is one the save would reduce.

### The backfill (same decision, its own scope)

An unsure row the rule resolves → re-filed **and** tagged, `taxTagged` **1**.
Pre-tagged `medical` → re-filed, `taxTagged` **0**, tag untouched. Excluded row →
re-filed, `taxTagged` **0**. Split CHILD → `taxTagged` **0** (it carries its
parent's descriptor, so the keyword matches, and its amount is real money in the
export). Blank tag `''` → re-filed **and** tagged, because the two writers share
one definition of "untagged".



## §C.25 read-side loan-payment flow exclusion (`engine/categorize/loan-payment-flows.ts`, DECISIONS #403)

The four gates: (1) row would otherwise count (CHECKING/SAVINGS outflow, POSTED,
not split parent, not reader-excluded); (2) canonical linked to ONE loan account by
**≥2 distinct calendar months** of ±3-day same-|amount| pairs, re-derived at read
time (stored `isTransfer` never consulted); aggregate canonicals refused; (3) that
account has a DATEABLE obligation; (4) |amount| equals an obligation payment.

Fixture A — the owner shape (Truist, obligation **621707**, due day 1):
loan inflows +621707 on 2026-05-05 / 06-04 / 07-10; chk outflows −621707 on
04-03 (unflagged, no counterpart), 05-04 (flagged, pairs at 1 day), 06-03
(flagged, pairs), 07-06 (unflagged, counterpart 4 days out = NO pair).
Pair months = {05, 06} = **2** → eligible. **All four outflows excluded**;
with payroll +500000 on the 1st and groceries −10000 on the 15th of each month,
`monthlyFlows` prints expenses **10000** and savingsRateBps **9800** in all four
months (today: Apr/Jul print 631707 expenses). Gate-4 note: t-may/t-jun were
already out via their stored flag — the ids that CHANGE totals are Apr and Jul.

Fixture B — generic descriptor (P0-1 of the reverted attempt): descriptor
`ONLINE PAYMENT` (non-aggregate canonical) on auto-loan payments −45000,
2026-05-15 + 06-15 (both pair with the auto account's +45000 inflows next day),
plus rent −190000 (06-01), electric −22000 (06-12), internet −9500 (06-14) under
the SAME descriptor. Excluded: **exactly the two −45000 rows**; rent/electric/
internet stay, because gate 4 matches the obligation amount only.

Fixture C — one coincidence (P0-2): roofing −621707 on 06-17 pairs with the
mortgage inflow 06-18; no other roofing row exists. Pair months = {06} = **1**
→ NOT eligible → the invoice stays in spending. Same for a first-payment
mortgage (one paired month only): visible until the second pair lands.

Fixture D — SimpleFIN loan: the MORTGAGE account carries NEITHER
`minimumPaymentCents` NOR `dueDayOfMonth` (verified: SimpleFIN writes neither)
→ no obligation → gate 3 fails → **no exclusion**, Apr/Jul rows count (visible
beats vanished, #400). Fixture E — undatable Plaid loan: payment present, due
day null → identical outcome.

Fixture F — escrow adjustment: as A plus −650000 on 08-04 (pairs 08-05);
obligation still 621707. Gate 4 fails for the 650000 row → it STAYS visible;
the four 621707 rows stay excluded.

Fixture G — aggregate canonical: descriptor `CHECK 1041` (aggregate `check`),
two paired months, matching obligation → **never excluded** (C.4 doctrine).

Boundary: two pairs in ONE calendar month (05-02 and 05-20) = 1 distinct month
→ not eligible. PENDING rows are never in flows regardless of the set.


Capacity cap (critic cycle 2): per canonical, month and amount, at most the
CARRIED count leaves — the month's loan inflows at that amount onto eligible
accounts (observed) or the obligations covering it there (projected),
whichever is larger. Two $6,217.07 rows against one July inflow → exactly one
leaves. Same-amount RENT under a generic canonical: the attributed loan
payment takes the capacity, the rent stays (and when both pair
coincidentally, exactly one unit leaves — the invariant is on the SUM). A row
paired with an INELIGIBLE account, even alongside an eligible one, never
leaves (ambiguity keeps it visible); a lone ambiguous month stays too.
Fixture A still excludes all four rows: Apr via the obligation capacity (no
inflow that month), May/Jun/Jul each at capacity 1.
