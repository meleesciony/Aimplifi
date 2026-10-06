## §Money you put in — brokerage deposits read from the bank side (DECISIONS #788)

Engine: `src/lib/engine/investments/deposits.ts` (`computeDepositHistory`), brokerage list
`src/lib/engine/investments/brokerages.ts`, words `src/lib/engine/investments/deposits-copy.ts`,
loader `src/server/investment-deposits.ts`, card `src/components/finance/deposit-history-card.tsx`.
Tests: `tests/unit/investment-deposits.test.ts`, `tests/e2e/investment-deposits.spec.ts`. Every
account, amount and date is invented. Unit `today = 2026-10-17`, bank accounts' feeds vouch through
2026-10-16 and their records start 2025-01-02 unless a case says otherwise; e2e and demo
`today = 2026-06-10`.

**The owner's choice (2026-10-05, verbatim option).** "Bank side, no new fee — … It counts money
sent from your linked checking or savings into a linked brokerage or retirement account, month by
month. It misses 401(k) contributions taken out of your paycheck and deposits from banks you haven't
linked."

**Sign.** A bank OUTFLOW is money put in; a bank INFLOW is money taken out. Kept as positive cents
with a direction; put in and taken out are separate sums; the lead states the difference.

**Destinations.** By the last four after a mask marker → that ACCOUNT ("Matched by its last four
digits"). By a brokerage's name → the BROKERAGE ("Vanguard"), with the linked account(s) there named
under it — a name says which firm, not which account.

**The window.** Records start = the earliest row on any live CHECKING or SAVINGS account (cards do
not move it). First covered month = that month when the row is on the 1st, else the next month. Shown
= from max(first covered month, this month − 12) through this month (partial). This year = from
max(January, first covered month). An account's record = its first row → the later of its last row
and the day its live feed vouches for (demo: today; healthy Plaid: the day before the last
successful sync; manual, dropped or failing: none). A month (this month: through yesterday) not
covered by every live checking or savings account names those accounts and reads "None found".

| Case | Rows | Expected |
|---|---|---|
| Name | chk 2026-09-05 −$500.00 "VANGUARD BUY INVESTMENT", Investment & Savings; Vanguard linked | Sep $500.00 → "Vanguard" (brokerage); this year $500.00 |
| Last four | chk 2026-09-10 −$250.00 "ONLINE TRANSFER TO XXXXXX6604"; Roth IRA ··6604 | Sep $250.00 → Roth IRA. Also X6604, ...6604, *6604, ENDING IN 6604, ACCT 6604, ACCT# 6604, acct no. 6604. NOT: "TRANSFER 6604", "BOX6604", "X66041", "X6604A", "CHECK #6604", "REF #6604" |
| Taken out | + chk 2026-08-14 +$300.00 "VANGUARD REDEMPTION" | Aug taken out $300.00; lead "… — $200.00 more in than out." |
| Not filed yet | chk 09-05 −$500.00 "…XXXXXX6604" uncategorized; chk 04-05 −$500.00 "VANGUARD BUY" unfiled | Both listed "not-filed"; Sep "None counted · 1 not counted"; lead "Nothing counted so far this year. 2 movements we couldn’t count are listed under “Not counted”." |
| Returned | chk 09-05 −$500.00 "…6604"; chk 09-08 +$500.00 "RETURNED ITEM …6604" unfiled | Listed "returned" (Tue, Sep 8, 2026); the return not listed; Sep $0 in, $0 out. Reversal filed Transfer on day 14 cancels; day 15 does not ($500 in + $500 out). A withdrawal filed Transfer without return words is money taken out. Unfiled "RETURNED ITEM" naming nothing cancels; filed Shopping it does not |
| Not a return | +$500.00 "ZELLE PAYMENT FROM JANE ROOMMATE" unfiled; "VENMO CASHOUT"; "AMAZON MKTPLACE RETURN" filed Shopping; "MERCHANDISE RETURN" filed Refund or Reimbursement | None cancels the deposit (critic cycle 2, P1) |
| Return filed as a move or income | "ONLINE TRANSFER RETURN" / "…REVERSAL" filed Transfer; "ACH RETURN" filed Income; "RETURN OF POSTED CHECK/ITEM" filed Investment & Savings | Each cancels the deposit (critic cycle 3, P1-1) |
| Return across the window start | chk 2025-09-28 −$500.00 "…6604"; chk 2025-10-03 +$500.00 "RETURNED ITEM …6604" (Transfer or unfiled) | Neither counts; nothing listed |
| Landed in your account | chk 07-02 −$400.00 "…6604"; sav 07-09 +$400.00 transfer | Listed "landed-in-your-account" (Rainy Day Savings); 07-10 (8 days) → counted |
| Ordinary move first | chk 06-01 −$500.00 to other bank; chk 06-02 −$500.00 VANGUARD; sav 06-03 +$500.00 | The ordinary transfer takes the savings inflow; Vanguard $500.00 COUNTS |
| Card payment | chk 06-01 −$500.00 epay (card payment); chk 06-02 −$500.00 VANGUARD; card 06-02 +$500.00 PAYMENT THANK YOU | The epay takes the card credit; Vanguard COUNTS |
| Not evidence of a move | card refund filed Shopping or unfiled; card purchase; savings inflow filed Income; pending; excluded; after today; a card payment credit beside a deposit placed by its last four; a second row that also names an investment destination | None takes a deposit |
| Not linked | chk 09-12 −$100.00 "ROBINHOOD FUNDS" | Listed "not-linked", Robinhood |
| Bank move naming a brokerage | chk −$200.00 "SCHWAB MONEYLINK"; Schwab Checking +$200.00 next day; no Schwab investment account | Ignored |
| Fees and bills | "ROBINHOOD CARD PAYMENT", "ROBINHOOD GOLD MEMBERSHIP", "ROBINHOOD GOLD", "COINBASE ONE", "MERRILL LYNCH ADVISORY FEE", "SCHWAB VISA PAYMENT", "SCHWAB LOAN PAYMENT", "SCHWAB BANK MORTGAGE PMT", "FIDELITY INVESTMENTS LIFE INS PREMIUM", "MERRILL LENDING PMT", +$3.00 "SCHWAB ATM REBATE" | Listed "not-a-deposit" with the word; "MERRILL LYNCH MARGIN DEPOSIT" counts |
| PayPal | "PAYPAL *COINBASE" (Investment) with Coinbase linked | Counted → Coinbase; "PAYPAL INST XFER COINBASE" unfiled → "not-filed" |
| Matchability | Edward Jones IRA ··7788 (brokerage unknown); Old 401(k) with no mask | "We can match Edward Jones IRA only when a description names its last four digits. We can’t match Old 401(k): …"; "EDWARD JONES INVEST" → "None matched" |
| Test deposits and people | ±$0.43, −$0.99 (ignored); −$1.00 by last four (counted); "ZELLE PAYMENT TO MARY SCHWAB" (ignored — a person) | Sep $1.00 put in |
| Same-brokerage bank account, covered | Schwab Checking records from 2025-01-03; chk 2026-09-20 −$1,000.00 "SCHWAB BROKERAGE MONEYLINK" | Counted → Charles Schwab |
| … records from 09-13 / 09-14 | week before 09-20 is 09-13 | 09-13 covers; 09-14 → "same-brokerage-account" |
| … feed vouches for nothing, last row 09-26 / 09-27 | week after is 09-27 | 09-26 → same-brokerage-account; 09-27 → counted |
| … row 2026-10-10 / 10-09 | the week must end before today (10-17) | 10-10 → "too-new"; 10-09 → counted |
| … with the last four X2202 | 2026-10-15 | Counted on Schwab Brokerage — no coverage test |
| … naming Schwab Checking's last four X2201 | | Ignored (a move between own accounts) |
| Two names | "VANGUARD SCHWAB MOVE" | "two-brokerages" (Vanguard, Charles Schwab) |
| Shared last four | a card also ends 5521; or two investment accounts end 5521 | "shared-last-four" |
| Two accounts named | "TRANSFER FROM SAV X3390 TO XXXXXX6604" | "names-two-accounts" (Rainy Day Savings and Roth IRA) |
| Last four vs name | "SCHWAB TRANSFER X5521" (5521 is Vanguard) | "last-four-vs-name"; "VANGUARD TRANSFER X6604" (no brokerage on 6604) → Roth IRA |
| Several at one brokerage | Vanguard Brokerage + Vanguard IRA, by name | one destination "Vanguard", "your 2 linked accounts there are …" |
| Combined account | old copy (→ live checking) −$250.00 VANGUARD 09-01, live +$250.00 09-02 | counted on the live checking; the copies never pair |
| Handover day | both copies report −$500.00 ×2 on 2026-09-01 | $1,000.00 (2+2 → 2); 2+1 → $1,000.00; 1+1 → $500.00 |
| Stopped feed | checking vouches for nothing, last row 2025-11-05 | Nov 2025 … Oct 2026: "Records from Everyday Checking run only through Wed, Nov 5, 2025."; "None found"; lead "Nothing matched so far this year in the records we have. Some months are missing records — they’re marked below." |
| This month | today 10-17: needs records through 10-15 (a feed through 10-15 covers; through 10-14 does not); today the 1st or 2nd: nothing to cover | "None yet" |
| Previous month on the 1st | today 11-01, feeds through 10-30 (before the sync): October covered; through 10-29: not | — |
| Rowless account | a linked "12-Month CD" with no rows | never named as missing records |
| Reader’s word | New Checking first row 2026-08-15: 8 of this year’s months name it; with "began 2026-08-15" none do; a word for 08-14 is ignored. Old Checking last row 2026-03-10, no feed: "ended 2026-03-10" clears the months after; "ended 2026-03-09" does not; on a combined record no word is read | — |
| One account (?account=ira) | VANGUARD $500 by name, X6604 $250 | only $250.00 counted; "Showing only money placed on Roth IRA by its last four digits."; for ?account=vg the lead is "Nothing placed on Vanguard Brokerage by its last four digits so far this year." and the $500 is "by name only — the description names the firm, not an account — it may or may not be Vanguard Brokerage’s, so it isn’t counted here"; unfiled rows placed only by name are not listed there |
| Never counted, never listed | pending, split parent, excluded, filed to spending, on a card, $0, after today | — |

**Demo seed (today 2026-06-10).** −$750.00 "ONLINE TRANSFER TO BROKERAGE X8842" on the 3rd of every
month from Jan 2025; +$2,000.00 "ONLINE TRANSFER FROM BROKERAGE X8842" on 2026-03-18. Window
Jun 2025 – Jun 2026 = 13 months × $750.00 = $9,750.00 put in, $2,000.00 taken out (Brokerage, by its
last four). This year (Jan–Jun) 6 × $750.00 = $4,500.00 in, $2,000.00 out → "$4,500.00 put in and
$2,000.00 taken out so far this year — $2,500.00 more in than out."

**E2E throwaway (today 2026-06-10).** Checking on a Plaid item synced 2026-06-10; Vanguard Brokerage
··5521 (institution Vanguard). 2026-04-06 −$600.00 VANGUARD BUY; 2026-05-04 −$450.00 "…XXXXXX5521";
2026-05-20 +$300.00 VANGUARD REDEMPTION; 2026-05-22 −$150.00 ROBINHOOD (not linked). Year: $1,050.00
in, $300.00 out → "$750.00 more in than out"; "Vanguard" $600.00 in · $300.00 out (by name), "Vanguard
Brokerage" $450.00 in (by last four); May "$450.00 put in · $300.00 taken out"; one "Not counted" row.
