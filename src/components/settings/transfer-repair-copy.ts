/**
 * Every sentence the transfer-flag repair card shows (H.7b). A pure module for
 * the plaid-update-copy reason: most of these are claims about money that can
 * be wrong in a state nobody rendered by hand — a claim that can be wrong is a
 * claim that needs a test.
 *
 * Copy rules honoured here:
 *  - a zero is a claim and must name WHICH zero ("no marks exist" is a
 *    different fact from "every mark checks out");
 *  - money directions are named separately — restored money-out moves spending
 *    figures, restored money-in moves income figures, and one sentence
 *    covering both would be claiming a total neither figure prints;
 *  - what the repair does NOT cover is stated, never implied away;
 *  - educational, not advisory; the mechanism is explained in one breath.
 */
import { cents, formatCents } from '@/lib/money';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "$X of money out and $Y of money in", eliding a zero side. Null when both
 * sides are zero (no amount claim can honestly be made). */
export function moneyBothWays(inflowCents: number, outflowCents: number): string | null {
  const parts: string[] = [];
  if (outflowCents > 0) parts.push(`${formatCents(cents(outflowCents))} of money out`);
  if (inflowCents > 0) parts.push(`${formatCents(cents(inflowCents))} of money in`);
  if (parts.length === 0) return null;
  return parts.join(' and ');
}

/** The standing explainer — mechanism and assumption, one breath each. */
export function repairExplainer(): string {
  return (
    'A transfer between your own accounts is left out of income and spending, so moving ' +
    'money around never counts twice. An earlier version of that check could mark an ' +
    'ordinary transaction as a transfer when an unrelated payment of the same amount ' +
    'landed within a few days. This tool re-tests every existing mark against the current, ' +
    'stricter check — it changes nothing until you say so.'
  );
}

/** The money claim, shown only when there is something to repair. */
export function repairClaim(p: {
  clearCount: number;
  inflowCents: number;
  outflowCents: number;
  incomeCategorisedCount: number;
}): string {
  const amounts = moneyBothWays(p.inflowCents, p.outflowCents);
  const first =
    `${p.clearCount} ${plural(p.clearCount, 'transaction is', 'transactions are')} being left ` +
    `out of your totals by a transfer mark today's check doesn't support.`;
  const second =
    amounts === null
      ? null
      : `Restoring ${plural(p.clearCount, 'it', 'them')} returns ${amounts} to your figures.`;
  const third =
    p.incomeCategorisedCount > 0
      ? `${p.incomeCategorisedCount} of ${plural(p.clearCount, 'it', 'them')} ` +
        `${plural(p.incomeCategorisedCount, 'is', 'are')} categorised as income.`
      : null;
  return [first, second, third].filter((s): s is string => s !== null).join(' ');
}

/** The zero state — which zero, exactly. */
export function repairNothingLine(p: { flaggedCount: number }): string {
  if (p.flaggedCount === 0) {
    return 'No transactions are marked as transfers yet, so there is nothing to check.';
  }
  return (
    'Nothing needs repair: no settled transaction is being held out of your totals by a ' +
    'mark today’s check declines.'
  );
}

/** Disclosed non-coverage — never silently dropped. */
export function repairOutOfScopeNote(count: number): string | null {
  if (count === 0) return null;
  return (
    `${count} marked ${plural(count, 'row', 'rows')} today's check also declines ` +
    `${plural(count, 'is', 'are')} not covered here — ` +
    `${plural(count, 'it is', 'they are')} still waiting on your review, pinned by you, or ` +
    'filed as a transfer — and stays exactly as it is.'
  );
}

export function repairApplyLabel(count: number): string {
  return `Restore ${count} ${plural(count, 'transaction', 'transactions')} to my totals`;
}

/** The standing-run line the Undo control sits beside. On success the card
 * reloads (the budget-form recipe), so THIS line — rendered from the recorded
 * run — is the apply's confirmation, not a transient flash. */
export function repairLastRunLine(p: {
  dateLabel: string;
  clearedCount: number;
  inflowCents: number;
  outflowCents: number;
}): string {
  const amounts = moneyBothWays(p.inflowCents, p.outflowCents);
  return (
    `Restored ${p.clearedCount} ${plural(p.clearedCount, 'transaction', 'transactions')} on ` +
    `${p.dateLabel}` +
    (amounts === null ? '.' : ` (${amounts}).`)
  );
}

export const REPAIR_UNDO_LABEL = 'Undo this repair';

/** The line rendered beside an already-undone last run. */
export function repairUndoneLine(p: { dateLabel: string; clearedCount: number }): string {
  return (
    `The repair from ${p.dateLabel} (${p.clearedCount} ` +
    `${plural(p.clearedCount, 'transaction', 'transactions')}) was undone — any row you had ` +
    'changed in between kept your change.'
  );
}
