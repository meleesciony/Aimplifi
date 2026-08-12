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
 * history" (critic cycle 1, F6/F9 — REVISED by K.4, DECISIONS #436): `oldest`/
 * `newest` come from the register's own pre-filter set, narrowed to spending
 * account types (#62), USD (#135), and — since K.4 — by the reader's
 * SET-DEFINING axes: account, category, unclassified. Those are the axes that
 * change WHICH ROWS EXIST; the bound that names the set they define is a lower
 * bound on every further-narrowed subset, so the window branches below stay
 * sound and the printed line is about the view being read. The MATCH axes
 * (type, class, search, merchant, reimbursement, the window itself) never move
 * the line — they select WITHIN the set, and a depth line that jumped on every
 * toggle would mislead in the other direction. K.4's defect shape (F10): a
 * reader narrowed to a card whose history starts INSIDE the chosen window got
 * the register's GLOBAL oldest printed above the empty box — both sentences
 * true, neither about the view, and the before-history branch could not fire
 * because the window's `to` sat after the global bound. First-person copy off
 * the scoped set is now sound: filtered to one card, "history here" is that
 * card's own depth.
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
  | { kind: 'merchant'; merchant: string; withOtherFilters: boolean }
  // The `?account=` axis when it names an account the register EXCLUDES BY
  // CONSTRUCTION (owner report 2026-08-11: his mortgage's row on /accounts
  // linked here and the page answered "No transactions match these filters").
  // `registerRowWhere` scopes to SPENDING_ACCOUNT_TYPES, so a LOAN / MORTGAGE /
  // INVESTMENT / other-asset filter returns zero rows whatever every other
  // control is set to — blaming "these filters" hands the reader a remedy
  // (change the controls) that cannot work. `name` and `type` arrive resolved
  // by the caller against the reader's OWN accounts; the copy layer paints the
  // type through the same label vocabulary /accounts uses.
  | { kind: 'account-not-here'; id: string; name: string; type: string }
  // `?account=` names no account of the reader's at all — a deleted account's
  // stale bookmark, another user's id, or a hand-edited URL. Nothing on the
  // page can name it, so the copy says that instead of blaming the filters.
  | { kind: 'account-unknown' }
  // `?account=` names an account the register CAN show — it simply holds no
  // rows for it (just linked and not yet synced, a balance-only feed, or a
  // manual account nobody has typed a transaction into). The dropdown lists
  // it (the filterable set comes from the Account table), so without this
  // kind the page would blame "these filters" for a zero that is about the
  // ACCOUNT's own history — the owner's mortgage report one type-class over
  // (hostile critic on this slice, finding #2). WHY the feed is empty is not
  // asserted: several causes produce this state and the module cannot tell
  // them apart.
  | { kind: 'account-empty'; name: string };

export interface RegisterEmptyInput {
  /** The #186 predicate: any register filter active. Unchanged in meaning. */
  hasFilters: boolean;
  /** The reader's chosen window, either end nullable — exactly as the URL carries it. */
  from: string | null;
  to: string | null;
  /**
   * Bounds of the register's own pre-filter set, narrowed by the SET-DEFINING
   * axes (account, category, unclassified — K.4, DECISIONS #436) — the same
   * two values the "History available from …" line is rendered from, so the
   * empty state and that line can never disagree (K.3's pair, kept together
   * by construction). Null when the set is empty.
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
  /**
   * The `?account=` axis, RESOLVED by the caller against the reader's own
   * accounts (this module cannot see the database):
   *
   * - `null` — the axis is off, or it names an in-basis account that HAS rows.
   *   Zero rows on screen then mean what the window / merchant / filter
   *   branches say they mean.
   * - `{ kind: 'not-here', … }` — the account EXISTS and is the reader's, but
   *   the register's basis excludes it. Carries the painted name (the same
   *   `accountLabel` resolution every surface renders) plus the raw type so
   *   the copy layer can label it with the shared vocabulary — and can tell a
   *   type exclusion from a currency withholding, because a spending TYPE
   *   here can only mean the currency guard excluded it (type + currency are
   *   the basis's only per-account axes).
   * - `{ kind: 'no-rows', … }` — in the basis, zero register rows.
   * - `{ kind: 'unknown' }` — no account of the reader's has this id.
   */
  accountFilter:
    | null
    | { kind: 'not-here'; id: string; name: string; type: string }
    | { kind: 'no-rows'; name: string }
    | { kind: 'unknown' };
}

export function registerEmptyReason(input: RegisterEmptyInput): RegisterEmptyReason {
  const { hasFilters } = input;
  const from = asBound(input.from);
  const to = asBound(input.to);
  const oldest = asBound(input.oldest);
  const newest = asBound(input.newest);

  // The account axis is decided FIRST, above even the inverted window: an
  // out-of-basis account defines an EMPTY SET by construction, so every other
  // branch's remedy (swap the dates, import a CSV, clear a control) is one
  // that cannot work — the exact failure the inverted-window comment below
  // describes, one level up. With such a filter the scoped bounds are null and
  // the window branches would fall through to 'filters' anyway; naming the
  // account is the difference between a cause and a shrug.
  if (input.accountFilter !== null) {
    if (input.accountFilter.kind === 'unknown') return { kind: 'account-unknown' };
    if (input.accountFilter.kind === 'no-rows') {
      // In the basis but historyless: still decided above the window branches,
      // because the account-scoped bounds are null here (K.4 scoping), so no
      // window branch could fire — and a date remedy cannot conjure rows an
      // account has never delivered.
      return { kind: 'account-empty', name: input.accountFilter.name };
    }
    const { id, name, type } = input.accountFilter;
    return { kind: 'account-not-here', id, name, type };
  }

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

  // A window that ENDS before the first row the view holds. Sound under every
  // MATCH-axis narrowing: the scoped oldest is a lower bound on every
  // further-narrowed subset's oldest (the SET-DEFINING axes already moved the
  // bound themselves), so `to < oldest` means `to` precedes every row any
  // remaining narrowing could have shown.
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

/**
 * True when the reason is one the ACCOUNT AXIS explains — the same F2 rule as
 * `isWindowExplainedZero`, extended to the account kinds (hostile critic on
 * the U.3 slice, finding #7): the "$0.00 × 3 / 0 transactions" strip renders
 * above the empty box, and for these zeros the count line must say the set is
 * about the account, not leave the tiles implying a sum that came up empty.
 */
export function isAccountExplainedZero(reason: RegisterEmptyReason): boolean {
  return reason.kind === 'account-not-here' || reason.kind === 'account-unknown' || reason.kind === 'account-empty';
}
