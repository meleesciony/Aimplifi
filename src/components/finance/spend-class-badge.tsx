/**
 * Fixed / Discretionary label on a register row (DECISIONS #378).
 * The display-only rendering of the row's class — used wherever the dial may
 * not write (out-of-scope rows, uncategorized rows, the shared demo). Editable
 * rows get SpendClassSelect instead (DECISIONS #396); the badge and the select
 * share the same testid / data attributes so a surface can assert the class
 * without caring which control rendered it.
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
