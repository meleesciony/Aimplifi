## §Money you put in — brokerage deposits read from the bank side (DECISIONS #788)

Engine: `src/lib/engine/investments/deposits.ts` (`computeDepositHistory`), brokerage list
`src/lib/engine/investments/brokerages.ts`, words `src/lib/engine/investments/deposits-copy.ts`,
loader `src/server/investment-deposits.ts`, card `src/components/finance/deposit-history-card.tsx`.
Tests: `tests/unit/investment-deposits.test.ts`, `tests/e2e/investment-deposits.spec.ts`. Every
account, amount and date is invented. Unit `today = 2026-10-17` (records from 2025-01-02 unless a
case says otherwise); e2e and demo `today = 2026-06-10`.

**The owner's choice (2026-10-05, verbatim option).** "Bank side, no new fee — … It counts money
sent from your linked checking or savings into a linked brokerage or retirement account, month by
month. It misses 401(k) contributions taken out of your paycheck and deposits from banks you haven't
linked."

**Sign.** A bank OUTFLOW is money put in; a bank INFLOW is money taken out. Amounts are kept as
positive cents with a direction; nothing is ever netted inside a month (put in and taken out are
separate sums; the lead states the difference).

**The window.** Records start = the earliest row on any live CHECKING or SAVINGS account (cards do
not move it). First covered month = that month when the row is on the 1st, else the next month. Shown
= from max(first covered month, this month − 12) through this month (partial). This year = from
max(January, first covered month).

| Case | Rows | Expected |
|---|---|---|
| Name | chk 2026-09-05 −$500.00 "VANGUARD BUY INVESTMENT", Investment & Savings; Vanguard linked | Sep put in $500.00 → Vanguard Brokerage (by name); this year $500.00 |
| Last four | chk 2026-09-10 −$250.00 "ONLINE TRANSFER TO XXXXXX6604"; Roth IRA ··6604 (no brokerage) | Sep $250.00 → Roth IRA (by last four). Also X6604, ...6604, *6604, #6604, ENDING IN 6604, ACCT 6604, ACCT# 6604, acct no. 6604. NOT: "TRANSFER 6604", "BOX6604", "X66041", "X6604A" |
| Taken out | + chk 2026-08-14 +$300.00 "VANGUARD REDEMPTION" | Aug taken out $300.00; this year $500.00 in / $300.00 out; lead "… — $200.00 more in than out." |
| Landed in your account | chk 2026-07-02 −$400.00 "…XXXXXX6604"; sav 2026-07-09 +$400.00 | Not counted, "landed-in-your-account" (7 days apart pairs); sav on 07-10 (8 days) → counted $400.00 |
| One to one | chk 06-01 −$500.00 to savings; sav 06-01 +$500.00; chk 06-03 −$500.00 "VANGUARD BUY" | The same-day pair takes the savings inflow first; the Vanguard $500.00 COUNTS |
| Not linked | chk 09-12 −$100.00 "ROBINHOOD FUNDS" | Not counted, "not-linked", Robinhood |
| Bank move naming a brokerage | chk 09-15 −$200.00 "SCHWAB MONEYLINK"; Schwab Checking +$200.00 09-16; no Schwab investment account | Ignored (not listed) |
| Same-brokerage bank account, covered | Schwab Checking records from 2025-01-03; chk 2026-09-20 −$1,000.00 "SCHWAB BROKERAGE MONEYLINK" | Counted → Schwab Brokerage |
| … records from 09-13 / 09-14 | week before 09-20 is 09-13 | 09-13 covers (counted); 09-14 does not ("unclear-account") |
| … feed stopped 09-27 / 09-28 | week after is 09-27 | 09-27 → unclear; 09-28 → counted |
| … row 2026-10-11 / 10-10 | week after must be ≤ today (10-17) | 10-11 → "too-new"; 10-10 → counted |
| … with the last four X2202 | 2026-10-15 | Counted by last four — no coverage test |
| Two names | "VANGUARD SCHWAB MOVE" | unclear-account |
| Shared last four | a card also ends 5521 | unclear-account |
| Last four vs name | "SCHWAB TRANSFER X5521" (5521 is Vanguard) | unclear-account; "VANGUARD TRANSFER X6604" (6604 has no brokerage) → Roth IRA |
| Several at one brokerage | Vanguard Brokerage + Vanguard IRA, by name | one destination "Vanguard (2 accounts)" |
| Combined account | old copy (→ live checking) −$250.00 VANGUARD 09-01, live +$250.00 09-02 | counted on the live checking; the two copies never pair |
| Filed Investment & Savings, names nothing | "MARCUS SAVINGS TRANSFER" | Not counted, "no-account-named"; the same filed Transfer → ignored |
| Never counted, never listed | pending, split parent, excluded from totals, any other filing, no filing, on a card, $0.00, after today | — |

**Demo seed (today 2026-06-10).** −$750.00 "ONLINE TRANSFER TO BROKERAGE X8842" on the 3rd of every
month from Jan 2025; +$2,000.00 "ONLINE TRANSFER FROM BROKERAGE X8842" on 2026-03-18. Window
Jun 2025 – Jun 2026 = 13 months × $750.00 = $9,750.00 put in, $2,000.00 taken out (Brokerage). This
year (Jan–Jun) 6 × $750.00 = $4,500.00 in, $2,000.00 out → "$4,500.00 put in and $2,000.00 taken
out so far this year — $2,500.00 more in than out."

**E2E throwaway (today 2026-06-10).** Vanguard Brokerage ··5521 (institution Vanguard); 2026-04-06
−$600.00 VANGUARD BUY; 2026-05-04 −$450.00 "…XXXXXX5521"; 2026-05-20 +$300.00 VANGUARD REDEMPTION;
2026-05-22 −$150.00 ROBINHOOD (not linked). Year: $1,050.00 in, $300.00 out → "$750.00 more in than
out"; May "$450.00 put in · $300.00 taken out"; one "Not counted" row.
