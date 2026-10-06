## §A card payment counts once it leaves checking (DECISIONS #791)

Engine: `src/lib/engine/cash-needed/detected-payments.ts` (`detectInTransitCardPayments`,
`CARD_PAYMENT_WORDS_RE`), wired in `assemble.ts` (two passes); words `in-transit-copy.ts`; result field
`CashNeededResult.inTransitPayments`. Surfaces: Home's cash-needed card, /cards, Ask's cash-needed answer.
Tests: `tests/unit/card-payment-in-transit.test.ts`, `tests/e2e/card-payment-in-transit.spec.ts`.
Every account, amount and date is invented. Unit `today = 2026-10-06`; e2e `today = 2026-06-10`.

**Fixture (the owner's shape).** Checking; Cards A, B, C with statements closed Sep 10, due Oct 5:
$1,234.56, $4,321.09, $9,876.54. On Oct 5 three "NORTHWIND BANK CRCARDPMT" debits of exactly those
amounts post on checking; only Card A's card side has shown its payment.

| Case | Card A | Card B | Card C | In transit |
|---|---|---|---|---|
| Before #791 (A paired only) | $0.00 | $4,321.09 | $9,876.54 | — |
| #791 | $0.00 (pair) | $0.00 | $0.00 | B, C |
| Card sides of B and C post within 3 days | $0.00 | $0.00 | $0.00 | none (pair rule) |
| Card C's side posts Oct 11 (today Oct 12) | — | — | $0.00, no next-statement credit note | B, C |

**Refusals — the bill stays demanded:** a $4,000.00 part payment of B; two cards with the same $4,321.09
remainder; a loan payment, an unfiled row, a transfer with no card words ("ONLINE TRANSFER TO SAVINGS");
a $4,321.09 move to the reader's savings the next day; the same amount returned the next day; a payment
on the statement's close date; a PENDING, a split-parent, an after-today or a card-account debit; one
debit whose card side already shows it on Card B is never also Card C's (both owe $4,321.09).
Filed Credit Card Payment needs no words ("WEB PMT 5521" pays B).

**Words.** One: "Counted as paid before the card company shows it: $4,321.09 to Card B (left Everyday
Checking Mon, Oct 5). It matches what was left to pay on that card’s statement, to the cent." Several:
"Counted as paid before the card companies show them: … ; and … . Each matches …".

**e2e.** One card, statement closed May 10, $2,345.67 due Jun 5; $2,345.67 "NORTHWIND BANK CRCARDPMT"
left checking Jun 5; card side empty. Home: "Cards: nothing due" + the sentence; /cards: "Nothing due
this cycle" + the sentence. Control without the debit: $2,345.67 needed, no sentence.
