/**
 * How a rule's extra conditions read (extracted from the builder in O.15 slice 3, so
 * the two rule lists on /rules cannot describe the same stored columns differently).
 *
 * It lives in the UI layer, not the engine, because it FORMATS money — per
 * CLAUDE.md currency formatting happens only at the UI boundary, through the one
 * `formatCents` helper.
 *
 * The day/weekend clauses are new here: the columns have existed since Phase 2 and
 * the builder never offered them, so nothing the reader can create today sets one —
 * but a rule row that carries one has always been executed by the engine, and a
 * condition the page silently omits is a rule the reader would misread as broader
 * than it is.
 */
import { cents, formatCents } from '@/lib/money';

export interface RuleConditionFields {
  minAmountCents: number | null;
  maxAmountCents: number | null;
  weekendOnly?: boolean | null;
  weekdayOnly?: boolean | null;
  accountId: string | null;
}

export function describeConditions(
  r: RuleConditionFields,
  accountNameById: Record<string, string>,
): string[] {
  const extras: string[] = [];
  if (r.accountId) extras.push(`only in ${accountNameById[r.accountId] ?? 'one account'}`);
  if (r.minAmountCents !== null && r.maxAmountCents !== null) {
    extras.push(`${formatCents(cents(r.minAmountCents))}–${formatCents(cents(r.maxAmountCents))}`);
  } else if (r.minAmountCents !== null) {
    extras.push(`at least ${formatCents(cents(r.minAmountCents))}`);
  } else if (r.maxAmountCents !== null) {
    extras.push(`at most ${formatCents(cents(r.maxAmountCents))}`);
  }
  if (r.weekendOnly) extras.push('weekends only');
  if (r.weekdayOnly) extras.push('weekdays only');
  return extras;
}
