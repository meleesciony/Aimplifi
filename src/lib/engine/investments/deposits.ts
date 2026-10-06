/**
 * Money you put in — brokerage deposits read from the BANK side (DECISIONS #788).
 *
 * The owner chose this over Plaid's investment history, which would start a
 * monthly fee per linked login. So the evidence is the bank's own rows: money
 * leaving a linked checking or savings account (put in) or arriving there (taken
 * out), placed at ONE linked investment destination by what the bank's
 * description says. Pure: typed rows and accounts in, a typed history out; no
 * DB, no React, integer cents only.
 *
 * A row COUNTS only when every test below passes; a row that names a
 * destination and fails one is listed with its reason, never dropped silently
 * (docs/lessons/a-zero-is-a-claim-and-must-name-which-zero.md):
 *
 *  1. It sits on a live CHECKING or SAVINGS account (its terminal successor when
 *     a combined account), is POSTED, is not a split parent, is not excluded
 *     from totals, and is filed Transfer or Investment & Savings — the reader's
 *     filing decides what the money was.
 *  2. Its description places it at exactly one destination:
 *     - the last four characters of ONE linked investment account, written after
 *       a mask marker (X…, *…, .., #, ENDING IN, ACCT) — and no other linked
 *       account shares those four; or
 *     - ONE brokerage's name (`brokerages.ts`, the categorizer's own list) where
 *       the reader has linked investment account(s) — every account there is one
 *       destination when there are several.
 *     When both are present they must agree.
 *  3. It did not land in one of the reader's own bank or card accounts: an equal,
 *     opposite row on another linked CHECKING / SAVINGS / CREDIT account within
 *     7 days takes it, one to one, closest dates first.
 *  4. By name only, where the reader ALSO links a bank or card account at that
 *     brokerage: that account's records must cover the week around the row (and
 *     the week must be over), because only then does "no equal amount arrived
 *     there" mean anything.
 *
 * Months: the last 12 complete months and this month so far, never before the
 * first complete month the linked checking and savings records cover.
 */
import {
  addDays,
  addMonthsToMonthKey,
  compareDates,
  daysBetween,
  isoDate,
  monthKey,
  type ISODate,
} from '@/lib/dates';
import { collapseHandoverDuplicates } from '@/lib/engine/account/reconcile-boundary';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { brokerageOfAccount, brokeragesNamedIn, type Brokerage } from './brokerages';

/** Accounts money is put in FROM. */
export const DEPOSIT_SOURCE_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS']);
/** Accounts whose rows can be the other leg of a move between the reader's own accounts. */
export const COUNTERPART_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS', 'CREDIT']);
/** The filings that say "this money moved", rather than "this money was spent or earned". */
export const DEPOSIT_CATEGORY_IDS: ReadonlySet<string> = new Set(['transfer', 'investment']);
/** How far apart the two legs of one move between the reader's own accounts may post. */
export const COUNTERPART_WINDOW_DAYS = 7;
/** Complete months shown before this month. */
export const HISTORY_MONTHS = 12;

export interface DepositRow {
  id: string;
  accountId: string;
  date: string;
  /** Signed: a bank outflow is negative. */
  amountCents: number;
  rawDescriptor: string;
  status: string;
  categoryId?: string | null;
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
  /** YYYY-MM-DD the bank stopped sharing this account, else null. */
  feedDroppedAt?: string | null;
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
   * keeps BOTH copies' rows on such a day, so one real deposit can arrive twice — once from
   * the old copy and once from the new. A deposit list counts each real movement once, so
   * those copies collapse (`collapseHandoverDuplicates`: same real account, same day, same
   * amount, different copy); two rows on one copy stay two.
   */
  handoverDates?: ReadonlySet<string>;
  /** Narrow to the destinations that include this investment account. */
  scopeAccountId?: string;
}

/** 'in' = put into investing (a bank outflow); 'out' = taken out (a bank inflow). */
export type DepositDirection = 'in' | 'out';

export interface DepositDestination {
  /** One account id, or `brokerage:<key>` for every linked account at one brokerage. */
  key: string;
  accountIds: readonly string[];
  accountLabels: readonly string[];
  /** The brokerage, when the destination was placed by name or the account has one. */
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
  via: 'mask' | 'name';
}

