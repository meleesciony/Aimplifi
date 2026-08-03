/**
 * Rule THEN-action: mark matched transactions Fixed or Discretionary.
 *
 * Owner (2026-08-03): algorithmic guess first (recurring → Fixed seed); on apply,
 * stamp the baseline past and future; EXTRA OCCURRENCES in a period (a second
 * water bill, an extra service payment) take NO override so the app keeps
 * guessing. Amount is deliberately NOT an outlier signal — utilities are Fixed
 * and almost never identical month to month.
 *
 * Pure: no clock, no I/O. Callers supply cadence and the matched rows.
 */
import { monthKey } from '@/lib/dates';
import type { Cadence } from '@/lib/engine/recurring/detect';
import type { SpendClass } from '@/lib/engine/spending-plan/spend-class';

export type SpendClassChoice = 'fixed' | 'guilt-free';

export function isSpendClassChoice(v: unknown): v is SpendClassChoice {
  return v === 'fixed' || v === 'guilt-free';
}

/** Builder / storage gate — blank or unknown ⇒ this rule sets no spend class. */
export function normalizeSetSpendClass(raw: string | null | undefined): SpendClassChoice | null {
  const trimmed = (raw ?? '').trim();
  return isSpendClassChoice(trimmed) ? trimmed : null;
}

/**
 * What to WRITE onto one row, or null for "leave spendClassOverride alone".
 * Extra occurrences are the only abstention once the rule carries a class.
 */
export function resolveRuleSpendClassStamp(input: {
  ruleSpendClass: string | null | undefined;
  isExtraOccurrence: boolean;
}): SpendClassChoice | null {
  if (!isSpendClassChoice(input.ruleSpendClass)) return null;
  if (input.isExtraOccurrence) return null;
  return input.ruleSpendClass;
}

/**
 * How many baseline charges belong in one calendar month for this cadence.
 * Long cadences still use the month bucket with expect 1 — a double charge in
 * the billing month is the outlier; quiet months are not.
 */
export function expectedPerCalendarMonth(cadence: Cadence | null | undefined): number {
  switch (cadence) {
    case 'WEEKLY':
      return 5;
    case 'BIWEEKLY':
      return 3;
    case 'MONTHLY':
    case 'QUARTERLY':
    case 'SEMIANNUAL':
    case 'ANNUAL':
    case 'IRREGULAR':
    case null:
    case undefined:
      return 1;
    default:
      return 1;
  }
}

export interface OccurrenceRow {
  id: string;
  date: string;
  /** Payee key — usually overrideKey(canonical). Outliers are per payee. */
  groupKey: string;
}

/**
 * Ids of rows that are EXTRA occurrences beyond the baseline for their payee
 * in a calendar month. Within each (payee, month), rows are kept in date order
 * (id tie-break); the first `expectedPerCalendarMonth(cadence)` are baseline,
 * the rest are extras. Unknown cadence defaults to 1/month.
 *
 * Amount is ignored — a $40 and $120 electric bill in different months are both
 * baseline; two electric bills in the same month make the later one an extra.
 */
export function extraOccurrenceIds(
  rows: readonly OccurrenceRow[],
  cadenceByGroup: ReadonlyMap<string, Cadence | null | undefined>,
): Set<string> {
  const buckets = new Map<string, OccurrenceRow[]>();
  for (const r of rows) {
    const key = `${r.groupKey}\0${monthKey(r.date)}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  const extras = new Set<string>();
  for (const [, list] of buckets) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const groupKey = list[0]!.groupKey;
    const expected = expectedPerCalendarMonth(cadenceByGroup.get(groupKey));
    for (let i = expected; i < list.length; i++) extras.add(list[i]!.id);
  }
  return extras;
}

/**
 * Algorithmic pre-select for the rule builder: majority of classifiable matched
 * rows. Tie or empty → Discretionary (safer direction for Fixed over-counting).
 * Recurring-as-Fixed is already inside each row's class via classifySpendClass.
 */
export function guessRuleSpendClass(classes: readonly SpendClass[]): SpendClassChoice {
  let fixed = 0;
  let guiltFree = 0;
  for (const c of classes) {
    if (c === 'fixed') fixed++;
    else if (c === 'guilt-free') guiltFree++;
  }
  if (fixed === 0 && guiltFree === 0) return 'guilt-free';
  return fixed >= guiltFree ? 'fixed' : 'guilt-free';
}

export function spendClassChoiceLabel(c: string | null | undefined): string | null {
  if (c === 'fixed') return 'Fixed';
  if (c === 'guilt-free') return 'Discretionary';
  return null;
}
