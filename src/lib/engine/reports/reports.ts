/**
 * Reports engine (DECISIONS #67) — pure spending analytics over categorized
 * transactions. Spending = expenses only (transfers, split parents, and income
 * excluded); refunds net against their category. Rolls leaf subcategories up to
 * their parent group. Integer cents in/out, no I/O.
 */
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { isoDate, monthWindow } from '@/lib/dates';

export interface ReportTxn {
  /** Present on every real row; optional so hand-built fixtures stay terse,
   *  nullable to match the breakdown row shapes that extend this type. */
  id?: string | null;
  date: string; // YYYY-MM-DD
  amountCents: number; // signed; negative = spend
  categoryId?: string | null;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  /** O.15: reader-excluded rows leave every total via this one basis. */
  excludeFromTotals?: boolean | null;
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  group: string;
  amountCents: number;
}
export interface GroupSpend {
  group: string;
  amountCents: number;
  categories: CategorySpend[];
}
export interface SpendingBreakdown {
  totalCents: number;
  byCategory: CategorySpend[]; // sorted desc
  byGroup: GroupSpend[]; // sorted desc
}

/**
 * The window a spending figure was summed over (C.26, audit P1-28).
 *
 * `fromYm`/`toYm` are the calendar months, as they always were. `asOf` is the
 * day the figure stops counting at — present when the figure is a claim about
 * money ALREADY SPENT, absent when it is a claim about a whole calendar month.
 * Both are legitimate questions and this app asks both: /reports says "you
 * spent", /budgets tracks an allowance a later-dated commitment already
 * consumes. What is NOT legitimate is a figure whose window and whose register
 * link disagree, so this object — not a month key — is what travels to
 * `categoryWindowRegisterHref`, and `spendWindowRegisterDates` below is the one
 * place the day boundaries are derived. A caller cannot hand the figure one
 * window and the link another without constructing a second object on purpose.
 *
 * Why `asOf` is optional rather than required: making it required would force
 * every caller to answer, which is the C.13/#409 construction, but the property
 * that actually protects money here is different. The link derives from the SAME
 * object the sum used, so an omitted `asOf` cannot desynchronise a figure from
 * its destination — it can only mean "this figure covers the whole month",
 * which is exactly what /budgets means. The remaining risk (a surface that
 * should clamp and forgets) is not a type problem and is locked by server-level
 * tests over a seeded future-dated row, because that is the only thing that
 * would have caught it.
 */
export interface SpendWindow {
  fromYm: string;
  toYm: string;
  /** YYYY-MM-DD; rows dated after it are not counted. Absent = whole months. */
  asOf?: string | null;
}

/**
 * "What you have spent so far" — one month, stopping at today.
 *
 * The named author for the clamped question, so the three surfaces that ask it
 * (/reports, the dashboard's top-spending card through it, and Ask) cannot
 * phrase the window three ways. Validates `today` here rather than per row:
 * `isoDate` throws on a malformed value, so a bad date fails loudly at the
 * boundary instead of silently filtering every row out and reporting $0.00 —
 * the failure direction a plain string comparison would have taken.
 */
export function spentSoFarWindow(month: string, today: string): SpendWindow {
  return asOfWindow({ fromYm: month, toYm: month }, today);
}

/**
 * The same question over an arbitrary month range — what Ask needs, because a
 * reader's timeframe is whatever they said ("last quarter", "this month").
 *
 * `asOf` is applied unconditionally rather than only when the range reaches the
 * current month, and the two are equivalent: every row in a month already past
 * is dated on or before today, so the clamp cannot remove one. Making it
 * conditional would add a branch whose false arm is unreachable and whose true
 * arm is the same value — a dead branch is a claim that something is handled
 * (`a-dead-branch-is-a-claim-that-something-is-handled`).
 */
export function asOfWindow(range: { fromYm: string; toYm: string }, today: string): SpendWindow {
  return { fromYm: range.fromYm, toYm: range.toYm, asOf: isoDate(today) };
}

/** "What the whole month holds" — the unclamped question (/budgets, history). */
export function wholeMonthWindow(month: string): SpendWindow {
  return { fromYm: month, toYm: month };
}

/**
 * The inclusive day boundaries a register must filter on to reproduce a figure
 * summed over this window — the translation `categoryWindowRegisterHref` uses.
 *
 * `to` is the earlier of the window's last calendar day and `asOf`, because the
 * clamp only ever narrows. For any past month `asOf` is later than the month
 * end and this returns the plain month window, byte-identical to what every
 * link emitted before C.26.
 *
 * A window entirely AHEAD of `asOf` therefore returns `from > to`, and the
 * register it points at lists nothing. That is the correct destination and not
 * an oversight: a figure summed over next month with a stop-at-today rule is
 * $0.00, and an empty list is what $0.00 is made of. It is called out here
 * because a critic read the sentence above as a promise that `from <= to`
 * always holds; no caller can reach it today (Ask resolves a bare future month
 * name to the past one), and if one ever does, the empty register agrees with
 * the figure rather than contradicting it.
 */
