/**
 * The POSTED half of the cash-flow calendar (TASKS K.1; owner report 2026-08-06:
 * "Calendar makes no sense. I have forward data but not trailing?").
 *
 * Pure function: groups register-basis transactions by the date they posted and
 * totals each day through the register's OWN `summarizeTransactions` — one
 * function shared with the register, so the calendar cannot disagree with it on
 * a total by construction (H.8's rule; the calendar must not become the seventh
 * reader that re-implements the register's math). The caller supplies rows that
 * already carry the register's basis and the reconciliation boundary
 * (`getPostedCalendarRows` in src/server/transactions.ts reuses the register's
 * exact where-clause and R1 keep) — this module's own job is only the
 * fact/projection boundary: the posted half describes dates on or before
 * `today`, and NOTHING after it, clamped here because that claim is this
 * module's contract, not a caller convention.
 *
 * The zero discipline is K.3's, reused: an empty month is a CLAIM, and the
 * reason is computed from the history bounds this surface holds, never asserted
 * as "nothing happened". A reason that names a date carries the date inside it
 * (discriminated union), so the copy can never reach for a bound that is not
 * there.
 */
import { type Cents, cents } from '@/lib/money';
import { type ISODate, compareDates, daysInMonth, formatISODate, isoDate } from '@/lib/dates';
import { summarizeTransactions } from '@/lib/engine/transactions/query';

/** A register-basis row, lean: exactly what the shared summarize needs, plus the posted date. */
export interface PostedTxnLike {
  date: string; // YYYY-MM-DD
  amountCents: number; // signed: outflow negative, inflow positive
  isTransfer: boolean;
  excludeFromTotals?: boolean | null;
  /**
   * True for a PENDING row (critics K.1 F-1, both independently): the bank has
   * reported it but it has not POSTED — it can be repriced or vanish. The money
   * stays in the figures (the register's summary counts pending too, and the
   * K.1 gate requires equality), but every surface that says "posted" over a
   * window holding one must say "pending" too, so the count is carried.
   */
  pending?: boolean;
  /**
   * U.24: whether this row sits on an (account, day) pair the reconciliation
   * boundary RELEASED to both sides of a combined pair (U.13). Same fact the
   * register rides on every row since U.20, and carried here for the same reason
   * `pending` is: the money stays in the figures — the R1 keep deliberately keeps
   * both copies, and the K.1 gate requires this surface to agree with the
   * register — but a surface that states a total containing one must be able to
   * say so.
   *
   * REQUIRED, unlike `pending`'s optional sibling on `TotalableTxn`. An optional
   * flag defaulting to "not released" is precisely how this surface stayed silent
   * through U.13, U.16 and U.20: every one of those slices threaded the fact
   * somewhere else while `buildPostedCalendarMonth` went on reading a default
   * nobody had to answer for. Requiring it makes the compiler ask the next
   * calendar row-builder the question rather than answering it for them.
   *
   * The unit is the (account, day) PAIR, never the bare date (U.16 critic cycle
   * 6): a released day is an ordinary shopping day on every other account the
   * reader owns. The pairing is resolved at the server boundary, which is the
   * layer that holds `accountId` — these rows are lean by design.
   */
  onHandoverDay: boolean;
}

export interface PostedCalendarDay {
  date: ISODate;
  /** Non-transfer, non-excluded inflows — the register's summary for this one day. */
  inCents: Cents;
  /** Magnitude of non-transfer, non-excluded outflows. */
  outCents: Cents;
  netCents: Cents;
  /** Rows the register would LIST for this day (transfers and excluded rows included). */
  count: number;
  /** Rows still PENDING — included in the figures, named so "posted" is not claimed over them. */
  pendingCount: number;
  /**
   * Rows that are listed but leave the money figures (critic F-6): a day where
   * $5,000 visibly moved between own accounts must not read "net $0.00" with no
   * explanation — these counts let the surface say what the zero is made of.
   */
  transferCount: number;
  excludedCount: number;
  /**
   * U.24: rows on this day the released-handover boundary kept on BOTH sides and
   * that this day's money figures are summed from. Comes off the same
   * `summarizeTransactions` call the figures do, so it can never count a row the
   * tiles do not (the U.16 critic finding: a count summed before a filter the
   * figure applies after is a disclosure about money that did not move).
   */
  countedOnHandoverDays: number;
}

