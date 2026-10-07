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

/** "your savings and investment accounts" / "your savings accounts" / "your investment accounts" — the kinds the reader links. */
function accountKinds(ms: MeasuredSavings): string {
  if (ms.hasSavingsAccounts && ms.hasInvestmentAccounts) return 'your savings and investment accounts';
  if (ms.hasInvestmentAccounts) return 'your investment accounts';
  return 'your savings accounts';
}

/**
 * Beside a comparison with the plan, when the plan's savings line holds extra debt
 * payments (debt-free goals) this measure can't see (critic cycle 1, P1-3): name them,
 * and the line it compares with instead. Null when the line holds none that matter.
 */
export function debtPaydownNote(ms: MeasuredSavings): string | null {
  const p = ms.plan;
  if (p.debtPaydownCents <= 0 || p.comparedCents === p.plannedSavingsCents) return null;
  return (
    `Your plan’s savings line of ${money(p.plannedSavingsCents)} includes ${money(p.debtPaydownCents)} a month of extra debt payments, ` +
    `which no savings or investment account shows, so this compares with ${money(p.comparedCents)} — the line without them.`
  );
}

/** The lead: this month so far, against the plan's savings line. Null with no month to measure. */
export function measuredLead(ms: MeasuredSavings): string | null {
  const m = ms.thisMonth;
  if (!m) return null;
  const planned = ms.plannedSavingsCents;
  const total = m.totalCents;
  let s: string;
  if (total > 0) {
    if (planned <= 0) s = `So far this month you’ve set aside ${money(total)}. Your plan doesn’t set any savings aside yet.`;
    else if (total > planned)
      s = `So far this month you’ve set aside ${money(total)} — ${money(total - planned)} more than the ${money(planned)} your plan sets aside.`;
    else if (total === planned) s = `So far this month you’ve set aside ${money(total)} — exactly what your plan sets aside.`;
    else s = `So far this month you’ve set aside ${money(total)} of the ${money(planned)} your plan sets aside — ${money(planned - total)} to go.`;
  } else if (total === 0) {
    s =
      planned > 0
        ? `Nothing counted as set aside so far this month — your plan sets aside ${money(planned)}.`
        : 'Nothing counted as set aside so far this month, and your plan doesn’t set any savings aside yet.';
  } else {
    s =
      `So far this month ${money(-total)} more has come out of ${accountKinds(ms)} than gone in` +
      (planned > 0 ? ` — your plan sets aside ${money(planned)}.` : '.');
  }
  const debt = debtPaydownNote(ms);
  if (debt) s += ` ${debt}`;
  if (m.missingRecordsFrom.length > 0) s += ' Records for part of this month are missing, so this figure may be incomplete.';
  return s;
}

/** The complete months with full records, against today's plan. Null when there is no such month. */
export function measuredAverageSentence(ms: MeasuredSavings): string | null {
  const a = ms.average;
  if (!a) return null;
  const amount = money(Math.abs(a.averageCents));
  const kinds = accountKinds(ms);
  let s: string;
  if (a.months === 1) {
    const span = formatMonth(a.fromMonth);
    s =
      a.averageCents >= 0
        ? `In ${span}, the one complete month with full records, you set aside ${amount}.`
        : `In ${span}, the one complete month with full records, ${amount} more came out of ${kinds} than went in.`;
  } else {
    const span = `${formatMonth(a.fromMonth)} – ${formatMonth(a.toMonth)}`;
    const lead = `Over the ${a.months} complete months with full records (${span}), `;
    s =
      a.averageCents >= 0
        ? `${lead}you set aside an average of ${amount} a month.`
        : `${lead}an average of ${amount} a month more came out of ${kinds} than went in.`;
  }
  if (ms.plannedSavingsCents > 0) s += ` Your plan today sets aside ${money(ms.plannedSavingsCents)} a month.`;
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

/** Beside the savings line: money into savings this measure could not trace (critic cycle 1, P1-1). Null when there is none. */
export function untracedNote(m: MeasuredMonth): string | null {
  if (m.untracedInCents === 0) return null;
  return (
    `${money(m.untracedInCents)} came into your savings from an account we can’t see — a bank you haven’t linked, a loan or a card — ` +
    'so it isn’t counted: it may be money you saved before. Money filed as income counts.'
  );
}

/** The rule, stated as the engine applies it. */
export const MEASURED_RULE_NOTE =
  'Counted: money into your linked savings accounts, net of what came out, and money your checking or savings put into a linked investment account, net of what came back, read exactly as “Money you put in” on Investments reads it — its rows and rules are there. Money into savings counts when the other half left one of your linked checking or savings accounts, when it came back from a linked investment account, or when it is filed as income (pay split straight into savings); money from anywhere else — a bank you haven’t linked, a loan, a card — is listed and not counted. Money out of savings always counts as money out, even a row you excluded from totals, and so does money sent to an account you haven’t linked, so this can understate what you saved, never overstate it. Interest and dividends are left out (they are what the account earned, not money you set aside). Money moved between your savings and investment accounts counts once. Only posted rows count. Not counted: money left in checking, savings at a bank you haven’t linked, a cash-management account your provider reports as checking, extra debt payments, and retirement contributions taken out of your paycheck. Money kept in savings for a bill counts when it goes in and as money out when the bill is paid. Months start where your linked checking and savings records cover a whole month; the average uses only complete months whose records are complete.';
