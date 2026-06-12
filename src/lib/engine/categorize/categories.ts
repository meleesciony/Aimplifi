/**
 * System category set (Phase 2). IDs are stable slugs so pure-engine output
 * can be persisted without a lookup table; names are display strings.
 */
export interface SystemCategory {
  id: string;
  name: string;
  /** Discretionary categories feed lifestyle-creep detection (Phase 3). */
  discretionary: boolean;
}

export const CATEGORIES: SystemCategory[] = [
  { id: 'dining', name: 'Dining Out', discretionary: true },
  { id: 'groceries', name: 'Groceries', discretionary: false },
  { id: 'fuel', name: 'Fuel', discretionary: false },
  { id: 'transport', name: 'Transport & Rideshare', discretionary: true },
  { id: 'travel', name: 'Travel', discretionary: true },
  { id: 'shopping', name: 'Shopping', discretionary: true },
  { id: 'household', name: 'Household & Home', discretionary: false },
  { id: 'electronics', name: 'Electronics', discretionary: true },
  { id: 'entertainment', name: 'Entertainment & Streaming', discretionary: true },
  { id: 'software', name: 'Software & Cloud', discretionary: false },
  { id: 'fitness', name: 'Fitness', discretionary: false },
  { id: 'health', name: 'Health & Pharmacy', discretionary: false },
  { id: 'insurance', name: 'Insurance', discretionary: false },
  { id: 'utilities', name: 'Internet & Utilities', discretionary: false },
  { id: 'rent', name: 'Rent & Mortgage', discretionary: false },
  { id: 'auto-loan', name: 'Auto & Loans', discretionary: false },
  { id: 'income', name: 'Income', discretionary: false },
  { id: 'transfer', name: 'Transfer', discretionary: false },
  { id: 'cash', name: 'Cash & ATM', discretionary: false },
  { id: 'fees', name: 'Fees & Charges', discretionary: false },
  { id: 'uncategorized', name: 'Uncategorized', discretionary: false },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryName(id: string | null | undefined): string {
  return (id && CATEGORY_BY_ID.get(id)?.name) || 'Uncategorized';
}
