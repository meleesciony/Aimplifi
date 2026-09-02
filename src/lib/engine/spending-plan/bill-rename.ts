/**
 * Household name for a repeating bill on the spending plan.
 *
 * Detection identity (merchantCanonical, used for rollup exclusion and the
 * convert lever) is NOT this name. A typed name is a label overlay: dollars
 * and cadence stay put. Unnamed bills — no payee from detection — key on
 * category + cadence so the overlay can still land.
 */
/** A line whose payee the detector never named. Not rendered as a category
 *  name: "Housing" beside one bill's rate reads as the whole budget. */
export const UNNAMED_BILL_LABEL = 'A recurring bill we detected';

export const MAX_BILL_NAME = 60;
export const MAX_BILL_KEY = 200;

export interface BillRenameRef {
  merchantCanonical?: string | null;
  categoryId?: string | null;
  cadence?: string | null;
}

export function billRenameKey(row: BillRenameRef): string {
  const canonical = (row.merchantCanonical ?? '').trim();
  if (canonical) return canonical.slice(0, MAX_BILL_KEY);
  const category = (row.categoryId ?? '').trim();
  const cadence = (row.cadence ?? '').trim();
  return `unnamed:${category}:${cadence}`.slice(0, MAX_BILL_KEY);
}

export function billNameError(raw: string): string | undefined {
  const name = raw.trim();
  if (!name) return 'Give the bill a name — "Internet", "HOA dues".';
  if (name.length > MAX_BILL_NAME) {
    return `Keep the name under ${MAX_BILL_NAME} characters.`;
  }
  return undefined;
}

/**
 * What the Fixed list prints for a bill. Overlay wins; otherwise the
 * detector's payee; otherwise the unnamed fallback (never the category
 * name — that would read as the whole budget).
 */
export function namedBillLabel(
  row: BillRenameRef,
  names: ReadonlyMap<string, string>,
  nameOfCategory: (id: string) => string,
): string {
  const overlay = names.get(billRenameKey(row))?.trim();
  if (overlay) return overlay;
  const canonical = (row.merchantCanonical ?? '').trim();
  if (canonical) return canonical;
  if (row.categoryId) return `${UNNAMED_BILL_LABEL} (${nameOfCategory(row.categoryId)})`;
  return UNNAMED_BILL_LABEL;
}

/**
 * Drop repeating bills whose billRenameKey is in the off-plan overlay.
 * getSpendingPlan applies this to scheduledFixed after detection so the
 * Fixed list and the Fixed figure cannot disagree.
 */
export function excludeOffPlanBills<T extends BillRenameRef>(
  items: readonly T[],
  offPlanKeys: ReadonlySet<string>,
): T[] {
  if (offPlanKeys.size === 0) return items.slice();
  return items.filter((item) => !offPlanKeys.has(billRenameKey(item)));
}
