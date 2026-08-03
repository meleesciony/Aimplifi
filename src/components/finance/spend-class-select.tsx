'use client';

/**
 * Fixed / Discretionary selector on a register row (DECISIONS #397).
 * The verdict is PER TRANSACTION — flipping this row never moves its
 * category siblings. Absent a verdict the app guesses (recurring-bill
 * merchant → fixed, else the category's taxonomy flag); a choice that
 * matches the guess is stored as NULL so the guess stays the source of
 * truth until the reader disagrees.
 */
import { useState, useTransition } from 'react';
import { type SpendClass } from '@/lib/engine/spending-plan/spend-class';
import { setTransactionSpendClass } from '@/server/transaction-flags-actions';
import { SpendClassBadge } from '@/components/finance/spend-class-badge';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function SpendClassSelect({
  transactionId,
  spendClass,
  canEdit,
  merchantName,
}: {
  transactionId: string;
  spendClass: SpendClass;
  canEdit: boolean;
  merchantName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editable = canEdit && spendClass !== 'out-of-scope';

  if (!editable) {
    return <SpendClassBadge spendClass={spendClass} />;
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
        title="Applies to this transaction only — change it if our guess is wrong"
        aria-label={`Fixed or discretionary for this ${merchantName} transaction. Applies to this transaction only.`}
        className="max-w-[7.5rem] rounded border bg-background px-1 py-0.5 text-[10px] text-muted-foreground disabled:opacity-50"
        onChange={(e) => {
          const next = e.target.value === 'fixed' ? 'fixed' : 'guilt-free';
          setError(null);
          startTransition(async () => {
            try {
              const res = await withDeadline(
                setTransactionSpendClass({ transactionId, spendClass: next }),
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
