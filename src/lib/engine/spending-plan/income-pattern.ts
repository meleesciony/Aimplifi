/**
 * Guilt-free income pattern inputs (DECISIONS #370 / #385).
 *
 * Trailing months should reflect money you *earn to allocate* — not investment
 * distributions, interest, or cash moved in from a money-market / other account.
 * When the reader has filed paycheck (or bonus / side-gig) rows, those leaves
 * count — and so does pay still filed under the generic Income parent (a second
 * biweekly deposit the categorizer has not refined yet). Tax refunds / rental /
 * interest stay out of that path. When no earned leaves exist, fall back to
 * broad income minus untouchable leaves (demo + Income-only filers).
 */
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { isIncomeCategoryId } from '@/lib/engine/categorize/categories';
import { monthKey } from '@/lib/dates';

/** Leaves that are earned pay for the guilt-free allocation. */
export const EARNED_INCOME_CATEGORY_IDS = new Set([
  'paycheck',
  'bonus',
  'side-income',
]);

/** Already-saved / portfolio yield — never spendable allocation income. */
export const UNTOUCHABLE_INCOME_CATEGORY_IDS = new Set([
  'interest-income',
  'investment-income',
]);

/** Cash moved into checking (often from MM / brokerage), not earned income. */
const INTERNAL_DEPOSIT_RE = /\bdeposit\s+mobile\s+banking\b/i;

export function isUntouchableIncomeRow(t: TxnLike): boolean {
  if (t.categoryId && UNTOUCHABLE_INCOME_CATEGORY_IDS.has(t.categoryId)) return true;
  if (INTERNAL_DEPOSIT_RE.test(t.rawDescriptor ?? '')) return true;
  return false;
}

export function isEarnedIncomeRow(t: TxnLike): boolean {
  return (
    countsInFlows(t) &&
    t.amountCents > 0 &&
    !!t.categoryId &&
    EARNED_INCOME_CATEGORY_IDS.has(t.categoryId)
  );
}

/**
 * Generic Income parent — still-unfiled pay (second biweekly deposit, etc.).
 * Counted WITH earned leaves (#385); never alone as a substitute for the
 * earned path's exclusions (tax-refund / rental stay on the fallback-only path).
 */
export function isGenericIncomePayRow(t: TxnLike): boolean {
  return (
    countsInFlows(t) &&
    t.amountCents > 0 &&
    t.categoryId === 'income' &&
    !isUntouchableIncomeRow(t)
  );
}

/**
 * Broad income used only when a month has no earned-pay rows: Income-group
 * (and uncategorized positives), minus untouchable investment/interest and
 * mobile-deposit transfers.
 */
export function isFallbackGuiltFreeIncomeRow(t: TxnLike): boolean {
  if (!countsInFlows(t) || t.amountCents <= 0) return false;
  if (isUntouchableIncomeRow(t)) return false;
  if (t.categoryId === 'refund') return false;
  return !t.categoryId || (t.categoryId !== 'refund' && isIncomeCategoryId(t.categoryId));
}

export interface MonthlyIncomeCents {
  month: string;
  incomeCents: number;
}

/**
 * Per complete-month income for the guilt-free trailing median.
 *
 * When any earned-pay leaf exists: earned leaves + generic Income parent rows
 * (sibling paychecks not yet refined to `paycheck`). Else: fallback income.
 */
export function monthlyGuiltFreeIncomeCents(transactions: readonly TxnLike[]): MonthlyIncomeCents[] {
  const byMonth = new Map<string, { earned: number; generic: number; fallback: number }>();
  for (const t of transactions) {
    const m = monthKey(t.date);
    const slot = byMonth.get(m) ?? { earned: 0, generic: 0, fallback: 0 };
    if (isEarnedIncomeRow(t)) slot.earned += t.amountCents;
    if (isGenericIncomePayRow(t)) slot.generic += t.amountCents;
    if (isFallbackGuiltFreeIncomeRow(t)) slot.fallback += t.amountCents;
    byMonth.set(m, slot);
  }
  return [...byMonth.entries()]
    .map(([month, { earned, generic, fallback }]) => ({
      month,
      // #385: do NOT drop generic Income pay just because one deposit is filed
      // as paycheck — that under-counted biweekly months by ~half.
      incomeCents: earned > 0 ? earned + generic : fallback,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}
