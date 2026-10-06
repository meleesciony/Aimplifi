/**
 * Money you put in — brokerage deposits read from the BANK side (DECISIONS #788).
 *
 * The owner chose this over Plaid's investment history, which would start a
 * monthly fee per linked login. So the evidence is the bank's own rows: money
 * leaving a linked checking or savings account (put in) or arriving there (taken
 * out), placed at a linked investment destination by what the bank's description
 * says. Pure: typed rows and accounts in, a typed history out; no DB, no React,
 * integer cents only.
 *
 * A row COUNTS only when every test below passes; a row that names an investment
 * destination and fails one is listed with its reason, never dropped silently
 * (docs/lessons/a-zero-is-a-claim-and-must-name-which-zero.md):
 *
 *  1. It sits on a live CHECKING or SAVINGS account (read through its terminal
 *     successor when combined), is POSTED, is not a split parent, is not excluded
 *     from totals, is not dated after today, and is $1.00 or more (smaller amounts
 *     are account-verification test deposits).
 *  2. It is filed Transfer or Investment & Savings. A row not filed yet that names
 *     a destination is listed ("file it to count it"); one filed to spending or
 *     income is the reader's word that it is something else.
 *  3. Its description places it:
 *     - the last four characters of ONE linked investment account after a mask
 *       marker (X…, *…, .., ENDING IN, ACCT) — that account; or
 *     - ONE brokerage's name (`brokerages.ts`, the categorizer's own list) where the
 *       reader links investment account(s) — the BROKERAGE, never one account there,
 *       because a name says which firm, not which account. A person-to-person payment
 *       (Zelle, Venmo, Cash App, Apple Cash) never names a brokerage — "MARY SCHWAB" is
 *       a person. (PayPal is also a merchant route — "PAYPAL *COINBASE" — so it may.)
 *     Two brokerages, last four shared with another account, the last four of one of
 *     the reader's bank accounts AND of an investment account, or last four and a name
 *     that disagree: not counted. Only the last four of one of the reader's OWN bank or
 *     card accounts: a move between them, ignored. A name beside a fee, bill, loan,
 *     insurance, membership, card-payment, rebate or refund word is money paid to (or
 *     refunded by) the brokerage, not money put in or taken out: listed.
 *  4. It was not returned: money moving the other way on the same account within 14
 *     days, same amount, that names the same destination (not filed, or worded as a
 *     return) — or is worded as a reversal or return and not filed to spending —
 *     cancels it (listed). A deposit up to 14 days before the window still takes its
 *     return inside it.
 *  5. It did not land in another of the reader's own accounts: a row that is
 *     evidence of a move — posted, not excluded, not after today, flagged as a
 *     transfer or filed Transfer / card payment / Investment & Savings (or, on a bank
 *     account, not filed), its SENDING half on checking or savings — of equal and
 *     opposite amount within 7 days takes it, one to one; ordinary moves pair first,
 *     then closest dates. Two rows that both name an investment destination are two
 *     movements, never one; a row placed by its last four never pairs with a card.
 *  6. By name only, where the reader ALSO links a bank or card account at that
 *     brokerage: that account's records must cover the week around the row, and the
 *     week must be over, because only then does "no equal amount arrived there" mean
 *     anything.
 *
 * Months: the last 12 complete months and this month so far, never before the
 * first complete month the linked checking and savings records cover. Each month
 * names the linked checking or savings accounts whose records do not cover all of
 * it (an account's record runs from its first row to the later of its last row and
 * the day a live feed vouches for — `analyst/account-records.ts` — or wherever the
 * reader said the account really began or ended, as Ask reads that word), because a
 * month with no records is not a month with no money. An account with no rows at all
 * is not part of the question (Ask's rule). Every month needs records only through
 * the day before yesterday — one daily sync's lag — so this month's zero reads
 * "None yet". Nothing here says money did not move: a zero is "nothing matched".
 */
import {
  addDays,
  addMonthsToMonthKey,
  compareDates,
  daysBetween,
  isoDate,
  monthKey,
  monthWindow,
  type ISODate,
} from '@/lib/dates';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { REVERSAL_RE } from '@/lib/engine/spending-plan/bonus';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { brokerageOfAccount, brokeragesNamedIn, type Brokerage } from './brokerages';

/** Accounts money is put in FROM. */
export const DEPOSIT_SOURCE_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS']);
/** Accounts whose rows can RECEIVE the other half of a move between the reader's own accounts. */
export const COUNTERPART_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS', 'CREDIT']);
/** The filings that say "this money moved", rather than "this money was spent or earned". */
export const DEPOSIT_CATEGORY_IDS: ReadonlySet<string> = new Set(['transfer', 'investment']);
/** Filings a counterpart may carry and still be evidence of a move. */
const MOVE_CATEGORY_IDS: ReadonlySet<string> = new Set(['transfer', 'investment', 'credit-card-payment']);
/** How far apart the two legs of one move between the reader's own accounts may post. */
export const COUNTERPART_WINDOW_DAYS = 7;
/** How long after a deposit money coming back cancels it. */
export const RETURN_WINDOW_DAYS = 14;
/** Complete months shown before this month. */
export const HISTORY_MONTHS = 12;
/** Below this, a deposit is an account-verification test amount, not money put in. */
export const MIN_DEPOSIT_CENTS = 100;
/**
 * Words that make a brokerage-named row a payment to (or a refund or payout from) the
 * brokerage itself — a fee, a bill, a loan or mortgage, an insurance premium, a
 * membership, a card payment, a rebate — not money put in or taken out of investing.
 */
