# Source transcription — owner's Simplifi-style category list (9 screenshots, IMG_4155–4164)

Verbatim transcription of the owner's live category picker. Used to compute the gap
against Aimplifi's canonical taxonomy. **Not** a target list — see the triage column.

Triage key:
- `ADOPT` — generic, reusable, belongs in a default taxonomy
- `SYSTEM` — reserved/system category, not user-facing spend
- `SKIP` — user-specific, junk, or an artifact of that app's data model

| Group | Child | Grandchild | Triage |
|---|---|---|---|
| Auto & Transport | | | ADOPT |
| | Car Insurance | | ADOPT |
| | Car Payment | | ADOPT |
| | Car Wash | | ADOPT |
| | Gas & Fuel | | ADOPT |
| | Parking | | ADOPT |
| | Public Transportation | | ADOPT |
| | Registration | | ADOPT |
| | | Other Vehicle Fees | ADOPT |
| | | Registration Fees | ADOPT |
| | | Vehicle Property Tax | ADOPT |
| | Rideshare | | ADOPT |
| | Service & Parts | | ADOPT |
| | Tolls | | ADOPT |
| Balance Adjustment | | | SYSTEM |
| Business Services | | | ADOPT |
| | Shipping | | ADOPT |
| Cash & ATM | | | ADOPT |
| Charity & Donations | | | ADOPT |
| Credit Card Payment | | | SYSTEM |
| Digital Services | | | ADOPT |
| Dining & Drinks | | | ADOPT |
| | Bars | | ADOPT |
| | Coffee Shops | | ADOPT |
| | Fast Food | | ADOPT |
| | food delivery | | ADOPT (normalize case) |
| | Restaurants | | ADOPT |
| Education | | | ADOPT |
| | Books & Supplies | | ADOPT |
| | Student Loan | | ADOPT |
| | Tuition | | ADOPT |
| Entertainment | | | ADOPT |
| | golf | | SKIP (user hobby) |
| Fees & Charges | | | ADOPT |
| | ATM Fee | | ADOPT |
| | Finance Charge | | ADOPT |
| | Late Fee | | ADOPT |
| | Service Fee | | ADOPT |
| Finan | | | SKIP (truncated typo, half-saved name) |
| Financial | | | ADOPT |
| | Financial Advisor | | ADOPT |
| | | financial sub | SKIP (test row) |
| | Financial Sub | | SKIP (test row) |
| | Life Insurance | | ADOPT |
| Fitness | | | ADOPT |
| | Gym | | ADOPT |
| | Workout Classes | | ADOPT |
| Gifts | | | ADOPT |
| golf | | | SKIP (duplicate of Entertainment > golf, at top level) |
| Groceries | | | ADOPT |
| | Alcohol | | ADOPT |
| Health | | | ADOPT |
| | Dentist | | ADOPT |
| | Doctor | | ADOPT |
| | Eyecare | | ADOPT |
| | Health Insurance | | ADOPT |
| | Pharmacy | | ADOPT |
| Home | | | ADOPT |
| | Furnishings | | ADOPT |
| | HOA Dues | | ADOPT |
| | Home Improvement | | ADOPT |
| | Home Insurance | | ADOPT |
| | Home Services | | ADOPT |
| | Home Supplies | | ADOPT |
| | Mortgage | | ADOPT |
| | | Mortgage Interest | ADOPT |
| | | Mortgage Principal | ADOPT |
| | Rent | | ADOPT |
| Kids | | | ADOPT |
| | 529 | | ADOPT |
| | Allowance | | ADOPT |
| | Baby Supplies | | ADOPT |
| | Babysitter & Daycare | | ADOPT |
| | Child Support | | ADOPT |
| | extracurricular | | ADOPT as "Extracurriculars" (merge w/ Kids Activities?) |
| | Kids Activities | | ADOPT |
| | kids bday | | SKIP (covered by Gifts) |
| | kids golf | | SKIP (user hobby) |
| | Toys | | ADOPT |
| | Tuition | | SKIP (dup of Education > Tuition) |
| Loans | | | ADOPT |
| | Loan Fees and Charges | | ADOPT |
| | Loan Insurance | | ADOPT |
| | Loan Payment | | ADOPT |
| | | Loan Interest | ADOPT |
| | | Loan Principal | ADOPT |
| Oh Shit | | | SKIP (user junk) |
| Opening Balance | | | SYSTEM |
| Personal Care | | | ADOPT |
| | Hair | | ADOPT |
| | Laundry | | ADOPT |
| | Nail Salon | | ADOPT |
| | Spa | | ADOPT |
| Personal Income | | | ADOPT (income side) |
| | Alimony | | ADOPT |
| | Bonus | | ADOPT |
| | Child Support | | ADOPT (income-side, distinct from Kids > Child Support) |
| | Dividend Income | | ADOPT |
| | Interest Earned | | ADOPT |
| | Other Income | | ADOPT |
| | Other Pension | | ADOPT |
| | Paycheck | | ADOPT |
| | Tax Refund | | ADOPT |
| | Taxable IRA Withdrawal | | ADOPT |
| Pets | | | ADOPT |
| | Pet Food & Supplies | | ADOPT |
| | Pet Grooming | | ADOPT |
| | Veterinary | | ADOPT |
| Shopping | | | ADOPT |
| | AJA gifts | | SKIP (user-specific) |
| | Books | | ADOPT |
| | Clothing | | ADOPT |
| | Electronics | | ADOPT |
| | mike meds | | SKIP (user-specific; covered by Health > Pharmacy) |
| Shopping:Pouch | | | SKIP (malformed colon-namespaced row) |
| Taxes | | | ADOPT |
| | Federal Estimated Tax Payment | | ADOPT |
| | Federal Tax | | ADOPT |
| | Local Tax | | ADOPT |
| | Medicare | | ADOPT |
| | Personal Property Tax | | ADOPT |
| | Property Tax | | ADOPT |
| | Sales Tax | | ADOPT |
| | SDI | | ADOPT |
| | Social Security | | ADOPT |
| | State Tax | | ADOPT |
| Transfer | | | SYSTEM |
| | (per-account rows: card/loan/brokerage names, 5x michael.lee.p@gmail.com) | | SKIP — that app materializes one child per linked account; Aimplifi models transfers as account-to-account links, not categories |
| Travel | | | ADOPT |
| | Airfare | | ADOPT |
| | Hotel | | ADOPT |
| | Rental Car & Taxi | | ADOPT |
| Uncategorized | | | SYSTEM |
| Utilities | | | ADOPT |
| | Gas & Electric | | ADOPT |
| | Internet & Cable | | ADOPT |
| | Phone | | ADOPT |
| | Trash | | ADOPT |
| | Water | | ADOPT |
| Work Expenses | | | ADOPT |

## Coverage note

Screenshot IMG_4163 was not provided; the gap falls inside the `Transfer` per-account
list (between "Roth Contributory IRA …734" and the earlier account rows), which is
entirely SKIP material. No ADOPT-class category is known to be missing from this
transcription.
