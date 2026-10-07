import type { RecurringItem } from '@/lib/engine/recurring/summary';

/**
 * #792 (critic cycle 1, P2-2): money coming back from investing, or a series the reader
 * files as a transfer, stays listed with the money coming in — with its controls — and
 * says why the section's income figure leaves it out. No background (critic cycle 2, P3-5:
 * muted text on the muted fill was 4.34:1 at 10px; on the card it clears AA).
 */
export function MoneyMoveBadge({ item }: { item: Pick<RecurringItem, 'isIncome' | 'movesMoney'> }) {
  if (!item.isIncome || !item.movesMoney) return null;
  return (
    <span
      data-testid="recurring-money-move-badge"
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      Money moved, not income
    </span>
  );
}