const NOT_A_DEPOSIT_RE =
  /\b(FEES?|MEMBERSHIP|SUBSCRIPTION|CARD PAYMENT|CARD PMT|CREDIT CARD|VISA|MASTERCARD|AMEX|INTEREST|ADVISORY|LOANS?|MORTGAGE|MTG|LENDING|INSURANCE|INS|PREMIUM|REBATE|REFUND|CASH ?BACK|ROBINHOOD GOLD|COINBASE ONE)\b/i;
/** Person-to-person payments: a brokerage's name in one is a person's name. */
const P2P_RE = /\b(ZELLE|VENMO|CASH ?APP|SQUARE CASH|APPLE CASH)\b/i;

/** The word that makes a brokerage-named row a payment to or from the brokerage itself, else null. */
export function notADepositWord(descriptor: string): string | null {
  const m = NOT_A_DEPOSIT_RE.exec(descriptor);
  return m ? m[1]!.toUpperCase() : null;
}

const isUnfiled = (categoryId: string | null | undefined) => !categoryId || categoryId === 'uncategorized';
/** Income leaves that are a merchant's or the government's money back, never a deposit's. */
const REFUND_CATEGORY_IDS: ReadonlySet<string> = new Set(['refund', 'reimbursement', 'tax-refund']);
/**
 * Filings under which money worded as a return can be a deposit coming back: not filed,
 * filed as a move, or filed as income other than a refund (the bonus engine's netting
 * rule). Anything else is the reader's word that it was something else.
 */
const mayBeADepositReturn = (categoryId: string | null | undefined) =>
  isUnfiled(categoryId) ||
  DEPOSIT_CATEGORY_IDS.has(categoryId!) ||
  (CATEGORY_BY_ID.get(categoryId!)?.group === 'Income' && !REFUND_CATEGORY_IDS.has(categoryId!));

export interface DepositRow {
  id: string;
  accountId: string;
  date: string;
  /** Signed: a bank outflow is negative. */
  amountCents: number;
  rawDescriptor: string;
  status: string;
  categoryId?: string | null;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  excludeFromTotals?: boolean | null;
}

export interface DepositAccount {
  id: string;
  /** CHECKING | SAVINGS | CREDIT | INVESTMENT | LOAN | … */
  type: string;
  /** The name the reader sees (their own name when set). */
  label: string;
  mask: string | null;
  /** The connection's institution name, when known. */
  institutionName: string | null;
  /** The feed's own account name — read for a brokerage only when no institution is known. */
  feedName: string;
  /** The day a live feed vouches the record complete through (`accountRecords`), else null. */
  completeThrough?: string | null;
  /**
   * The reader's word (Ask, #781) that the account really BEGAN on this date — it counts
   * only while it is still the record's first row, exactly as Ask reads it.
   */
  beganOn?: string | null;
  /** The reader's word that the account really ENDED on this date (its last row). */
  endedOn?: string | null;
}

export interface DepositHistoryInput {
  today: ISODate;
  /** Register rows (bank and card accounts), the reconciliation boundary already applied. */
  rows: readonly DepositRow[];
  /** LIVE accounts only — a superseded predecessor is read through `terminalOf`. */
  accounts: readonly DepositAccount[];
  /** Predecessor → live successor; absent = every account is its own. */
  terminalOf?: ReadonlyMap<string, string>;
  /**
   * The combined accounts' released handover days (`handoverDatesFromKeys`). The boundary
   * keeps BOTH copies' rows on such a day, so one real deposit can arrive twice — once
   * from each copy. Per real account, day and amount the copy reporting MORE rows is kept
   * and the other dropped: two copies of one record report the same movements, and the
   * larger report is the one that missed none.
   */
  handoverDates?: ReadonlySet<string>;
  /** Narrow to one investment account. */
  scopeAccountId?: string;
}

/** 'in' = put into investing (a bank outflow); 'out' = taken out (a bank inflow). */
export type DepositDirection = 'in' | 'out';

export interface DepositDestination {
  /** An account id, or `brokerage:<key>`. */
  key: string;
  /** 'account': placed by its last four. 'brokerage': placed by the firm's name only. */
  kind: 'account' | 'brokerage';
  /** The account itself, or every linked investment account at the brokerage. */
  accountIds: readonly string[];
  accountLabels: readonly string[];
  /** The brokerage, when known. */
  brokerageName: string | null;
}

export interface DepositEvent {
  rowId: string;
  date: ISODate;
  month: string;
  sourceAccountId: string;
  sourceLabel: string;
  descriptor: string;
  direction: DepositDirection;
  /** Always positive. */
  cents: number;
  destinationKey: string;
}

