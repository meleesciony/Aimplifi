## §A card payment counts once it leaves checking (DECISIONS #791)

Engine: `src/lib/engine/cash-needed/detected-payments.ts` (`detectInTransitCardPayments`,
`CARD_PAYMENT_WORDS_RE`, `BILL_PAY_WORDS_RE`, `CARD_ISSUER_RE`, `NOT_A_CARD_BILL_RE`,
`detectedPaymentsForStatement`), wired in `assemble.ts` (two passes; newest-statement selection; the
estimate basis); words `in-transit-copy.ts`; result field `CashNeededResult.inTransitPayments`. Surfaces:
Home's cash-needed card (every branch), /cards, Ask's cash-needed answer, the Glass-Box panel.
Tests: `tests/unit/card-payment-in-transit.test.ts`, `tests/unit/card-payment-in-transit-render.test.tsx`,
`tests/e2e/card-payment-in-transit.spec.ts`. Every account, amount and date is invented. Unit
`today = 2026-10-06` unless a case says otherwise; e2e `today = 2026-06-10`.

**Fixture (the owner's shape).** Checking; Cards A, B, C with statements closed Sep 10, due Oct 5:
$1,234.56, $4,321.09, $9,876.54; issuer balances $200.00, $4,800.00, $10,100.00. On Oct 5 three
"NORTHWIND BANK CRCARDPMT" debits of exactly those amounts post on checking; only Card A's card side has
shown its payment.

| Case | Card A | Card B | Card C | Listed "before the card company shows it" |
|---|---|---|---|---|
| Before #791 (A paired only) | $0.00 | $4,321.09 | $9,876.54 | — |
| #791 | $0.00 (pair) | $0.00 | $0.00 | B, C |
| B and C card sides post within 3 days | $0.00 | $0.00 | $0.00 | none (pair rule) |
| C's card side posts Oct 11 (today Oct 12) | — | $0.00 | $0.00, no next-statement credit note | B only (C arrived) |

**Next cycle after an in-transit settlement** = max(charges posted since the close less payments to
them, issuer balance − the unshown payment). Card B with $400.00 + $78.91 charged since Sep 10:
max($478.91, $4,800.00 − $4,321.09 = $478.91) = **$478.91** ("charges" note). Card C, nothing charged:
max($0.00, $10,100.00 − $9,876.54) = **$223.46** ("balance" note). Card B, issuer already took it off
($78.91) with $478.91 charged: **$478.91**. Card A (paired) reads the issuer's $200.00 as before. A
manual card keeps its typed balance; a card with no next due date keeps the issuer's balance on the
undated list. Charges count POSTED rows dated after the close day, never a payment the pair rule credited.

**Statements.** Only the newest statement can be current. Aug $3,000.00 ($1,000.00 paired Sep 4) + Sep
$4,321.09 paid in transit → $0.00 (before the fix: $2,000.00 "past due"). Sep $4,321.09 paid Oct 5, its
card side Oct 9 (outside the window), Oct $1,000.00 paid Nov 5, today Nov 6 → $0.00 (before: $3,321.09).

**What was owed that day.** $100.00 paid Sep 20, the $4,221.09 remainder Oct 5, $50.00 more Oct 6 →
in transit $4,221.09. $100.00 paid Sep 20, then the WHOLE $4,321.09 Oct 5 → matched by the whole balance.

**Refusals — the bill stays demanded:** a $4,000.00 part payment; two cards owing the same $4,321.09; a
loan payment, an unfiled row, "ONLINE TRANSFER TO SAVINGS", "VERIZON WIRELESS EPAY" (filed Transfer), a
car-loan "TOYOTA FINANCIAL AUTOPAY" flagged a transfer, an issuer's "CHASE MORTGAGE EPAY" / "DISCOVER
STUDENT LOAN EPAY" / "CAPITAL ONE AUTO FINANCE EPAY" / "USAA P&C EPAY"; a row filed to spending even with
card words; a move to the reader's savings the next day; a later-day return — even beside a top-up from
savings; a payment on the close date; PENDING, split-parent, after-today and card-account debits; one
debit whose card side already shows it on another card owing the same. Accepted: filed Credit Card
Payment ("WEB PMT 5521"); "AMEX EPAYMENT ACH PMT"; an unfiled transfer-flagged "CAPITAL ONE CRCARDPMT";
"CHASE AUTO PAY"; a top-up of exactly the bill the same day or the next; an unrelated same-day deposit.

**Arrivals.** A same-amount credit on the matched card, filed as a payment, not used by the pair rule,
after the close, from 14 days before to 31 days after the bank side: arrived (still credited, not listed,
no next-statement note). Refused as an arrival: a $4,321.09 "BEST BUY REFUND" filed Electronics; a credit
paired with its own debit; one dated on or before the close; one 20 days early; one 32 days late.

**Words.** One: "Counted as paid before the card company shows it: $4,321.09 to Card B (left Everyday
Checking Mon, Oct 5). It matches what was left to pay on that card’s statement, to the cent." Several:
"Counted as paid before the card companies show them: … ; and … . Each matches …". Household: "Card B
(Sam's) (left Everyday Checking (Sam's) …)". Two cards with one name: "Card B ····6271".

**e2e.** One card, statement closed May 10, $2,345.67 due Jun 5, issuer balance $2,900.00;
$2,345.67 "NORTHWIND BANK CRCARDPMT" left checking Jun 5; card side empty. Home: "Cards: nothing due" +
the sentence; /cards: "Nothing due this cycle" + the sentence. (By the estimate rule above its next
cycle is $2,900.00 − $2,345.67 = $554.33; the unit tests lock that rule, the e2e does not assert it.)
Control without the debit: $2,345.67 needed, no sentence.
