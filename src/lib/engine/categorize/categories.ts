/**
 * System category set (Phase 2; Mint/Simplifi two-level taxonomy in DECISIONS #63/#65).
 * IDs are stable slugs; `group` is the PARENT category, the entry itself a
 * subcategory (the picker renders parent headers with their subcategories under
 * them). Every original ID + name is preserved EXACTLY so the demo's pinned
 * categorization and all golden values are unchanged — new subcategories are
 * purely additive.
 *
 * O.17: 22 leaves added after auditing a real Simplifi export the owner uses
 * daily (docs/scratch/simplifi-category-import.md holds the triaged source).
 * Only gaps nothing already covered were taken — "Digital Services", "Gym",
 * "Restaurants", "Rideshare", "Tolls" and the rest were REFUSED as duplicates of
 * `subscriptions`/`fitness`/`dining`/`transport`/`parking`. Third-level rows in
 * that export (Mortgage → Interest/Principal, Loan Payment → Interest/Principal,
 * Registration → Vehicle Property Tax) are not representable here: the taxonomy
 * is two-level by DECISIONS #63/#65 and `parentId` is still unpopulated.
 *
 * `discretionary` feeds lifestyle-creep detection: true = "wants", false =
 * "needs"/income/transfers.
 */
export interface SystemCategory {
  id: string;
  name: string;
  /** Parent category (the subcategory grouping shown in the picker). */
  group: string;
  discretionary: boolean;
}