export function spendWindowRegisterDates(w: SpendWindow): { from: string; to: string } {
  const { from } = monthWindow(w.fromYm);
  const { to } = monthWindow(w.toYm);
  const asOf = w.asOf ? isoDate(w.asOf) : null;
  return { from, to: asOf && asOf < to ? asOf : to };
}

/**
 * The per-row spending filter `spendingByCategory` applies, exported so the
 * Glass-Box trace (GLASSBOX_PLAN) selects contributing rows with the SAME
 * predicate the breakdown summed — by construction, never a re-derivation
 * that can drift. Any change here changes both surfaces together.
 */
export function isSpendRow(
  t: ReportTxn,
  range: SpendWindow,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  // C.25 (#403): loan payments carried elsewhere leave the category totals in
  // every month. Omitted = the exact pre-C.25 behaviour.
  excludedFlowIds?: ReadonlySet<string>,
): boolean {
  if (t.isSplitParent || t.isTransfer || isExcludedFromTotals(t)) return false;
  if (typeof t.id === 'string' && excludedFlowIds?.has(t.id)) return false;
  const ym = t.date.slice(0, 7);
  if (ym < range.fromYm || ym > range.toYm) return false;
  // C.26: a figure that says "you spent" counts money already gone. Absent
  // `asOf` this is the pre-C.26 behaviour exactly (nothing is dropped).
  //
  // Validated per row rather than only at `spendingByCategory`, because this
  // predicate is exported and three production call sites reach it directly
  // (/budgets, the Ask trace, `buildCategoryBreakdowns`). A critic executed the
  // gap: `asOf: '06/10/2026'` compares greater than every ISO date, so every
  // row silently vanished and the surface reported $0.00 — the exact
  // fabricated-zero failure the boundary check was written to prevent, reached
  // through the door the check did not cover. `isoDate` throws instead. The
  // cost is one regex per row on clamped windows only; the unclamped path
  // (every /budgets and /trends figure) does not execute it at all.
  if (range.asOf) {
    isoDate(range.asOf);
    if (t.date > range.asOf) return false;
  }
  const id = t.categoryId ?? 'uncategorized';
  if (id === 'transfer') return false;
  if (meta.get(id)?.group === 'Income') return false; // income isn't spending
  return true;
}

/** The category bucket a spend row lands in (shared with the trace). */
export const spendRowCategoryId = (t: ReportTxn): string => t.categoryId ?? 'uncategorized';

/** A spend row's signed contribution to its bucket: purchases add, refunds net
 *  down — both branches are exactly −amountCents (spend rows are negative). */
export const spendContributionCents = (t: ReportTxn): number => -t.amountCents;

/**
 * Spending grouped by category for months in [fromYm, toYm] (inclusive), and —
 * when the window carries an `asOf` — stopping at that day (C.26).
 */
export function spendingByCategory(
  txns: readonly ReportTxn[],
  range: SpendWindow,
  // Custom-category aware (DECISIONS #111): defaults to the static system map, so
  // a user with no custom categories gets byte-identical output.
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  excludedFlowIds?: ReadonlySet<string>, // C.25 (#403), threaded to isSpendRow
): SpendingBreakdown {
  // Validated ONCE here rather than per row: a malformed `asOf` compared as a
  // plain string would drop every row and print "$0.00 spent" — a fabricated
  // fact. `isoDate` throws instead.
  if (range.asOf) isoDate(range.asOf);
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (!isSpendRow(t, range, meta, excludedFlowIds)) continue;
    const id = spendRowCategoryId(t);
    totals.set(id, (totals.get(id) ?? 0) + spendContributionCents(t));
  }

  const byCategory: CategorySpend[] = [];
  for (const [id, amountCents] of totals) {
    if (amountCents <= 0) continue; // net refund / zero → drop
    const cat = meta.get(id);
    byCategory.push({ categoryId: id, name: cat?.name ?? 'Uncategorized', group: cat?.group ?? 'Other', amountCents });
  }
  byCategory.sort((a, b) => b.amountCents - a.amountCents);

  const groupMap = new Map<string, CategorySpend[]>();
  for (const c of byCategory) {
    const arr = groupMap.get(c.group) ?? [];
    arr.push(c);
    groupMap.set(c.group, arr);
  }
  const byGroup: GroupSpend[] = [...groupMap.entries()]
    .map(([group, categories]) => ({
      group,
      amountCents: categories.reduce((s, c) => s + c.amountCents, 0),
      categories,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const totalCents = byCategory.reduce((s, c) => s + c.amountCents, 0);
  return { totalCents, byCategory, byGroup };
}
