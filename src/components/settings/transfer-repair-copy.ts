/**
 * Every sentence the transfer-flag repair card shows (H.7b, critic-cycled). A
 * pure module for the plaid-update-copy reason: most of these are claims about
 * money that can be wrong in a state nobody rendered by hand — a claim that
 * can be wrong is a claim that needs a test. Card-local strings live here too
 * (critic cycle 1 P3-8): a string the card types itself is a string no test
 * reads.
 *
 * Copy rules honoured here, several enforced by the cycle-1 critics:
 *  - a zero is a claim and must name WHICH zero — "no marks exist", "all
 *    covered marks check out", and "nothing THIS TOOL covers needs repair
 *    (but marks it doesn't cover exist)" are three different facts;
 *  - money directions are named separately, and dollars are claimed ONLY for
 *    rows the totals would actually regain (the planner's scope guarantees
 *    every cleared row is POSTED, USD-counted, and not reader-excluded);
 *  - the one known class the check cannot see — a genuine cash advance or
 *    balance transfer out of a card — is named BEFORE the button, because the
 *    repair would un-mark it and the sweep can never re-fix it;
 *  - the confirmation makes no calendar-day claim (a UTC date is "tomorrow"
 *    for a US evening);
 *  - what the repair does NOT cover is stated, never implied away.
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
    'landed within a few days. This tool re-tests your transfer marks against the current, ' +
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
    p.incomeCategorisedCount === 0
      ? null
      : p.clearCount === 1
        ? 'It is categorised as income.'
        : `${p.incomeCategorisedCount} of them ${plural(p.incomeCategorisedCount, 'is', 'are')} categorised as income.`;
  return [first, second, third].filter((s): s is string => s !== null).join(' ');
}

/** The one class the check cannot see, named before the button (critic P1-1:
 * the repair would un-mark a GENUINE card-sourced transfer, and because repair
 * and sweep share one rule, the sweep can never re-fix it — only the reader
 * can, by leaving it marked). */
export function repairCashAdvanceCaution(): string {
  return (
    'One caution: a cash advance or balance transfer paid out of a credit card really is a ' +
    'transfer, but it looks identical to these from here. If you recognise one below, leave ' +
    'this alone and file that transaction as Transfer instead — restoring it would count the ' +
    'same money twice.'
  );
}

/** The zero state — which zero, exactly (three different facts). */
export function repairNothingLine(p: {
  flaggedCount: number;
  declinedOutOfScopeCount: number;
}): string {
  if (p.flaggedCount === 0) {
    return 'No transactions are marked as transfers yet, so there is nothing to check.';
  }
  if (p.declinedOutOfScopeCount > 0) {
    // Marks this tool cannot touch DO exist and some are declined — saying
    // "nothing needs repair" here would be false (critic P1-2, executed).
    return 'Nothing this tool covers needs repair right now — see the note below for marks it doesn’t cover.';
  }
  return 'Nothing needs repair: every transfer mark here is backed by today’s check.';
}

/** Disclosed non-coverage — never silently dropped. */
export function repairOutOfScopeNote(count: number): string | null {
  if (count === 0) return null;
  return (
    `${count} marked ${plural(count, 'row', 'rows')} today's check declines ` +
    `${plural(count, 'is', 'are')} not covered here — still waiting on your review, pinned or ` +
    `excluded by you, pending, in a non-USD account, or filed as a transfer — and ` +
    `${plural(count, 'stays exactly as it is', 'stay exactly as they are')}.`
  );
}

export function repairApplyLabel(count: number): string {
  return `Restore ${count} ${plural(count, 'transaction', 'transactions')} to my totals`;
}

/** The confirmation line the Undo control sits beside, rendered from the
 * RECORDED run after the reload (the budget-form recipe). No calendar-day
 * claim; a partial apply is disclosed, never silently narrowed. */
export function repairLastRunLine(p: {
  clearedCount: number;
  skippedCount: number;
  inflowCents: number;
  outflowCents: number;
}): string {
  const amounts = moneyBothWays(p.inflowCents, p.outflowCents);
  const named = p.clearedCount + p.skippedCount;
  const first =
    p.skippedCount === 0
      ? `Most recent repair: restored ${p.clearedCount} ${plural(p.clearedCount, 'transaction', 'transactions')}`
      : `Most recent repair: restored ${p.clearedCount} of the ${named} it named`;
  const second =
    p.skippedCount === 0
      ? null
      : `${p.skippedCount} ${plural(p.skippedCount, 'was', 'were')} re-decided while it ran and kept your change.`;
  return (
    [first + (amounts === null ? '.' : ` (${amounts}).`), second]
      .filter((s): s is string => s !== null)
      .join(' ')
  );
}

export const REPAIR_UNDO_LABEL = 'Undo this repair';

/** The line rendered beside an already-undone last run. */
export function repairUndoneLine(p: { clearedCount: number }): string {
  return (
    `The most recent repair (${p.clearedCount} ` +
    `${plural(p.clearedCount, 'transaction', 'transactions')}) was undone — any row you had ` +
    'changed in between kept your change.'
  );
}

/** Rendered when an apply came back with nothing cleared: every row the
 * preview named was re-decided before the write reached it. No reload happens
 * (nothing changed server-side), so this line is the click's entire outcome
 * (critic P2-6: a silent reload here communicated nothing). */
export function repairAllSkippedNote(): string {
  return (
    'Nothing was changed — every row this preview named had been re-decided since the page ' +
    'loaded, and a row you have re-decided is yours. Refresh the page to see the current list.'
  );
}

/** Card-local strings, centralised so the copy test reads every rendered
 * sentence (critic P3-8). */
export const REPAIR_DEMO_NOTE =
  'The demo is a shared account, so this stays read-only here — in your own account this is a ' +
  'one-tap, undoable repair.';
export const REPAIR_BUSY_APPLY = 'Restoring…';
export const REPAIR_BUSY_UNDO = 'Undoing…';
export const REPAIR_GENERIC_ERROR = 'Something went wrong — nothing was changed.';
export function repairShowRowsLabel(count: number): string {
  return count === 1 ? 'Show the transaction' : `Show the ${count} transactions`;
}
