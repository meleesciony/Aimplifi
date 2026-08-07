/**
 * WHICH zero the register is printing (owner report 2026-08-06).
 *
 * The owner set a custom window of Aug 6 2024 → Aug 6 2025 on a register whose
 * history starts Mar 25 2026, and the page answered "No transactions match these
 * filters." — while printing "History available from Wed, Mar 25, 2026" four
 * lines above it. Both sentences were true and the pair reads as a broken app:
 * one blames the filters, the other holds the actual reason, and nothing joins
 * them. His conclusion was "we have no trailing data in transactions", which is
 * correct about the DATA and was indistinguishable, on that screen, from a
 * filter that had simply matched nothing.
 *
 * So this is the `a-zero-is-a-claim-and-must-name-which-zero` lesson on the
 * register: several different facts rendered as one sentence about filters. The
 * window cases are the certain ones — decided by comparing the reader's own
 * dates against the bounds of the set the register itself loaded — so they are
 * tested first, and everything else falls through to the pre-existing #186
 * branch unchanged.
 *
 * SCOPE, and why the copy built from this says "history here" rather than "your
 * history" (critic cycle 1, F6/F9): `oldest`/`newest` come from the register's
 * own pre-filter set, which is narrowed to spending account types (#62) and USD
 * (#135), and is NOT re-narrowed by the reader's account/category filter. A
 * first-person claim off that set would tell a reader filtered to one card when
 * "your" history starts using a date from an account they filtered away, and
 * would tell a reader with a CAD card about a set that excludes it.
 *
 * SECOND owner report, 2026-08-07, same sentence and a different zero behind
 * it: "still not showing up" — a register reading 0 transactions / $0.00 with
 * the type, account, category, class and period controls ALL on their defaults,
 * the search box empty, and "History available from Wed, Mar 25, 2026" above
 * it. The one thing on that screen that could not happen without a filter was
 * the "Clear" link, which renders on the same predicate as the "Showing a
 * filtered slice" copy. Only ONE axis can be active while every control reads
 * its default: `?merchant=`, which had no control at all. So the register was
 * filtered to a merchant name, the page said the filters were to blame, and no
 * filter was visible to blame. This module now names that axis, and the bar
 * renders a chip for it — the fence `links.ts` predicted would be needed.
 *
 * Deliberately NOT a suggestion engine: it names the fact and stops. Which
 * remedy (if any) is offered is the caller's decision, because availability is
 * the caller's knowledge — the CSV import is refused for the shared demo user,
 * and this module cannot see that.
 */
import { compareDates, isoDate, type ISODate } from '@/lib/dates';

/**
 * A date bound, or null if it is not one.
 *
 * `from`/`to` reach this function from the URL. The EMPTY STRING is the live
 * case and the reason this exists: the page reads `str(sp.to)`, which is `''`
 * when the param is absent, and `isoDate('')` throws — so a bare cast here
 * would have thrown /transactions on every unfiltered load.
 *
 * A MALFORMED bound (`?to=banana`) is defence in depth rather than the live
 * path, and the distinction is worth stating precisely because an earlier
 * version of this comment got it wrong (critic cycle 1, F5): `filterTransactions`
 * casts the same value with an unguarded `isoDate` and runs FIRST, so a
 * malformed bound used to 500 the route before ever arriving here. The page now
 * drops an unparseable bound before building the filter, which is what makes
 * this branch reachable at all; keeping it total means the two validation sites
 * can never disagree about what counts as a date.
 */
function asBound(value: string | null): ISODate | null {
  if (value === null || value === '') return null;
  try {
    return isoDate(value);
  } catch {
    return null;
  }
}

/**
 * Why the register has nothing to show. `filters` and `no-rows-yet` are the two
 * pre-existing outcomes (#186) named rather than left as a boolean; the three
 * window kinds are new, and each carries BOTH dates it compared so the copy can
 * state the comparison instead of asserting a bare bound.
 */
export type RegisterEmptyReason =
  | { kind: 'no-rows-yet' }
  | { kind: 'filters' }
  | { kind: 'inverted-window'; from: ISODate; to: ISODate }
  | { kind: 'before-history'; oldest: ISODate; to: ISODate }
  | { kind: 'after-history'; newest: ISODate; from: ISODate }
  // The merchant axis, named because it is the one filter the reader cannot
  // see (owner report 2026-08-07, below). `withOtherFilters` keeps the copy
  // honest when the merchant is not the only narrowing in play: with a
  // category and a type also set, "nothing matches X" would assert a cause
  // this function did not establish.
  | { kind: 'merchant'; merchant: string; withOtherFilters: boolean };

