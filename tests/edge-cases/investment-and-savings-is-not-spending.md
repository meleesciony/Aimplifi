## §Investment & Savings is never spending (DECISIONS #789)

Predicate: `isMoneyMoveCategoryId` (`src/lib/engine/categorize/categories.ts`) — the FILING, whoever
filed it. Read by `reports.isSpendRow`, `insights.countsInFlows` (and so `isIncomeFlowRow`,
`monthlyFlows`, the /reports bar panels, the coach's savings rate, the FI number, discretionary spend),
the /trends and Ask purchase predicates, Ask's `merchantSpend`, the coach's cut list, creep series and
life-energy view, the unusual-charge radar, the register's `summarizeTransactions` / `matchesType`, the
posted calendar, "Money you put in" (`deposits.ts`), /recurring's price increases, the merchant lens,
the household digest and the CSV export's transfer column. /budgets: `isBudgetable`,
`untrackedBudgetTargets`, `untrackedBudgetTargetSentence` (`src/lib/engine/budgets/status.ts`).
The categorizer's side: `src/lib/engine/categorize/brokerage-move.ts`.
Tests: `tests/unit/investment-not-spending.test.ts`, `investment-not-spending-cycle1.test.ts`,
`investment-not-spending-cycle2.test.ts`, `investment-not-spending-cycle2-db.test.ts`, the #789
describes in `investment-deposits.test.ts`, `tests/e2e/investment-not-spending.spec.ts`.
Every amount is invented.

**The rule.** A row filed Transfer or Investment & Savings moves the reader's own money. In either
direction it is never spending, never income, and never a refund that nets spending down — whether or
not `isTransfer` is set, and whoever filed it: the bank's text never overrides the filing (critic
cycle 2, P1-1). The register's spend-class chip already said so for Investment & Savings ("Money moved
into investing is saving, not spending"); the figures agree with it.

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

**The reader's own filing (critic cycle 2, P1-1).** A hand-entered "Vanguard" −$1,000.00 the reader
filed Investment & Savings, beside $5,000.00 of pay and $400.00 of groceries: spending $400.00, savings
rate (5,000.00 − 400.00) / 5,000.00 = **92%**; Ask "spent at Vanguard" answers "Money sent to Vanguard
isn't spending"; "Money you put in" counts it as $1,000.00 put in at Vanguard. A "Vanguard" series the
reader filed there, rising $500.00 → $600.00, is never a cut, a creep, a biggest purchase or an unusual
charge.

**What the categorizer files Investment & Savings.**
- A brokerage's own money movement: "VANGUARD BUY INVESTMENT", "VANGUARD SELL INVESTMENT", "FID BKG SVC
  LLC MONEYLINE", "SCHWAB BROKERAGE MONEYLINK TRANSFER", "ROBINHOOD DEBITS", "MERRILL LYNCH", "ACORNS
  INVEST", "COINBASE.COM", "DEBIT CARD PMT COINBASE" (a bank prefix is stripped before the firm-payment
  test), "MERRILL LYNCH MARGIN DEPOSIT".
- Money coming back (critic cycle 2, P2-1): "VANGUARD ACH RTN", "VANGUARD RETURNED ITEM", "ROBINHOOD
  CREDITS", "ACORNS WITHDRAW", "BETTERMENT WITHDRAWAL". A −$5,000.00 "VANGUARD BUY INVESTMENT" and its
  +$5,000.00 "VANGUARD ACH RTN" cancel: with $5,000.00 of pay and $400.00 of groceries, money in
  $5,000.00 and money out $400.00.
- Never a same-named business (critic cycle 1, P1-3): "LES SCHWAB TIRES #0123", "SQ *SCHWAB MEATS",
  "MERRILL GARDENS AT RENTON", "VANGUARD CLEANING SYSTEMS", "VANGUARD CAR RENTAL", "TST* ROBINHOOD
  BURGERS", "BETTERMENT HOME SERVICES", "LITTLE ACORNS DAYCARE" → not Investment & Savings.
- Never a payment to the firm itself (critic cycle 2, P1-2): "COINBASE ONE", "COINBASE ONE
  SUBSCRIPTION", "FIDELITY INVESTMENTS LIFE INS PREMIUM", "MERRILL LYNCH ADVISORY FEE", "WEALTHFRONT
  ADVISORY FEE", "E*TRADE MARGIN INTEREST", "SCHWAB BANK TRANSFER LOAN PAYMENT", "ROBINHOOD GOLD
  MEMBERSHIP" → not Investment & Savings, so spending. With $400.00 of groceries, a $185.00 premium and a
  $29.99 Coinbase One, spending is $614.99. "Money you put in" lists the same rows, when filed
  Investment & Savings, as payments to the firm by the same word (`paysTheFirmWord`).

**Every surface (critic cycle 2).** A day holding only a −$5,000.00 deposit filed Investment & Savings:
the calendar shows "1 move into or out of investing — not counted as money in or out." A row flagged a
transfer AND filed there is named once, as a transfer. /recurring: a Vanguard contribution rising
$500.00 → $600.00 is not a price increase (its badge reads favorable); Netflix $15.99 → $17.99 is, and
Ask says "1 recurring charge has gone up in price recently." The merchant lens counts no deposit as a
charge. The household digest leaves a shared account's deposit out of money out, as the register does.
The CSV marks the row `transfer,yes`, and its note says "moving money between accounts, or into or out of
investing".

