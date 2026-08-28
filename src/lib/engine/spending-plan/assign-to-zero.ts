/**
 * DECISIONS #525 — P0.4 "assign to zero" on /budgets. The coach-principles
 * plan's leftover C6 affordance: highlight the existing
 * `leftToSpendCents` as leftover after Fixed and savings. This module
 * is the one author of WHETHER the sentence prints; the sentence
 * itself is `COACH_COPY.assignToZero` (the leftover formatted at the
 * copy boundary, no new spend math).
 *
 * The number is the spending-plan remainder — identical to the
 * guilt-free bucket (`mapToConsciousBuckets`) by construction. It is
 * MONTHLY CAPACITY (income − fixed − savings), not cash still sitting
 * unspent: discretionary spend this month is deliberately not
 * subtracted (`plan.ts` spentSoFar retirement). The copy must say
 * capacity, never "You have … still unassigned" as remaining cash.
 *
 * The strip already names those dollars Guilt-free (Sethi's
 * assignment); this line names the same dollars as leftover that can
 * take a more specific job (Ramsey overlay). One quantity, two
 * vocabularies.
 *
 * A non-positive remainder is an absence, not a $0-unassigned claim.
 * A leftover this card already knows is too large (uncounted bills
 * inflate guilt-free; frozen/excluded-card notes) must not be
 * certified as assignable — refuse, same direction as the strip's
 * own uncounted-fixed note. Unset savings is NOT inflation: that is
 * genuine unassigned leftover, the Ramsey case.
 *
 * The inflation flags are REQUIRED (L.15): a defaulted argument would
 * be forgotten at the caller that needed it.
 */
import { cents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

export interface AssignToZeroInflation {
  /** A repeating bill the projection lost — leftover is too generous. */
  uncountedFixed: boolean;
  /** Frozen / excluded-card notes on this strip — leftover direction unknown. */
  cardNotesPresent: boolean;
}

export function assignToZeroLineFor(
  leftToSpendCents: number,
  inflation: AssignToZeroInflation,
): string | null {
  if (leftToSpendCents <= 0) return null;
  if (inflation.uncountedFixed || inflation.cardNotesPresent) return null;
  return COACH_COPY.assignToZero(cents(leftToSpendCents));
}
