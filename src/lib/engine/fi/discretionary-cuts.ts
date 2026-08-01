/**
 * Dial-aware discretionary cut proposals (TASKS W.6(a), DECISIONS #375).
 *
 * Sethi: spend lavishly on money dials; cut mercilessly elsewhere. Money dials
 * are the reader's "things we want to spend on" (Settings). Cut candidates are
 * discretionary categories that are NOT dials, ranked by typical monthly spend.
 *
 * Pure & deterministic: no I/O, no clock. The caller supplies category averages
 * and the gap (extra $/mo the wealth target needs beyond current contribution).
 */
import { cents, type Cents } from '@/lib/money';

export interface DiscretionaryCategorySpend {
  categoryId: string;
  categoryName: string;
  /** Typical monthly outflow in this category, integer cents (positive). */
  monthlyCents: number;
  discretionary: boolean;
}

export interface DiscretionaryCutProposal {
  categoryId: string;
  categoryName: string;
  monthlyCents: Cents;
  /**
   * How much of `gapCents` this category alone could cover if spending there
   * went to $0 — min(monthly, remaining gap). Never fabricates a larger save.
   */
  closesGapCents: Cents;
  /** True when this category alone covers the whole remaining gap. */
  coversGap: boolean;
}

/**
 * Case-insensitive dial match — same spirit as /budgets (`dials.has(name)`),
 * plus a contains check so a dial typed "dining" protects "Dining Out".
 */
export function categoryMatchesMoneyDial(
  categoryName: string,
  moneyDials: readonly string[],
): boolean {
  const name = categoryName.trim().toLowerCase();
  if (!name) return false;
  for (const d of moneyDials) {
    const dial = d.trim().toLowerCase();
    if (!dial) continue;
    if (name === dial || name.includes(dial) || dial.includes(name)) return true;
  }
  return false;
}

/**
 * Rank cut candidates: discretionary, not a money dial, positive monthly spend.
 * Walk largest-first and attribute `closesGapCents` against the remaining gap
 * so the list reads as a stacking plan toward the required additional save.
 */
export function proposeDiscretionaryCuts(input: {
  categories: readonly DiscretionaryCategorySpend[];
  moneyDials: readonly string[];
  /** Extra $/mo needed beyond current contribution; ≤0 → empty list. */
  gapCents: number;
  limit?: number;
}): DiscretionaryCutProposal[] {
  const gap = Math.trunc(input.gapCents);
  if (!Number.isFinite(gap) || gap <= 0) return [];

  const limit = input.limit ?? 5;
  const ranked = input.categories
    .filter(
      (c) =>
        c.discretionary &&
        c.monthlyCents > 0 &&
        !categoryMatchesMoneyDial(c.categoryName, input.moneyDials),
    )
    .slice()
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.categoryName.localeCompare(b.categoryName));

  const out: DiscretionaryCutProposal[] = [];
  let remaining = gap;
  for (const c of ranked) {
    if (out.length >= limit || remaining <= 0) break;
    const closes = Math.min(c.monthlyCents, remaining);
    out.push({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      monthlyCents: cents(c.monthlyCents),
      closesGapCents: cents(closes),
      coversGap: closes >= remaining,
    });
    remaining -= closes;
  }
  return out;
}

/**
 * Which monthly contribution the wealth-target years dial should grow from.
 * Settings savings % is the intentional "new money" flow; historical surplus
 * is the fallback when no % is set (or it resolves to $0).
 */
export function wealthContributionBasis(input: {
  historicalMonthlySavingsCents: number;
  plannedSavingsCents: number;
  savingsTargetBps: number | null;
}): {
  contributionCents: number;
  basis: 'settings-savings-pct' | 'recent-surplus';
} {
  const planned = Math.trunc(input.plannedSavingsCents);
  const historical = Math.trunc(input.historicalMonthlySavingsCents);
  if (
    input.savingsTargetBps != null &&
    input.savingsTargetBps > 0 &&
    Number.isFinite(planned) &&
    planned > 0
  ) {
    return { contributionCents: planned, basis: 'settings-savings-pct' };
  }
  return {
    contributionCents: Number.isFinite(historical) ? historical : 0,
    basis: 'recent-surplus',
  };
}
