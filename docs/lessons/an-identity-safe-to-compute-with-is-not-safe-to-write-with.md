# An identity good enough to COMPUTE with is not good enough to WRITE with

One-line summary: C.24's structural loan-payment merchant set was safe as an input to the Fixed
union because a compensating invariant sat around it (excluded ⇔ unioned — where the union cannot
take the money, the basis keeps it); reusing the identical set to write `Transaction.isTransfer`
at sync time dropped that invariant, and the same identity then deleted $2,215/mo of a stranger's
real bills, permanently and with no undo.

## What happened (#400, C.25)

The owner's $6,217.07 mortgage counted as `rent` spending in April and July and as nothing in May
and June, because the transfer pair rule is a ±3-day coincidence test and the flag it writes is per
ROW. One payee, two classes of row, decided by settlement timing. The fix looked obvious and had a
precedent in the repo: make the class per MERCHANT, exactly as a descriptor the normalizer knows
(`auto-loan`) already classifies every row of its payee. It was built at the one production writer
of `isTransfer`, passed the whole gate — tsc, eslint, 5772 unit tests including 16 new locks with
four mutations each killing exactly its own lock, `next build`, 25/25 affected e2e — and was
reverted after a fresh-context critic, because three of its five P0s reproduce by execution.

## The transferable rule

**Ask what invariant was holding the identity's error budget, and whether it comes with you.**

C.24 consumed `loanPaymentMerchantCanonicals` inside one read-time computation that could check its
own work: a merchant's rows leave the Fixed rollup ONLY once its series actually made the union, so
a wrong or unlucky classification cost nothing — the money stayed in the basis. The write path can
check nothing. It fires at sync, applies to every consumer at once, and there is no undo: nothing
in `src/server` or `src/lib/providers` ever writes `isTransfer: false`, and a flagged row cannot be
split, reimbursed, excluded from totals, rule-targeted, or declared a bill. The same set, one layer
over, went from "worst case we count a bill twice in one internal sum" to "worst case a stranger's
rent, electric and internet vanish from every total forever".

Three concrete failures, all executed (`scripts/audit-probes/c25-critic-repro.mts`):

1. **The specificity guard was narrower than its docblock implied.** The C.24 comment warns about
   "ONE NAME OVER MANY PAYEES", and the guard for it is `m.aggregate` — a hardcoded six-name list
   (Zelle, Venmo, Check, Cash App, Apple Cash, PayPal Transfer). `ONLINE PAYMENT`, `BILL PAY` and
   `ACH DEBIT` are ordinary canonicals. On a bank that stamps every ACH the same way, ONE $450
   auto-loan payment flagged and auto-filed the reader's rent, electric and internet.
2. **One coincidence classified a payee forever, at every amount.** The class carries no amount and
   no date constraint by design ("one paired month classifies every month"), which is right for a
   computation over a known payee and wrong for a permanent write: a roofing invoice that happened
   to equal a mortgage payment took its own later $1,250 bill with it.
3. **It silently defeated the invariant it was borrowing credibility from.** `classifySpendClass`
   returns `out-of-scope` for a transfer row, so flagging removed the merchant from
   `monthlyNonDiscretionaryCents` and `resolveFixedCategoryAmounts` too — and in the no-series
   branch (the reader taps "Not a bill", under three payments of history, an escrow re-analysis
   breaks the amount plateau) Fixed lost the whole bill with nothing to re-enter it. The exact
   defect C.24 was built to fix, in the dangerous direction.

## Two smaller rules the same session paid for

**Grepping a literal is not following a call chain.** The reverted decision record asserted that
`resolveFixedCategoryAmounts` and `monthlyNonDiscretionaryCents` "never read `isTransfer`" — from
grepping the string in those two files. Both reach it through `countsInFlows` and
`classifySpendClass` one call down. That sentence is what made the change look safe enough to gate,
and it is rule 0's own failure mode: a check that cannot fail is not a check.

**Measure the queued prescription before building it.** C.25 was written as "the radar, /calendar
and cash-needed stay blind to the bill the plan reserves — add a `loanPayment` keep". A read-only
replay killed that in one run: the linked mortgage account carries `minimumPaymentCents` and
`dueDayOfMonth`, so `selectLoanObligations` dates it and those surfaces have been expanding three
$6,217.07 committed events per 90-day window all along. Building the keep would have doubled the
bill on the committed line, and the #134 overlap disclosure could not have caught it (it fires only
on a normalizer `auto-loan` verdict). A task row's diagnosis is authoring-time, like a plan doc's
verdict — re-measure it, especially when it tells you something is missing.

**And the reassuring worked example is the tell.** The whole "the loan side already carries it"
argument rested on one account: the owner's Plaid mortgage. SimpleFIN writes neither provider field
for loans, and the repo already models `undatable-loan` for Plaid servicers that return no next
payment. For those users the fix would have removed the payment from every flow sum while nothing
projected it anywhere — money deleted, not moved.

## Where this leaves the defect

Open, and narrower than before. Removing money from a flow sum is only safe where "it is carried
elsewhere" can be CHECKED, and that is a read-time fact (does the series union? does a loan
obligation exist to project?). So the remaining direction is a read-side per-merchant exclusion at
the flow-summing boundary carrying its own invariant — never a stored flag. Failure direction
decides the tie the way it usually does: the defect leaves a real charge visible in some months,
which a reader can weigh; the fix deleted real charges silently, which inflates guilt-free spending
and drops the FI number by 25× the missing annual amount.
