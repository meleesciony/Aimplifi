/**
 * Every sentence the "Money you put in" card prints (DECISIONS #788), in one
 * author so each is locked by a test. Pure; money formatted at this boundary
 * only through `formatCents`. Each sentence is written for the state that renders
 * it — a narrowed view speaks about that account, a zero says which zero.
 */
import { formatISODate, formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { BROKERAGES } from './brokerages';
import type { DepositDestination, DepositDirection, DepositHistory, DepositMonth, UncountedRow } from './deposits';

const money = (n: number) => formatCents(cents(n));

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Vanguard Brokerage" (placed by its last four) or "Vanguard" (placed by the firm's name). */
export function destinationLabel(d: DepositDestination): string {
  return d.kind === 'account' ? d.accountLabels[0]! : (d.brokerageName ?? d.accountLabels.join(' or '));
}

/** How the destination was placed, said plainly under its name. */
export function destinationDetail(d: DepositDestination): string {
  if (d.kind === 'account') return 'Matched by its last four digits';
  return d.accountLabels.length === 1
    ? `Matched by name only — your linked account there is ${d.accountLabels[0]}`
    : `Matched by name only — your ${d.accountLabels.length} linked accounts there are ${listOf(d.accountLabels)}`;
}

/** The span the year figure covers: "so far this year", or "since Apr 2026" when records start later. */
export function thisYearSpan(fromMonth: string): string {
  return fromMonth.endsWith('-01') ? 'so far this year' : `since ${formatMonth(fromMonth)}`;
}

const MISSING_NOTE = 'Some months are missing records — they’re marked below.';

/**
 * The lead line, or null when there is no covered month to speak about. Every figure in it
 * is what was COUNTED, and it says so whenever something was left out: it never claims
 * money did not move (critic cycles 3–4: a zero is a claim about the matcher, not the rows).
 */
export function depositLead(h: DepositHistory): string | null {
  if (!h.thisYear) return null;
  const { putInCents, takenOutCents, fromMonth, monthsMissingRecords } = h.thisYear;
  const span = thisYearSpan(fromMonth);
  const label = h.scope?.label ?? null;
  const left = h.uncounted.filter((u) => u.month >= fromMonth).length;
  const tail = [
    left > 0
      ? `${left === 1 ? 'One movement we couldn’t count is' : `${left} movements we couldn’t count are`} listed under “Not counted”.`
      : null,
    monthsMissingRecords > 0 ? MISSING_NOTE : null,
  ].filter((x): x is string => x !== null);
  const withTail = (sentence: string) => [sentence, ...tail].join(' ');

  if (putInCents === 0 && takenOutCents === 0) {
    if (left > 0) return withTail(`Nothing counted ${label ? `for ${label} ` : ''}${span}.`);
    const where = monthsMissingRecords > 0 ? ' in the records we have' : '';
    return withTail(label ? `Nothing placed on ${label} by its last four digits ${span}${where}.` : `Nothing matched ${span}${where}.`);
  }

  const into = label ? ` to ${label}` : '';
  const outOf = label ? ` from ${label}` : '';
  if (takenOutCents === 0) return withTail(`${money(putInCents)} put in${into} ${span}.`);
  if (putInCents === 0) return withTail(`${money(takenOutCents)} taken out${outOf} ${span}; nothing counted going in.`);
  const net = putInCents - takenOutCents;
  const netWords =
    net === 0 ? 'as much in as out' : net > 0 ? `${money(net)} more in than out` : `${money(-net)} more out than in`;
  return withTail(`${label ? `For ${label}: ` : ''}${money(putInCents)} put in and ${money(takenOutCents)} taken out ${span} — ${netWords}.`);
}

/** How the matcher reads an account's last four, said once for every sentence that needs it. */
export const LAST_FOUR_MARKERS = 'after X, *, “..”, “ending in” or “acct”';

/** Which linked investment accounts the card can match only by last four, or not at all. */
export function matchingNote(h: DepositHistory): string | null {
  if (h.scope) return null;
  const parts: string[] = [];
  if (h.lastFourOnly.length > 0) {
    const one = h.lastFourOnly.length === 1;
    parts.push(
      `We can match ${listOf(h.lastFourOnly.map((a) => a.label))} only when a description shows ${one ? 'its' : 'their'} last four digits ${LAST_FOUR_MARKERS} — for example X${h.lastFourOnly[0]!.lastFour}.`,
    );
  }
  if (h.unmatchable.length > 0) {
    const one = h.unmatchable.length === 1;
    parts.push(
      `We can’t match ${listOf(h.unmatchable)}: ${one ? 'it has' : 'they have'} no last four digits on file and ${one ? 'its' : 'their'} brokerage isn’t one we know.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Narrowed view: what this card is showing. */
export function scopeNote(h: DepositHistory): string | null {
  return h.scope ? `Showing only money placed on ${h.scope.label} by its last four digits.` : null;
}

/** Narrowed view: money matched only by the brokerage's name, which may or may not be this account's. */
export function scopeByNameNote(h: DepositHistory): string | null {
  const b = h.scope?.byBrokerageName;
  if (!h.scope || !b || (b.putInCents === 0 && b.takenOutCents === 0)) return null;
  const parts: string[] = [];
  if (b.putInCents > 0) parts.push(`${money(b.putInCents)} went to ${b.brokerageName}`);
  if (b.takenOutCents > 0) parts.push(`${money(b.takenOutCents)} came back from ${b.brokerageName}`);
  const which =
    b.accountsThere === 1
      ? `the description names the firm, not an account — it may or may not be ${h.scope.label}’s`
      : `the description doesn’t say which of your ${b.accountsThere} accounts there`;
  return `Also, over these months ${listOf(parts)} by name only — ${which}, so it isn’t counted here. See all your investments for it.`;
}

/** The money parts of a figure: "$500.00 put in", "$300.00 taken out". */
export function figureParts(putInCents: number, takenOutCents: number): string[] {
  const parts: string[] = [];
  if (putInCents > 0) parts.push(`${money(putInCents)} put in`);
  if (takenOutCents > 0) parts.push(`${money(takenOutCents)} taken out`);
  return parts;
}

/** A destination's figure: "$500.00 put in · $300.00 taken out". */
export function monthFigure(putInCents: number, takenOutCents: number): string {
  const parts = figureParts(putInCents, takenOutCents);
  return parts.length === 0 ? 'None' : parts.join(' · ');
}

/** A month row's figure, naming which zero: none, none counted, or none found in partial records. */
export function monthFigureParts(m: DepositMonth): string[] {
  const parts = figureParts(m.putInCents, m.takenOutCents);
  if (parts.length > 0) return m.uncountedCount > 0 ? [...parts, `${m.uncountedCount} not counted`] : parts;
  if (m.uncountedCount > 0) return ['None counted', `${m.uncountedCount} not counted`];
  if (m.missingRecordsFrom.length > 0) return ['None found'];
  return [m.partial ? 'None yet' : 'None matched'];
}

/** Under a month whose records are incomplete: where each account's records begin or stop. */
export function monthMissingNote(m: DepositMonth): string | null {
  if (m.missingRecordsDetail.length === 0) return null;
  return (
    m.missingRecordsDetail
      .map((d) =>
        d.startsOn && d.endsOn
          ? `Records from ${d.label} begin ${formatISODate(d.startsOn, 'long')} and run only through ${formatISODate(d.endsOn, 'long')}`
          : d.startsOn
            ? `Records from ${d.label} begin ${formatISODate(d.startsOn, 'long')}`
            : d.endsOn
              ? `Records from ${d.label} run only through ${formatISODate(d.endsOn, 'long')}`
              : `Records from ${d.label} don’t cover all of ${m.partial ? 'this month so far' : 'this month'}`,
      )
      .join('; ') + '.'
  );
}

/** "into Vanguard Brokerage" / "out of Vanguard Brokerage". */
export function movementPhrase(direction: DepositDirection, destination: string): string {
  return direction === 'in' ? `into ${destination}` : `out of ${destination}`;
}

/** Which way the money went, from the reader's bank account's side. */
export function uncountedDirection(u: UncountedRow): string {
  return u.direction === 'in' ? `Left ${u.sourceLabel}.` : `Arrived in ${u.sourceLabel}.`;
}

/** Why a row that names an investment destination is not in the figures — said for its direction. */
export function uncountedReason(u: UncountedRow): string {
  const where = u.direction === 'in' ? 'went' : 'came from';
  switch (u.reason) {
    case 'not-linked':
      return `No ${u.brokerageName} investment account is linked here, so it isn’t counted. Link it on Accounts to count it.`;
    case 'not-filed':
      // Transfer only: a row filed Investment & Savings still counts as spending in reports
      // (STATUS, #788 "found, not changed"), so this card never advises that filing.
      return 'It isn’t filed yet. File it as Transfer to count it.';
    case 'not-a-deposit':
      return u.direction === 'in'
        ? `It names ${u.brokerageName} next to “${u.matchedWord}”, so it looks like a payment to ${u.brokerageName} itself — a fee, bill, loan, insurance premium or card payment — not money put in.`
        : `It names ${u.brokerageName} next to “${u.matchedWord}”, so it looks like interest, a refund or a payout from ${u.brokerageName} itself, not money taken out of an investment account.`;
    case 'returned':
      return `The same amount ${u.direction === 'in' ? 'came back' : 'went back'} on ${u.returnedOn ? formatISODate(u.returnedOn, 'long') : 'a later day'}, so the two cancel out.`;
    case 'shared-last-four':
      return `More than one of your linked accounts ends in the four digits it names, so we can’t tell which one it ${u.direction === 'in' ? 'went to' : 'came from'}.`;
    case 'names-two-accounts':
      return `It names two of your accounts by their last four digits — ${u.otherAccountLabel} and ${u.destinationLabels[0] ?? 'an investment account'} — so we can’t tell where it ${where}.`;
    case 'two-brokerages':
      return `It names both ${u.brokerageName} and ${u.otherBrokerageName}, so we can’t tell where it ${where}.`;
    case 'last-four-vs-name':
      return `Its last four digits point to your ${u.brokerageName} account, but it names ${u.otherBrokerageName}, so we can’t tell where it ${where}.`;
    case 'same-brokerage-account':
      return `You also link ${u.otherAccountLabel} at ${u.brokerageName}, and its records don’t cover the week around this, so we can’t rule out that it ${u.direction === 'in' ? 'went there' : 'came from there'}.`;
    case 'too-new':
      return `It’s too recent to tell: ${u.otherAccountLabel} (at ${u.brokerageName}) may still show the other half. We’ll check again once a full week has passed.`;
    case 'landed-in-your-account':
      return u.direction === 'in'
        ? `The same amount arrived in ${u.otherAccountLabel ?? 'another of your accounts'} within a week, so it looks like a move between your own accounts.`
        : `The same amount left ${u.otherAccountLabel ?? 'another of your accounts'} within a week, so it looks like a move between your own accounts.`;
    case 'no-account-named':
      return `It’s filed Investment & Savings, but we couldn’t read an investment account’s last four digits (${LAST_FOUR_MARKERS}) or a brokerage we know in its description, so it isn’t counted.`;
  }
}

/** The "how we read this" note: the rule, stated as the code applies it. */
export function depositRuleNote(firstShownMonth: string | null): string {
  const names = BROKERAGES.map((b) => b.name);
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  const records = firstShownMonth
    ? ` The months shown start in ${formatMonth(firstShownMonth)}: the last 12 complete months, or fewer when your linked checking and savings records start later; a month whose records are incomplete says so.`
    : '';
  return (
    `Counted: money your linked checking and savings accounts sent to a linked investment account (put in) or got back from one (taken out), $1.00 or more, filed Transfer or Investment & Savings, when the bank’s description shows the account’s last four digits ${LAST_FOUR_MARKERS} (for example X1234), or names the brokerage — ` +
    list +
    '. A brokerage’s name says which firm, not which account, so those amounts are shown under the firm. ' +
    'Not counted, and listed under “Not counted” with the reason: rows not filed yet; money that moved back within two weeks; money that arrived in (or left) another of your accounts within a week; fees, bills, loans, insurance, memberships, rebates and refunds between you and a brokerage itself; brokerages not linked here; descriptions that could mean more than one account; rows filed Investment & Savings that name no account; and — if you also link a bank or card account at the same brokerage — rows its records can’t rule out. ' +
    'A Zelle, Venmo or Cash App payment names a person, not a brokerage. ' +
    'Never seen here: retirement contributions taken out of your paycheck, money your paycheck sends straight to an investment account, money moved from banks you haven’t linked, and market gains or losses. Not matched: a description that shows the last four digits any other way (“TO IRA 1234”) or names a brokerage not on the list — so “None matched” means nothing we could match, not that no money moved.' +
    records
  );
}

/** Shown when no checking or savings account is linked. */
export const DEPOSITS_NO_SOURCE_ACCOUNTS =
  'Link a checking or savings account — this card reads the money it sends to brokerage and retirement accounts each month.';

/** Shown when no investment account is linked. */
export const DEPOSITS_NO_INVESTMENT_ACCOUNTS =
  'Link a brokerage or retirement account to see how much you put in each month from your checking and savings.';

/** Shown when no linked checking or savings account has a complete month of records yet. */
export const DEPOSITS_NO_RECORDS =
  'Your linked checking and savings accounts don’t have a full month of records yet, so there is nothing to read.';