export interface RegisterEmptyInput {
  /** The #186 predicate: any register filter active. Unchanged in meaning. */
  hasFilters: boolean;
  /** The reader's chosen window, either end nullable — exactly as the URL carries it. */
  from: string | null;
  to: string | null;
  /**
   * Bounds of the register's own FULL pre-filter set — the same two values the
   * "History available from …" line is rendered from, so the empty state and
   * that line can never disagree. Null when the set is empty.
   */
  oldest: string | null;
  newest: string | null;
  /**
   * The `?merchant=` axis, exactly as the URL carries it. Null or '' when off.
   *
   * Owner report 2026-08-07: a register with every visible control on its
   * default, a "Clear" link, and "No transactions match these filters" printed
   * over "History available from Wed, Mar 25, 2026" — data present, zero shown,
   * and nothing on the page naming what was narrowing it. `merchant` is an
   * EXACT case-insensitive match on the register's display name (query.ts:265)
   * reachable from a dozen surfaces, so a name no row carries returns zero
   * forever — and until this slice it was the ONE axis the filter bar rendered
   * no control for (the gap `links.ts` had already written down and queued).
   */
  merchant: string | null;
  /**
   * Whether any NON-merchant axis is also active. Kept separate from
   * `hasFilters` because it is the only thing that decides whether the merchant
   * sentence may stand alone as the cause.
   */
  otherFilters: boolean;
}

export function registerEmptyReason(input: RegisterEmptyInput): RegisterEmptyReason {
  const { hasFilters } = input;
  const from = asBound(input.from);
  const to = asBound(input.to);
  const oldest = asBound(input.oldest);
  const newest = asBound(input.newest);

  // A window that ends before it starts holds nothing WHATEVER the data is, so
  // it is decided first and without consulting the bounds at all. Checked
  // before `before-history` because that branch would otherwise fire on it and
  // hand the reader a false cause AND a false remedy — "import a CSV to reach
  // further back" cannot help a window that is empty by construction, and the
  // reader would import the data and still see zero (critic cycle 1, F3). The
  // date inputs carry no min/max, so this is two clicks away, not exotic.
  if (from !== null && to !== null && compareDates(from, to) > 0) {
    return { kind: 'inverted-window', from, to };
  }

  // A window that ENDS before the first row we hold. Sound under every other
  // filter: the global oldest is a lower bound on every subset's oldest, so
  // `to < oldest` means `to` precedes every row any narrowing could have shown.
  if (oldest !== null && to !== null && compareDates(to, oldest) < 0) {
    return { kind: 'before-history', oldest, to };
  }

  // The mirror. Reached by a hand-typed future window, and — the realistic
  // route, and the one the copy has to survive — by a STALE FEED: a register
  // whose newest row is months old while the reader picks a current-month
  // window. (Not by a preset: none of the eight returns a `from` after today.
  // An earlier comment here claimed they did, which is why this branch shipped
  // its first version untested — critic cycle 1, F8.)
  if (newest !== null && from !== null && compareDates(from, newest) > 0) {
    return { kind: 'after-history', newest, from };
  }

  // The merchant axis, AFTER the three window branches because those are
  // decided by comparing dates against bounds the register itself loaded and
  // are true whatever else is set: a reader whose window ends before their
  // first row sees nothing for that reason even if the merchant matches
  // hundreds of rows. Below them, a merchant filter is the most specific thing
  // this function knows, and — unlike every other axis — the one the reader
  // cannot read off the page. `.trim()`, because `?merchant=` and `?merchant=%20`
  // arrive as strings that are present and narrow nothing.
  const merchant = (input.merchant ?? '').trim();
  if (merchant !== '') {
    return { kind: 'merchant', merchant, withOtherFilters: input.otherFilters };
  }

  // Everything else keeps #186's answer verbatim, INCLUDING the empty-register
  // case: with no rows at all `oldest` is null, every window branch above is
  // skipped, and a reader with a filter on still gets the filter sentence they
  // got before this function existed. Widening that is a separate decision.
  return hasFilters ? { kind: 'filters' } : { kind: 'no-rows-yet' };
}

/**
 * True when the reason is one the DATE WINDOW explains — the set whose zero has
 * to be named beside the zero itself, not only in the box below it.
 *
 * The owner's report named the `$0.00 / $0.00 / $0.00` tiles and the "0
 * transactions" line, and the first version of this slice explained the zero in
 * a box underneath all four of them (critic cycle 1, F2). The lesson's rule is
 * to say which zero it is WHERE the zero is.
 */
export function isWindowExplainedZero(reason: RegisterEmptyReason): boolean {
  return reason.kind === 'inverted-window' || reason.kind === 'before-history' || reason.kind === 'after-history';
}
