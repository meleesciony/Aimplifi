## §Money you set aside — measured savings against the plan's savings line (DECISIONS #790)

Engine: `src/lib/engine/savings/measured.ts` (`measureSavings`, `savingsPlanLine`), words
`src/lib/engine/savings/measured-copy.ts`, inputs `loadDepositInputs` beside `getSpendingPlan`, section
`src/components/finance/measured-savings-card.tsx` on Guilt-free (`/spending-plan`, `#money-set-aside`).
It reads the rows and months of #788's deposit engine (`liveDepositRows`, `computeDepositHistory`). Tests: `tests/unit/measured-savings.test.ts`,
`tests/unit/measured-savings-card.test.tsx`, `tests/e2e/measured-savings.spec.ts`. Every account, amount
and date is invented. Unit `today = 2026-10-17`, records start 2025-01-02 and feeds vouch through
2026-10-16 unless a case says otherwise; e2e and demo `today = 2026-06-10`.

**The rule.** Set aside (a month) = money into the linked SAVINGS accounts, net of what came out, read from
their own rows (posted, not a split parent, not $0, not after today) + money into the linked INVESTMENT accounts,
net of what came back, exactly as "Money you put in" counts it. Money IN to savings counts only when it is half of a
move from a linked checking or savings account (both halves filed Transfer / Investment & Savings or flagged and
filed nothing else, equal, within a week, neither half a brokerage's movement by #788's verdict), money back from a
linked investment account, a bank's return of money that left the same account (bank return wording, equal, ≤ 14
days later), or pay (Paycheck, Bonus, Side Gig); anything else is listed as untraced. Interest and dividends (filed,
or worded INTEREST / INT / DIVIDEND / DIV on an unflagged row with no TRANSFER / XFER / ZELLE / WIRE word) are listed
and left out. Money OUT always counts, an excluded row included. Months, and the accounts whose records are missing
from each, are #788's. The average uses only complete months whose records are complete.

**Hand-verified cases (unit).**

| Case | Savings, net | Investments, net | Set aside |
|---|---|---|---|
| Checking → savings $500.00 (both rows) | +$500.00 | $0.00 | +$500.00 — the checking row is never read |
| Checking → Vanguard by last four $750.00 | $0.00 | +$750.00 | +$750.00 |
| Savings → Vanguard $1,000.00, $300.00 back (Sep) | −$700.00 | +$700.00 | $0.00 — counted once |
| Interest $3.21 + dividend $1.20 on savings | $0.00 | — | $0.00; earnings +$4.41 listed |
| Savings: pay +$2,000.00, purchase −$20.00, to checking −$100.00, to Betterment (not linked) −$500.00 (Aug) | +$1,380.00 | $0.00 (Betterment listed by #788) | +$1,380.00 |
| Combined savings: $400.00 on the old record (Sep 1) + $400.00 on a handover day reported by both | +$800.00 | — | +$800.00 |

**Average.** Savings records stop 2026-08-20 (no live feed): Aug and Sep are complete months with missing
records → left out; Oct 2025 – Jul 2026 (10 months) hold +$600.00 → $60.00 a month. Rounding is half away
from zero: −$0.05 over 12 months → $0.00 (never −$0.00); −$0.18 over 12 → −$0.02.

**Words.** Lead, against a $1,000.00 plan: $1,250.00 → "… $250.00 more than the $1,000.00 your plan sets
aside."; $1,000.00 → "exactly what your plan sets aside"; $400.00 → "… of the $1,000.00 … — $600.00 to
go."; $0.00 → "Nothing counted as set aside so far this month — your plan sets aside $1,000.00.";
−$300.00 → "So far this month $300.00 more has come out of your savings and investment accounts than gone
in — …". A month with missing records adds "Records for part of this month are missing, so this figure
may be incomplete." A line for an account kind the reader does not link is not drawn.

**Demo (e2e and unit loader, `today = 2026-06-10`).** Every month: +$500.00 into High-Yield Savings (the
1st) and +$750.00 into the Brokerage by its last four (the 3rd). Jan–Apr 2026 add a $380.00 shop payout
into savings; Mar 2026 has $2,000.00 back out of the Brokerage. June so far: $500.00 + $750.00 =
**$1,250.00**. March 2026: savings +$880.00, investments +$750.00 − $2,000.00 = −$1,250.00, set aside
**−$370.00**. Jun 2025 – May 2026: savings 12 × $500.00 + 4 × $380.00 = $7,520.00; investments
12 × $750.00 − $2,000.00 = $7,000.00; total $14,520.00 → **$1,210.00 a month**. The demo plan's savings
line is its two goals' $200.00 + $150.00 = $350.00 (unit DB; other e2e specs add demo goals, so the e2e
asserts only the measured half).

