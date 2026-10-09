## §Fees you paid — bank fees by kind, net of what came back (DECISIONS #796)

Engine: `src/lib/engine/fi/bank-fees.ts` (`findBankFees`, `feeKindOf`, `readsAsFeeGivenBack`, `bankFeeWindowStart`),
words `src/lib/engine/fi/bank-fees-copy.ts`, card `src/components/coach/bank-fees-card.tsx` on /coach (`#fees-you-paid`),
loaded in `getCoachData` off the coach's own rows. Tests: `tests/unit/bank-fees.test.ts`,
`tests/unit/bank-fees-card.test.tsx`, `tests/e2e/bank-fees.spec.ts`. Every account, amount, descriptor and date is
invented. Unit `today = 2026-10-17` (window 2025-10-18 – 2026-10-17); e2e and demo `today = 2026-06-10`
(window 2025-06-11 – 2026-06-10).

**The rule.** Charged = money out filed under Fees & Charges (`fees`), ATM Fee (`atm-fee`) or Late Fee (`late-fee`),
posted, not a transfer / money move / split parent / excluded / loan-payment exclusion (`countsInFlows`), dated in the
window. Given back = money in on those rows, plus money in filed elsewhere whose bank text reads as a fee returned.
Net = max(0, charged − given back). Interest & Finance Charges, interest/finance wording under Fees & Charges, and
annual/membership fees are left out (their reversals too) and totalled separately.

**Worked example (unit, `findBankFees — the worked example`).**

| Row | Filed | Amount | Reads as | Counted |
|---|---|---|---|---|
| 2024-01-05 BLUE DOOR COFFEE | coffee | −$4.50 | — | no (sets records-from) |
| 2025-10-17 OVERDRAFT ITEM FEE | fees | −$35.00 | overdraft | no — the day before the window |
| 2025-10-18 WIRE FEE OUTGOING | fees | −$15.00 | wire | yes — the window's first day |
| 2026-04-02 FOREIGN TRANSACTION FEE | fees | −$0.87 | foreign | yes |
| 2026-05-20 LATE FEE | late-fee | −$29.00 | late | yes |
| 2026-06-15 NON-NETWORK ATM FEE | fees | −$3.50 | atm | yes |
| 2026-06-15 ATM SURCHARGE 7-ELEVEN | atm-fee | −$3.00 | atm (filing) | yes |
| 2026-07-01 SERVICE CHARGE | fees | −$7.00 | account | no — a loan-payment exclusion id |
| 2026-07-31, 2026-08-31 MONTHLY MAINTENANCE FEE | fees | −$12.00 ×2 | account | yes |
| 2026-08-01 MONTHLY SERVICE FEE (pending) | fees | −$5.00 | — | no |
| 2026-08-02/03/04 OVERDRAFT ITEM FEE (excluded / transfer / split parent) | fees | −$25.00 ×3 | — | no |
| 2026-09-03, 2026-09-04 OVERDRAFT ITEM FEE, NSF RETURNED ITEM FEE | fees | −$35.00 ×2 | overdraft | yes |
| 2026-09-10 OVERDRAFT FEE REFUND | fees | +$35.00 | overdraft | given back |
| 2026-03-01 ATM FEE REBATE | refund | +$3.50 | fee wording | given back |
| 2026-08-06 CASH BACK CREDIT | refund | +$50.00 | — | no — no fee word |
| 2026-05-20 INTEREST CHARGE ON PURCHASES | fees | −$45.12 | interest | left out |
| 2026-04-20 PURCHASE INTEREST CHARGE | fees-interest | −$39.77 | interest | left out |
| 2026-01-15 ANNUAL MEMBERSHIP FEE | fees | −$95.00 | annual | left out |
| 2026-02-01 ANNUAL FEE REVERSAL | fees | +$95.00 | annual | ignored with it |
| 2026-10-18 SERVICE CHARGE | fees | −$10.00 | — | no — after today |

Kinds, largest first: overdraft $70.00 (2) · late $29.00 (1) · account $24.00 (2) · wire $15.00 (1) · ATM $6.50 (2) ·
foreign $0.87 (1). Charged $145.37 (9 charges); given back $35.00 + $3.50 = $38.50; net $145.37 − $38.50 = **$106.87**.
Left out: interest $45.12 + $39.77 = $84.89 (2), annual $95.00 (1). One counted row on chk's handover day (2026-09-03).
Lead: "You were charged $145.37 in bank fees (9 charges) in the last 12 months; $38.50 came back, so they cost you $106.87."

**Lead branches.** Nothing counted → "No bank fees counted in the last 12 months." · records beginning 2026-09-01 →
"… since your records begin on Sep 1, 2026." · only a refund ($34.00) → "No bank fees counted …, and $34.00 of fees came
back to you." · $12.00 charged, $12.00 back → "You were charged $12.00 … (1 charge) …, and $12.00 came back." (no
"cost you $0.00") · $12.00 charged, $47.00 back → same shape, net $0.00 · one $29.00 charge, nothing back → "You paid
$29.00 in bank fees (1 charge) in the last 12 months." A $0.00 fee row is not a charge.

**Window.** 2026-10-17 → 2025-10-18; 2028-02-29 → 2027-03-01 (Feb 29 − 12 months clamps to Feb 28).

**E2E (throwaway reader, today 2026-06-10).** Overdraft $34.00 ×2 (May 4, May 5) + refund $34.00 (May 12); monthly
service $15.00 (Apr 30); card late fee $39.00 (May 21); interest $28.17 (left out); an overdraft on 2025-06-10 (the
day before the window, not counted). Charged $68.00 + $39.00 + $15.00 = $122.00 (4 charges), back $34.00, net $88.00.
Demo: no row filed as a fee → "No bank fees counted in the last 12 months."
