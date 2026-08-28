## §Recurring: the reader's own verdict (O.13f / O.15 slice 4, hand-verified)

All values below are executed in `tests/unit/recurring-override.test.ts` against
today = **2026-06-10**, and the descriptors' canonicals are read from
`normalizeMerchant`, not assumed: `LAKESIDE PROPERTY MGMT RENT` → `Lakeside Property
Mgmt Rent` (category `rent`), `SUPERCUTS 4412` → `Supercuts` (`personal-care`).

**A. What a declaration is allowed to claim.** ONE charge on 2026-05-15 for
**−$1,250.00**, declared MONTHLY, produces a series with `typicalAmountCents`
**−125000**, `lastSeenAt` **2026-05-15**, `nextExpectedAt` **2026-06-15** (one month on,
already ≥ today), `occurrences` **1**, `categoryId` `rent`, `isIncome` false and
`declaredByUser` **true**. Every one of those except the cadence is read off the
reader's real charge by `buildSeries`, the same function detection uses. With no
declaration the same input detects **nothing** — three sightings are the bar.

**B. No price-change claim, ever.** Two charges at two amounts (−120000 on 2026-04-15,
−125000 on 2026-05-15) is exactly the shape the two-plateau rule reads as a price rise
WITH three sightings. Declared, it yields `previousAmountCents` **null** and
`priceChangedAt` **null**, and `typicalAmountCents` **−125000** (the most recent charge,
as detection does). From two rows a price claim would be the app originating a fact.

**C. The declared rhythm steps past today.** Anchor 2026-01-15, today 2026-06-10:
WEEKLY → **2026-06-11**, MONTHLY → **2026-06-15**, ANNUAL → **2027-01-15**. Same
`nextDate` loop as a detected series, so a declaration cannot land a date in the past.

**D. It reaches the money.** The series in (A) through `toScheduledTransactions` with
scope `{paymentAccountId: 'acct-checking', cashAccountIds: {'acct-checking'}}` is
exactly one row: `{accountId: 'acct-checking', description: 'Lakeside Property Mgmt
Rent', amountCents: -125000, nextDate: '2026-06-15', cadence: 'MONTHLY', source:
'recurring'}` — the same shape a detected bill produces, so every downstream expander
(cash-needed, forecast, calendar, the plan's fixed term) treats it identically.

**E. A demotion removes the projection, not just the listing.** Three haircuts on
2025-12-10 / 2026-03-11 / 2026-06-09 (gaps 91 and 90 — inside the quarterly band and
within the 7-day spread licence) DETECT as QUARTERLY and produce one scheduled row.
With `NOT_BILL` for `Supercuts`: **0** series and **0** scheduled rows, while every
other payee in the same input is byte-identical. NOT_BILL also beats a BILL row for the
same payee and beats the evidence — it is the only lever against a false detection.

**F. What is refused rather than half-honoured.** A BILL row whose cadence is not one of
the six projected cadences (including `IRREGULAR`) reads back as NO instruction, at both
the write boundary and `parseRecurringOverride`; a declaration naming a payee with no
charges produces no series (there would be no amount to state and no date to anchor) and
/recurring says so; and a BILL whose payee ALSO detects keeps the DETECTED cadence, with
`declaredByUser` false — the page then reads "Aimplifi now sees the pattern … so removing
this would change nothing" rather than claiming his rhythm is the one running.
