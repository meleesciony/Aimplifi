/**
 * The guilt-free split as bar widths (DECISIONS #793).
 *
 * One formula for the two surfaces that draw the split of this month's pay —
 * the /spending-plan hero bar and the Home guilt-free card — so they cannot
 * disagree about a share. Each segment is its share of PATTERN income, clamped
 * to 0–100%: fixed costs, the savings this month's pay funds (a bonus that paid
 * the rest is not income, DECISIONS #784/#787), and what is left to spend.
 * An over-plan month has no guilt-free share (it clamps to 0%), and the
 * callers hide the bar then. Display only — no figure is derived from these.
 */
export interface PlanSplitInput {
  patternIncomeCents: number;
  fixedExpensesCents: number;
  savingsFromPayCents: number;
  leftToSpendCents: number;
}

export interface PlanSplitWidths {
  fixed: string;
  savings: string;
  guiltFree: string;
}

export function planSplitWidths(p: PlanSplitInput): PlanSplitWidths {
  const total = Math.max(1, p.patternIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  return {
    fixed: pct(p.fixedExpensesCents),
    savings: pct(p.savingsFromPayCents),
    guiltFree: pct(Math.max(0, p.leftToSpendCents)),
  };
}
