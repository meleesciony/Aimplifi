/**
 * Fixed / Discretionary label on a register row (DECISIONS #378).
 * Display-only since 2026-08-03 (owner directive): the class is computed from
 * the row's filed category — deterministic, never typed in. The reader changes
 * it by refiling the transaction, not by labeling the row.
 */
import {
  spendClassLabel,
  type SpendClass,
} from '@/lib/engine/spending-plan/spend-class';

export function SpendClassBadge({ spendClass }: { spendClass: SpendClass }) {
  return (
    <span
      data-testid="txn-spend-class"
      data-spend-class={spendClass}
      className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      title={
        spendClass === 'out-of-scope'
          ? 'Transfers, card payments, income, and uncategorized rows are not Fixed or Discretionary'
          : undefined
      }
    >
      {spendClassLabel(spendClass)}
    </span>
  );
}
