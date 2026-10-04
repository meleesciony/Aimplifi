## §Tax charges left out of the guilt-free plan (DECISIONS #783)

Engine: `src/lib/engine/spending-plan/tax-categories.ts` (`PLAN_TAX_CATEGORY_IDS` = Taxes +
Estimated Tax Payment), read by `FIXED_PATTERN_EXCLUDE_CATEGORY_IDS` (spend-class.ts),
`PLAN_FIXED_NEVER_CATEGORY_IDS` (plan.ts), the loader's filed-category remap and
`taxChargesInLookback` (fixed-category-amounts.ts). Tests:
`tests/unit/tax-payments-out-of-plan.test.ts`. All amounts and dates invented. `today = 2026-10-03`:
the Fixed typical window is Jul–Sep 2026; the tax lookback is the 12 complete months Oct 2025–Sep 2026.

Household (one checking account, savings target 20%):

| Date | Row | Category | Amount |
|---|---|---|---|
| Jul 17 / Aug 17 / Sep 17 | Payroll | paycheck | +$6,000.00 each |
| Sep 22 | Transfer from brokerage (`isTransfer`) | transfer | +$28,000.00 |
| Jul 1 / Aug 1 / Sep 1 | Rent | rent | −$2,000.00 each |
| Jul 12 / Aug 12 / Sep 12 | Electricity | electricity | −$150.00 each |
| Jun 11 | State estimated payment | estimated-tax | −$1,800.00 |
| Aug 9 | Tax preparer | taxes | −$400.00 |
| Sep 8 | State estimated payment | estimated-tax | −$2,500.00 |
| Sep 23 | IRS | taxes | −$30,000.00 |

- **Income** = median($6,000, $6,000, $6,000) = **$6,000.00**. The brokerage transfer is in no
  income month.
- **Fixed** = rent $6,000 ÷ 3 + electricity $450 ÷ 3 = $2,000.00 + $150.00 = **$2,150.00**. No tax
  line on either leaf.
- **Savings** = 20% × $6,000.00 = **$1,200.00**.
- **Guilt-free** = $6,000.00 − $2,150.00 − $1,200.00 = **$2,650.00**.
- **Left out** (12-month lookback) = 4 charges, $1,800 + $400 + $2,500 + $30,000 = **$34,700.00**.

Before the rule (fail-old, measured by emptying `PLAN_TAX_CATEGORY_IDS`): Taxes' first counted
outflow is Aug 9, so its typical divided by 2 observed months — ($400 + $30,000) ÷ 2 =
$15,200.00; Estimated Tax Payment was first seen in June, so it divided by 3 — $2,500 ÷ 3 =
$833.33 (Math.round of 250000/3 = 83333). Fixed **$18,183.33**; guilt-free
$6,000.00 − $18,183.33 − $1,200.00 = **−$13,383.33** ("over plan").

Re-filing the IRS row to Estimated Tax Payment (critic cycle 1, P1-1) still gives Fixed $2,150.00;
under the first cut (`taxes` only) that row was its leaf's first window outflow and priced whole.

A **Taxes target of $500.00** the reader typed enters Fixed as their own number: rollup
$2,150.00 + $500.00 = **$2,650.00** (`basis: 'budget-target'`, typical $0.00).

A converted reserve for the IRS payee: left out = 3 charges, **$4,700.00** — the reserve carries
that payee's money.

Boundaries locked:
- Sep 2025 (13th month back) and Oct 2026 (current month) tax rows are not in the left-out count;
  PENDING, transfer-flagged, excluded and positive (refund) tax rows are not charges.
- Property Tax is NOT a tax leaf: it classifies Fixed, a detected SEMIANNUAL $3,000 property-tax
  series unions at $500.00 a month, and it is never in the left-out count.
- A row the reader marked Fixed is still out — the rule is category-level.
- A detected QUARTERLY series on either tax leaf is refused by both the union and the
  detected-series fallback.
- The median basis drops tax rows: Jul/Aug/Sep each read $2,150.00.
- A quarterly state payee the normalizer does not recognise ("COMMONWEALTH DOR ESTPMT", $900.00
  Jan/Apr/Jul), filed Taxes, is detected but never reaches Fixed: Fixed = groceries $600.00,
  guilt-free = $5,000.00 − $600.00 = $4,400.00 (no target). With the remap clause removed it
  unioned at $900 ÷ 3 = $300.00 a month.

Critic cycle 2 locks:
- A QUARTERLY series on a tax leaf (or a card-payment / cash / investment series on any long
  rhythm) does not trigger the "counted a third at a time" note on Home or in the glass box —
  `longCadencesInTerm` skips `PLAN_FIXED_NEVER_CATEGORY_IDS`; a QUARTERLY auto-insurance series and
  an ANNUAL series with no category still do.
- "PROPERTY TAXES", "HARRIS COUNTY PROPERTY TAXES", "REAL ESTATE TAXES", "SCHOOL TAXES",
  "COUNTY TAXES ONLINE", "COUNTY TAX COLLECTOR" file as Property Tax (counted); "IRS USATAXPYMT",
  "STATE DEPT OF REVENUE PMT", "FRANCHISE TAX BD", "TURBOTAX" still file as Taxes.
- One sentence author (`tax-copy.ts`). With 2 charges totalling $30,400.00: "Not counted here:
  $30,400.00 filed as taxes in your last 12 complete months (2 charges)." With a $500.00 tax
  target in the figure the set-aside lever is replaced by "Your monthly tax target of $500.00 is
  counted in their place." Ask safe-to-spend: room-to-spend branch (income $6,000, Fixed $2,150 →
  $3,850.00) says the real room is smaller; over-plan branch (Fixed $9,000 → over by $3,000.00) says
  the real overage is bigger; a Fixed override claims no direction. Ask conscious spending and the
  /budgets strip print the signed figure, so they always say "room to spend is smaller".
- Loader: income $5,000, groceries $600, IRS $12,000 filed Taxes, Taxes target $500 → Fixed
  $1,100.00, guilt-free $3,900.00, `targetCents` 50000; a Property Tax renamed "Home taxes" is
  named that way in the sentence.

Critic cycle 3 locks:
- A property-tax series an older categorizer filed Taxes ("HARRIS COUNTY PROPERTY TAXES", $3,000.00
  Apr 2025 / Oct 2025 / Apr 2026, SEMIANNUAL) stays counted: today's guess is Property Tax, a Fixed
  category, so the stale tax filing does not win the remap. Income $5,000, groceries $600 →
  Fixed $600.00 + $3,000 ÷ 6 = **$1,100.00**; the series is the one union line; the left-out count
  is 0 (its merchant made the union). Fail-old: Fixed $600.00.
- A tax filing still wins over a guess that is not a Fixed category (null, `uncategorized`,
  discretionary) — the state-payee case above.
- The set-aside lever addresses "quarterly estimates or a monthly payment plan".
