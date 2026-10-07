## §Money you set aside — measured savings against the plan's savings line (DECISIONS #790)

Engine: `src/lib/engine/savings/measured.ts` (`measureSavings`), words
`src/lib/engine/savings/measured-copy.ts`, loader `src/server/measured-savings.ts`, section
`src/components/finance/measured-savings-card.tsx` on Guilt-free (`/spending-plan`, `#money-set-aside`).
It reads the rows and months of #788's deposit engine (`liveDepositRows`, `countableDepositRow`,
`computeDepositHistory`). Tests: `tests/unit/measured-savings.test.ts`,
`tests/unit/measured-savings-card.test.tsx`, `tests/e2e/measured-savings.spec.ts`. Every account, amount
and date is invented. Unit `today = 2026-10-17`, records start 2025-01-02 and feeds vouch through
2026-10-16 unless a case says otherwise; e2e and demo `today = 2026-06-10`.

**The rule.** Set aside (a month) = money into the linked SAVINGS accounts, net of what came out, read
from their own rows (posted, not a split parent, not excluded, not $0, not after today), with rows filed
Interest Income or Investment Income left out and listed + money into the linked INVESTMENT accounts, net of
what came back, exactly as "Money you put in" counts it. Months, and the accounts whose records are
missing from each, are #788's. The average uses only complete months whose records are complete.

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
