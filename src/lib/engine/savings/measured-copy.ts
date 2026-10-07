/**
 * Words for "Money you set aside" (DECISIONS #790) — one author for the Guilt-free
 * section, so every sentence states what the engine (`measured.ts`) counted and
 * nothing it did not. Educational, never advisory, no shame: a month below the plan
 * is "to go", and a month with more out than in says exactly that.
 *
 * No sentence here says money did not move. A zero is "nothing counted as set aside",
 * and a month whose records are incomplete says so beside its figure.
 */
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { MeasuredMonth, MeasuredSavings } from './measured';

const money = (c: number) => formatCents(cents(c));

/** Shown instead of a figure when no checking or savings account is linked. */
export const MEASURED_NO_SOURCE_ACCOUNTS =
  'Link the checking and savings accounts your pay moves through, and this measures what you set aside each month against your plan.';
/** Shown instead of a figure when no savings or investment account is linked. */
export const MEASURED_NO_SAVING_ACCOUNTS =
  'Link the savings or investment accounts you save into, and this measures what you set aside each month against your plan. A cash-management account (one your provider reports as checking) isn’t read as savings here.';
/** Shown instead of a figure when the records do not yet cover a whole month. */
export const MEASURED_NO_RECORDS =
  'Your linked checking and savings records don’t cover a whole month yet, so there is nothing to measure yet.';

/** "+$500.00" / "−$300.00" / "$0.00" — a net figure with its sign spelled out. */
export function signedMoney(c: number): string {
  return c > 0 ? `+${money(c)}` : c < 0 ? `−${money(-c)}` : money(0);
}

/**
 * "(not counting $3,000.00 that came in that we couldn’t trace)" — beside a sentence about
 * what was counted, when money came into savings that the figure leaves out (critic cycle 4,
 * P1-1: a sentence about counted money must not read as one about every dollar). Empty when
 * there is none.
 */
function notCounting(untracedCents: number): string {
  return untracedCents > 0 ? ` (not counting ${money(untracedCents)} that came in that we couldn’t trace)` : '';
}

/**
 * When the plan's savings line holds extra debt payments (debt-free goals), which no
 * savings or investment account shows (critic cycles 1 and 2, P1-3 / P1-B / P2-C): the
 * sentence that says so, after the comparison. Null when it holds none.
 */
export function debtPaydownNote(ms: MeasuredSavings): string | null {
  const p = ms.plan;
  if (p.debtPaydownCents <= 0) return null;
  return p.comparedCents === 0
    ? `Your plan’s savings line of ${money(p.plannedSavingsCents)} is all extra debt payments, which no savings or investment account shows.`
    : `Your plan’s savings line of ${money(p.plannedSavingsCents)} includes ${money(p.debtPaydownCents)} a month of extra debt payments, which no savings or investment account shows.`;
}

/** "your plan sets aside" — or, beside extra debt payments, what it sets aside apart from them. */
function planSetsAside(ms: MeasuredSavings): string {
  return ms.plan.debtPaydownCents > 0 ? 'your plan sets aside apart from extra debt payments' : 'your plan sets aside';
}

/** The lead: this month so far, against the plan's savings line. Null with no month to measure. */
export function measuredLead(ms: MeasuredSavings): string | null {
  const m = ms.thisMonth;
  if (!m) return null;
  const planned = ms.plannedSavingsCents;
  const total = m.totalCents;
  const debt = debtPaydownNote(ms);
  // An all-debt line is named by the debt note, never as "no savings aside yet" (P2-C).
  const noLine = debt ? '' : ' Your plan doesn’t set any savings aside yet.';
  const sets = planSetsAside(ms);
  let s: string;
  if (total > 0) {
    if (planned <= 0) s = `So far this month you’ve set aside ${money(total)}.${noLine}`;
    else if (total > planned) s = `So far this month you’ve set aside ${money(total)} — ${money(total - planned)} more than the ${money(planned)} ${sets}.`;
    else if (total === planned) s = `So far this month you’ve set aside ${money(total)} — exactly what ${sets}.`;
    else s = `So far this month you’ve set aside ${money(total)} of the ${money(planned)} ${sets} — ${money(planned - total)} to go.`;
  } else if (total === 0) {
    s =
      planned > 0
        ? `Nothing counted as set aside so far this month — ${sets} ${money(planned)}.`
        : debt
          ? 'Nothing counted as set aside so far this month.'
          : 'Nothing counted as set aside so far this month, and your plan doesn’t set any savings aside yet.';
  } else {
    // Counted money only (critic cycle 4, P1-1): "more came out than went in" was false beside
    // money in the figure leaves out — a tax refund untraced, then a withdrawal.
    s =
      `So far this month you’ve taken out ${money(-total)} more than you set aside${notCounting(m.untracedInCents)}` +
      (planned > 0 ? ` — ${sets} ${money(planned)}.` : '.');
  }
  if (debt) s += ` ${debt}`;
  if (m.missingRecordsFrom.length > 0) s += ' Records for part of this month are missing, so this figure may be incomplete.';
  return s;
}