**/budgets.** Investment & Savings is not offered or accepted as a target, nor as a money dial. A target
stored on it before #789 ($1,000.00) leaves the rows and is named: "Your $1,000.00 monthly target on
Investment & Savings isn’t tracked here: money moved into investing or savings is saving, not
spending, so no spending figure counts it." — with a Remove target button that says so if it fails. A
dial stored on it is named in Settings and removed on save. A target on any other id — a legacy one
included — is tracked exactly as before.

**Known bounds (recorded, not changed).**
- A row filed Investment & Savings for a business — by the reader, or by the categorizer before it
  learned the difference — leaves spending until it is re-filed; the register's chip reads "Investing"
  on it. Measured read-only (critic cycle 2): every stored production row filed there is money moved
  into investing.
- TRANSFER, XFER and BUY are generic bank words: "MERRILL GARDENS ACH TRANSFER" and "WEB XFER MERRILL
  GARDENS" still file Investment & Savings.
- A bare brokerage name ("Vanguard", "Robinhood", "Acorns") goes to review; until it is filed, an
  inflow with such a name counts as income.
- A business's returned payment worded the way a bank words a return beside a shared brokerage name
  ("LES SCHWAB TIRES RETURNED ITEM") files Investment & Savings, so the return does not net its purchase.
- /recurring's monthly recurring total still includes a contribution series.

**Demo.** The demo seed holds no row filed Investment & Savings (its brokerage and savings transfers
are transfer-flagged), so no demo figure moves.

**§#792 — the remaining readers.** /recurring "Coming up": a 529 contribution $200.00 → $250.00 carries
no "↑ was" mark; Netflix $15.99 → $17.99 carries "was $15.99". ~~The merchant set: five "VENMO PAYMENT"
rows filed Rent plus one "VENMO CASHOUT" filed Transfer (flagged or not) → Venmo is NOT a money move;
"Vanguard" rows filed Investment & Savings plus one unfiled → it is; one filed Shopping → it is not.~~
(Superseded at critic cycles 1 and 2: a series is decided by its own rows — below.) The
radar's daily outflows over 31 days: four $200.00 grocery runs → $800.00; plus two $2,000.00 deposits
filed Investment & Savings → still $800.00 (filed Shopping instead → $4,800.00). The repair card: a
flagged −$2,000.00 filed Investment & Savings is declined; a flagged −$40.00 grocery run is cleared →
$40.00 of money out claimed, not $2,040.00. "VANGUARD INVESTIGATIONS LLC" is not Investment & Savings;
"ROBINHOOD INVESTMENTS", "SCHWAB INVESTING TRANSFER" are (and, from cycle 1, "VANGUARD INVESTMNT"). A
learned Investment & Savings rule on a
Betterment ACH files −$500.00 and +$500.00 alike. "VANGUARD ACH RTN" +$5,000.00 in review is re-filed
Investment & Savings. ~~A monthly +$500.00 "ROBINHOOD CREDITS" is not recurring income and, when it stops,
not a pause; a $4,000.00 payroll that stops is.~~ (Superseded at critic cycle 1: listed, not counted, and
still a pause — below.)

**#792 critic cycle 1 (hand-verified, unit).** ~~The merchant set by majority of filed, unflagged rows:
5 × Rent + 1 × Transfer (Venmo) → not a move; 4 × Investment & Savings + 1 × Education (529) → a move, and
its $200.00 → $250.00 rise is not a price increase; 1 + 1 → a move (tie); 1 move + 2 Shopping → not.~~
(Superseded at cycle 2 by the series' own rows — below; the 529 and tie outcomes stand.)
"ROBINHOOD CREDITS" +$500.00 on the 10th, Jan–May 2026, beside a $4,000.00 payroll on the 1st: on
2026-06-05 both are listed under recurring income, Robinhood badged as money moved, and "Recurring income"
reads the payroll's monthly figure only; on 2026-07-25 both are lapsed income and a confirmed pause on
either reads "paused". Three Betterment deposits of −$500.00 and one +$1,200.00 withdrawal, all filed
Investment & Savings, learn a rule that files both signs; the same four filed Shopping learn nothing.

**#792 critic cycle 2 (hand-verified, unit) — a series is decided by the reader's filings of ITS OWN rows.**
Twelve "VENMO PAYMENT" rent payments in 2025, −$1,800.00 rising to −$1,950.00 from September, six filed Rent
and six not filed yet, beside eight "VENMO CASHOUT" +$400.00 filed Transfer: the rent series is not a move
(the cash-outs are not its rows) and its rise is a price increase. Four 529 contributions filed Investment &
Savings and one Education: a move, and its $200.00 → $250.00 rise is not a price. "FIDELITY INVESTMENTS
ANNUITY PMT" +$1,800.00 monthly, filed Investment & Savings by default and re-filed Income by the reader on
every row, beside a $1,900.00 benefit: recurring income, no badge, in the section's figure. Series of four to six:
2 moves + 2 Shopping → a move; 1 move + 2 Shopping + 1 not filed → not; 1 move + 4 not filed → a move; none
filed → absent (the default filing decides). "VANGUARD INVESTIG" is a business.
Cycle 3: a row in review is stored `'uncategorized'` — 2 moves + 4 in review → a move; 3 in review → absent.
