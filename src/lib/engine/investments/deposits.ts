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
 *     from totals, and is not dated after today.
 *  2. It is filed Transfer or Investment & Savings. A row not filed yet that names
 *     a destination is listed ("file it to count it"); one filed to spending or
 *     income is the reader's word that it is something else.
 *  3. Its description places it:
 *     - the last four characters of ONE linked investment account after a mask
 *       marker (X…, *…, .., ENDING IN, ACCT) — that account; or
 *     - ONE brokerage's name (`brokerages.ts`, the categorizer's own list) where the
 *       reader links investment account(s) — the BROKERAGE, never one account there,
 *       because a name says which firm, not which account.
 *     Two brokerages, last four shared with another account, or last four and a name
 *     that disagree: not counted. Last four of one of the reader's OWN bank or card
 *     accounts: a move between their own accounts, ignored. A name beside fee, bill
 *     or card-payment words is money paid TO the brokerage, not put in: listed.
 *  4. It was not returned: money coming back to the same account within 14 days,
 *     same amount, worded as a reversal or return or not filed, cancels it (listed).
 *  5. It did not land in another of the reader's own accounts: a row that is
 *     evidence of a move — posted, not excluded, not after today, flagged as a
 *     transfer or filed Transfer / card payment / Investment & Savings or not filed,
 *     its SENDING half on checking or savings — of equal and opposite amount within
 *     7 days takes it, one to one; ordinary moves pair first, then closest dates.
 *  6. By name only, where the reader ALSO links a bank or card account at that
 *     brokerage: that account's records must cover the week around the row, and the
 *     week must be over, because only then does "no equal amount arrived there" mean
 *     anything.
 *
 * Months: the last 12 complete months and this month so far, never before the
 * first complete month the linked checking and savings records cover. Each month
 * names the linked checking or savings accounts whose records do not cover all of
 * it (an account's record runs from its first row to its last row, or to the day a
 * live feed vouches for — `analyst/account-records.ts`), because a month with no
 * records is not a month with no money.
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
/** Words that make a brokerage-named row a payment TO the brokerage, not money put in. */
const NOT_A_DEPOSIT_RE =
  /\b(FEES?|MEMBERSHIP|SUBSCRIPTION|CARD PAYMENT|CARD PMT|CREDIT CARD|VISA|MASTERCARD|AMEX|INTEREST|MARGIN|ADVISORY)\b/i;

const isUnfiled = (categoryId: string | null | undefined) => !categoryId || categoryId === 'uncategorized';

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
  /** Names a brokerage beside fee, bill or card-payment words. */
  | 'not-a-deposit'
  /** Money came back within two weeks. */
  | 'returned'
  /** Its last four belong to more than one linked account. */
  | 'shared-last-four'
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
  /** 'landed-in-your-account': the account the other half sits on. 'same-brokerage-account': that account. */
  otherAccountLabel: string | null;
  /** 'returned': the day the money came back. */
  returnedOn: ISODate | null;
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
  /** The account the history is narrowed to, when it is. */
  scope: {
    accountId: string;
    label: string;
    /** Money matched only by the name of this account's brokerage — it may or may not be this account's. */
    byBrokerageName: { brokerageName: string; putInCents: number; takenOutCents: number } | null;
  } | null;
}

const MASK_MARKER = String.raw`(?:X+|\*+|\.{2,}|ENDING(?: +IN)? +|ACC(?:OUN)?T(?: *(?:NO\.?|#))? *)`;

function usableMask(mask: string | null): string | null {
  const m = mask?.trim() ?? '';
  return m.length >= 4 && /^[A-Za-z0-9]+$/.test(m) ? m.toUpperCase() : null;
}

