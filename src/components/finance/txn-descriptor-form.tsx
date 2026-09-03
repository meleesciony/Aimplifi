'use client';

/**
 * Change the bank text a rule matches. Amount and merchantId stay put.
 * Same mutation recipe as TxnAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionDescriptor,
  type TxnDescriptorResult,
} from '@/server/transaction-descriptor-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function TxnDescriptorControl({
  transactionId,
  descriptor,
}: {
  transactionId: string;
  descriptor: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnDescriptorResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(
        updateTransactionDescriptor(transactionId, fd),
        FORM_ACTION_DEADLINE_MS,
      );
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
    return (
      <button
        type="button"
        className="break-all font-mono text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="detail-raw-descriptor"
        aria-label={`Change bank text ${descriptor}`}
        onClick={() => setEditing(true)}
      >
        {descriptor}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-1" data-testid="txn-descriptor-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-descriptor-${transactionId}`}>
          Bank text
        </label>
        <input
          id={`txn-descriptor-${transactionId}`}
          name="descriptor"
          required
          defaultValue={descriptor}
          aria-invalid={result?.errors?.descriptor ? true : undefined}
          aria-describedby={result?.errors?.descriptor ? 'txn-descriptor-error' : undefined}
          className={`min-w-0 flex-1 font-mono ${inputCls}`}
          data-testid="txn-descriptor-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-descriptor-save">
          {busy ? 'Saving…' : 'Save text'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.descriptor ? (
        <p id="txn-descriptor-error" className="text-xs text-red-500" role="alert">
          {result.errors.descriptor}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-descriptor-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