export const CATEGORIES: SystemCategory[] = [
  // ── Income ──────────────────────────────────────────────────────────
  { id: 'income', name: 'Income', group: 'Income', discretionary: false },
  { id: 'paycheck', name: 'Paycheck', group: 'Income', discretionary: false },
  { id: 'bonus', name: 'Bonus', group: 'Income', discretionary: false },
  { id: 'side-income', name: 'Side Gig / Freelance', group: 'Income', discretionary: false },
  { id: 'interest-income', name: 'Interest Income', group: 'Income', discretionary: false },
  { id: 'investment-income', name: 'Investment Income', group: 'Income', discretionary: false },
  { id: 'rental-income', name: 'Rental Income', group: 'Income', discretionary: false },
  { id: 'govt-benefits', name: 'Government Benefits', group: 'Income', discretionary: false },
  { id: 'tax-refund', name: 'Tax Refund', group: 'Income', discretionary: false },
  { id: 'reimbursement', name: 'Reimbursement', group: 'Income', discretionary: false },
  { id: 'refund', name: 'Refund', group: 'Income', discretionary: false },
  // Both names state the DIRECTION on purpose. A category in the Income group is
  // read as income by all 14 predicates (see NON_CUSTOM_GROUPS in assign.ts), so
  // an outflow filed here would erase spending from reports while monthlyFlows
  // still counted it — the L.13 sign class. "Alimony" alone is ambiguous;
  // "Alimony Received" cannot be mis-picked for a payment. Paying alimony or
  // support is `child-support` under Personal & Family.
  { id: 'alimony', name: 'Alimony Received', group: 'Income', discretionary: false },
  { id: 'retirement-income', name: 'Retirement Income', group: 'Income', discretionary: false },

  // ── Food & Dining ───────────────────────────────────────────────────
  { id: 'dining', name: 'Dining Out', group: 'Food & Dining', discretionary: true },
  { id: 'fast-food', name: 'Fast Food', group: 'Food & Dining', discretionary: true },
  { id: 'coffee', name: 'Coffee Shops', group: 'Food & Dining', discretionary: true },
  { id: 'alcohol', name: 'Alcohol & Bars', group: 'Food & Dining', discretionary: true },
  { id: 'food-delivery', name: 'Food Delivery', group: 'Food & Dining', discretionary: true },
  { id: 'groceries', name: 'Groceries', group: 'Food & Dining', discretionary: false },

  // ── Shopping ────────────────────────────────────────────────────────
  { id: 'shopping', name: 'Shopping', group: 'Shopping', discretionary: true },
  { id: 'general-merchandise', name: 'General Merchandise', group: 'Shopping', discretionary: true },
  { id: 'clothing', name: 'Clothing', group: 'Shopping', discretionary: true },
  { id: 'electronics', name: 'Electronics', group: 'Shopping', discretionary: true },
  { id: 'hobbies', name: 'Hobbies & Sporting Goods', group: 'Shopping', discretionary: true },
  { id: 'books', name: 'Books & Supplies', group: 'Shopping', discretionary: true },
  { id: 'office-supplies', name: 'Office Supplies', group: 'Shopping', discretionary: false },
  { id: 'furnishings', name: 'Home Furnishings', group: 'Shopping', discretionary: true },

  // ── Home ────────────────────────────────────────────────────────────
  { id: 'rent', name: 'Rent & Mortgage', group: 'Home', discretionary: false },
  { id: 'household', name: 'Household & Home', group: 'Home', discretionary: false },
  { id: 'home-improvement', name: 'Home Improvement', group: 'Home', discretionary: true },
  { id: 'home-services', name: 'Home Services', group: 'Home', discretionary: false },
  { id: 'lawn-garden', name: 'Lawn & Garden', group: 'Home', discretionary: true },
  { id: 'property-tax', name: 'Property Tax', group: 'Home', discretionary: false },
  { id: 'hoa', name: 'HOA Dues', group: 'Home', discretionary: false },
  { id: 'storage', name: 'Storage', group: 'Home', discretionary: false },

  // ── Bills & Utilities ───────────────────────────────────────────────
  // `utilities` is the CATCH-ALL for combined/municipal bills; the four leaves
  // below split out the household utilities everyone recognises (added #154).
  // Purely additive — no existing id/name changed, so every golden holds.
  { id: 'utilities', name: 'Internet & Utilities', group: 'Bills & Utilities', discretionary: false },
  { id: 'electricity', name: 'Electricity', group: 'Bills & Utilities', discretionary: false },
  { id: 'natural-gas', name: 'Natural Gas', group: 'Bills & Utilities', discretionary: false },
  { id: 'water', name: 'Water & Sewer', group: 'Bills & Utilities', discretionary: false },
  { id: 'trash', name: 'Trash & Recycling', group: 'Bills & Utilities', discretionary: false },
  { id: 'phone', name: 'Mobile Phone', group: 'Bills & Utilities', discretionary: false },
  { id: 'internet', name: 'Internet & Cable', group: 'Bills & Utilities', discretionary: false },
  { id: 'subscriptions', name: 'Subscriptions', group: 'Bills & Utilities', discretionary: true },
  { id: 'insurance', name: 'Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'auto-insurance', name: 'Auto Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'home-insurance', name: 'Home & Renters Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'health-insurance', name: 'Health Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'dental-insurance', name: 'Dental Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'vision-insurance', name: 'Vision Insurance', group: 'Bills & Utilities', discretionary: false },
  { id: 'life-insurance', name: 'Life Insurance', group: 'Bills & Utilities', discretionary: false },

  // ── Auto & Transport ────────────────────────────────────────────────
  { id: 'fuel', name: 'Fuel', group: 'Auto & Transport', discretionary: false },
  { id: 'transport', name: 'Transport & Rideshare', group: 'Auto & Transport', discretionary: true },
  { id: 'public-transit', name: 'Public Transit', group: 'Auto & Transport', discretionary: false },
  { id: 'parking', name: 'Parking & Tolls', group: 'Auto & Transport', discretionary: false },
  { id: 'auto-maintenance', name: 'Auto Maintenance', group: 'Auto & Transport', discretionary: false },
  { id: 'car-wash', name: 'Car Wash', group: 'Auto & Transport', discretionary: true },
  { id: 'auto-registration', name: 'Registration & Fees', group: 'Auto & Transport', discretionary: false },
  { id: 'auto-loan', name: 'Auto & Loans', group: 'Auto & Transport', discretionary: false },

  // ── Travel ──────────────────────────────────────────────────────────
  { id: 'travel', name: 'Travel', group: 'Travel', discretionary: true },
  { id: 'air-travel', name: 'Air Travel', group: 'Travel', discretionary: true },
  { id: 'hotel', name: 'Hotel & Lodging', group: 'Travel', discretionary: true },
  { id: 'rental-car', name: 'Rental Car', group: 'Travel', discretionary: true },
  { id: 'vacation', name: 'Vacation', group: 'Travel', discretionary: true },

  // ── Health & Fitness ────────────────────────────────────────────────
  { id: 'health', name: 'Health & Pharmacy', group: 'Health & Fitness', discretionary: false },
  { id: 'doctor', name: 'Doctor', group: 'Health & Fitness', discretionary: false },
  { id: 'pharmacy', name: 'Pharmacy', group: 'Health & Fitness', discretionary: false },
  { id: 'dental', name: 'Dental', group: 'Health & Fitness', discretionary: false },
  { id: 'vision', name: 'Vision', group: 'Health & Fitness', discretionary: false },
  { id: 'mental-health', name: 'Mental Health', group: 'Health & Fitness', discretionary: false },
  { id: 'medical-supplies', name: 'Medical Supplies', group: 'Health & Fitness', discretionary: false },
  // Discretionary (owner 2026-08-01): golf, gym, extracurricular sport — guilt-free
  // spend, not a fixed cost. Kids Activities is already discretionary; this matches.
  { id: 'fitness', name: 'Fitness', group: 'Health & Fitness', discretionary: true },

  // ── Personal & Family ───────────────────────────────────────────────
  { id: 'personal-care', name: 'Personal Care', group: 'Personal & Family', discretionary: true },
  { id: 'hair-beauty', name: 'Hair & Beauty', group: 'Personal & Family', discretionary: true },
  { id: 'spa', name: 'Spa & Massage', group: 'Personal & Family', discretionary: true },
  { id: 'laundry', name: 'Laundry & Dry Cleaning', group: 'Personal & Family', discretionary: false },
  { id: 'pets', name: 'Pets', group: 'Personal & Family', discretionary: false },
  { id: 'pet-food', name: 'Pet Food & Supplies', group: 'Personal & Family', discretionary: false },
  { id: 'veterinary', name: 'Veterinary', group: 'Personal & Family', discretionary: false },
  { id: 'kids', name: 'Kids', group: 'Personal & Family', discretionary: false },
  { id: 'kids-activities', name: 'Kids Activities', group: 'Personal & Family', discretionary: true },
  { id: 'toys', name: 'Toys', group: 'Personal & Family', discretionary: true },
  { id: 'baby-supplies', name: 'Baby Supplies', group: 'Personal & Family', discretionary: false },
  { id: 'allowance', name: 'Allowance', group: 'Personal & Family', discretionary: false },
  { id: 'child-support', name: 'Child Support', group: 'Personal & Family', discretionary: false },
  { id: 'childcare', name: 'Childcare', group: 'Personal & Family', discretionary: false },
  { id: 'education', name: 'Education', group: 'Personal & Family', discretionary: false },
  { id: 'tuition', name: 'Tuition', group: 'Personal & Family', discretionary: false },
  { id: 'student-loan', name: 'Student Loan', group: 'Personal & Family', discretionary: false },

  // ── Entertainment ───────────────────────────────────────────────────
  { id: 'entertainment', name: 'Entertainment & Streaming', group: 'Entertainment', discretionary: true },
  { id: 'games', name: 'Games', group: 'Entertainment', discretionary: true },
  { id: 'music', name: 'Music', group: 'Entertainment', discretionary: true },
  { id: 'events', name: 'Events & Concerts', group: 'Entertainment', discretionary: true },
  { id: 'software', name: 'Software & Cloud', group: 'Entertainment', discretionary: false },

  // ── Financial & Fees ────────────────────────────────────────────────
  { id: 'fees', name: 'Fees & Charges', group: 'Financial', discretionary: false },
  { id: 'fees-interest', name: 'Interest & Finance Charges', group: 'Financial', discretionary: false },
  { id: 'atm-fee', name: 'ATM Fee', group: 'Financial', discretionary: false },
  { id: 'late-fee', name: 'Late Fee', group: 'Financial', discretionary: false },
  { id: 'taxes', name: 'Taxes', group: 'Financial', discretionary: false },
  { id: 'estimated-tax', name: 'Estimated Tax Payment', group: 'Financial', discretionary: false },
  { id: 'financial', name: 'Financial & Professional', group: 'Financial', discretionary: false },
  { id: 'legal', name: 'Legal', group: 'Financial', discretionary: false },
  { id: 'investment', name: 'Investment & Savings', group: 'Financial', discretionary: false },
  { id: 'loan-payment', name: 'Loan Payment', group: 'Financial', discretionary: false },

  // ── Business ────────────────────────────────────────────────────────
  { id: 'business', name: 'Business Services', group: 'Business', discretionary: false },
  { id: 'advertising', name: 'Advertising & Marketing', group: 'Business', discretionary: false },
  { id: 'shipping', name: 'Shipping & Postage', group: 'Business', discretionary: false },
  { id: 'work-expenses', name: 'Work Expenses', group: 'Business', discretionary: false },

  // ── Giving ──────────────────────────────────────────────────────────
  { id: 'gifts', name: 'Gifts', group: 'Giving', discretionary: true },
  { id: 'charity', name: 'Charity & Donations', group: 'Giving', discretionary: false },

  // ── Transfers & Other ───────────────────────────────────────────────
  { id: 'transfer', name: 'Transfer', group: 'Transfers & Other', discretionary: false },
  { id: 'credit-card-payment', name: 'Credit Card Payment', group: 'Transfers & Other', discretionary: false },
  { id: 'cash', name: 'Cash & ATM', group: 'Transfers & Other', discretionary: false },
  { id: 'uncategorized', name: 'Uncategorized', group: 'Transfers & Other', discretionary: false },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * Longest category name a reader may type — for a custom category and for a
 * rename of a built-in one alike. It lives here, in a plain leaf module, because
 * both writers are `'use server'` files, which may export only async functions
 * (L.7). One constant so the two paths cannot drift into accepting different
 * lengths for what the picker renders in the same column.
 */
export const MAX_CATEGORY_NAME = 40;

/**
 * Normalize a category name the reader typed, for BOTH a custom category and a
 * rename of a built-in one. Pure, so the two writers share one definition rather
 * than each trimming in its own way.
 *
 * What it removes, and why each one matters — every item here defeats the
 * duplicate-name check that runs immediately after it, which is the whole point
 * of that check (two picker rows the reader cannot tell apart):
 *   - NFC first, so "Café" composed two ways is ONE name. `resolveSpendTarget`
 *     already normalizes this way for the same reason.
 *   - ASCII control characters and DEL. A literal NUL also makes Postgres reject
 *     the write outright while SQLite (dev/test) accepts it, so without this the
 *     failure appears only in production.
 *   - Zero-width and bidi formatting characters (U+200B–U+200F, U+202A–U+202E,
 *     U+2060–U+2064, U+FEFF). These are invisible: "Dining Out" plus a zero-width
 *     space is pixel-identical to "Dining Out" and byte-different, and U+202E
 *     visually reverses the text around it in the register and the exported CSV.
 *   - Whitespace collapsed and trimmed, so " Dr  Visits " === "Dr Visits".
 */
export function normalizeCategoryName(raw: string): string {
  let out = '';
  for (const ch of (raw ?? '').normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (code >= 0x200b && code <= 0x200f) continue;
    if (code >= 0x202a && code <= 0x202e) continue;
    if (code >= 0x2060 && code <= 0x2064) continue;
    if (code === 0xfeff) continue;
    out += ch;
  }
  return out.trim().replace(/\s+/g, ' ');
}

/**
 * Length in CODE POINTS, not UTF-16 units — otherwise the same 40-character
 * limit admits 40 CJK characters and refuses 40 emoji. `dials.ts` counts the
 * same way for the same limit.
 */
export function categoryNameLength(name: string): number {
  return [...name].length;
}

/**
 * True when a SYSTEM category id belongs to the Income group ('income' plus the
 * #163 leaves: paycheck, bonus, side-income, interest-income, investment-income,
 * rental-income, govt-benefits, tax-refund, reimbursement, refund). Custom
 * category ids return false — custom categories are spending by definition
 * (DECISIONS #111). This is THE income test for flow classification: id-literal
 * checks (`=== 'income'`) predate the #163 leaf taxonomy and silently
 * misclassify a real user's 'paycheck' payroll — see REGRESSION_LEDGER
 * 2026-07-05 (monthlyFlows) before adding a new id-literal income check.
 *
 * CORRECTION TO "THIS IS THE income test" (measured 2026-07-30, DECISIONS #345).
 * It is one of fourteen. This function has exactly TWO call sites
 * (`budgets/status.ts`, `fi/insights.ts`); the other twelve answers to "is this
 * category income?" are inline `group === 'Income'` comparisons spread across
 * pipeline / propose / learn / backfill / reports / trends / answer /
 * keyword-rules / categorize-assist / plaid-map. They agree today only because a
 * custom category can never be filed under the Income group — see the
 * load-bearing note on `NON_CUSTOM_GROUPS` in `categorize/assign.ts`, which is
 * what actually holds this together. Consolidating the fourteen onto one
 * custom-aware basis is the prerequisite for an explicit Expense/Income type on
 * custom categories (TASKS O.13e), NOT a cleanup that can be done casually:
 * two of the fourteen already read a different (per-user) map than the rest.
 */
export function isIncomeCategoryId(id: string): boolean {
  return CATEGORY_BY_ID.get(id)?.group === 'Income';
}

/**
 * The minimal metadata every category-resolution site needs (name/group for
 * display + grouping, discretionary for lifestyle-creep). A structural SUBSET of
 * SystemCategory, so `CATEGORY_BY_ID` (Map<string, SystemCategory>) is itself a
 * valid `ReadonlyMap<string, CategoryMeta>` — every engine can default its
 * optional `meta` param to it (DECISIONS #111).
 */
export interface CategoryMeta {
  name: string;
  group: string;
  discretionary: boolean;
}

/** A user-created custom category as stored: id + the three meta fields. */
export interface CustomCategoryInput {
  id: string;
  name: string;
  group: string;
  discretionary: boolean;
}

/**
 * The no-renames case, shared so every default argument is the same reference
 * and `renames.size === 0` is the cheap "nothing to overlay" test.
 */
export const NO_RENAMES: ReadonlyMap<string, string> = new Map();

/**
 * Per-user resolver (PURE): the static system meta OVERLAID with a user's custom
 * categories and their per-user SYSTEM renames. With an EMPTY custom list and no
 * renames the result is value-identical to CATEGORY_BY_ID, so every engine that
 * defaults to the static map produces byte-identical output for a user with
 * neither — the golden tests stay green without being touched. Custom ids are
 * cuids and never collide with the system slug ids, so the custom overlay only
 * ADDS entries.
 *
 * `renames` is applied ONLY to system ids (inside the CATEGORIES loop) and the
 * custom overlay runs after it, so a stale rename row can never rewrite a custom
 * category's name — a custom is renamed through `renameCustomCategory`, which
 * edits its own row. Only `name` is overridable: `group` decides income vs
 * spending in 14 predicates and `discretionary` feeds lifestyle-creep, so
 * neither is a label the reader may edit.
 */
export function mergeCategoryMeta(
  custom: readonly CustomCategoryInput[],
  renames: ReadonlyMap<string, string> = NO_RENAMES,
): Map<string, CategoryMeta> {
  const m = new Map<string, CategoryMeta>();
  for (const c of CATEGORIES) {
    m.set(c.id, { name: renames.get(c.id) ?? c.name, group: c.group, discretionary: c.discretionary });
  }
  for (const c of custom) {
    m.set(c.id, { name: c.name, group: c.group, discretionary: c.discretionary });
  }
  return m;
}

/**
 * The vocabulary a reader can speak to Ask: their custom categories plus any
 * built-in they renamed, as a flat id+name list.
 *
 * Both belong in one list because both are "words this reader uses that the
 * static taxonomy does not know". `resolveSpendTarget` tells them apart by
 * asking whether the id is in the taxonomy, and ranks them differently — see the
 * comment there — so this stays a plain concatenation with no priority baked in.
 */
export function askVocabulary(
  custom: readonly { id: string; name: string }[],
  renames: ReadonlyMap<string, string>,
): { id: string; name: string }[] {
  return [
    ...custom.map((c) => ({ id: c.id, name: c.name })),
    ...[...renames].map(([id, name]) => ({ id, name })),
  ];
}

/**
 * Resolve a category id to its display name. The optional `meta` map makes this
 * custom-category aware; it defaults to the static system map so every existing
 * caller (no second arg) is unchanged.
 */
export function categoryName(
  id: string | null | undefined,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): string {
  return (id && meta.get(id)?.name) || 'Uncategorized';
}