/** The complete months with full records, against today's plan. Null when there is no such month. */
export function measuredAverageSentence(ms: MeasuredSavings): string | null {
  const a = ms.average;
  if (!a) return null;
  const amount = money(Math.abs(a.averageCents));
  let s: string;
  if (a.months === 1) {
    const span = formatMonth(a.fromMonth);
    s =
      a.averageCents >= 0
        ? `In ${span}, the one complete month with full records, you set aside ${amount}.`
        : `In ${span}, the one complete month with full records, you took out ${amount} more than you set aside.`;
  } else {
    const span = `${formatMonth(a.fromMonth)} – ${formatMonth(a.toMonth)}`;
    const lead = `Over the ${a.months} complete months with full records (${span}), `;
    s =
      a.averageCents >= 0
        ? `${lead}you set aside an average of ${amount} a month.`
        : `${lead}you took out an average of ${amount} a month more than you set aside.`;
  }
  if (ms.plannedSavingsCents > 0)
    s += ` Your plan today sets aside ${money(ms.plannedSavingsCents)} a month${ms.plan.debtPaydownCents > 0 ? ' apart from extra debt payments' : ''}.`;
  // The averaged months' money in the figure leaves out, said beside it (critic cycle 4, P1-1).
  const untraced = ms.months
    .filter((m) => !m.partial && m.missingRecordsFrom.length === 0)
    .reduce((sum, m) => sum + m.untracedInCents, 0);
  if (untraced > 0) s += ` Not counted: ${money(untraced)} that came into your savings over those months that we couldn’t trace.`;
  const left = ms.monthsMissingRecords.length;
  if (left > 0) s += left === 1 ? ' One month with missing records is left out.' : ` ${left} months with missing records are left out.`;
  return s;
}

/** "Investments lists 2 movements this month it couldn’t count." — null when there are none. */
export function uncountedInvestmentsNote(m: MeasuredMonth): string | null {
  const k = m.uncountedInvestmentRows;
  if (k === 0) return null;
  const when = m.partial ? 'this month' : `in ${formatMonth(m.month)}`;
  return `Investments lists ${k} ${k === 1 ? 'movement' : 'movements'} ${when} it couldn’t count.`;
}

/**
 * Beside the savings line: money into savings this measure could not trace (critic cycles 1
 * and 2, P1-1 / P2-B). It names what was not found, never a cause it does not know.
 */
export function untracedNote(m: MeasuredMonth): string | null {
  if (m.untracedInCents === 0) return null;
  return (
    `${money(m.untracedInCents)} came into your savings that we couldn’t match to a transfer from your linked checking or savings, ` +
    'a linked investment account, money returned to the same account, or pay — so it isn’t counted.'
  );
}

/** The rule, stated as the engine applies it. */
export const MEASURED_RULE_NOTE =
  'Counted: money into your linked savings accounts, net of what came out, and money your checking or savings put into a linked investment account, net of what came back, read exactly as “Money you put in” on Investments reads it — its rows and rules are there. ' +
  'Money into savings counts when it is a transfer from one of your linked checking or savings accounts — both halves filed as a transfer or to Investment & Savings (or marked a transfer and filed nothing else), the same amount, within a week — when it came back from a linked investment account, when your bank returned money that left the same savings account, or when it is filed as pay (Paycheck, Bonus or Side Gig — pay split straight into savings). ' +
  'Anything else — a bank or brokerage you haven’t linked, a loan, a card, money from someone else, a pension or benefits — is listed and not counted; money in on a row you excluded from totals is left out too. ' +
  'Money out of savings always counts as money out, even a row you excluded from totals, and so does money sent to an account you haven’t linked. ' +
  'So this can understate what you saved; it can overstate only when your filings say a coincidence was a move — the same amount filed as a transfer leaving one of your linked checking or savings accounts within a week of an arrival filed as a transfer, money to and back from a brokerage the app doesn’t recognise filed to Investment & Savings, or a deposit your bank words as a return of an equal payment — or when money from elsewhere is filed as pay. ' +
  'Interest and dividends are left out (they are what the account earned, not money you set aside). Money moved between your savings and investment accounts counts once. Only posted rows count. ' +
  'Not counted: money left in checking, savings at a bank you haven’t linked, a cash-management account your provider reports as checking, extra debt payments (the comparison leaves them out of your plan’s line too), and retirement contributions taken out of your paycheck. ' +
  'Money kept in savings for a bill counts when it goes in and as money out when the bill is paid. Months start where your linked checking and savings records cover a whole month; the average uses only complete months whose records are complete.';