**Critic cycle 1 (hand-verified, unit).** Money in must be traceable; money out always counts.

| Case (Sep 2026 unless said) | Savings, net | Left out | Set aside |
|---|---|---|---|
| +$20,000.00 "TRANSFER FROM MARCUS SAVINGS" (not filed), +$15,000.00 "LOAN DISBURSEMENT", +$1,000.00 from a card advance, +$300.00 "FROM CHECKING" 8 days after the checking side, and $100.00 checking → savings the same day | +$100.00 | $36,300.00 untraced, listed | +$100.00; the 12-month average $8.33 |
| Savings → another linked savings $200.00 (2 days apart), +$450.00 back from Vanguard by its last four, +$1,200.00 payroll filed Paycheck, +$380.00 payout filed Side Gig | +$2,030.00 | — | +$1,580.00 (the $450.00 nets against Investments) |
| Oct: $500.00 from checking, then −$5,000.00 at a garage, excluded from totals | −$4,500.00 | — | −$4,500.00: "$4,500.00 more has come out …" |
| "INTEREST" $43.21 (not filed), "MONTHLY INTEREST" $2.10 (filed Income), "INT PAID" $1.05, "DIV CREDIT" $0.99, and "ACME INT'L PAYROLL" $1,500.00 filed Paycheck | +$1,500.00 | $47.35 earnings | +$1,500.00 |
| Oct: checking → savings $500.00, both halves filed Investment & Savings | +$500.00 | — | +$500.00; no "couldn't count" note (Investments still lists both) |

~~**The plan line.** Goals $1,100.00 a month of which $900.00 is a debt-free goal, no target: the line compared is
$200.00; $200.00 set aside reads "exactly what your plan sets aside" and names the $900.00 of extra debt payments.
With a $500.00 target it is max($200.00, $500.00) = $500.00. Goals $300.00 ($100.00 debt-free) under a $500.00 target:
the target already won, the line stays $500.00, and nothing is said about debt.~~ (Superseded at cycle 2 — below.)

**Words.** A reader who links savings only: "… more has come out of your savings accounts than gone in". One complete
month (records from Sep 1; −$1.00 fee, +$250.00 from checking): "In Sep 2026, the one complete month with full records,
you set aside $249.00." Ten months averaged with two left out: "… 2 months with missing records are left out."