export type UncountedReason =
  /** Names a brokerage where no investment account is linked. */
  | 'not-linked'
  /** Names a destination but is not filed yet. */
  | 'not-filed'
  /** Names a brokerage beside a fee, bill, loan, insurance, membership, card-payment, rebate or refund word. */
  | 'not-a-deposit'
  /** Money moved back within two weeks. */
  | 'returned'
  /** Its last four belong to more than one linked account. */
  | 'shared-last-four'
  /** Its last four name one of the reader's bank or card accounts AND an investment account. */
  | 'names-two-accounts'
  /** It names two brokerages. */
  | 'two-brokerages'
  /** Its last four point to one brokerage, its words name another. */
  | 'last-four-vs-name'
  /** The reader's bank or card account at that brokerage can't rule it out. */
  | 'same-brokerage-account'
  /** As above, but less than a week old. */
  | 'too-new'
  /** An equal amount arrived in (or left) another of the reader's own accounts. */
  | 'landed-in-your-account'
  /** Filed Investment & Savings, but the description names no account or brokerage. */
  | 'no-account-named';

export interface UncountedRow {
  rowId: string;
  date: ISODate;
  month: string;
  sourceAccountId: string;
  sourceLabel: string;
  descriptor: string;
  direction: DepositDirection;
  cents: number;
  reason: UncountedReason;
  brokerageName: string | null;
  /** 'two-brokerages' / 'last-four-vs-name': the other brokerage named. */
  otherBrokerageName: string | null;
  /** The investment accounts the row could have gone to (empty when none is linked). */
  destinationAccountIds: readonly string[];
  /** Their labels, in the same order. */
  destinationLabels: readonly string[];
  /** True when the row was placed by an account's last four (not only by a brokerage's name). */
  byLastFour: boolean;
  /**
   * 'landed-in-your-account': the account the other half sits on. 'same-brokerage-account'
   * / 'too-new': that account. 'names-two-accounts': the bank or card account named.
   */
  otherAccountLabel: string | null;
  /** 'returned': the day the money moved back. */
  returnedOn: ISODate | null;
  /** 'not-a-deposit': the word that made it a payment to or from the brokerage itself. */
  matchedWord: string | null;
}

export interface DepositMonth {
  month: string;
  /** True for this month (so far). */
  partial: boolean;
  putInCents: number;
  takenOutCents: number;
  events: readonly DepositEvent[];
  /** Rows this month listed under "Not counted". */
  uncountedCount: number;
  /** Linked checking or savings accounts whose records do not cover all of this month. */
  missingRecordsFrom: readonly string[];
  /** The same accounts, with where their records start (after the month began) or end (before it ended). */
  missingRecordsDetail: readonly { label: string; startsOn: ISODate | null; endsOn: ISODate | null }[];
}

export interface DepositHistory {
  /** At least one live CHECKING or SAVINGS account. */
  hasSourceAccounts: boolean;
  hasInvestmentAccounts: boolean;
  /** The first complete month the linked checking and savings records cover; null = none. */
  recordsFromMonth: string | null;
  /** Oldest → newest; the last one is this month so far. Empty when no month is covered. */
  months: readonly DepositMonth[];
  /** This calendar year, from January or the first covered month, whichever is later. */
  thisYear: { fromMonth: string; putInCents: number; takenOutCents: number; monthsMissingRecords: number } | null;
  /** Totals over every month shown, per destination (largest put in first). */
  destinations: readonly { destination: DepositDestination; putInCents: number; takenOutCents: number }[];
  uncounted: readonly UncountedRow[];
  /** Linked investment accounts with no brokerage we know: matched only by their last four digits. */
  lastFourOnly: readonly string[];
  /** Linked investment accounts with no brokerage we know AND no usable last four: never matched. */
  unmatchable: readonly string[];
  /** The account the history is narrowed to, when it is. */
  scope: {
    accountId: string;
    label: string;
    /**
     * Money matched only by the name of this account's brokerage — it may or may not be
     * this account's. `accountsThere` is how many linked investment accounts that firm has.
     */
    byBrokerageName: { brokerageName: string; accountsThere: number; putInCents: number; takenOutCents: number } | null;
  } | null;
}

const MASK_MARKER = String.raw`(?:X+|\*+|\.{2,}|ENDING(?: +IN)? +|ACC(?:OUN)?T(?: *(?:NO\.?|#))? *)`;

function usableMask(mask: string | null): string | null {
  const m = mask?.trim() ?? '';
  return m.length >= 4 && /^[A-Za-z0-9]+$/.test(m) ? m.toUpperCase() : null;
}

const maskPatterns = new Map<string, RegExp>();

/** Does the description carry these last four after a mask marker? */
export function descriptorCarriesMask(descriptor: string, mask: string | null): boolean {
  const m = usableMask(mask);
  if (!m) return false;
  let re = maskPatterns.get(m);
  if (!re) {
    re = new RegExp(String.raw`(?:^|[^A-Z0-9])${MASK_MARKER}${m}(?![A-Z0-9])`, 'i');
    maskPatterns.set(m, re);
  }
  return re.test(descriptor);
}

interface Live {
  row: DepositRow;
  account: DepositAccount;
  date: ISODate;
}

