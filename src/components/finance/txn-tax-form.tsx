'use client';

/**
 * Set or clear a transaction tax tag. Compact idle for Home recent strip.
 * Same mutation recipe as TxnNoteControl — plain onSubmit with busy state.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionTaxClass,
  type TxnTaxClassResult,
} from '@/server/transaction-tax-actions';
import { TAX_CLASSES, TAX_CLASS_LABELS, taxClassLabel } from '@/lib/engine/tax/classes';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function TxnTaxClassControl({
  transactionId,
  taxClass,
  triggerTestId = 'detail-tax',
  compact = false,
}: {
  transactionId: string;
  taxClass: string | null;
  triggerTestId?: string;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnTaxClassResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateTransactionTaxClass(transactionId, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const idle = taxClassLabel(taxClass) ?? 'Tax tag';
    return (
      <button
        type="button"
        className={
          compact
            ? 'shrink-0 text-xs text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground'
            : 'text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground'
        }
        data-testid={triggerTestId}
        aria-label={taxClassLabel(taxClass) ? 'Change tax tag' : 'Set tax tag'}
        onClick={() => setEditing(true)}
      >
        {idle}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-1" data-testid="txn-tax-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-tax-${transactionId}`}>
          Tax tag
        </label>
        <select
          id={`txn-tax-${transactionId}`}
          name="taxClass"
          defaultValue={taxClass ?? ''}
          aria-invalid={result?.errors?.taxClass ? true : undefined}
          aria-describedby={result?.errors?.taxClass ? 'txn-tax-error' : undefined}
          className={`min-w-0 flex-1 ${inputCls}`}
          data-testid="txn-tax-select"
        >
          <option value="">Untagged</option>
          {TAX_CLASSES.map((c) => (
            <option key={c} value={c}>
              {TAX_CLASS_LABELS[c]}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-tax-save">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.taxClass ? (
        <p id="txn-tax-error" className="text-xs text-red-500" role="alert">
          {result.errors.taxClass}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-tax-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
