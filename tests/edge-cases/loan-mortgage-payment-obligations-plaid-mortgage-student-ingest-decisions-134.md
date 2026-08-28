## Loan/mortgage payment obligations + Plaid mortgage/student ingest (DECISIONS #134)

The loan-obligation engine (`engine/loans/obligations.ts::selectLoanObligations`) and the Plaid
mortgage/student mappers. All money is integer cents; the business-day rule is the SAME the
cash-needed engine applies to cards (`priorBusinessDayIfNonBusiness`, clamped never-before-today).

### LO-A. Weekend + observed-holiday roll-back (the demo Auto Loan)
`{ type:'LOAN', minimumPaymentCents:38500, dueDayOfMonth:5 }`, today 2026-06-10. Next due-day-5
on/after today = **2026-07-05** (a Sunday). Walk back: Sun → Sat → Fri **2026-07-03**, which is the
OBSERVED Independence Day (Jul 4 = Saturday) → Thursday **2026-07-02**. Obligation: dueDate 2026-07-05,
effectiveDueDate 2026-07-02, paymentCents 38500. Verified end-to-end on the seed (phase4.test.ts).

### LO-B. MORTGAGE included; plain business-day due date unchanged
`{ type:'MORTGAGE', dueDayOfMonth:15, minimumPaymentCents:210000 }`, today 2026-06-10 → dueDate
2026-06-15 (a Monday, a business day) → effectiveDueDate 2026-06-15 (unchanged). MORTGAGE surfaces on
the calendar/reminders exactly like LOAN (both are liabilities); it is excluded from the debt snowball.

### LO-C. Exclusions — nothing fabricated
A CREDIT or CHECKING account, a loan with `minimumPaymentCents` null or 0, or a loan with
`dueDayOfMonth` null all produce NO obligation (no payment/date to surface; the engine never invents one).

### LO-D. Clamp to today
today = Sunday 2026-07-05, dueDay 5 → dueDate 2026-07-05; its prior business day (2026-07-02) is BEFORE
today, so effectiveDueDate clamps UP to today (2026-07-05) — the cash-needed "never before today" rule.

### LO-E. Plaid mortgage → loan fields
`{ next_monthly_payment:1850.00, next_payment_due_date:'2026-07-15', interest_rate:{percentage:6.49} }`
→ `{ aprBps:649, minimumPaymentCents:185000, dueDayOfMonth:15 }`. Nested `interest_rate.percentage`
(percent→bps via integer ×100); `next_monthly_payment` (dollars→cents); due day = the date's day component.

### LO-F. Plaid student → loan fields (FLAT rate field; deferment)
`{ minimum_payment_amount:250.00, next_payment_due_date:'2026-07-21', interest_rate_percentage:4.53 }`
→ `{ aprBps:453, minimumPaymentCents:25000, dueDayOfMonth:21 }`. Student uses the FLAT
`interest_rate_percentage` (not the nested mortgage object) and `minimum_payment_amount`. In deferment
(`minimum_payment_amount`/`next_payment_due_date` null) the known rate still maps; payment + day stay null.

### LO-G. Preserve-on-null (never zero a known value)
Any mortgage/student field Plaid reports null/non-finite/non-positive maps to null, and the Account UPDATE
OMITS null fields — a deferment loan or a transient missing field PRESERVES the last-known APR/payment/
due-day (the #130 discipline). A null student `account_id` (Plaid allows it) is skipped, never throws.

### Surface boundary (no headline drift)
Loan obligations feed the calendar (`loan-due` event) + reminders + — as of the #134 follow-up below —
the /forecast BALANCE PROJECTION; the cash-needed engine (`type==='CREDIT'` filter, `requiredCents`,
`cardsDueCount`, projection) is untouched. The seed has no shortfall, so removing the `sched-autoloan`
stand-in leaves every cash-needed headline golden byte-identical.

### LO-H. Loan payments in the /forecast balance projection (#134 follow-up, DECISIONS #151)
The forecast reads only checking scheduled rows, and a loan payment is NOT a scheduled row (it surfaces
as a loan-due obligation), so removing `sched-autoloan` starved the demo forecast by $385/mo — the
projection over-stated checking and disagreed with the calendar/reminders that DID show the loan.
`loanObligationsToScheduledFlows` maps each obligation to a MONTHLY outflow on its RAW `dueDate` (never
`effectiveDueDate` — a business-day-shifted anchor would drag the shift into every future month), and
`getCashFlowForecast` folds them onto the payment-account projection. The loan's **ISOLATED contribution**
— a bare `$3,400.00` (340000¢) start with ONLY the auto-loan, which is the exact known-answer
`forecast.test.ts` pins (demo: today `2026-06-10`, Auto Loan `$385.00` = 38500¢ due day 5; horizon 90d →
occurrences 2026-07-05, 08-05, 09-05):
- one payment by 2026-07-10 (30d) → `340000 − 38500 = 301500` (`$3,015.00`) = **−$385** vs no-loan
- two payments by 2026-08-09 (60d) → `340000 − 77000 = 263000` (`$2,630.00`) = **−$770**
- three payments by 2026-09-08 (90d) → `340000 − 115500 = 224500` (`$2,245.00`) = **−$1,155**
- total loan outflow over the horizon = `3 × 38500 = 115500` (`$1,155.00`)

**These are the loan's isolated effect, NOT the on-screen /forecast milestone balances.** The real demo
projection also carries biweekly payroll (+$2,450), rent (−$1,800), and the savings auto-transfer (−$500),
so the balance shown on /forecast at those dates is much higher — do NOT diff the `$3,015`-style figures
above against the screen (that reads a phantom regression). The **server** read-path (loan folded in ×3 @
−$385, correct account/count) is locked by `tests/unit/forecast-server.test.ts`; the isolated per-milestone
deltas are locked by `tests/unit/forecast.test.ts`.

NO cross-source de-dup: no structural key links a checking scheduled row to a loan Account, and heuristic
money-matching is rejected (STATUS #134). The narrow residual — a loan whose ACH is ALSO recurring-detected
as a non-transfer checking row double-counts (now on forecast too, same population already doubling on the
calendar) — is pinned by a regression test that documents the accepted limitation. Not demo-reachable
(`refreshRecurringForUser` runs only on real Plaid/SimpleFIN sync, never for the seeded demo).