export type UncountedReason =
  /** Names a brokerage where no investment account is linked. */
  | 'not-linked'
  /** Could be more than one account, or a bank account at the same brokerage we can't rule out. */
  | 'unclear-account'
  /** A bank account at the same brokerage may still show the other half — less than a week old. */
  | 'too-new'
  /** An equal amount arrived in (or left) another of the reader's own bank or card accounts. */
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
  /** The investment accounts the row would have gone to (empty when none is linked). */
  destinationAccountIds: readonly string[];
  /** For 'landed-in-your-account': the reader's account the other half sits on. */
  counterpartLabel: string | null;
}

export interface DepositMonth {
  month: string;
  /** True for this month (so far). */
  partial: boolean;
  putInCents: number;
  takenOutCents: number;
  events: readonly DepositEvent[];
}

export interface DepositHistory {
  hasInvestmentAccounts: boolean;
  /** The first complete month the linked checking and savings records cover; null = none. */
  recordsFromMonth: string | null;
  /** Oldest → newest; the last one is this month so far. Empty when no month is covered. */
  months: readonly DepositMonth[];
  /** This calendar year, from January or the first covered month, whichever is later. */
  thisYear: { fromMonth: string; putInCents: number; takenOutCents: number } | null;
  /** Totals over every month shown, per destination (largest put in first). */
  destinations: readonly { destination: DepositDestination; putInCents: number; takenOutCents: number }[];
  uncounted: readonly UncountedRow[];
}

const MASK_MARKER = String.raw`(?:X+|\*+|\.{2,}|# *|ENDING(?: +IN)? +|ACC(?:OUN)?T(?: *(?:NO\.?|#))? *)`;

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

interface Placed {
  destination: DepositDestination;
  via: 'mask' | 'name';
  brokerage: Brokerage | null;
}

type Placement =
  | { kind: 'placed'; placed: Placed }
  | { kind: 'uncounted'; reason: UncountedReason; brokerage: Brokerage | null; accountIds: readonly string[] }
  | { kind: 'ignore' };

/**
 * One-to-one pairing of equal, opposite rows on two different bank or card
 * accounts within the window, closest dates first (ties: earlier date, then
 * ids). Returns row id → the other row's account id. One to one on purpose: a
 * $500 transfer into savings explains ONE $500 outflow, not every one that week.
 */
function pairOwnAccountMoves(
  rows: readonly { id: string; account: string; date: ISODate; amountCents: number }[],
): Map<string, string> {
  const byAmount = new Map<number, typeof rows[number][]>();
  for (const r of rows) {
    const list = byAmount.get(Math.abs(r.amountCents)) ?? [];
    list.push(r);
    byAmount.set(Math.abs(r.amountCents), list);
  }
  const edges: { out: typeof rows[number]; inn: typeof rows[number]; gap: number }[] = [];
  for (const group of byAmount.values()) {
    for (const out of group) {
      if (out.amountCents >= 0) continue;
      for (const inn of group) {
        if (inn.amountCents <= 0 || inn.account === out.account) continue;
        const gap = Math.abs(daysBetween(out.date, inn.date));
        if (gap <= COUNTERPART_WINDOW_DAYS) edges.push({ out, inn, gap });
      }
    }
  }
  edges.sort(
    (a, b) =>
      a.gap - b.gap ||
      compareDates(a.out.date, b.out.date) ||
      (a.out.id < b.out.id ? -1 : a.out.id > b.out.id ? 1 : 0) ||
      (a.inn.id < b.inn.id ? -1 : a.inn.id > b.inn.id ? 1 : 0),
  );
  const partner = new Map<string, string>();
  for (const { out, inn } of edges) {
    if (partner.has(out.id) || partner.has(inn.id)) continue;
    partner.set(out.id, inn.account);
    partner.set(inn.id, out.account);
  }
  return partner;
}

