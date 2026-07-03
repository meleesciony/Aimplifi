/**
 * System category set (Phase 2; Mint/Simplifi two-level taxonomy in DECISIONS #63/#65).
 * IDs are stable slugs; `group` is the PARENT category, the entry itself a
 * subcategory (the picker renders parent headers with their subcategories under
 * them). Every original ID + name is preserved EXACTLY so the demo's pinned
 * categorization and all golden values are unchanged — new subcategories are
 * purely additive.
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
  { id: 'pharmacy', name: 'Pharmacy', group: 'Health & Fitness', discretionary: false },
  { id: 'dental', name: 'Dental', group: 'Health & Fitness', discretionary: false },
  { id: 'vision', name: 'Vision', group: 'Health & Fitness', discretionary: false },
  { id: 'mental-health', name: 'Mental Health', group: 'Health & Fitness', discretionary: false },
  { id: 'medical-supplies', name: 'Medical Supplies', group: 'Health & Fitness', discretionary: false },
  { id: 'fitness', name: 'Fitness', group: 'Health & Fitness', discretionary: false },

  // ── Personal & Family ───────────────────────────────────────────────
  { id: 'personal-care', name: 'Personal Care', group: 'Personal & Family', discretionary: true },
  { id: 'pets', name: 'Pets', group: 'Personal & Family', discretionary: false },
  { id: 'kids', name: 'Kids', group: 'Personal & Family', discretionary: false },
  { id: 'childcare', name: 'Childcare', group: 'Personal & Family', discretionary: false },
  { id: 'education', name: 'Education', group: 'Personal & Family', discretionary: false },

  // ── Entertainment ───────────────────────────────────────────────────
  { id: 'entertainment', name: 'Entertainment & Streaming', group: 'Entertainment', discretionary: true },
  { id: 'games', name: 'Games', group: 'Entertainment', discretionary: true },
  { id: 'music', name: 'Music', group: 'Entertainment', discretionary: true },
  { id: 'events', name: 'Events & Concerts', group: 'Entertainment', discretionary: true },
  { id: 'software', name: 'Software & Cloud', group: 'Entertainment', discretionary: false },

  // ── Financial & Fees ────────────────────────────────────────────────
  { id: 'fees', name: 'Fees & Charges', group: 'Financial', discretionary: false },
  { id: 'fees-interest', name: 'Interest & Finance Charges', group: 'Financial', discretionary: false },
  { id: 'taxes', name: 'Taxes', group: 'Financial', discretionary: false },
  { id: 'financial', name: 'Financial & Professional', group: 'Financial', discretionary: false },
  { id: 'legal', name: 'Legal', group: 'Financial', discretionary: false },
  { id: 'investment', name: 'Investment & Savings', group: 'Financial', discretionary: false },
  { id: 'loan-payment', name: 'Loan Payment', group: 'Financial', discretionary: false },

  // ── Business ────────────────────────────────────────────────────────
  { id: 'business', name: 'Business Services', group: 'Business', discretionary: false },
  { id: 'advertising', name: 'Advertising & Marketing', group: 'Business', discretionary: false },

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
 * Per-user resolver (PURE): the static system meta OVERLAID with a user's custom
 * categories. With an EMPTY custom list the result is value-identical to
 * CATEGORY_BY_ID, so every engine that defaults to the static map produces
 * byte-identical output for a user with no custom categories — the golden tests
 * stay green without being touched. Custom ids are cuids and never collide with
 * the system slug ids, so the overlay only ADDS entries.
 */
export function mergeCategoryMeta(
  custom: readonly CustomCategoryInput[],
): Map<string, CategoryMeta> {
  const m = new Map<string, CategoryMeta>();
  for (const c of CATEGORIES) {
    m.set(c.id, { name: c.name, group: c.group, discretionary: c.discretionary });
  }
  for (const c of custom) {
    m.set(c.id, { name: c.name, group: c.group, discretionary: c.discretionary });
  }
  return m;
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
