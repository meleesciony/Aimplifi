# Seed / Demo Dataset Specification

`prisma/seed.ts` builds this deterministically relative to an `--asOf` date
(default: 2026-06-10). All randomness from a fixed-seed PRNG. A `seed.test.ts` asserts
every invariant marked ✔ below.

## Demo user
- email `demo@pulse.finance`, hourly wage $38.00/hr (after-tax effective),
  SWR 400 bps, expected return 700 bps, money dials: ["Travel", "Dining Out"].
- Payment account = "Everyday Checking".

## Accounts (✔ counts)
1. **Everyday Checking** — balance ≈ $3,400 at asOf; designated payment account.
2. **High-Yield Savings** — ≈ $18,500.
3. **Joint Checking** — ≈ $1,200, light activity.
4. **Sapphire Card** (credit) — due 15th, cycle closes ~18th prior month. Statement
   $2,712.33 due asOf+5. ✔ no autopay.
5. **Platinum Card** (credit) — due 15th. Statement $2,100.00. ✔ autopay
   STATEMENT_BALANCE.
6. **Freedom Card** (credit) — due 28th. ✔ mid-cycle manual payment of $400.00
   already applied this cycle (statement $1,000.00 → $600.00 remaining).
7. **Store Card** (credit) — low use; current cycle statement **not yet generated**
   (✔ estimate path exercised); occasional $0-due cycles in history.
8. **Brokerage** (investment) — ≈ $142,000, monthly drifting value history.
9. **Auto Loan** — ≈ $14,300 remaining, $385/mo scheduled payment.

Distinct billing cycles across the four cards ✔ (two share the 15th due date ✔ —
exercises same-day aggregation; one due date in history falls on a weekend ✔).

## Transactions — 18 months ending asOf (✔ span)
- **Payroll:** biweekly +$2,450.00 net, every other Friday ✔, into Everyday Checking.
- **Pending:** ≥3 pending transactions at asOf, including −$250.00 pending on the
  payment account ✔ (exercises edge case J).
- **Recurring subscriptions (≥8 ✔):** Spotify (via `PAYPAL *SPOTIFYUSA`), Netflix
  (✔ price increase $15.49 → $17.99 four months ago), a gym membership
  (✔ unused — no related visits — and last meaningful interaction >90 days),
  iCloud, YouTube Premium, a meal-kit, car insurance (semi-monthly trap: monthly),
  internet, plus the auto-loan payment as a recurring obligation.
- **Messy descriptors ✔:** at least 40 distinct raw forms including `SQ *`, `TST*`,
  `AMZN Mktp US*…`, `PAYPAL *…`, `HMSHOST-ATL-T4-POS…`, `COSTCO GAS #` vs
  `COSTCO WHSE #`, `UBER *TRIP`, `UBER *EATS`, check numbers, ACH descriptors.
- **Transfers ✔:** monthly checking→savings $500 and card-payment transfers — must be
  detectable as transfers (excluded from income/expense).
- **Lifestyle creep ✔:** discretionary spend (dining, shopping) rises ~4%/mo over the
  final 6 months while income is flat — detectable by the Phase 3 creep engine.
- **Refund:** one $50.00 credit posting 2 days after a statement close on Sapphire ✔.
- **Engineered intra-period dip ✔:** rent −$1,800 lands 2 days before a payroll Friday
  each month so that, in the current cycle, the projected checking balance dips below
  the amount needed for the earliest card due date even though it recovers by the
  15th (mirror of edge case H; exact amounts chosen in Phase 1 and recorded in
  EDGE_CASES §Seed-headline with hand math).

## Statements
- 18 months of statement history per card (balance, min = max($35, 1% of balance,
  rounded to cents), cycle dates, due dates incl. one weekend-falling due date ✔).
- Current statements arranged so the asOf dashboard headline is non-trivial:
  total due ≈ $5,412.33 across three cards with a real shortfall vs. projected
  checking — final exact numbers fixed in Phase 1 + hand-verified.

## Determinism ✔
Same `--asOf` ⇒ identical dataset (assert via row counts + a checksum over a stable
serialization in `seed.test.ts`).