**Critic cycle 2 (hand-verified, unit).** The plan line is planned − debt: goals $1,100.00 with $900.00 debt-free →
$200.00 ("$50.00 of the $200.00 your plan sets aside apart from extra debt payments — $150.00 to go", then the debt
sentence); a $1,000.00 target that won over $900.00 debt-free → $100.00 ("$100.00 — exactly what your plan sets aside
apart from extra debt payments"); all $900.00 debt → $0.00 ("Your plan's savings line of $900.00 is all extra debt
payments …"). Debt-free goals only: savings $200.00 + debt-free $900.00 + reserve $50.00 + debt-free with no amount → $900.00.

| Case (Sep 2026) | Savings, net | Left out | Set aside |
|---|---|---|---|
| −$500.00 daycare (Childcare) + $500.00 Zelle from a person (not filed); −$1,234.56 card payment (flagged) + $1,234.56 external transfer (not filed); −$70.00 check + $70.00 mobile deposit (neither filed nor flagged) | $0.00 | $1,804.56 untraced | $0.00 |
| $300.00 flagged, not filed, 2 days apart; $200.00 filed Transfer, 3 days apart; $110.00 filed Transfer, 4 days apart | +$500.00 | $110.00 untraced | +$500.00 |
| −$5,000.00 to Vanguard by its last four + $5,000.00 "LOAN DISBURSEMENT" filed Loan Payment two days later | $0.00 | $5,000.00 untraced | +$5,000.00 (put in), never $10,000.00 |
| One −$500.00 out, two +$500.00 in (same and next day) | +$500.00 | $500.00 | +$500.00 |
| Out on the 1st and the 3rd, in on the 3rd and the 6th ($400.00 each) | +$400.00 | $400.00 | +$400.00 |
| −$400.00 out and +$400.00 "FROM CHECKING" on the same savings account | −$400.00 | $400.00 | −$400.00 |
| −$500.00 to Vanguard, +$500.00 "… RETURNED" six days later; −$10.00 fee, +$10.00 "FEE REVERSAL" | $0.00 | — | $0.00 |
| +$250.00 "TRANSFER FROM INTEREST CHECKING" (flagged) with its checking half; +$4,000.00 IRA distribution (Retirement Income) | +$250.00 | $4,000.00 untraced; no earnings | +$250.00 |
| Oct: −$60.00 after today, −$80.00 split parent, a $0.00 row, −$20.00 fee | −$20.00 | — | −$20.00 |

**Critic cycle 3 (hand-verified, unit).**

| Case (Sep 2026) | Savings, net | Left out | Set aside |
|---|---|---|---|
| +$5,000.00 "SCHWAB BROKERAGE MONEYLINK" into savings, −$5,000.00 "VANGUARD BUY INVESTMENT" from checking the next day (both Investment & Savings, flagged) | $0.00 | $5,000.00 untraced | +$5,000.00 (put in) — never $10,000.00; Investments still lists the Schwab row |
| −$2,000.00 to Fidelity (not linked) from checking, +$2,000.00 from Schwab (not linked) into savings | $0.00 | $2,000.00 untraced | $0.00 |
| $300.00 flagged, 2 days; $200.00 Transfer, 3 days; $110.00 "TO MARCUS" / "FROM CHASE", 4 days; $90.00, 8 days | +$610.00 | $90.00 | +$610.00 |
| −$500.00 card payment "CHASE CREDIT CRD EPAY" (Transfer, flagged) + $500.00 mobile deposit (Transfer, flagged) | +$500.00 | — | +$500.00 (recorded bound: the app files both a move) |
| Returns: "ACH CREDIT RETURN" after a deposit Investments counts; a trust distribution "… REV TRUST DIST" after an equal premium; "ACH RETURN" before the money left, on another account, for $119.00 of $120.00, and after an outflow already paired | each untraced | $2,469.00 | −$1,470.00 (−$2,470.00 out, +$1,000.00 put in) |
| −$1,000.00 to Vanguard, +$1,000.00 "ACH RETURN" filed Refund (Investments refused it as a return) | −$1,000.00 | $1,000.00 | $0.00 — never +$1,000.00 |
| Paycheck $1,500.00, bonus $500.00, side gig $380.00; pension filed Income $2,100.00, benefits $900.00, refund $45.00 | +$2,380.00 | $3,045.00 untraced | +$2,380.00 |
| +$250.00 "FROM INT CHECKING" (flagged) with its checking half; "ZELLE FROM DIV SMITH" $40.00; "INTL WIRE IN INT" $60.00 | +$250.00 | $100.00 untraced; no earnings | +$250.00 |

**The server.** A reader with a $200.00 savings goal and a $900.00 debt-free goal and no target: `getSpendingPlan` →
planned $1,100.00, `measuredSavingsLine` {planned $1,100.00, debt $900.00, compared $200.00}.