/**
 * WHICH zero (K.3's lesson): only set when the posted window holds no rows.
 * - no-history: the reader has no posted rows anywhere.
 * - before-history: the whole posted window predates the oldest row we hold.
 * - after-history: the whole posted window postdates the newest row we hold —
 *   the realistic cause is a feed that stopped, so the remedy points at
 *   /accounts, never "nothing happened" (K.3 critic F-7/F-11, reused).
 * - quiet: the window sits inside history and genuinely holds nothing.
 */
export type PostedEmptyReason =
  | { kind: 'no-history' }
  | { kind: 'before-history'; historyStartsAt: ISODate }
  | { kind: 'after-history'; historyEndsAt: ISODate }
  | { kind: 'quiet' };

export interface PostedCalendarMonth {
  month: string; // YYYY-MM
  /**
   * The last date the posted half covers: min(end of month, today).
   * Null when the whole month is after today — a wholly-future month has no
   * posted half at all, and every other field is its empty value.
   */
  postedThrough: ISODate | null;
  /** Days holding at least one register row, ascending. */
  days: PostedCalendarDay[];
  totalInCents: Cents;
  totalOutCents: Cents;
  /** Rows in the posted window (register count semantics: transfers + excluded included). */
  rowCount: number;
  /** Reader-excluded rows the money figures left out (register disclosure, same direction). */
  excludedCount: number;
  /** PENDING rows in the window — in the figures, named in the copy (critic F-1). */
  pendingCount: number;
  /**
   * U.24: rows across the whole posted window that the released-handover boundary
   * kept on both sides AND the month totals above are summed from — the count the
   * month-level sentence states. Read off the month's own
   * `summarizeTransactions(rows)`, the same call `totalInCents`/`totalOutCents`
   * come from, so the sentence and the figures it qualifies can never describe
   * different row sets.
   */
  countedOnHandoverDays: number;
  /**
   * Set on the CURRENT month when the newest row we hold is older than today
   * (wiring critic F-3): the trailing blank days are not proven quiet — feeds
   * report with a lag — so the edge is named instead of silently reading as
   * "nothing happened".
   */
  edgeNote: string | null;
  /** Set ONLY when the posted window holds zero rows (and postedThrough is not null). */
  emptyReason: PostedEmptyReason | null;
  /**
   * Set when the month STARTS before the oldest row we hold but history begins
   * inside the posted window — the early days of this month are not "quiet",
   * they are before the data, and the floor is named where the gap is.
   */
  floorNote: string | null;
}

