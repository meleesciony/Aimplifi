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
/** Prisma Int ceiling — same column bound as Goal.targetCents. */
export const MAX_BILL_MONTHLY_CENTS = 2_147_483_647;

export interface BillRenameRef {
  merchantCanonical?: string | null;
  categoryId?: string | null;
  cadence?: string | null;
  /** Stamped overlay identity. Wins so a cadence overlay cannot drift unnamed keys. */
  billKey?: string | null;
}

export function billRenameKey(row: BillRenameRef): string {
  const stamped = (row.billKey ?? '').trim();
  if (stamped) return stamped.slice(0, MAX_BILL_KEY);
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

export function billMonthlyCentsError(monthlyCents: number | null): string | undefined {
  if (monthlyCents === null || monthlyCents <= 0) {
    return 'Enter a monthly amount above $0 — like 80 or $80.';
  }
  if (monthlyCents > MAX_BILL_MONTHLY_CENTS) {
    return 'That amount is too large.';
  }
  return undefined;
}

/**
 * Stamp a household monthly-rate overlay onto counted expense series.
 * Loans stay at detection. Overlay is MONTHLY cents; cadence stays put so
 * the basis note still tells the truth. One filter with the Fixed figure.
 */
export function typicalChargeCentsForMonthlyRate(
  monthlyCents: number,
  cadence: string | null,
): number {
  switch (cadence) {
    case 'WEEKLY':
      return Math.round((monthlyCents * 12) / 52);
    case 'BIWEEKLY':
      return Math.round((monthlyCents * 12) / 26);
    case 'QUARTERLY':
      return monthlyCents * 3;
    case 'SEMIANNUAL':
      return monthlyCents * 6;
    case 'ANNUAL':
      return monthlyCents * 12;
    default:
      return monthlyCents;
  }
}

export function applyBillAmountOverlays<
  T extends BillRenameRef & { loanPayment?: boolean },
>(
  items: readonly T[],
  amounts: ReadonlyMap<string, number>,
): Array<T & { monthlyAmountOverlayCents?: number }> {
  if (amounts.size === 0) return items.slice();
  return items.map((item) => {
    if (item.loanPayment === true) return item;
    const overlay = amounts.get(billRenameKey(item));
    if (overlay == null || overlay <= 0) return item;
    return { ...item, monthlyAmountOverlayCents: overlay };
  });
}

export const BILL_CADENCES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
] as const;
export type BillCadence = (typeof BILL_CADENCES)[number];

export const BILL_CADENCE_WORDS: Record<BillCadence, string> = {
  WEEKLY: 'every week',
  BIWEEKLY: 'every two weeks',
  MONTHLY: 'every month',
  QUARTERLY: 'every 3 months',
  SEMIANNUAL: 'twice a year',
  ANNUAL: 'once a year',
};

export function isBillCadence(value: string): value is BillCadence {
  return (BILL_CADENCES as readonly string[]).includes(value);
}

export function billCadenceError(raw: string): string | undefined {
  const cadence = raw.trim();
  if (!cadence) return 'Pick how often the bill comes around.';
  if (!isBillCadence(cadence)) {
    return 'Pick a cadence the plan can smooth — weekly through yearly.';
  }
  return undefined;
}

/**
 * Stamp overlay identity from detection BEFORE any cadence rewrite.
 * Unnamed keys include cadence; rewriting first would drift the key.
 */
export function stampBillKeys<T extends BillRenameRef>(
  items: readonly T[],
): Array<T & { billKey: string }> {
  return items.map((item) => {
    if ((item.billKey ?? '').trim()) {
      return { ...item, billKey: (item.billKey as string).trim().slice(0, MAX_BILL_KEY) };
    }
    return { ...item, billKey: billRenameKey(item) };
  });
}

/**
 * Stamp a household cadence overlay onto counted expense series.
 * Loans stay at detection. Overlay rewrites cadence after identity is stamped
 * so unnamed keys do not drift. Amount overlay (monthly cents) still wins.
 */
export function applyBillCadenceOverlays<
  T extends BillRenameRef & { loanPayment?: boolean; cadence?: string | null },
>(
  items: readonly T[],
  cadences: ReadonlyMap<string, string>,
): T[] {
  if (cadences.size === 0) return items.slice();
  return items.map((item) => {
    if (item.loanPayment === true) return item;
    const overlay = cadences.get(billRenameKey(item));
    if (!overlay || !isBillCadence(overlay)) return item;
    return { ...item, cadence: overlay };
  });
}
