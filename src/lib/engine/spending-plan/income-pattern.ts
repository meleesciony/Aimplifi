/**
 * Guilt-free income pattern inputs (DECISIONS #370).
 *
 * Trailing months should reflect money you *earn to allocate* — not investment
 * distributions, interest, or cash moved in from a money-market / other account.
 * When the reader has filed paycheck (or bonus / side-gig) rows, those leave
 * drive each month; otherwise we fall back to broad income minus investment /
 * interest leaves so demo + users who only use the generic Income category
 * still get a pattern.
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
 * Prefer earned-pay leaves when present in that month; else fallback income.
 */
export function monthlyGuiltFreeIncomeCents(transactions: readonly TxnLike[]): MonthlyIncomeCents[] {
  const byMonth = new Map<string, { earned: number; fallback: number }>();
  for (const t of transactions) {
    const m = monthKey(t.date);
    const slot = byMonth.get(m) ?? { earned: 0, fallback: 0 };
    if (isEarnedIncomeRow(t)) slot.earned += t.amountCents;
    if (isFallbackGuiltFreeIncomeRow(t)) slot.fallback += t.amountCents;
    byMonth.set(m, slot);
  }
  return [...byMonth.entries()]
    .map(([month, { earned, fallback }]) => ({
      month,
      incomeCents: earned > 0 ? earned : fallback,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}
