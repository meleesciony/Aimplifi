## §Fees you paid — bank and card fees by kind, and what came back (DECISIONS #796)

Engine: `src/lib/engine/fi/bank-fees.ts` (`findBankFees`, `feeKindOf`, `readsAsFeeGivenBack`, `bankFeeWindowStart`),
words `src/lib/engine/fi/bank-fees-copy.ts`, card `src/components/coach/bank-fees-card.tsx` on /coach (`#fees-you-paid`),
loaded in `getCoachData` off the coach's own rows. Tests: `tests/unit/bank-fees.test.ts`,
`tests/unit/bank-fees-card.test.tsx`, `tests/unit/coach-bank-fees.test.ts`, `tests/e2e/bank-fees.spec.ts`. Every
account, amount, descriptor and date is invented. Unit `today = 2026-10-17` (window 2025-10-18 – 2026-10-17); e2e and
demo `today = 2026-06-10` (window 2025-06-11 – 2026-06-10).

**The rule.** Rows: checking, savings and card accounts; posted, not a transfer / money move / split parent /
excluded / loan-payment exclusion (`countsInFlows`); dated in the window; not $0.00.
- *Charged* = money out filed under Fees & Charges (`fees`), ATM Fee (`atm-fee`) or Late Fee (`late-fee`) whose bank
  text has a fee word (FEE / CHARGE / SURCHARGE), names no other kind of business, is not a returned deposit, and names
  a kind (the ATM Fee / Late Fee filing supplies one). Interest phrases and annual-fee phrases are read first and left
  out. Everything else filed there is *not counted* and listed.
- *Came back* = money in, any filing, whose text names a counted kind and says refunded / reversed / rebated /
  reimbursed / waived / credited.
- No net is stated.

**Worked example (unit, `findBankFees — the worked example`).**

| Row | Filed | Amount | Reads as | Result |
|---|---|---|---|---|
| 2024-01-05 BLUE DOOR COFFEE | coffee | −$4.50 | — | records begin here |
| 2025-10-17 OVERDRAFT ITEM FEE | fees | −$35.00 | overdraft | outside — the day before the window |
| 2025-10-18 WIRE FEE OUTGOING | fees | −$15.00 | wire | charged — the window's first day |
| 2026-03-24 INTEREST CHECKING MONTHLY SERVICE FEE | fees | −$15.00 | account (not interest) | charged |
| 2026-04-02 FOREIGN TRANSACTION FEE | fees | −$0.87 | foreign | charged |
| 2026-05-20 LATE FEE | late-fee | −$29.00 | late | charged |
| 2026-06-15 NON-NETWORK ATM FEE | fees | −$3.50 | atm | charged |
| 2026-06-15 ATM SURCHARGE 7-ELEVEN | atm-fee | −$3.00 | atm | charged |
| 2026-07-31, 2026-08-31 MONTHLY MAINTENANCE FEE | fees | −$12.00 ×2 | account | charged |
| 2026-09-03 OVERDRAFT ITEM FEE (chk handover day) | fees | −$35.00 | overdraft | charged, marked |
| 2026-09-04 NSF RETURNED ITEM FEE | fees | −$35.00 | overdraft | charged |
| 2026-09-10 OVERDRAFT FEE REFUND | fees | +$35.00 | overdraft + refund | came back |
| 2026-03-01 ATM FEE REBATE | refund | +$3.50 | atm + rebate | came back |
| 2026-03-10 HOA MAINTENANCE FEE | fees | −$450.00 | another business | not counted |
| 2026-03-20 DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS | fees | −$1,200.00 | a returned deposit, no fee word | not counted |
| 2026-03-25 VENMO INSTANT TRANSFER FEE | fees | −$1.75 | a fee word, no kind | not counted |
| 2026-03-21 OVERDRAFT PROTECTION FROM SAVINGS | fees | +$300.00 | no fee word | ignored |
| 2026-03-22 ATM WITHDRAWAL REVERSAL | cash | +$400.00 | no fee word | ignored |
| 2026-03-23 UNIVERSITY TUITION FEE REFUND | education | +$1,500.00 | another business | ignored |
| 2026-08-06 CASH BACK CREDIT | refund | +$50.00 | no fee word | ignored |
| 2026-05-20 INTEREST CHARGE ON PURCHASES | fees | −$45.12 | interest | left out |
| 2026-04-20 PURCHASE INTEREST CHARGE | fees-interest | −$39.77 | interest | left out |
| 2026-01-15 ANNUAL MEMBERSHIP FEE | fees | −$95.00 | annual | left out |
| 2026-02-01 ANNUAL FEE REVERSAL | fees | +$95.00 | annual + reversal | ignored with it |
| 2026-07-01 SERVICE CHARGE | fees | −$7.00 | account | a loan-payment exclusion id — not read |
| 2026-08-01/02/03/04 fee rows: pending / excluded / transfer / split parent | fees | — | — | not read |
| 2026-09-03 CORNER GROCERY (chk handover day), 2026-08-05 RENT PAYMENT | groceries, rent | — | — | not a fee filing |
| 2026-10-18 SERVICE CHARGE | fees | −$10.00 | — | after today |

Kinds, largest first: overdraft $35.00 + $35.00 = **$70.00** (2) · account $15.00 + $12.00 + $12.00 = **$39.00** (3) ·
late **$29.00** (1) · wire **$15.00** (1) · ATM $3.50 + $3.00 = **$6.50** (2) · foreign **$0.87** (1).
Charged $70.00 + $39.00 + $29.00 + $15.00 + $6.50 + $0.87 = **$160.37** (10 charges). Came back $35.00 + $3.50 =
**$38.50** (2). Not counted $1.75 + $1,200.00 + $450.00 = **$1,651.75** (3). Left out: interest $45.12 + $39.77 =
**$84.89** (2), annual **$95.00** (1). One printed row on chk's handover day.
Lead: "You paid $160.37 in bank and card fees (10 charges) in the last 12 months, and $38.50 in fees came back."

**Lead branches.** No rows at all → "No checking, savings or card records yet, so there are no fees to count." ·
records, nothing counted → "No bank or card fees counted in the last 12 months." · records beginning 2026-09-01 →
"… since your records begin on Sep 1, 2026." · only a refund ($34.00) → "No bank or card fees counted in the last 12
months; $34.00 in fees came back." · $12.00 charged, $47.00 back → "You paid $12.00 in bank and card fees (1 charge)
in the last 12 months, and $47.00 in fees came back." (no net) · one $29.00 charge → "You paid $29.00 in bank and card
fees (1 charge) in the last 12 months." A $0.00 fee row is nothing.

**Window.** 2026-10-17 → 2025-10-18; 2028-02-29 → 2027-03-01 (Feb 29 − 12 months clamps to Feb 28).

**E2E (throwaway reader, today 2026-06-10).** Overdraft $34.00 ×2 (May 4, May 5) + refund $34.00 (May 12); monthly
service $15.00 (Apr 30); card late fee $39.00 (May 21); interest $28.17 (left out); APARTMENT LATE FEE $50.00 (not
counted); OVERDRAFT PROTECTION FROM SAVINGS +$300.00 filed as fees (ignored); an overdraft on 2025-06-10 (outside).
Charged $68.00 + $39.00 + $15.00 = **$122.00** (4 charges), came back **$34.00**, not counted **$50.00**.
Demo: no row filed as a fee → "No bank or card fees counted in the last 12 months."
