## §C.25 read-side loan-payment flow exclusion (`engine/categorize/loan-payment-flows.ts`, DECISIONS #403)

The four gates: (1) row would otherwise count (CHECKING/SAVINGS outflow, POSTED,
not split parent, not reader-excluded); (2) canonical linked to ONE loan account by
**≥2 distinct calendar months** of ±3-day same-|amount| pairs, re-derived at read
time (stored `isTransfer` never consulted); aggregate canonicals refused; (3) that
account has a DATEABLE obligation; (4) |amount| equals an obligation payment.

Fixture A — the owner shape (Truist, obligation **621707**, due day 1):
loan inflows +621707 on 2026-05-05 / 06-04 / 07-10; chk outflows −621707 on
04-03 (unflagged, no counterpart), 05-04 (flagged, pairs at 1 day), 06-03
(flagged, pairs), 07-06 (unflagged, counterpart 4 days out = NO pair).
Pair months = {05, 06} = **2** → eligible. **All four outflows excluded**;
with payroll +500000 on the 1st and groceries −10000 on the 15th of each month,
`monthlyFlows` prints expenses **10000** and savingsRateBps **9800** in all four
months (today: Apr/Jul print 631707 expenses). Gate-4 note: t-may/t-jun were
already out via their stored flag — the ids that CHANGE totals are Apr and Jul.

Fixture B — generic descriptor (P0-1 of the reverted attempt): descriptor
`ONLINE PAYMENT` (non-aggregate canonical) on auto-loan payments −45000,
2026-05-15 + 06-15 (both pair with the auto account's +45000 inflows next day),
plus rent −190000 (06-01), electric −22000 (06-12), internet −9500 (06-14) under
the SAME descriptor. Excluded: **exactly the two −45000 rows**; rent/electric/
internet stay, because gate 4 matches the obligation amount only.

Fixture C — one coincidence (P0-2): roofing −621707 on 06-17 pairs with the
mortgage inflow 06-18; no other roofing row exists. Pair months = {06} = **1**
→ NOT eligible → the invoice stays in spending. Same for a first-payment
mortgage (one paired month only): visible until the second pair lands.

Fixture D — SimpleFIN loan: the MORTGAGE account carries NEITHER
`minimumPaymentCents` NOR `dueDayOfMonth` (verified: SimpleFIN writes neither)
→ no obligation → gate 3 fails → **no exclusion**, Apr/Jul rows count (visible
beats vanished, #400). Fixture E — undatable Plaid loan: payment present, due
day null → identical outcome.

Fixture F — escrow adjustment: as A plus −650000 on 08-04 (pairs 08-05);
obligation still 621707. Gate 4 fails for the 650000 row → it STAYS visible;
the four 621707 rows stay excluded.

Fixture G — aggregate canonical: descriptor `CHECK 1041` (aggregate `check`),
two paired months, matching obligation → **never excluded** (C.4 doctrine).

Boundary: two pairs in ONE calendar month (05-02 and 05-20) = 1 distinct month
→ not eligible. PENDING rows are never in flows regardless of the set.


Capacity cap (critic cycle 2): per canonical, month and amount, at most the
CARRIED count leaves — the month's loan inflows at that amount onto eligible
accounts (observed) or the obligations covering it there (projected),
whichever is larger. Two $6,217.07 rows against one July inflow → exactly one
leaves. Same-amount RENT under a generic canonical: the attributed loan
payment takes the capacity, the rent stays (and when both pair
coincidentally, exactly one unit leaves — the invariant is on the SUM). A row
paired with an INELIGIBLE account, even alongside an eligible one, never
leaves (ambiguity keeps it visible); a lone ambiguous month stays too.
Fixture A still excludes all four rows: Apr via the obligation capacity (no
inflow that month), May/Jun/Jul each at capacity 1.
