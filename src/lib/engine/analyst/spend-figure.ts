/**
 * The app's own spending figure, in the shape the same-account engine takes.
 *
 * One definition of "spent": `spendingByCategory` — the function /reports, /budgets,
 * /trends and every existing Ask answer already print. This module only narrows its
 * result to what the question named (everything, a category, a family of categories, a
 * group), exactly the way `answerSpendByCategory` does, so a month inside a comparison
 * is the number Ask gives for that month on its own whenever every account is in.
 * `analyst-spend-figure.test.ts` holds the two together over the whole demo dataset.
 *
 * A period is a whole calendar month, or the first days of one (a month still in
 * progress is compared day for day with the same days of another month). The partial
 * window is `spendingByCategory`'s own stop date (`asOf`), the one "spent so far" already
 * uses — no second definition of a partial month.
 *
 * Pure: no I/O, integer cents.
 */
import { daysInMonth, monthKey, monthWindow, type ISODate } from '@/lib/dates';
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { spendingByCategory, type CategorySpend, type ReportTxn, type SpendingBreakdown } from '@/lib/engine/reports/reports';
import type { SpendTarget } from '@/lib/engine/assistant/intent';
import type { Figure, Period } from './same-account';

export interface SpendFigure extends Figure {
  /**
   * Counted rows that fall on a day a combined pair of accounts both reported — the one
   * shape in which the figure can hold a real charge twice. Scoped to the target, like
   * the figure it qualifies.
   */
  countedOnHandoverDays: number;
  /** Such rows in categories the figure DROPPED (net zero or less), which it cannot see. */
  uncountedOnHandoverDays: number;
}

export interface SpendFigureContext {
  meta: ReadonlyMap<string, CategoryMeta>;
  /** Loan payments carried elsewhere (C.25) — the same set every other figure excludes. */
  excludedFlowIds?: ReadonlySet<string>;
  handoverKeys: ReadonlySet<string>;
  /** Null = all spending. */
  target: SpendTarget | null;
}

const asGroup = (c: CategorySpend) => ({ key: c.categoryId, label: c.name, cents: c.amountCents });

/** Whether a row's category is inside what a target names (null = all spending). */
export function inTarget(categoryId: string | null | undefined, target: SpendTarget | null, meta: ReadonlyMap<string, CategoryMeta>): boolean {
  if (!target) return true;
  const id = categoryId ?? 'uncategorized';
  if (target.type === 'category') return id === target.categoryId;
  if (target.type === 'categories') return target.categoryIds.includes(id);
  return meta.get(id)?.group === target.group;
}

/** The categories of a breakdown that a target names. */
function targetCategories(b: SpendingBreakdown, target: SpendTarget | null): CategorySpend[] {
  if (!target) return b.byCategory;
  if (target.type === 'category') return b.byCategory.filter((c) => c.categoryId === target.categoryId);
  if (target.type === 'categories') {
    const ids = new Set(target.categoryIds);
    return b.byCategory.filter((c) => ids.has(c.categoryId));
  }
  return b.byGroup.find((g) => g.group === target.group)?.categories ?? [];
}

function uncountedFor(b: SpendingBreakdown, target: SpendTarget | null): number {
  const rows = b.uncountedOnHandoverDays;
  const mine = !target
    ? rows
    : target.type === 'category'
      ? rows.filter((u) => u.categoryId === target.categoryId)
      : target.type === 'categories'
        ? rows.filter((u) => target.categoryIds.includes(u.categoryId))
        : rows.filter((u) => u.group === target.group);
  return mine.reduce((n, u) => n + u.count, 0);
}

/**
 * The window a period is: one calendar month, whole or from its first day to an earlier
 * day of it. Anything else is a caller bug and throws.
 */
export function windowOfPeriod(period: Period): { fromYm: string; toYm: string; asOf?: string } {
  const ym = monthKey(period.start);
  const w = monthWindow(ym);
  if (w.from !== period.start || monthKey(period.end) !== ym || period.end < period.start) {
    throw new Error(`spend-figure: a period must be a calendar month or its first days (${period.start}…${period.end})`);
  }
  return period.end === w.to ? { fromYm: ym, toYm: ym } : { fromYm: ym, toYm: ym, asOf: period.end };
}

/**
 * The two periods a month-against-month question is answered over. Normally the two
 * whole months. When exactly ONE of them is the month in progress, the first days of
 * each that have FINISHED in it (through yesterday — today is not over), capped at the
 * other month's length: "this month so far" against the same days of the other month,
 * which is the comparison a reader asking mid-month means. `soFarDays` says which.
 * On the 1st nothing of the month has finished; the whole months come back and the
 * engine refuses the unfinished one by name.
 */
export function comparisonPeriods(
  currentYm: string,
  baselineYm: string,
  today: ISODate,
): { current: Period; baseline: Period; soFarDays: number | null } {
  const nowYm = monthKey(today);
  const live = (currentYm === nowYm) !== (baselineYm === nowYm);
  const finished = Number(today.slice(8, 10)) - 1;
  if (!live || finished < 1) return { current: periodOfMonth(currentYm), baseline: periodOfMonth(baselineYm), soFarDays: null };
  const other = currentYm === nowYm ? baselineYm : currentYm;
  const days = Math.min(finished, daysInMonth(Number(other.slice(0, 4)), Number(other.slice(5, 7))));
  return { current: periodOfFirstDays(currentYm, days), baseline: periodOfFirstDays(baselineYm, days), soFarDays: days };
}

/** The first `days` days of a "YYYY-MM" (1 ≤ days ≤ the month's length). */
export function periodOfFirstDays(ym: string, days: number): Period {
  const w = monthWindow(ym);
  return { start: w.from, end: `${ym}-${String(days).padStart(2, '0')}` as Period['end'] };
}

/** A period for a "YYYY-MM". */
export function periodOfMonth(ym: string): Period {
  const w = monthWindow(ym);
  return { start: w.from, end: w.to };
}

/** The figure function for one question: what `rows` spent on the target in `period`. */
export function spendFigureFor(ctx: SpendFigureContext): (rows: readonly ReportTxn[], period: Period) => SpendFigure {
  return (rows, period) => {
    const breakdown = spendingByCategory(rows, windowOfPeriod(period), ctx.meta, ctx.excludedFlowIds, ctx.handoverKeys);
    const categories = targetCategories(breakdown, ctx.target);
    return {
      totalCents: categories.reduce((n, c) => n + c.amountCents, 0),
      groups: categories.map(asGroup),
      countedOnHandoverDays: categories.reduce((n, c) => n + c.countedOnHandoverDays, 0),
      uncountedOnHandoverDays: uncountedFor(breakdown, ctx.target),
    };
  };
}