export function computeDepositHistory(input: DepositHistoryInput): DepositHistory {
  const today = isoDate(input.today);
  const currentMonth = monthKey(today);
  const terminal = (id: string) => input.terminalOf?.get(id) ?? id;
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const investment = input.accounts.filter((a) => a.type === 'INVESTMENT');
  const brokerageOf = new Map(input.accounts.map((a) => [a.id, brokerageOfAccount(a.institutionName, a.feedName)]));

  // Every register row on a live account, read through its terminal successor — one copy
  // per real movement on a handover day.
  const rowsOnce = collapseHandoverDuplicates(input.rows, input.handoverDates ?? new Set<string>(), input.terminalOf ?? new Map());
  const live = rowsOnce
    .map((r) => ({ row: r, account: accountById.get(terminal(r.accountId)) }))
    .filter((x): x is { row: DepositRow; account: DepositAccount } => x.account !== undefined)
    .map((x) => ({ ...x, date: isoDate(x.row.date) }));

  // Where the records start: the earliest row on any live checking or savings account.
  let earliest: ISODate | null = null;
  const earliestByAccount = new Map<string, ISODate>();
  for (const { row, account, date } of live) {
    if (row.isSplitParent) continue;
    const prev = earliestByAccount.get(account.id);
    if (!prev || compareDates(date, prev) < 0) earliestByAccount.set(account.id, date);
    if (DEPOSIT_SOURCE_TYPES.has(account.type) && (!earliest || compareDates(date, earliest) < 0)) earliest = date;
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

  const partner =
    windowStart === null
      ? new Map<string, string>()
      : pairOwnAccountMoves(
          live
            .filter(
              ({ row, account, date }) =>
                COUNTERPART_ACCOUNT_TYPES.has(account.type) &&
                !row.isSplitParent &&
                row.amountCents !== 0 &&
                compareDates(date, addDays(windowStart, -COUNTERPART_WINDOW_DAYS)) >= 0,
            )
            .map(({ row, account, date }) => ({ id: row.id, account: account.id, date, amountCents: row.amountCents })),
        );

  const destinationFor = (accountIds: readonly string[], brokerage: Brokerage | null): DepositDestination => {
    const sorted = [...accountIds].sort();
    return {
      key: sorted.length === 1 ? sorted[0]! : `brokerage:${brokerage?.key ?? sorted.join('|')}`,
      accountIds: sorted,
      accountLabels: sorted.map((id) => accountById.get(id)?.label ?? id),
      brokerageName: brokerage?.name ?? (sorted.length === 1 ? brokerageOf.get(sorted[0]!)?.name ?? null : null),
    };
  };

  const place = (row: DepositRow, source: DepositAccount, date: ISODate): Placement => {
    const descriptor = row.rawDescriptor ?? '';
    const maskHits = investment.filter((a) => descriptorCarriesMask(descriptor, a.mask));
    const named = brokeragesNamedIn(descriptor);

    if (maskHits.length === 0 && named.length === 0) {
      return row.categoryId === 'investment'
        ? { kind: 'uncounted', reason: 'no-account-named', brokerage: null, accountIds: [] }
        : { kind: 'ignore' };
    }

    let placed: Placed;
    if (maskHits.length > 0) {
      if (maskHits.length > 1) {
        return { kind: 'uncounted', reason: 'unclear-account', brokerage: null, accountIds: maskHits.map((a) => a.id) };
      }
      const hit = maskHits[0]!;
      const sharedMask = input.accounts.some(
        (a) => a.id !== hit.id && usableMask(a.mask) !== null && usableMask(a.mask) === usableMask(hit.mask),
      );
      const hitBrokerage = brokerageOf.get(hit.id) ?? null;
      const disagrees = named.length > 1 || (named.length === 1 && hitBrokerage !== null && named[0]!.key !== hitBrokerage.key);
      if (sharedMask || disagrees) {
        return { kind: 'uncounted', reason: 'unclear-account', brokerage: named.length === 1 ? named[0]! : null, accountIds: [hit.id] };
      }
      placed = { destination: destinationFor([hit.id], hitBrokerage), via: 'mask', brokerage: hitBrokerage };
    } else {
      if (named.length > 1) return { kind: 'uncounted', reason: 'unclear-account', brokerage: null, accountIds: [] };
      const brokerage = named[0]!;
      const there = investment.filter((a) => brokerageOf.get(a.id)?.key === brokerage.key);
      if (there.length === 0) {
        // Money that landed in the reader's own account is a bank move that happens to
        // name a brokerage (their Schwab checking) — nothing to say about investing.
        return partner.has(row.id)
          ? { kind: 'ignore' }
          : { kind: 'uncounted', reason: 'not-linked', brokerage, accountIds: [] };
      }
      placed = { destination: destinationFor(there.map((a) => a.id), brokerage), via: 'name', brokerage };
    }

    if (partner.has(row.id)) {
      return { kind: 'uncounted', reason: 'landed-in-your-account', brokerage: placed.brokerage, accountIds: placed.destination.accountIds };
    }

    if (placed.via === 'name' && placed.brokerage) {
      const key = placed.brokerage.key;
      const banksThere = input.accounts.filter(
        (a) => a.id !== source.id && COUNTERPART_ACCOUNT_TYPES.has(a.type) && brokerageOf.get(a.id)?.key === key,
      );
      if (banksThere.length > 0) {
        const weekAfter = addDays(date, COUNTERPART_WINDOW_DAYS);
        if (compareDates(weekAfter, today) > 0) {
          return { kind: 'uncounted', reason: 'too-new', brokerage: placed.brokerage, accountIds: placed.destination.accountIds };
        }
        const weekBefore = addDays(date, -COUNTERPART_WINDOW_DAYS);
        const covered = banksThere.every((a) => {
          const first = earliestByAccount.get(a.id);
          const dropped = a.feedDroppedAt ? isoDate(a.feedDroppedAt) : null;
          return first !== undefined && compareDates(first, weekBefore) <= 0 && (dropped === null || compareDates(dropped, weekAfter) > 0);
        });
        if (!covered) {
          return { kind: 'uncounted', reason: 'unclear-account', brokerage: placed.brokerage, accountIds: placed.destination.accountIds };
        }
      }
    }
    return { kind: 'placed', placed };
  };

  const months: { month: string; partial: boolean; putInCents: number; takenOutCents: number; events: DepositEvent[] }[] = [];
  const monthIndex = new Map<string, number>();
  if (startMonth !== null) {
    for (let m = startMonth; m <= currentMonth; m = addMonthsToMonthKey(m, 1)) {
      monthIndex.set(m, months.length);
      months.push({ month: m, partial: m === currentMonth, putInCents: 0, takenOutCents: 0, events: [] });
    }
  }

  const destinations = new Map<string, { destination: DepositDestination; putInCents: number; takenOutCents: number }>();
  const uncounted: UncountedRow[] = [];
  const inScope = (accountIds: readonly string[]) =>
    input.scopeAccountId === undefined || accountIds.includes(input.scopeAccountId);

  if (windowStart !== null) {
    for (const { row, account, date } of live) {
      if (!DEPOSIT_SOURCE_TYPES.has(account.type)) continue;
      if (compareDates(date, windowStart) < 0 || compareDates(date, today) > 0) continue;
      if (row.status !== 'POSTED' || row.isSplitParent || isExcludedFromTotals(row) || row.amountCents === 0) continue;
      if (!row.categoryId || !DEPOSIT_CATEGORY_IDS.has(row.categoryId)) continue;

      const month = monthKey(date);
      const direction: DepositDirection = row.amountCents < 0 ? 'in' : 'out';
      const cents = Math.abs(row.amountCents);
      const outcome = place(row, account, date);
      if (outcome.kind === 'ignore') continue;
      if (outcome.kind === 'uncounted') {
        if (!inScope(outcome.accountIds)) continue;
        const otherId = partner.get(row.id);
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
          destinationAccountIds: outcome.accountIds,
          counterpartLabel:
            outcome.reason === 'landed-in-your-account' && otherId ? accountById.get(otherId)?.label ?? null : null,
        });
        continue;
      }
      const { destination, via } = outcome.placed;
      if (!inScope(destination.accountIds)) continue;
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
        via,
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
            (acc, m) => ({ ...acc, putInCents: acc.putInCents + m.putInCents, takenOutCents: acc.takenOutCents + m.takenOutCents }),
            { fromMonth: thisYearFrom, putInCents: 0, takenOutCents: 0 },
          );

  return {
    hasInvestmentAccounts: investment.length > 0,
    recordsFromMonth,
    months,
    thisYear,
    destinations: [...destinations.values()].sort(
      (a, b) => b.putInCents - a.putInCents || (a.destination.key < b.destination.key ? -1 : 1),
    ),
    uncounted,
  };
}
