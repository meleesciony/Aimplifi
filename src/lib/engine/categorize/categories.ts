/**
 * System category set (Phase 2; expanded to Mint/Simplifi breadth in DECISIONS #63).
 * IDs are stable slugs so pure-engine output can be persisted without a lookup
 * table; names are display strings. The original 21 IDs are preserved EXACTLY so
 * the demo's pinned categorization (and every golden value) is unchanged — the new
 * categories are purely additive.
 *
 * `discretionary` feeds lifestyle-creep detection (Phase 3): true = "wants"
 * (dining, travel, shopping…), false = "needs"/income/transfers.
 */
export interface SystemCategory {
  id: string;
  name: string;
  /** Coarse group for picker organization (display only). */
  group: string;
  discretionary: boolean;
}

export const CATEGORIES: SystemCategory[] = [
  // ── Income ──────────────────────────────────────────────────────────
  { id: 'income', name: 'Income', group: 'Income', discretionary: false },
  { id: 'paycheck', name: 'Paycheck', group: 'Income', discretionary: false },
  { id: 'bonus', name: 'Bonus', group: 'Income', discretionary: false },
  { id: 'interest-income', name: 'Interest Income', group: 'Income', discretionary: false },
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
  { id: 'clothing', name: 'Clothing', group: 'Shopping', discretionary: true },
  { id: 'electronics', name: 'Electronics', group: 'Shopping', discretionary: true },
  { id: 'hobbies', name: 'Hobbies & Sporting Goods', group: 'Shopping', discretionary: true },
  { id: 'books', name: 'Books & Supplies', group: 'Shopping', discretionary: true },
  { id: 'furnishings', name: 'Home Furnishings', group: 'Shopping', discretionary: true },

  // ── Home ────────────────────────────────────────────────────────────
  { id: 'rent', name: 'Rent & Mortgage', group: 'Home', discretionary: false },
  { id: 'household', name: 'Household & Home', group: 'Home', discretionary: false },
  { id: 'home-improvement', name: 'Home Improvement', group: 'Home', discretionary: true },
  { id: 'home-services', name: 'Home Services', group: 'Home', discretionary: false },
  { id: 'lawn-garden', name: 'Lawn & Garden', group: 'Home', discretionary: true },

  // ── Bills & Utilities ───────────────────────────────────────────────
  { id: 'utilities', name: 'Internet & Utilities', group: 'Bills & Utilities', discretionary: false },
  { id: 'phone', name: 'Mobile Phone', group: 'Bills & Utilities', discretionary: false },
  { id: 'internet', name: 'Internet & Cable', group: 'Bills & Utilities', discretionary: false },
  { id: 'insurance', name: 'Insurance', group: 'Bills & Utilities', discretionary: false },

  // ── Auto & Transport ────────────────────────────────────────────────
  { id: 'fuel', name: 'Fuel', group: 'Auto & Transport', discretionary: false },
  { id: 'transport', name: 'Transport & Rideshare', group: 'Auto & Transport', discretionary: true },
  { id: 'public-transit', name: 'Public Transit', group: 'Auto & Transport', discretionary: false },
  { id: 'parking', name: 'Parking & Tolls', group: 'Auto & Transport', discretionary: false },
  { id: 'auto-maintenance', name: 'Auto Maintenance', group: 'Auto & Transport', discretionary: false },
  { id: 'auto-loan', name: 'Auto & Loans', group: 'Auto & Transport', discretionary: false },

  // ── Travel ──────────────────────────────────────────────────────────
  { id: 'travel', name: 'Travel', group: 'Travel', discretionary: true },
  { id: 'air-travel', name: 'Air Travel', group: 'Travel', discretionary: true },
  { id: 'hotel', name: 'Hotel & Lodging', group: 'Travel', discretionary: true },
  { id: 'rental-car', name: 'Rental Car', group: 'Travel', discretionary: true },

  // ── Health & Fitness ────────────────────────────────────────────────
  { id: 'health', name: 'Health & Pharmacy', group: 'Health & Fitness', discretionary: false },
  { id: 'pharmacy', name: 'Pharmacy', group: 'Health & Fitness', discretionary: false },
  { id: 'dental', name: 'Dental', group: 'Health & Fitness', discretionary: false },
  { id: 'vision', name: 'Vision', group: 'Health & Fitness', discretionary: false },
  { id: 'fitness', name: 'Fitness', group: 'Health & Fitness', discretionary: false },

  // ── Personal & Family ───────────────────────────────────────────────
  { id: 'personal-care', name: 'Personal Care', group: 'Personal & Family', discretionary: true },
  { id: 'pets', name: 'Pets', group: 'Personal & Family', discretionary: false },
  { id: 'kids', name: 'Kids', group: 'Personal & Family', discretionary: false },
  { id: 'childcare', name: 'Childcare', group: 'Personal & Family', discretionary: false },
  { id: 'education', name: 'Education', group: 'Personal & Family', discretionary: false },

  // ── Entertainment ───────────────────────────────────────────────────
  { id: 'entertainment', name: 'Entertainment & Streaming', group: 'Entertainment', discretionary: true },
  { id: 'software', name: 'Software & Cloud', group: 'Entertainment', discretionary: false },

  // ── Financial & Fees ────────────────────────────────────────────────
  { id: 'fees', name: 'Fees & Charges', group: 'Financial', discretionary: false },
  { id: 'taxes', name: 'Taxes', group: 'Financial', discretionary: false },
  { id: 'financial', name: 'Financial & Professional', group: 'Financial', discretionary: false },
  { id: 'business', name: 'Business Services', group: 'Financial', discretionary: false },

  // ── Giving ──────────────────────────────────────────────────────────
  { id: 'gifts', name: 'Gifts', group: 'Giving', discretionary: true },
  { id: 'charity', name: 'Charity & Donations', group: 'Giving', discretionary: false },

  // ── Transfers & Other ───────────────────────────────────────────────
  { id: 'transfer', name: 'Transfer', group: 'Transfers & Other', discretionary: false },
  { id: 'cash', name: 'Cash & ATM', group: 'Transfers & Other', discretionary: false },
  { id: 'fees-interest', name: 'Interest & Finance Charges', group: 'Financial', discretionary: false },
  { id: 'uncategorized', name: 'Uncategorized', group: 'Transfers & Other', discretionary: false },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryName(id: string | null | undefined): string {
  return (id && CATEGORY_BY_ID.get(id)?.name) || 'Uncategorized';
}
