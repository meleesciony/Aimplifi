## §Fees you paid — bank and card fees by kind, and what came back (DECISIONS #796)

Engine: `src/lib/engine/fi/bank-fees.ts` (`findBankFees`, `feeKindOf`, `feeGivenBackKind`, `feeTextWords`,
`FEE_KIND_WORDS`, `bankFeeWindowStart`), words `src/lib/engine/fi/bank-fees-copy.ts`, card
`src/components/coach/bank-fees-card.tsx` on /coach (`#fees-you-paid`), loaded in `getCoachData` off the coach's own
rows. Tests: `tests/unit/bank-fees.test.ts`, `tests/unit/bank-fees-card.test.tsx`, `tests/unit/coach-bank-fees.test.ts`,
`tests/e2e/bank-fees.spec.ts`. Every account, amount, descriptor and date is invented. Unit `today = 2026-10-17`
(window 2025-10-18 – 2026-10-17, both ends inclusive); e2e and demo `today = 2026-06-10` (window 2025-06-11 – 2026-06-10).

**The rule.** Rows: checking, savings and card accounts; posted, not a transfer / money move / split parent /
excluded / loan-payment exclusion (`countsInFlows`) — money in and money out alike; dated in the window, never after
today (a later row isn't a record yet); not $0.00. A reconnected account (`terminalOf`) is one account.
- The bank text is read by ALLOWLIST: less numbers, amounts, ordinals, masks (X's + digits), a date written with a
  month's name (AUG 31 / 31 AUG / AUG-31 / AUG31 / AUG 31ST / AUG 2026), "NON-<BANK>" (up to four words) before ATM,
  and — only after overdraft / returned-item words — a "FOR A $… / DETAILS: …" tail after a space or hyphen;
  "NON SUFFICIENT" → NONSUFFICIENT. Every word must then be a fee word (one required), a connective, or one kind's
  words with one of its anchors. One other word → not a bank or card fee.
- *Charged* = money out filed under Fees & Charges (`fees`), ATM Fee (`atm-fee`) or Late Fee (`late-fee`) whose text
  reads as a kind — the text's own kind first; the ATM Fee / Late Fee filing supplies the anchor only to text naming
  none. Interest PHRASES, and a card's or account's annual fee worded on its own, are left out first (an HOA's, a
  club's or an IRA's annual fee is not counted and listed). Everything else filed there is *not counted* and listed.
  Headings count credits ("1 credit") and not-counted rows ("1 row").
- *Came back* = money in, any filing, whose text — less refund / reversal / rebate / reimbursement / waived / credit
  words (credit kept beside WIRE) — reads as a counted kind, taken oldest first and only while it fits within what was
  charged of that kind on that account in the window (to the cent).
- The paid figure says "at least"; no net is stated. The window phrase is decided account by account.

**Worked example (unit, `findBankFees — the worked example`).** Accounts `chk` (first row 2024-01-05) and `card`
(first row 2026-01-15 — inside the window).

| Row | Filed | Amount | Reads as | Result |
|---|---|---|---|---|
| 2024-01-05 BLUE DOOR COFFEE | coffee | −$4.50 | — | chk's first row |
| 2025-10-17 OVERDRAFT ITEM FEE | fees | −$35.00 | overdraft | outside — the day before the window |
| 2025-10-18 WIRE FEE OUTGOING | fees | −$15.00 | wire | charged — the window's first day |
| 2026-10-17 SERVICE CHARGE | fees | −$11.00 | account | charged — today, the window's last day |
| 2026-10-18 SERVICE CHARGE | fees | −$10.00 | — | after today |
| 2026-04-02 FOREIGN TRANSACTION FEE | fees | −$0.87 | foreign | charged |
| 2026-05-20 LATE FEE | late-fee | −$29.00 | late | charged |
| 2026-05-25 LATE FEE | late-fee | +$29.00 | late | came back (same-text credit; card late fees charged $29.00) |
| 2026-06-15 NON-NETWORK ATM FEE | fees | −$3.50 | atm | charged |
| 2026-06-16 CASH WITHDRAWAL CHARGE | atm-fee | −$2.50 | atm (filing's anchor) | charged |
| 2026-06-15 ATM SURCHARGE 7-ELEVEN | atm-fee | −$3.00 | ELEVEN | not counted |
| 2026-07-31, 2026-08-31 MONTHLY MAINTENANCE FEE | fees | −$12.00 ×2 | account | charged |
| 2026-09-03 OVERDRAFT ITEM FEE (chk handover day) | fees | −$35.00 | overdraft | charged, marked |
| 2026-09-04 NSF RETURNED ITEM FEE | fees | −$35.00 | overdraft | charged |
| 2026-09-10 OVERDRAFT FEE REFUND | fees | +$35.00 | overdraft | came back (chk overdraft fees charged $70.00) |
| 2026-03-01 ATM FEE REBATE | refund | +$3.50 | atm | came back (chk ATM fees charged $6.00 in the window) |
| 2026-03-24 INTEREST CHECKING MONTHLY SERVICE FEE | fees | −$15.00 | INTEREST, CHECKING | not counted |
| 2026-03-10 HOA MAINTENANCE FEE | fees | −$450.00 | HOA | not counted |
| 2026-02-10 WESTGATE MAINTENANCE FEE | fees | −$1,850.00 | WESTGATE | not counted |
| 2026-03-20 DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS | fees | −$1,200.00 | no fee word | not counted |
| 2026-03-25 VENMO INSTANT TRANSFER FEE | fees | −$1.75 | VENMO, INSTANT, TRANSFER | not counted |
| 2026-03-21 OVERDRAFT PROTECTION FROM SAVINGS | fees | +$300.00 | no fee word | ignored |
| 2026-03-22 ATM WITHDRAWAL REVERSAL | cash | +$400.00 | no fee word | ignored |
| 2026-03-23 UNIVERSITY TUITION FEE REFUND | education | +$1,500.00 | UNIVERSITY, TUITION | ignored |
| 2026-02-11 INCOMING WIRE CREDIT INV 2207 PROFESSIONAL FEES | other-income | +$4,000.00 | CREDIT (beside WIRE), INV, PROFESSIONAL | ignored |
| 2026-08-06 CASH BACK CREDIT | refund | +$50.00 | no fee word | ignored |
| 2026-05-20 INTEREST CHARGE ON PURCHASES | fees | −$45.12 | interest phrase | left out |
| 2026-04-20 PURCHASE INTEREST CHARGE | fees-interest | −$39.77 | interest | left out |
| 2026-01-15 ANNUAL MEMBERSHIP FEE | fees | −$95.00 | annual phrase | left out |
| 2026-02-01 ANNUAL FEE REVERSAL | fees | +$95.00 | ANNUAL | ignored |
| 2026-07-01 SERVICE CHARGE | fees | −$7.00 | account | a loan-payment exclusion id — not read |
| 2026-08-01/02/03/04 fee rows: pending / excluded / transfer / split parent | fees | — | — | not read |
| 2026-09-03 CORNER GROCERY (chk handover day), 2026-08-05 RENT PAYMENT | groceries, rent | — | — | not a fee filing |

Kinds, largest first: overdraft $35.00 + $35.00 = **$70.00** (2) · account $12.00 + $12.00 + $11.00 = **$35.00** (3)
· late **$29.00** (1) · wire **$15.00** (1) · ATM $3.50 + $2.50 = **$6.00** (2) · foreign **$0.87** (1).
Charged $70.00 + $35.00 + $29.00 + $15.00 + $6.00 + $0.87 = **$155.87** (10 charges). Came back $35.00 + $29.00 +
$3.50 = **$67.50** (3). Not counted $3.00 + $1.75 + $15.00 + $1,200.00 + $450.00 + $1,850.00 = **$3,519.75** (6).
Left out: interest $45.12 + $39.77 = **$84.89** (2), annual **$95.00** (1). One printed row on chk's handover day.
Lead: "You paid at least $155.87 in bank and card fees (10 charges) in the last 12 months (one account's records begin
later, on Jan 15, 2026), and $67.50 of fees came back."

**The cap (unit, `money back is capped …`).** chk: wire fee $15.00 charged; +$4,000.00 "INCOMING WIRE TRANSFER 2207
SERVICE FEES", +$50.00 "WIRE TRANSFER IN REFUND OF FEES" (both wholly wire words), +$200.00 "ATM WITHDRAWAL CHARGE
REVERSAL" (no ATM fee charged) → none fit; +$15.00 "WIRE FEE REFUND" fits exactly → came back $15.00. Two $35.00
overdraft fees and three $35.00 refunds → the first two (oldest) count, $70.00. A $35.01 refund against a $35.00 fee →
not counted; a following $35.00 one → counted. A refund on another account, or of a kind not charged there → not
counted. A predecessor's $35.00 overdraft fee (2026-02-10) and its successor's $35.00 refund (2026-03-05), linked by
`terminalOf` → one account, records from 2023-01-04, the refund counts; unlinked → two accounts, the new one starting
inside the window, nothing back.

**Window phrase.** Every account's first row on or before the window's first day → "in the last 12 months" (a first
row ON 2025-10-18 reaches it) · every account starting inside → "since your records begin on <earliest>" · one inside →
"(one account's records begin later, on <date>)" · several → "(records for N accounts begin later, the latest on
<date>)". No rows at all → "No checking, savings or card records yet, so there are no fees to count."

**Lead branches.** Records, nothing counted → "No bank or card fees counted in the last 12 months." · only a refund
($34.00, no fee of its kind charged) → nothing back either: the same zero sentence · $12.00 monthly fee charged, its
$12.00 reversal and a $35.00 overdraft-fee reversal (no overdraft fee charged) → "You paid at least $12.00 in bank and
card fees (1 charge) in the last 12 months, and $12.00 of fees came back." (no net) · one $29.00 charge → "You paid at
least $29.00 in bank and card fees (1 charge) in the last 12 months." A $0.00 fee row is nothing.

**Window.** 2026-10-17 → 2025-10-18; 2028-02-29 → 2027-03-01 (Feb 29 − 12 months clamps to Feb 28).

**E2E (throwaway reader, today 2026-06-10).** chk and card both reach back before the window. Overdraft $34.00 ×2
(May 4, May 5) + refund $34.00 (May 12); monthly service $15.00 (Apr 30); card late fee $39.00 (May 21); interest
$28.17 (left out); APARTMENT LATE FEE $50.00 (not counted); OVERDRAFT PROTECTION FROM SAVINGS +$300.00 filed as fees
(ignored); an overdraft on 2025-06-10 (outside). Charged $68.00 + $39.00 + $15.00 = **$122.00** (4 charges), came
back **$34.00** (within chk's $68.00 of overdraft fees), not counted **$50.00**. Lead: "You paid at least $122.00 in
bank and card fees (4 charges) in the last 12 months, and $34.00 of fees came back." Demo: no row filed as a fee, every account reaching back → "No bank or card
fees counted in the last 12 months."