/**
 * On a handover day, per (real account, day, amount), keep the rows of the copy that
 * reported the most and drop the other copy's: a multiset union, not a sum. A tie
 * keeps the live account's own copy.
 */
function collapseHandoverCopies(live: readonly Live[], handoverDates: ReadonlySet<string>): Live[] {
  if (handoverDates.size === 0) return [...live];
  const groups = new Map<string, Map<string, Live[]>>();
  const out: Live[] = [];
  for (const x of live) {
    if (!handoverDates.has(x.date)) {
      out.push(x);
      continue;
    }
    const key = `${x.account.id}|${x.date}|${x.row.amountCents}`;
    const byCopy = groups.get(key) ?? new Map<string, Live[]>();
    const list = byCopy.get(x.row.accountId) ?? [];
    list.push(x);
    byCopy.set(x.row.accountId, list);
    groups.set(key, byCopy);
  }
  for (const byCopy of groups.values()) {
    const ranked = [...byCopy.entries()].sort(([copyA, a], [copyB, b]) => {
      if (a.length !== b.length) return b.length - a.length;
      const liveId = a[0]!.account.id;
      if ((copyA === liveId) !== (copyB === liveId)) return copyA === liveId ? -1 : 1;
      return copyA < copyB ? -1 : 1;
    });
    out.push(...ranked[0]![1]);
  }
  return out;
}

interface PairRow {
  id: string;
  account: string;
  date: ISODate;
  amountCents: number;
  /** Names an investment destination (a bank row only). */
  names: boolean;
  /** Placed by an investment account's last four. */
  masked: boolean;
  /** On a card account. */
  card: boolean;
}

/**
 * One-to-one pairing of equal, opposite rows on two different accounts within the
 * window. Edges between two rows that name no investment destination pair first (an
 * ordinary move claims its own other half before a deposit can lose it), then closest
 * dates, then earlier dates and ids. Two rows that BOTH name an investment destination
 * are two movements, never one; a row placed by its last four never pairs with a card.
 * Returns row id → the other row's account id.
 */
function pairOwnAccountMoves(rows: readonly PairRow[]): Map<string, string> {
  const byAmount = new Map<number, PairRow[]>();
  for (const r of rows) {
    const list = byAmount.get(Math.abs(r.amountCents)) ?? [];
    list.push(r);
    byAmount.set(Math.abs(r.amountCents), list);
  }
  const edges: { out: PairRow; inn: PairRow; gap: number; naming: number }[] = [];
  for (const group of byAmount.values()) {
    for (const out of group) {
      if (out.amountCents >= 0) continue;
      for (const inn of group) {
        if (inn.amountCents <= 0 || inn.account === out.account) continue;
        if (out.names && inn.names) continue;
        if ((out.masked && inn.card) || (inn.masked && out.card)) continue;
        const gap = Math.abs(daysBetween(out.date, inn.date));
        if (gap <= COUNTERPART_WINDOW_DAYS) edges.push({ out, inn, gap, naming: (out.names ? 1 : 0) + (inn.names ? 1 : 0) });
      }
    }
  }
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  edges.sort(
    (a, b) =>
      a.naming - b.naming ||
      a.gap - b.gap ||
      compareDates(a.out.date, b.out.date) ||
      byId(a.out.id, b.out.id) ||
      byId(a.inn.id, b.inn.id),
  );
  const partner = new Map<string, string>();
  for (const { out, inn } of edges) {
    if (partner.has(out.id) || partner.has(inn.id)) continue;
    partner.set(out.id, inn.account);
    partner.set(inn.id, out.account);
  }
  return partner;
}

type Placement =
  | { kind: 'placed'; destination: DepositDestination; brokerage: Brokerage | null }
  | {
      kind: 'uncounted';
      reason: UncountedReason;
      brokerage: Brokerage | null;
      other?: Brokerage | null;
      accountIds: readonly string[];
      byLastFour: boolean;
      otherAccountLabel?: string | null;
      matchedWord?: string | null;
    }
  | { kind: 'ignore' };

