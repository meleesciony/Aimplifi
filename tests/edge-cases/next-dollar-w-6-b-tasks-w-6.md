## §Next-dollar (W.6(b) — TASKS W.6)

The extra-dollar order, compared at **nominal** APR vs the **nominal** expected-return
dial (APR is a contracted nominal rate; the FI card's real/after-inflation rate is a
different unit). Strict `>` so an APR equal to the return assumption is a wash and
falls through (eventually to investing). Employer match is a Settings rung status (`unknown` → skipped; `uncaptured` wins
the destination; `captured` / `none` fall through). Tax-advantaged room is still
not on file (`unknown` → skipped). CREDIT is revolving only when a
statement remainder is past due; in-cycle card balances are cash-needed, not extra-pay.

Order: revolving APR above the return → uncaptured match → runway under 3 months →
installment APR above the return → investing.

| # | Inputs | Destination |
|---|--------|-------------|
| N1 | revolving Store Card 31.99% $43.50; Auto Loan 6.49%; runway 1.5 mo; return 7.00% | revolving Store Card |
| N2 | Auto Loan 6.49%; runway 1.5 mo; match **uncaptured** | employer match |
| N3 | Auto Loan 6.49%; runway 1.5 mo; match unknown | emergency fund |
| N4 | Auto Loan 6.49% $14,300; runway 4.2 mo; return 7.00% (demo shape) | investing |
| N5 | Personal Loan 12.00%; Auto Loan 6.49%; runway 4.2 mo | installment Personal Loan |
| N6 | Auto Loan APR **=** 7.00% return; runway 4.2 mo | investing (strict `>`) |
| N7 | no debts; runway `Infinity` | investing; skip match + tax-advantaged |
| N8 | 0% promo revolving $900; Auto Loan 6.49%; runway 4.2 mo | investing |
| N9 | revolving 5.00% (under 7.00%); runway 4.2 mo | investing |
| N10 | Auto Loan 6.49%; runway `Infinity` | investing (unsized runway does not fire the floor) |
| N11 | LOAN with `aprBps` null; runway 4.2 mo | investing; skip `loan_apr` (unknown is not 0%) |
| N12 | match **none**; Auto Loan 6.49%; runway 1.5 mo | emergency fund (none is not uncaptured; skip list is tax only) |
| N13 | match **captured**; Auto Loan 6.49%; runway 4.2 mo | investing; skip tax only (match is known, not unknown) |

The 3-month floor is the same band `NetWorthCard` uses (`runwayMonths < 3`).
3.0 months is at the floor, not under it. A known 0% installment stays on file
and is named; a null APR is skipped, never ranked as 0%.

---
