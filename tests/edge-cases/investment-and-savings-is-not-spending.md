## §Investment & Savings is never spending (DECISIONS #789)

Predicates: `MONEY_MOVE_CATEGORY_IDS` / `isMoneyMoveCategoryId` (`src/lib/engine/categorize/categories.ts`),
read by `reports.isSpendRow`, `insights.countsInFlows` (and so `isIncomeFlowRow`, `monthlyFlows`,
the /reports bar panels, the coach's savings rate, the FI number, discretionary spend), the /trends
purchase predicate and Ask's `isPurchaseRow`. /budgets: `isBudgetable`, `untrackedBudgetTargets`,
`untrackedBudgetTargetSentence` (`src/lib/engine/budgets/status.ts`).
Tests: `tests/unit/investment-not-spending.test.ts`, `tests/e2e/investment-not-spending.spec.ts`.
Every amount is invented.

**The rule.** A row filed Transfer or Investment & Savings moves the reader's own money. In either
direction it is never spending, never income, and never a refund that nets spending down — whether or
not `isTransfer` is set. The register's spend-class chip already said so for Investment & Savings
("Money moved into investing is saving, not spending"); the figures now agree with it.

**Hand-verified month (June 2026).**

| Row | Amount | Filed | Before #789 | After |
|---|---|---|---|---|
| Paycheck | +$5,000.00 | Paycheck | income | income |
| KROGER | −$400.00 | Groceries | spending | spending |
| VANGUARD BUY INVESTMENT | −$1,000.00 | Investment & Savings | spending | neither |
| VANGUARD SELL INVESTMENT | +$250.00 | Investment & Savings | a refund: −$250.00 of spending | neither |

- Spending: before $400.00 + $1,000.00 − $250.00 = **$1,150.00**; after **$400.00**.
- Savings rate: before (5,000.00 − 1,150.00) / 5,000.00 = **77%** (7,700 bps); after
  (5,000.00 − 400.00) / 5,000.00 = **92%** (9,200 bps).
- The /reports expense bar's panel lists one row, $400.00, and reconciles; the income bar's lists
  $5,000.00.
- /trends and Ask "biggest purchase": Kroger, never Vanguard.
- Ask "how much did I spend on Investment & Savings this month": "No Investment & Savings spending this
  month." + "Money filed Investment & Savings is saving, not spending, so no spending figure counts it."

**/budgets.** Investment & Savings is not offered or accepted as a target, nor as a money dial. A target
stored on it before #789 ($1,000.00) leaves the rows and is named: "Your $1,000.00 monthly target on
Investment & Savings isn’t tracked here: money moved into investing or savings is saving, not
spending, so no spending figure counts it." A target on any other id — a legacy one included — is
tracked exactly as before.

**Known bound (recorded, not changed).** The categorizer files a description naming a brokerage
(VANGUARD, SCHWAB, MERRILL …) to Investment & Savings, so a non-brokerage merchant carrying one of
those names ("VANGUARD CLEANING SYSTEMS", "MERRILL GARDENS AT RENTON") now leaves spending until the
reader re-files it. The register already labelled those rows "Not spending" before #789.

**Demo.** The demo seed holds no row filed Investment & Savings (its brokerage and savings transfers
are transfer-flagged), so no demo figure moves.
