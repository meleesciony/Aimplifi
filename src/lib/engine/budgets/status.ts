/**
 * Budgets engine (ROADMAP #7) — the pure math behind the conscious-spending view.
 * Given this month's spend-by-category and the user's optional per-category
 * monthly targets, produce the display rows (union of categories that have spend
 * OR a target), each with its over/under status, remaining amount, and bar
 * percentage. The /budgets page used to compute over/pct inline; this is the one
 * tested definition (per the "UI calls engine functions, never recompute inline"
 * rule). No React, no DB — maps in, rows out.
 *
 * Conscious-spending framing, not a guilt meter: `isDial` marks a category the
 * user spends on intentionally; the engine reports it, the UI never scolds it.
 */
import { parseDollarInput, type Cents } from '@/lib/money';
import { isIncomeCategoryId } from '@/lib/engine/categorize/categories';

/**
 * Categories for which a monthly budget target is meaningful. The whole Income
 * GROUP is out (an inflow isn't spending you'd target — the pre-#163 id set
 * offered 'Paycheck' as the picker's default spend target), transfers and
 * credit-card payments move money between your own accounts, and uncategorized
 * is a holding pen. 'cash' (Cash & ATM) stays budgetable — ATM withdrawals are
 * real spending leakage worth a target. Custom categories are spending by
 * definition (DECISIONS #111) and stay budgetable. Shared by the page's
 * category picker AND the server action, so the offered set equals the
 * accepted set.
 */
const NON_BUDGETABLE = new Set(['transfer', 'credit-card-payment', 'uncategorized']);
export function isBudgetable(categoryId: string): boolean {
  return !NON_BUDGETABLE.has(categoryId) && !isIncomeCategoryId(categoryId);
}

/**
 * Net spend per category from a month's transactions (NET of refunds). Sums
 * signed amounts per category (outflow negative + refund positive) and keeps
 * only categories whose net is an outflow, as a positive spend figure. A return
 * that offsets a purchase therefore lowers the category's spend — so the budget
 * bar reflects what you actually spent, not the gross of every charge. Callers
 * pass already-scoped transactions (non-transfer, non-split, posted, this month).
 */
export function netSpendByCategory(
  txns: readonly { categoryId: string | null; amountCents: number }[],
): Map<string, number> {
  const signed = new Map<string, number>();
  for (const t of txns) {
    const cat = t.categoryId ?? 'uncategorized';
    signed.set(cat, (signed.get(cat) ?? 0) + t.amountCents);
  }
  const spend = new Map<string, number>();
  for (const [cat, net] of signed) if (net < 0) spend.set(cat, -net);
  return spend;
}

export interface BudgetRow {
  categoryId: string;
  name: string;
  spentCents: number;
  /** The monthly target, or null when none is set. Always > 0 when set. */
  budgetCents: number | null;
  isDial: boolean;
  /** spent > budget (false when no budget). */
  over: boolean;
  /** budget − spent (may be negative); null when no budget. */
  remainingCents: number | null;
  /** min(100, round(spent/budget·100)); null when no budget. */
  pct: number | null;
}

export function summarizeBudgets(
  spendByCategory: ReadonlyMap<string, number>,
  budgetByCategory: ReadonlyMap<string, number>,
  meta: { name: (id: string) => string; isDial: (id: string) => boolean },
): BudgetRow[] {
  const ids = new Set<string>([...spendByCategory.keys(), ...budgetByCategory.keys()]);
  const rows: BudgetRow[] = [];
  for (const categoryId of ids) {
    const spentCents = spendByCategory.get(categoryId) ?? 0;
    const budgetCents = budgetByCategory.get(categoryId) ?? null;
    const hasBudget = budgetCents !== null && budgetCents > 0;
    rows.push({
      categoryId,
      name: meta.name(categoryId),
      spentCents,
      budgetCents,
      isDial: meta.isDial(categoryId),
      over: hasBudget && spentCents > budgetCents,
      remainingCents: budgetCents !== null ? budgetCents - spentCents : null,
      pct: hasBudget ? Math.min(100, Math.round((spentCents / budgetCents) * 100)) : null,
    });
  }
  // Highest spend first; ties broken by name for deterministic ordering.
  rows.sort((a, b) => b.spentCents - a.spentCents || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

/**
 * Parse a budget-target dollar string into POSITIVE integer cents, or null if
 * malformed / not positive. A target of $0 is not meaningful — clearing the
 * target is a separate action.
 */
export function parseBudgetTargetCents(s: string): Cents | null {
  // Lenient boundary parse (#166): "$500" and "1,000" are things real users
  // type into a money field — they must set a target, not crash to an error.
  const c = parseDollarInput(s);
  return c !== null && c > 0 ? c : null;
}