export function buildPostedCalendarMonth(params: {
  month: string; // YYYY-MM
  today: ISODate;
  /** Register-basis rows for this month's window (see getPostedCalendarRows). */
  rows: readonly PostedTxnLike[];
  /** Oldest/newest posted dates across the reader's WHOLE register (post-boundary), null when none. */
  oldestPostedDate: ISODate | null;
  newestPostedDate: ISODate | null;
}): PostedCalendarMonth {
  const { month, today, oldestPostedDate, newestPostedDate } = params;
  const year = +month.slice(0, 4);
  const mo = +month.slice(5, 7);
  const first = isoDate(`${month}-01`);
  const last = isoDate(`${month}-${String(daysInMonth(year, mo)).padStart(2, '0')}`);
  const postedThrough =
    compareDates(first, today) > 0 ? null : compareDates(last, today) <= 0 ? last : today;
  if (postedThrough === null) {
    return {
      month,
      postedThrough,
      days: [],
      totalInCents: cents(0),
      totalOutCents: cents(0),
      rowCount: 0,
      excludedCount: 0,
      pendingCount: 0,
      countedOnHandoverDays: 0,
      edgeNote: null,
      emptyReason: null,
      floorNote: null,
    };
  }

  // The fact/projection boundary: rows outside [first, postedThrough] are not this half's to
  // describe. A future-dated row (a bank's forward-dated pending charge) belongs to no posted day.
  const rows = params.rows.filter(
    (r) =>
      compareDates(isoDate(r.date), first) >= 0 && compareDates(isoDate(r.date), postedThrough) <= 0,
  );

  const byDate = new Map<string, PostedTxnLike[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const days: PostedCalendarDay[] = [...byDate.keys()].sort().map((date) => {
    const dayRows = byDate.get(date)!;
    const s = summarizeTransactions(dayRows);
    return {
      date: isoDate(date),
      inCents: s.inflowCents,
      outCents: s.outflowCents,
      netCents: s.netCents,
      count: s.count,
      pendingCount: dayRows.filter((r) => r.pending === true).length,
      transferCount: dayRows.filter((r) => r.isTransfer).length,
      excludedCount: s.excludedCount,
      countedOnHandoverDays: s.countedOnHandoverDays,
    };
  });
  const total = summarizeTransactions(rows);
  const pendingCount = rows.filter((r) => r.pending === true).length;

  let emptyReason: PostedEmptyReason | null = null;
  if (rows.length === 0) {
    emptyReason =
      oldestPostedDate === null || newestPostedDate === null
        ? { kind: 'no-history' }
        : compareDates(oldestPostedDate, postedThrough) > 0
          ? { kind: 'before-history', historyStartsAt: oldestPostedDate }
          : compareDates(first, newestPostedDate) > 0
            ? { kind: 'after-history', historyEndsAt: newestPostedDate }
            : { kind: 'quiet' };
  }

  // The floor is named where the gap is: history starts inside this month's posted window, so the
  // days before it are absent for a reason the reader can see, not silently blank. "Imported
  // data", not "your banks" (critic F-9): manual and CSV rows set these bounds too.
  const floorNote =
    oldestPostedDate !== null &&
    compareDates(first, oldestPostedDate) < 0 &&
    compareDates(oldestPostedDate, postedThrough) <= 0 &&
    rows.length > 0
      ? `Posted history here starts ${formatISODate(oldestPostedDate)} — earlier days of this month are before your imported data.`
      : null;

  // The trailing edge, named on the current month (wiring critic F-3): when the newest row we
  // hold is older than today, the days after it are blank-by-lag, not proven quiet. Hedged on
  // purpose — the reader may genuinely have spent nothing — but the bound itself is a fact.
  const edgeNote =
    compareDates(postedThrough, today) === 0 &&
    newestPostedDate !== null &&
    compareDates(newestPostedDate, today) < 0 &&
    rows.length > 0
      ? `Latest activity we hold is ${formatISODate(newestPostedDate)} — later days may simply not have arrived yet.`
      : null;

  return {
    month,
    postedThrough,
    days,
    totalInCents: total.inflowCents,
    totalOutCents: total.outflowCents,
    rowCount: total.count,
    excludedCount: total.excludedCount,
    pendingCount,
    countedOnHandoverDays: total.countedOnHandoverDays,
    edgeNote,
    emptyReason,
    floorNote,
  };
}

/**
 * The sentence for a posted window that holds nothing — computed from the reason,
 * which carries its own bound (K.3: name WHICH zero, with the date the claim
 * rests on). `showAccountsLink` marks the one reason whose realistic remedy is a
 * connection check rather than waiting.
 */
export function postedZeroCopy(reason: PostedEmptyReason): {
  sentence: string;
  showAccountsLink: boolean;
} {
  switch (reason.kind) {
    case 'no-history':
      return {
        sentence: 'Nothing recorded yet — no transactions have been imported.',
        showAccountsLink: false,
      };
    case 'before-history':
      // No "can't be reconstructed" claim (critic F-3): the register's own empty state offers
      // exactly that reconstruction (CSV import), so this sentence states the floor and stops —
      // the page appends the import remedy for users the importer accepts.
      return {
        sentence: `Nothing to show — your imported history starts ${formatISODate(reason.historyStartsAt)}.`,
        showAccountsLink: false,
      };
    case 'after-history':
      return {
        sentence: `Nothing recorded this month — your imported history ends ${formatISODate(reason.historyEndsAt)}. If a bank has stopped syncing, its connection is the place to check.`,
        showAccountsLink: true,
      };
    case 'quiet':
      // "Bank and card accounts", not "the register" (critic F-4): this page never introduces
      // that word — its own links say Activity — and the scope fact is the account types.
      return {
        sentence: 'Nothing recorded this month on your bank and card accounts.',
        showAccountsLink: false,
      };
  }
}
