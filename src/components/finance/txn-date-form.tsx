'use client';

/**
 * Change a transaction's date. Same mutation recipe as TxnAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionDate,
  type TxnDateResult,
} from '@/server/transaction-date-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { formatISODate, isoDate } from '@/lib/dates';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function TxnDateControl({
  transactionId,
  date,
  triggerTestId = 'detail-date',
}: {
  transactionId: string;
  date: string;
  triggerTestId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnDateResult | null>(null);
  const shown = formatISODate(isoDate(date), 'long');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateTransactionDate(transactionId, fd), FORM_ACTION_DEADLINE_MS);
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
        className="text-left underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid={triggerTestId}
        aria-label={`Change date ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="txn-date-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-date-${transactionId}`}>
          Date
        </label>
        <input
          id={`txn-date-${transactionId}`}
          name="date"
          type="date"
          required
          defaultValue={date}
          aria-invalid={result?.errors?.date ? true : undefined}
          aria-describedby={result?.errors?.date ? 'txn-date-error' : undefined}
          className={inputCls}
          data-testid="txn-date-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-date-save">
          {busy ? 'Saving…' : 'Save date'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.date ? (
        <p id="txn-date-error" className="text-xs text-red-500" role="alert">
          {result.errors.date}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-date-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
