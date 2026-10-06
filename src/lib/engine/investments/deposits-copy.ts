/**
 * Every sentence the "Money you put in" card prints (DECISIONS #788), in one
 * author so each is locked by a test. Pure; money formatted at this boundary
 * only through `formatCents`.
 */
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { BROKERAGES } from './brokerages';
import type { DepositDestination, DepositDirection, DepositHistory, UncountedRow } from './deposits';

const money = (n: number) => formatCents(cents(n));

/** "Vanguard Brokerage", or "Charles Schwab (2 accounts)" for every account at one brokerage. */
export function destinationLabel(d: DepositDestination): string {
  if (d.accountLabels.length === 1) return d.accountLabels[0]!;
  return `${d.brokerageName ?? 'Several accounts'} (${d.accountLabels.length} accounts)`;
}

/** The span the year figure covers: "so far this year", or "since Apr 2026" when records start later. */
export function thisYearSpan(fromMonth: string): string {
  return fromMonth.endsWith('-01') ? 'so far this year' : `since ${formatMonth(fromMonth)}`;
}

/** The lead line, or null when there is no covered month to speak about. */
export function depositLead(h: DepositHistory): string | null {
  if (!h.thisYear) return null;
  const span = thisYearSpan(h.thisYear.fromMonth);
  const { putInCents, takenOutCents, fromMonth } = h.thisYear;
  if (putInCents === 0 && takenOutCents === 0) {
    // A zero is a claim (docs/lessons/a-zero-is-a-claim-and-must-name-which-zero.md):
    // "nothing moved" is only true when nothing that names an investment account
    // was left out either.
    const left = h.uncounted.filter((u) => u.month >= fromMonth).length;
    if (left > 0) {
      return `Nothing counted ${span}. ${left === 1 ? 'One movement that names an investment account is' : `${left} movements that name an investment account are`} listed below under “Not counted”.`;
    }
    return `Nothing moved between your linked checking or savings and your investment accounts ${span}.`;
  }
  if (takenOutCents === 0) return `${money(putInCents)} put in ${span}.`;
  if (putInCents === 0) return `${money(takenOutCents)} taken out ${span}, nothing put in.`;
  const net = putInCents - takenOutCents;
  const netWords =
    net === 0 ? 'as much in as out' : net > 0 ? `${money(net)} more in than out` : `${money(-net)} more out than in`;
  return `${money(putInCents)} put in and ${money(takenOutCents)} taken out ${span} — ${netWords}.`;
}

/** The month row's own figure: "$500.00 put in", "$300.00 taken out", both, or "None". */
export function monthFigure(putInCents: number, takenOutCents: number): string {
  if (putInCents === 0 && takenOutCents === 0) return 'None';
  const parts: string[] = [];
  if (putInCents > 0) parts.push(`${money(putInCents)} put in`);
  if (takenOutCents > 0) parts.push(`${money(takenOutCents)} taken out`);
  return parts.join(' · ');
}

/** "into Vanguard Brokerage" / "out of Vanguard Brokerage". */
export function movementPhrase(direction: DepositDirection, destination: string): string {
  return direction === 'in' ? `into ${destination}` : `out of ${destination}`;
}

/** Why a row that names an investment destination is not in the figures. */
export function uncountedReason(u: UncountedRow): string {
  switch (u.reason) {
    case 'not-linked':
      return `No ${u.brokerageName} investment account is linked here, so it isn't counted. Link it on Accounts to count it.`;
    case 'unclear-account':
      return u.brokerageName
        ? `It could have gone to more than one of your ${u.brokerageName} accounts, and we can't tell which — so it isn't counted.`
        : "The description could mean more than one of your accounts, so it isn't counted.";
    case 'too-new':
      return `It's less than a week old, and your ${u.brokerageName} bank account may still show the other half. We'll check again after a week.`;
    case 'landed-in-your-account':
      return u.direction === 'in'
        ? `The same amount arrived in ${u.counterpartLabel ?? 'another of your accounts'} within a week, so it looks like a move between your own accounts.`
        : `The same amount left ${u.counterpartLabel ?? 'another of your accounts'} within a week, so it looks like a move between your own accounts.`;
    case 'no-account-named':
      return "It's filed Investment & Savings, but the description doesn't name an investment account or a brokerage we know, so it isn't counted.";
  }
}

/** The "how we read this" note: the rule, stated as the code applies it. */
export function depositRuleNote(recordsFromMonth: string | null): string {
  const names = BROKERAGES.map((b) => b.name);
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  const records = recordsFromMonth ? ` Your linked checking and savings records start in ${formatMonth(recordsFromMonth)}.` : '';
  return (
    'Counted: money your linked checking and savings accounts sent to a linked investment account (put in) or got back from one (taken out), filed Transfer or Investment & Savings, when the bank’s description names the account’s last four digits or the brokerage — ' +
    list +
    ' — and the same amount didn’t arrive in another of your accounts within a week. ' +
    'Not counted: retirement contributions taken out of your paycheck, money moved from banks you haven’t linked, and market gains or losses.' +
    records
  );
}

/** Shown when no investment account is linked and nothing names a brokerage. */
export const DEPOSITS_NO_INVESTMENT_ACCOUNTS =
  'Link a brokerage or retirement account to see how much you put in each month from your checking and savings.';

/** Shown when no linked checking or savings account has a complete month of records yet. */
export const DEPOSITS_NO_RECORDS =
  'Your linked checking and savings accounts don’t have a full month of records yet, so there is nothing to read.';