/** Does the description carry these last four after a mask marker? */
export function descriptorCarriesMask(descriptor: string, mask: string | null): boolean {
  const m = usableMask(mask);
  if (!m) return false;
  return new RegExp(String.raw`(?:^|[^A-Z0-9])${MASK_MARKER}${m}(?![A-Z0-9])`, 'i').test(descriptor);
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

/**
 * One-to-one pairing of equal, opposite rows on two different accounts within the
 * window. Edges between two rows that name no investment destination pair first (an
 * ordinary move claims its own other half before a deposit can lose it), then closest
 * dates, then earlier dates and ids. Returns row id → the other row's account id.
 */
function pairOwnAccountMoves(
  rows: readonly { id: string; account: string; date: ISODate; amountCents: number; names: boolean }[],
): Map<string, string> {
  type R = (typeof rows)[number];
  const byAmount = new Map<number, R[]>();
  for (const r of rows) {
    const list = byAmount.get(Math.abs(r.amountCents)) ?? [];
    list.push(r);
    byAmount.set(Math.abs(r.amountCents), list);
  }
  const edges: { out: R; inn: R; gap: number; naming: number }[] = [];
  for (const group of byAmount.values()) {
    for (const out of group) {
      if (out.amountCents >= 0) continue;
      for (const inn of group) {
        if (inn.amountCents <= 0 || inn.account === out.account) continue;
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
      otherAccountLabel?: string | null;
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
  const recordsOf = (a: DepositAccount): { from: ISODate; through: ISODate } | null => {
    const s = span.get(a.id);
    if (!s) return null;
    let through = s.last;
    if (a.completeThrough) {
      // Every coverage question ends by yesterday, so a date past today needs no cap.
      const vouched = isoDate(a.completeThrough);
      if (compareDates(vouched, through) > 0) through = vouched;
    }
    return { from: s.first, through };
  };
  const covers = (a: DepositAccount, from: ISODate, to: ISODate) => {
    const r = recordsOf(a);
    return r !== null && compareDates(r.from, from) <= 0 && compareDates(r.through, to) >= 0;
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
  // accounts by last four (never the row's own account), and brokerages by name.
  const evidence = new Map<string, { inv: DepositAccount[]; own: DepositAccount[]; named: Brokerage[] }>();
  const evidenceOf = (x: Live) => {
    let e = evidence.get(x.row.id);
    if (!e) {
      const d = x.row.rawDescriptor ?? '';
      e = {
        inv: investment.filter((a) => descriptorCarriesMask(d, a.mask)),
        own: input.accounts.filter((a) => a.type !== 'INVESTMENT' && a.id !== x.account.id && descriptorCarriesMask(d, a.mask)),
        named: brokeragesNamedIn(d),
      };
      evidence.set(x.row.id, e);
    }
    return e;
  };
  const namesDestination = (x: Live) => {
    const e = evidenceOf(x);
    return e.inv.length > 0 || e.named.length > 0;
  };
  const countable = (x: Live) =>
    x.row.status === 'POSTED' &&
    !x.row.isSplitParent &&
    !isExcludedFromTotals(x.row) &&
    x.row.amountCents !== 0 &&
    compareDates(x.date, today) <= 0;
  const filedAsMove = (x: Live) => isUnfiled(x.row.categoryId) || DEPOSIT_CATEGORY_IDS.has(x.row.categoryId!);
  const isCandidate = (x: Live) => DEPOSIT_SOURCE_TYPES.has(x.account.type) && countable(x) && filedAsMove(x) && namesDestination(x);

  // Returns: money coming back to the same account within two weeks, same amount, worded
  // as a reversal or return, or not filed. One to one, closest first.
  const returnedOn = new Map<string, ISODate>();
  const consumedReturns = new Set<string>();
  if (windowStart !== null) {
    const candidates = live.filter((x) => isCandidate(x) && compareDates(x.date, windowStart) >= 0);
    const backs = live.filter(
      (x) =>
        DEPOSIT_SOURCE_TYPES.has(x.account.type) &&
        countable(x) &&
        (REVERSAL_RE.test(x.row.rawDescriptor ?? '') || isUnfiled(x.row.categoryId)),
    );
    const pairs: { orig: Live; back: Live; gap: number }[] = [];
    for (const orig of candidates) {
      for (const back of backs) {
        if (back.row.id === orig.row.id || back.account.id !== orig.account.id) continue;
        if (back.row.amountCents !== -orig.row.amountCents) continue;
        const gap = daysBetween(orig.date, back.date);
        if (gap < 0 || gap > RETURN_WINDOW_DAYS) continue;
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
              // The SENDING half of a move is a bank account: a card purchase is not one.
              if (x.row.amountCents < 0 && !DEPOSIT_SOURCE_TYPES.has(x.account.type)) return false;
              const c = x.row.categoryId;
              return x.row.isTransfer === true || isUnfiled(c) || MOVE_CATEGORY_IDS.has(c!);
            })
            .map((x) => ({
              id: x.row.id,
              account: x.account.id,
              date: x.date,
              amountCents: x.row.amountCents,
              names: DEPOSIT_SOURCE_TYPES.has(x.account.type) && namesDestination(x),
            })),
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
        ? { kind: 'uncounted', reason: 'no-account-named', brokerage: null, accountIds: [] }
        : { kind: 'ignore' };
    }

    let placed: { destination: DepositDestination; brokerage: Brokerage | null };
    if (e.inv.length > 0) {
      const hit = e.inv[0]!;
      const hitBrokerage = brokerageOf.get(hit.id) ?? null;
      const shared =
        e.inv.length > 1 ||
        e.own.length > 0 ||
        input.accounts.some((a) => a.id !== hit.id && usableMask(a.mask) !== null && usableMask(a.mask) === usableMask(hit.mask));
      if (shared) {
        return { kind: 'uncounted', reason: 'shared-last-four', brokerage: null, accountIds: e.inv.map((a) => a.id) };
      }
      if (e.named.length > 1) {
        return { kind: 'uncounted', reason: 'two-brokerages', brokerage: e.named[0]!, other: e.named[1]!, accountIds: [hit.id] };
      }
      if (e.named.length === 1 && hitBrokerage !== null && e.named[0]!.key !== hitBrokerage.key) {
        return { kind: 'uncounted', reason: 'last-four-vs-name', brokerage: hitBrokerage, other: e.named[0]!, accountIds: [hit.id] };
      }
      placed = { destination: destinationFor('account', [hit], hitBrokerage), brokerage: hitBrokerage };
    } else {
      // The last four of one of the reader's own bank or card accounts: a move between them.
      if (e.own.length > 0) return { kind: 'ignore' };
      if (e.named.length > 1) {
        return { kind: 'uncounted', reason: 'two-brokerages', brokerage: e.named[0]!, other: e.named[1]!, accountIds: [] };
      }
      const brokerage = e.named[0]!;
      const there = investment.filter((a) => brokerageOf.get(a.id)?.key === brokerage.key);
      if (NOT_A_DEPOSIT_RE.test(row.rawDescriptor ?? '')) {
        return { kind: 'uncounted', reason: 'not-a-deposit', brokerage, accountIds: there.map((a) => a.id) };
      }
      if (there.length === 0) {
        // Money that landed in the reader's own account is a bank move that happens to
        // name a brokerage (their Schwab checking) — nothing to say about investing.
        return partner.has(row.id) ? { kind: 'ignore' } : { kind: 'uncounted', reason: 'not-linked', brokerage, accountIds: [] };
      }
      placed = { destination: destinationFor('brokerage', there, brokerage), brokerage };
    }

    const accountIds = placed.destination.accountIds;
    if (returnedOn.has(row.id)) return { kind: 'uncounted', reason: 'returned', brokerage: placed.brokerage, accountIds };
    const otherId = partner.get(row.id);
    if (otherId) {
      return {
        kind: 'uncounted',
        reason: 'landed-in-your-account',
        brokerage: placed.brokerage,
        accountIds,
        otherAccountLabel: accountById.get(otherId)?.label ?? null,
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
          return { kind: 'uncounted', reason: 'too-new', brokerage: placed.brokerage, accountIds, otherAccountLabel: banksThere[0]!.label };
        }
        const blind = banksThere.find((a) => !covers(a, weekBefore, weekAfter));
        if (blind) {
          return { kind: 'uncounted', reason: 'same-brokerage-account', brokerage: placed.brokerage, accountIds, otherAccountLabel: blind.label };
        }
      }
    }
    if (isUnfiled(row.categoryId)) {
      return { kind: 'uncounted', reason: 'not-filed', brokerage: placed.brokerage, accountIds };
    }
    return { kind: 'placed', ...placed };
  };

  // The months, and which accounts' records each one is missing.
  const months: (Omit<DepositMonth, 'events'> & { events: DepositEvent[] })[] = [];
  const monthIndex = new Map<string, number>();
  if (startMonth !== null) {
    for (let m = startMonth; m <= currentMonth; m = addMonthsToMonthKey(m, 1)) {
      const w = monthWindow(m);
      // This month needs records only through yesterday — today is not over.
      const need = m === currentMonth ? addDays(today, -1) : w.to;
      const to = compareDates(need, w.from) < 0 ? w.from : need;
      monthIndex.set(m, months.length);
      months.push({
        month: m,
        partial: m === currentMonth,
        putInCents: 0,
        takenOutCents: 0,
        events: [],
        uncountedCount: 0,
        missingRecordsFrom: sources.filter((a) => !covers(a, w.from, to)).map((a) => a.label),
      });
    }
  }

  const scopeAccount = input.scopeAccountId ? accountById.get(input.scopeAccountId) : undefined;
  const scope = scopeAccount && scopeAccount.type === 'INVESTMENT' ? scopeAccount : undefined;
  let byName: { brokerageName: string; putInCents: number; takenOutCents: number } | null = null;

  const destinations = new Map<string, { destination: DepositDestination; putInCents: number; takenOutCents: number }>();
  const uncounted: UncountedRow[] = [];

  if (windowStart !== null) {
    for (const x of live) {
      const { row, account, date } = x;
      if (!DEPOSIT_SOURCE_TYPES.has(account.type) || !countable(x) || !filedAsMove(x)) continue;
      if (compareDates(date, windowStart) < 0 || consumedReturns.has(row.id)) continue;

      const month = monthKey(date);
      const direction: DepositDirection = row.amountCents < 0 ? 'in' : 'out';
      const cents = Math.abs(row.amountCents);
      const outcome = place(x);
      if (outcome.kind === 'ignore') continue;
      if (outcome.kind === 'uncounted') {
        if (scope && !outcome.accountIds.includes(scope.id)) continue;
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
          otherAccountLabel: outcome.otherAccountLabel ?? null,
          returnedOn: outcome.reason === 'returned' ? returnedOn.get(row.id) ?? null : null,
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
            byName ??= { brokerageName: destination.brokerageName ?? '', putInCents: 0, takenOutCents: 0 };
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
    scope: scope ? { accountId: scope.id, label: scope.label, byBrokerageName: byName } : null,
  };
}
