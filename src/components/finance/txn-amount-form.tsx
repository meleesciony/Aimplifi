'use client';

/**
 * Change a transaction's amount. Sign stays with the row. Splits are not
 * offered this control. Same mutation recipe as BillAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionAmount,
  type TxnAmountResult,
} from '@/server/transaction-amount-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function TxnAmountControl({
  transactionId,
  amountCents,
  triggerTestId = 'detail-amount',
  idleClassName,
}: {
  transactionId: string;
  amountCents: number;
  triggerTestId?: string;
  idleClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnAmountResult | null>(null);
  const shown = formatCents(cents(amountCents), { signDisplay: 'always' });
  const defaultDollars = formatCents(cents(Math.abs(amountCents)));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateTransactionAmount(transactionId, fd), FORM_ACTION_DEADLINE_MS);
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
        className={
          idleClassName ??
          `text-left text-2xl tabular-nums underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground ${
            amountCents > 0 ? 'text-positive-500' : ''
          }`
        }
        data-testid={triggerTestId}
        aria-label={`Change amount ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="txn-amount-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-amount-${transactionId}`}>
          Amount
        </label>
        <input
          id={`txn-amount-${transactionId}`}
          name="amount"
          required
          inputMode="decimal"
          defaultValue={defaultDollars}
          aria-invalid={result?.errors?.amount ? true : undefined}
          aria-describedby={result?.errors?.amount ? 'txn-amount-error' : undefined}
          className={`w-32 ${inputCls}`}
          data-testid="txn-amount-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-amount-save">
          {busy ? 'Saving…' : 'Save amount'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.amount ? (
        <p id="txn-amount-error" className="text-xs text-red-500" role="alert">
          {result.errors.amount}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-amount-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
