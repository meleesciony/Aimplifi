'use client';

/**
 * Fixed / Discretionary selector on a register row (DECISIONS #378).
 * Changes apply to the CATEGORY (every transaction filed there), matching
 * CategoryFixedOverride — not a silent per-txn flag that would disagree with Plan.
 */
import { useState, useTransition } from 'react';
import {
  spendClassLabel,
  type SpendClass,
} from '@/lib/engine/spending-plan/spend-class';
import { setCategoryFixed } from '@/server/category-fixed-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function SpendClassSelect({
  transactionId,
  categoryId,
  spendClass,
  canEdit,
  merchantName,
}: {
  transactionId: string;
  categoryId: string;
  spendClass: SpendClass;
  canEdit: boolean;
  merchantName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = spendClassLabel(spendClass);
  const editable = canEdit && spendClass !== 'out-of-scope' && categoryId !== 'uncategorized';

  if (!editable) {
    return (
      <span
        data-testid="txn-spend-class"
        data-spend-class={spendClass}
        className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
        title={
          spendClass === 'out-of-scope'
            ? 'Transfers, income, and uncategorized rows are not Fixed or Discretionary'
            : undefined
        }
      >
        {label}
      </span>
    );
  }

  const selectId = `spend-class-${transactionId}`;
  return (
    <span className="inline-flex min-w-0 flex-col">
      <label className="sr-only" htmlFor={selectId}>
        Fixed or discretionary for {merchantName}
      </label>
      <select
        id={selectId}
        data-testid="txn-spend-class"
        data-spend-class={spendClass}
        disabled={pending}
        value={spendClass === 'fixed' ? 'fixed' : 'guilt-free'}
        title="Applies to every transaction in this category — change if our suggestion is wrong"
        aria-label={`Fixed or discretionary for category of ${merchantName}. Applies to the whole category.`}
        className="max-w-[7.5rem] rounded border bg-background px-1 py-0.5 text-[10px] text-muted-foreground disabled:opacity-50"
        onChange={(e) => {
          const next = e.target.value === 'fixed';
          setError(null);
          startTransition(async () => {
            try {
              const res = await withDeadline(
                setCategoryFixed(categoryId, next),
                FORM_ACTION_DEADLINE_MS,
              );
              if (!res.ok) {
                setError(res.error);
                return;
              }
              window.location.reload();
            } catch (err) {
              if (err instanceof ActionDeadline) {
                window.location.reload();
                return;
              }
              setError('Could not save — nothing was changed.');
            }
          });
        }}
      >
        <option value="fixed">Fixed</option>
        <option value="guilt-free">Discretionary</option>
      </select>
      {error ? (
        <span role="alert" className="text-[10px] text-red-400" data-testid="txn-spend-class-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
