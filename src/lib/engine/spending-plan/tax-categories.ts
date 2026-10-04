/**
 * The categories whose charges the guilt-free plan never counts as a cost
 * (owner 2026-10-03, DECISIONS #783): "Certain things like tax payments
 * shouldn't be considered in budget."
 *
 * ONE set, read by every Fixed basis (the classifier via
 * `FIXED_PATTERN_EXCLUDE_CATEGORY_IDS`, the union and the detected-series
 * fallback via `PLAN_FIXED_NEVER_CATEGORY_IDS`), by the loader's filed-category
 * remap, by the row reason and by the disclosure count — so a taxonomy leaf can
 * never be inside the rule on one surface and outside it on another. The first
 * cut named only `taxes`; the critic re-filed the slice's own IRS row to
 * `estimated-tax`, a pickable leaf in the same group, and the plan priced it
 * whole as a one-month typical (critic cycle 1, P1-1).
 *
 * `property-tax` is deliberately OUTSIDE: it is a cost of owning the home the
 * reader lives in — the same class as rent or an HOA fee, usually paid inside
 * the mortgage's escrow, and recurring for as long as they own it. An income
 * tax paid directly is a true-up on income, not a living cost. Every sentence
 * that states the rule says which leaves it covers and that Property Tax still
 * counts.
 *
 * Kept free of imports so `plan.ts` and `spend-class.ts` can both read it
 * without a module cycle.
 */
export const PLAN_TAX_CATEGORY_IDS: ReadonlySet<string> = new Set(['taxes', 'estimated-tax']);

/**
 * The reader's OWN names for the categories the rule's sentences point at — a
 * system category can be renamed per user (`CategoryRename`), and a sentence
 * that sends the reader to "Property Tax" when their picker says "Home taxes"
 * points at nothing (critic cycle 2, P2-3; `one-loader-is-not-one-reader`).
 * Resolved by the loader through the same meta every other label reads.
 */
export interface TaxCategoryNames {
  taxes: string;
  estimatedTax: string;
  propertyTax: string;
  /** Where a tax-prep fee belongs (`financial`). */
  financial: string;
}

/** The charges filed in `PLAN_TAX_CATEGORY_IDS` that the plan left out — what the
 *  page, Ask, /budgets and the glass box say so the money never silently vanishes. */
export interface TaxChargesLeftOut {
  /** Outflow rows in the lookback. */
  count: number;
  /** Their total, as a positive number of cents. */
  totalCents: number;
  /** The lookback, in complete months before today's month. */
  months: number;
  /**
   * The monthly TARGET the reader set on a tax leaf that IS in the Fixed figure
   * (0 when none, or when a Fixed override replaced the basis that holds it).
   * A sentence telling a reader with a target to also set money aside instructs
   * a double count (critic cycle 2, P2-1), so the copy branches on it.
   */
  targetCents: number;
  /** The reader's names; absent = the built-in names (fixtures, un-renamed readers). */
  names?: TaxCategoryNames;
}
