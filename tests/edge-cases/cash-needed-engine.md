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
- firstDueDate = **2026-06-15** (FIRST effective due date — the aggregate total
  is dated with the earliest payment: the whole-cycle total needed "by the last
  due" under-demands late, audit P2)
- byDate = **2026-06-26** (last effective due date — the PROJECTION HORIZON: the
  day-by-day walk must see every obligation, and the dip can land anywhere)
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
