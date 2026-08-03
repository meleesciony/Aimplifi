'use client';

/**
 * Fixed / Discretionary selector on a register row (DECISIONS #397).
 * The verdict is PER TRANSACTION — but when the payee has more rows, the
 * change asks first: just this one, or all of them ("Chun's Martial Arts —
 * all of them"), the register's once/always idiom (#36/#42). Absent a
 * verdict the app guesses (recurring-bill merchant → fixed, else the
 * category's taxonomy flag); a choice that matches the guess is stored as
 * NULL so the guess stays the source of truth until the reader disagrees.
 */
import { useState, useTransition } from 'react';
import { type SpendClass } from '@/lib/engine/spending-plan/spend-class';
import {
  setMerchantSpendClass,
  setTransactionSpendClass,
} from '@/server/transaction-flags-actions';
import { SpendClassBadge } from '@/components/finance/spend-class-badge';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function SpendClassSelect({
  transactionId,
  spendClass,
  canEdit,
  merchantName,
  bulkCount,
}: {
  transactionId: string;
  spendClass: SpendClass;
  canEdit: boolean;
  merchantName: string;
  /** How many transactions share this payee (the register's merchantCount
   *  basis). Undefined / ≤ 1 → no scope question, the write is single-row. */
  bulkCount?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** The class the reader picked, waiting on the scope answer. */
  const [choice, setChoice] = useState<'fixed' | 'guilt-free' | null>(null);

  const editable = canEdit && spendClass !== 'out-of-scope';

  if (!editable) {
    return <SpendClassBadge spendClass={spendClass} />;
  }

  const offersScope = typeof bulkCount === 'number' && bulkCount > 1;

  function write(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error ?? 'Could not save — nothing was changed.');
          setChoice(null);
          return;
        }
        window.location.reload();
      } catch (err) {
        if (err instanceof ActionDeadline) {
          window.location.reload();
          return;
        }
        setError('Could not save — nothing was changed.');
        setChoice(null);
      }
    });
  }

  if (choice !== null) {
    const label = choice === 'fixed' ? 'Fixed' : 'Discretionary';
    return (
      <span
        className="flex min-w-0 flex-col gap-1 rounded border p-1.5"
        data-testid="txn-spend-class-scope"
      >
        <span className="text-[10px] text-muted-foreground">Make {label} for:</span>
        <button
          type="button"
          data-testid="txn-spend-class-scope-one"
          disabled={pending}
          className="tap-target rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          onClick={() =>
            write(() => setTransactionSpendClass({ transactionId, spendClass: choice }))
          }
        >
          Just this one
        </button>
        <button
          type="button"
          data-testid="txn-spend-class-scope-all"
          disabled={pending}
          className="tap-target rounded border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
          onClick={() =>
            write(() => setMerchantSpendClass({ transactionId, spendClass: choice }))
          }
        >
          All {bulkCount} {merchantName}
        </button>
        <button
          type="button"
          data-testid="txn-spend-class-scope-cancel"
          disabled={pending}
          className="tap-target rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50"
          onClick={() => setChoice(null)}
        >
          Cancel
        </button>
        {error ? (
          <span role="alert" className="text-[10px] text-red-400" data-testid="txn-spend-class-error">
            {error}
          </span>
        ) : null}
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
        title="Applies to this transaction — or every transaction from this payee, your choice"
        aria-label={`Fixed or discretionary for this ${merchantName} transaction.`}
        className="max-w-[7.5rem] rounded border bg-background px-1 py-0.5 text-[10px] text-muted-foreground disabled:opacity-50"
        onChange={(e) => {
          const next = e.target.value === 'fixed' ? 'fixed' : 'guilt-free';
          setError(null);
          if (offersScope) {
            setChoice(next);
            return;
          }
          write(() => setTransactionSpendClass({ transactionId, spendClass: next }));
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