export function computeDepositHistory(input: DepositHistoryInput): DepositHistory {
  const today = isoDate(input.today);
  const currentMonth = monthKey(today);
  const terminal = (id: string) => input.terminalOf?.get(id) ?? id;
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const investment = input.accounts.filter((a) => a.type === 'INVESTMENT');
  const sources = input.accounts.filter((a) => DEPOSIT_SOURCE_TYPES.has(a.type));
  const brokerageOf = new Map(input.accounts.map((a) => [a.id, brokerageOfAccount(a.institutionName, a.feedName)]));
  const labelOf = (id: string) => accountById.get(id)?.label ?? id;

  // Every register row on a live account, read through its terminal successor, one copy
  // per real movement on a handover day.
  const live = collapseHandoverCopies(
    input.rows
      .map((r) => ({ row: r, account: accountById.get(terminal(r.accountId)) }))
      .filter((x): x is { row: DepositRow; account: DepositAccount } => x.account !== undefined)
      .map((x) => ({ ...x, date: isoDate(x.row.date) })),
    input.handoverDates ?? new Set<string>(),
  );

  // Each account's record: its first row → the later of its last row and the day a live
  // feed vouches for. A row after today proves nothing yet.
  const span = new Map<string, { first: ISODate; last: ISODate }>();
  for (const { account, date } of live) {
    if (compareDates(date, today) > 0) continue;
    const s = span.get(account.id);
    if (!s) span.set(account.id, { first: date, last: date });
    else {
      if (compareDates(date, s.first) < 0) s.first = date;
      if (compareDates(date, s.last) > 0) s.last = date;
    }
  }
  // A combined account's record is trimmed by the boundary, and Ask takes no word on a trimmed
  // lineage (`same-account.ts`): neither does this.
  const combined = new Set(input.terminalOf ? [...input.terminalOf.values()] : []);
  const recordsOf = (a: DepositAccount): { from: ISODate; through: ISODate; began: boolean; ended: boolean } | null => {
    const s = span.get(a.id);
    if (!s) return null;
    let through = s.last;
    if (a.completeThrough) {
      // Every coverage question ends before today, so a date past today needs no cap.
      const vouched = isoDate(a.completeThrough);
      if (compareDates(vouched, through) > 0) through = vouched;
    }
    // The reader's word counts only while it still names the record's own edge (Ask's rule).
    const began = !combined.has(a.id) && !!a.beganOn && a.beganOn === s.first;
    const ended = !combined.has(a.id) && !!a.endedOn && a.endedOn === s.last;
    return { from: s.first, through, began, ended };
  };
  const covers = (a: DepositAccount, from: ISODate, to: ISODate) => {
    const r = recordsOf(a);
    if (r === null) return false;
    // Before an account really began, or after it really ended, there was nothing to miss.
    const startOk = compareDates(r.from, from) <= 0 || r.began;
    const endOk = compareDates(r.through, to) >= 0 || r.ended;
    return startOk && endOk;
  };

  let earliest: ISODate | null = null;
  for (const a of sources) {
    const r = recordsOf(a);
    if (r && (!earliest || compareDates(r.from, earliest) < 0)) earliest = r.from;
  }
  const recordsFromMonth =
    earliest === null ? null : earliest.endsWith('-01') ? monthKey(earliest) : addMonthsToMonthKey(monthKey(earliest), 1);
  const oldestShown = addMonthsToMonthKey(currentMonth, -HISTORY_MONTHS);
  const startMonth =
    recordsFromMonth === null || recordsFromMonth > currentMonth
      ? null
      : recordsFromMonth > oldestShown
        ? recordsFromMonth
        : oldestShown;
  const windowStart = startMonth === null ? null : isoDate(`${startMonth}-01`);

  // What a row's description names: investment accounts by last four, the reader's other
  // accounts by last four (never the row's own account), and brokerages by name (never in a
  // person-to-person payment, where a brokerage's name is a person's).
  const evidence = new Map<string, { inv: DepositAccount[]; own: DepositAccount[]; named: Brokerage[] }>();
  const evidenceOf = (x: Live) => {
    let e = evidence.get(x.row.id);
    if (!e) {
      const d = x.row.rawDescriptor ?? '';
      e = {
        inv: investment.filter((a) => descriptorCarriesMask(d, a.mask)),
        own: input.accounts.filter((a) => a.type !== 'INVESTMENT' && a.id !== x.account.id && descriptorCarriesMask(d, a.mask)),
        named: P2P_RE.test(d) ? [] : brokeragesNamedIn(d),
      };
      evidence.set(x.row.id, e);
    }
    return e;
  };
  const namesDestination = (x: Live) => {
    const e = evidenceOf(x);
    return e.inv.length > 0 || e.named.length > 0;
  };
  /** Every destination a row names: investment accounts by last four, and brokerages (by name or by those accounts). */
  const destinationTokens = (x: Live) => {
    const e = evidenceOf(x);
    const t = new Set<string>();
    for (const a of e.inv) {
      t.add(`acct:${a.id}`);
      const b = brokerageOf.get(a.id);
      if (b) t.add(`brk:${b.key}`);
    }
    for (const b of e.named) t.add(`brk:${b.key}`);
    return t;
  };
  const countable = (x: Live) =>
    x.row.status === 'POSTED' &&
    !x.row.isSplitParent &&
    !isExcludedFromTotals(x.row) &&
    x.row.amountCents !== 0 &&
    compareDates(x.date, today) <= 0;
  const filedAsMove = (x: Live) => isUnfiled(x.row.categoryId) || DEPOSIT_CATEGORY_IDS.has(x.row.categoryId!);
  const bigEnough = (x: Live) => Math.abs(x.row.amountCents) >= MIN_DEPOSIT_CENTS;
  const isCandidate = (x: Live) =>
    DEPOSIT_SOURCE_TYPES.has(x.account.type) && countable(x) && bigEnough(x) && filedAsMove(x) && namesDestination(x);

  // Returns: money moving the other way on the same account within two weeks, same amount,
  // naming the same destination — or not filed and worded as a reversal or return. One to
  // one, closest first. A deposit up to two weeks before the window still claims its return.
  const returnedOn = new Map<string, ISODate>();
  const consumedReturns = new Set<string>();
  if (windowStart !== null) {
    const reachBack = addDays(windowStart, -RETURN_WINDOW_DAYS);
    const candidates = live.filter((x) => isCandidate(x) && compareDates(x.date, reachBack) >= 0);
    const backs = live.filter((x) => DEPOSIT_SOURCE_TYPES.has(x.account.type) && countable(x));
    const pairs: { orig: Live; back: Live; gap: number }[] = [];
    for (const orig of candidates) {
      const tokens = destinationTokens(orig);
      for (const back of backs) {
        if (back.row.id === orig.row.id || back.account.id !== orig.account.id) continue;
        if (back.row.amountCents !== -orig.row.amountCents) continue;
        const gap = daysBetween(orig.date, back.date);
        if (gap < 0 || gap > RETURN_WINDOW_DAYS) continue;
        const sameDestination = [...destinationTokens(back)].some((t) => tokens.has(t));
        // Worded as a return and filed where a deposit's return can sit — unfiled, as a move, or
        // as income other than a refund (a categorizer files "ONLINE TRANSFER RETURN" Transfer).
        // A store refund filed Shopping or Refund is the reader's word that it is not this.
        const wordedReturn = REVERSAL_RE.test(back.row.rawDescriptor ?? '') && mayBeADepositReturn(back.row.categoryId);
        if (!sameDestination && !wordedReturn) continue;
        // Money that moved back must not be a fresh movement of its own the other way: a
        // destination-naming row filed as a move is a withdrawal, unless worded as a return.
        if (sameDestination && !isUnfiled(back.row.categoryId) && !REVERSAL_RE.test(back.row.rawDescriptor ?? '')) continue;
        pairs.push({ orig, back, gap });
      }
    }
    const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    pairs.sort(
      (a, b) =>
        a.gap - b.gap ||
        compareDates(a.orig.date, b.orig.date) ||
        byId(a.orig.row.id, b.orig.row.id) ||
        byId(a.back.row.id, b.back.row.id),
    );
    const used = new Set<string>();
    for (const { orig, back } of pairs) {
      if (used.has(orig.row.id) || used.has(back.row.id)) continue;
      used.add(orig.row.id);
      used.add(back.row.id);
      returnedOn.set(orig.row.id, back.date);
      consumedReturns.add(back.row.id);
    }
  }

  // Moves between the reader's own accounts.
  const partner =
    windowStart === null
      ? new Map<string, string>()
      : pairOwnAccountMoves(
          live
            .filter((x) => {
              if (!COUNTERPART_ACCOUNT_TYPES.has(x.account.type) || !countable(x)) return false;
              if (compareDates(x.date, addDays(windowStart, -COUNTERPART_WINDOW_DAYS)) < 0) return false;
              if (returnedOn.has(x.row.id) || consumedReturns.has(x.row.id)) return false;
              const bank = DEPOSIT_SOURCE_TYPES.has(x.account.type);
              // The SENDING half of a move is a bank account: a card purchase is not one.
              if (x.row.amountCents < 0 && !bank) return false;
              const c = x.row.categoryId;
              // On a card, only a payment or a transfer is a move — an unfiled card credit is
              // as likely a refund.
              return x.row.isTransfer === true || (bank && isUnfiled(c)) || (!isUnfiled(c) && MOVE_CATEGORY_IDS.has(c!));
            })
            .map((x) => {
              const bank = DEPOSIT_SOURCE_TYPES.has(x.account.type);
              return {
                id: x.row.id,
                account: x.account.id,
                date: x.date,
                amountCents: x.row.amountCents,
                names: bank && namesDestination(x),
                masked: bank && evidenceOf(x).inv.length > 0,
                card: !bank,
              };
            }),
        );

  const destinationFor = (
    kind: 'account' | 'brokerage',
    accounts: readonly DepositAccount[],
    brokerage: Brokerage | null,
  ): DepositDestination => {
    const sorted = [...accounts].sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      key: kind === 'account' ? sorted[0]!.id : `brokerage:${brokerage!.key}`,
      kind,
      accountIds: sorted.map((a) => a.id),
      accountLabels: sorted.map((a) => a.label),
      brokerageName: brokerage?.name ?? null,
    };
  };

  const place = (x: Live): Placement => {
    const { row, account: source, date } = x;
    const e = evidenceOf(x);
    if (e.inv.length === 0 && e.named.length === 0) {
      return row.categoryId === 'investment'
        ? { kind: 'uncounted', reason: 'no-account-named', brokerage: null, accountIds: [], byLastFour: false }
        : { kind: 'ignore' };
    }

    let placed: { destination: DepositDestination; brokerage: Brokerage | null };
    if (e.inv.length > 0) {
      const hit = e.inv[0]!;
      const hitBrokerage = brokerageOf.get(hit.id) ?? null;
      const accountIds = e.inv.map((a) => a.id);
      const shared =
        e.inv.length > 1 ||
        input.accounts.some((a) => a.id !== hit.id && usableMask(a.mask) !== null && usableMask(a.mask) === usableMask(hit.mask));
      if (shared) {
        return { kind: 'uncounted', reason: 'shared-last-four', brokerage: null, accountIds, byLastFour: true };
      }
      if (e.own.length > 0) {
        return { kind: 'uncounted', reason: 'names-two-accounts', brokerage: hitBrokerage, accountIds, byLastFour: true, otherAccountLabel: e.own[0]!.label };
      }
      if (e.named.length > 1) {
        return { kind: 'uncounted', reason: 'two-brokerages', brokerage: e.named[0]!, other: e.named[1]!, accountIds, byLastFour: true };
      }
      if (e.named.length === 1 && hitBrokerage !== null && e.named[0]!.key !== hitBrokerage.key) {
        return { kind: 'uncounted', reason: 'last-four-vs-name', brokerage: hitBrokerage, other: e.named[0]!, accountIds, byLastFour: true };
      }
      placed = { destination: destinationFor('account', [hit], hitBrokerage), brokerage: hitBrokerage };
    } else {
      // The last four of one of the reader's own bank or card accounts: a move between them.
      if (e.own.length > 0) return { kind: 'ignore' };
      if (e.named.length > 1) {
        return { kind: 'uncounted', reason: 'two-brokerages', brokerage: e.named[0]!, other: e.named[1]!, accountIds: [], byLastFour: false };
      }
      const brokerage = e.named[0]!;
      const there = investment.filter((a) => brokerageOf.get(a.id)?.key === brokerage.key);
      const word = notADepositWord(row.rawDescriptor ?? '');
      if (word) {
        return { kind: 'uncounted', reason: 'not-a-deposit', brokerage, accountIds: there.map((a) => a.id), byLastFour: false, matchedWord: word };
      }
      if (there.length === 0) {
        // Money that landed in the reader's own account is a bank move that happens to
        // name a brokerage (their Schwab checking) — nothing to say about investing.
        return partner.has(row.id)
          ? { kind: 'ignore' }
          : { kind: 'uncounted', reason: 'not-linked', brokerage, accountIds: [], byLastFour: false };
      }
      placed = { destination: destinationFor('brokerage', there, brokerage), brokerage };
    }

    const accountIds = placed.destination.accountIds;
    const byLastFour = placed.destination.kind === 'account';
    if (returnedOn.has(row.id)) return { kind: 'uncounted', reason: 'returned', brokerage: placed.brokerage, accountIds, byLastFour };
    const otherId = partner.get(row.id);
    if (otherId) {
      return {
        kind: 'uncounted',
        reason: 'landed-in-your-account',
        brokerage: placed.brokerage,
        accountIds,
        byLastFour,
        otherAccountLabel: labelOf(otherId),
      };
    }

    if (placed.destination.kind === 'brokerage' && placed.brokerage) {
      const key = placed.brokerage.key;
      const banksThere = input.accounts.filter(
        (a) => a.id !== source.id && COUNTERPART_ACCOUNT_TYPES.has(a.type) && brokerageOf.get(a.id)?.key === key,
      );
      if (banksThere.length > 0) {
        const weekBefore = addDays(date, -COUNTERPART_WINDOW_DAYS);
        const weekAfter = addDays(date, COUNTERPART_WINDOW_DAYS);
        // A feed vouches through yesterday at best, so the week is over only once its last
        // day is before today.
        if (compareDates(weekAfter, today) >= 0) {
          return { kind: 'uncounted', reason: 'too-new', brokerage: placed.brokerage, accountIds, byLastFour, otherAccountLabel: banksThere[0]!.label };
        }
        const blind = banksThere.find((a) => !covers(a, weekBefore, weekAfter));
        if (blind) {
          return { kind: 'uncounted', reason: 'same-brokerage-account', brokerage: placed.brokerage, accountIds, byLastFour, otherAccountLabel: blind.label };
        }
      }
    }
    if (isUnfiled(row.categoryId)) {
      return { kind: 'uncounted', reason: 'not-filed', brokerage: placed.brokerage, accountIds, byLastFour };
    }
    return { kind: 'placed', ...placed };
  };

  // The months, and which accounts' records each one is missing.
  const months: (Omit<DepositMonth, 'events'> & { events: DepositEvent[] })[] = [];
  const monthIndex = new Map<string, number>();
  if (startMonth !== null) {
    // Every month needs records only through the day before yesterday: today is not over,
    // and the latest daily sync may not have run yet (a feed vouches through the day before
    // its last sync). An account with no rows at all is not part of the question.
    const lag = addDays(today, -2);
    const withRows = sources.filter((a) => span.has(a.id));
    for (let m = startMonth; m <= currentMonth; m = addMonthsToMonthKey(m, 1)) {
      const w = monthWindow(m);
      const need = compareDates(w.to, lag) < 0 ? w.to : lag;
      const missing = compareDates(need, w.from) < 0 ? [] : withRows.filter((a) => !covers(a, w.from, need));
      const missingRecordsDetail = missing.map((a) => {
        const r = recordsOf(a)!;
        return {
          label: a.label,
          startsOn: compareDates(r.from, w.from) > 0 ? r.from : null,
          endsOn: compareDates(r.through, need) < 0 ? r.through : null,
        };
      });
      monthIndex.set(m, months.length);
      months.push({
        month: m,
        partial: m === currentMonth,
        putInCents: 0,
        takenOutCents: 0,
        events: [],
        uncountedCount: 0,
        missingRecordsFrom: missing.map((a) => a.label),
        missingRecordsDetail,
      });
    }
  }

  const scopeAccount = input.scopeAccountId ? accountById.get(input.scopeAccountId) : undefined;
  const scope = scopeAccount && scopeAccount.type === 'INVESTMENT' ? scopeAccount : undefined;
  let byName: { brokerageName: string; accountsThere: number; putInCents: number; takenOutCents: number } | null = null;

  const destinations = new Map<string, { destination: DepositDestination; putInCents: number; takenOutCents: number }>();
  const uncounted: UncountedRow[] = [];

  if (windowStart !== null) {
    for (const x of live) {
      const { row, account, date } = x;
      if (!DEPOSIT_SOURCE_TYPES.has(account.type) || !countable(x) || !bigEnough(x) || !filedAsMove(x)) continue;
      if (compareDates(date, windowStart) < 0 || consumedReturns.has(row.id)) continue;

      const month = monthKey(date);
      const direction: DepositDirection = row.amountCents < 0 ? 'in' : 'out';
      const cents = Math.abs(row.amountCents);
      const outcome = place(x);
      if (outcome.kind === 'ignore') continue;
      if (outcome.kind === 'uncounted') {
        // Narrowed: only rows whose last four point at this account are this account's to explain.
        if (scope && !(outcome.byLastFour && outcome.accountIds.includes(scope.id))) continue;
        uncounted.push({
          rowId: row.id,
          date,
          month,
          sourceAccountId: account.id,
          sourceLabel: account.label,
          descriptor: row.rawDescriptor,
          direction,
          cents,
          reason: outcome.reason,
          brokerageName: outcome.brokerage?.name ?? null,
          otherBrokerageName: outcome.other?.name ?? null,
          destinationAccountIds: outcome.accountIds,
          destinationLabels: outcome.accountIds.map(labelOf),
          byLastFour: outcome.byLastFour,
          otherAccountLabel: outcome.otherAccountLabel ?? null,
          returnedOn: outcome.reason === 'returned' ? returnedOn.get(row.id) ?? null : null,
          matchedWord: outcome.matchedWord ?? null,
        });
        months[monthIndex.get(month)!]!.uncountedCount += 1;
        continue;
      }
      const { destination } = outcome;
      if (scope) {
        if (destination.kind === 'brokerage') {
          // A firm's name says nothing about WHICH account there — never counted as this
          // account's money, only reported beside it.
          if (destination.accountIds.includes(scope.id)) {
            byName ??= { brokerageName: destination.brokerageName ?? '', accountsThere: destination.accountIds.length, putInCents: 0, takenOutCents: 0 };
            if (direction === 'in') byName.putInCents += cents;
            else byName.takenOutCents += cents;
          }
          continue;
        }
        if (destination.key !== scope.id) continue;
      }
      const slot = months[monthIndex.get(month)!]!;
      slot.events.push({
        rowId: row.id,
        date,
        month,
        sourceAccountId: account.id,
        sourceLabel: account.label,
        descriptor: row.rawDescriptor,
        direction,
        cents,
        destinationKey: destination.key,
      });
      if (direction === 'in') slot.putInCents += cents;
      else slot.takenOutCents += cents;
      const total = destinations.get(destination.key) ?? { destination, putInCents: 0, takenOutCents: 0 };
      if (direction === 'in') total.putInCents += cents;
      else total.takenOutCents += cents;
      destinations.set(destination.key, total);
    }
  }

  const byDate = (a: { date: ISODate; rowId: string }, b: { date: ISODate; rowId: string }) =>
    compareDates(a.date, b.date) || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);
  for (const m of months) m.events.sort(byDate);
  uncounted.sort(byDate);

  const year = currentMonth.slice(0, 4);
  const thisYearFrom = startMonth === null ? null : startMonth > `${year}-01` ? startMonth : `${year}-01`;
  const thisYear =
    thisYearFrom === null
      ? null
      : months
          .filter((m) => m.month >= thisYearFrom)
          .reduce(
            (acc, m) => ({
              ...acc,
              putInCents: acc.putInCents + m.putInCents,
              takenOutCents: acc.takenOutCents + m.takenOutCents,
              monthsMissingRecords: acc.monthsMissingRecords + (m.missingRecordsFrom.length > 0 ? 1 : 0),
            }),
            { fromMonth: thisYearFrom, putInCents: 0, takenOutCents: 0, monthsMissingRecords: 0 },
          );

  return {
    hasSourceAccounts: sources.length > 0,
    hasInvestmentAccounts: investment.length > 0,
    recordsFromMonth,
    months,
    thisYear,
    destinations: [...destinations.values()].sort(
      (a, b) => b.putInCents - a.putInCents || (a.destination.key < b.destination.key ? -1 : 1),
    ),
    uncounted,
    lastFourOnly: investment.filter((a) => !brokerageOf.get(a.id) && usableMask(a.mask) !== null).map((a) => a.label),
    unmatchable: investment.filter((a) => !brokerageOf.get(a.id) && usableMask(a.mask) === null).map((a) => a.label),
    scope: scope ? { accountId: scope.id, label: scope.label, byBrokerageName: byName } : null,
  };
}
