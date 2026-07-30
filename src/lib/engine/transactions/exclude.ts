/**
 * Exclude-from-totals — the single basis (O.15 slice 2).
 *
 * `excludeFromTotals` is the reader saying "this row is not my spending":
 * a work-reimbursed purchase, a shared expense they'll be paid back for, a
 * one-off that would distort every average. An excluded row must vanish from
 * every money TOTAL the same way — through the predicates that already drop
 * transfers and split parents — while staying fully visible (badged) in the
 * register. One predicate here; every summer imports it. Grep for
 * `isExcludedFromTotals` to enumerate the basis.
 *
 * WHERE IT APPLIES (the totals): reports (`isSpendRow`), budgets (same
 * predicate), trends (both its register-alias and its narrower purchase
 * predicate), coach flows (`countsInFlows` → monthlyFlows/savings rate/
 * signature/Money Review), spending plan (via monthlyFlows + reports),
 * Ask (spend/income/merchant answers + the Glass-Box trace, via the same
 * exported predicates), the Merchant Lens, the anomaly detector, radar's
 * discretionary burn, the household shared-movement digest, and the
 * register's own income/outflow summary counts.
 *
 * WHERE IT DELIBERATELY DOES NOT APPLY (each is a reality the reader cannot
 * re-classify away, not a report about their behavior):
 *  - Account balances and net worth: the bank already counted the row; a
 *    balance that disagrees with the bank is a lie, not a preference.
 *  - Cash-needed / statement math: the card bill includes the row whether or
 *    not the reader wants it in their budgets; "how much do I need" answers
 *    the biller, not the budget.
 *  - Recurring detection: a bill marked excluded is still a bill that will
 *    recur; hiding it from detection would hide the reminder too.
 *  - Tax export: `taxClass` is its own explicit instruction. A row the reader
 *    both tax-tagged AND excluded was given two orders; dropping the deduction
 *    silently is the O.13b split/tax failure again, so the tag wins there.
 *
 * The field is OPTIONAL on engine row types: a call site that never selects
 * the column keeps its exact pre-O.15 behavior (nothing excluded).
 */

/** The minimum a row must expose for the exclusion basis to read it. */
export interface ExcludableTxn {
  excludeFromTotals?: boolean | null;
}

/** True only on an explicit exclusion — absent/null/false all mean "counts". */
export function isExcludedFromTotals(t: ExcludableTxn): boolean {
  return t.excludeFromTotals === true;
}
