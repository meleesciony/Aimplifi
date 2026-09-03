'use client';

/**
 * Change a repeating bill's monthly amount on the spending plan. Name and
 * cadence stay put. Same mutation recipe as ReserveCostControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateBillAmount, type BillAmountResult } from '@/server/bill-amount-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function BillAmountControl({
  billKey,
  monthlyCents,
}: {
  billKey: string;
  monthlyCents: number;
}) {
  const inputId = `bill-amount-${billKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BillAmountResult | null>(null);
  const shown = formatCents(cents(monthlyCents));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateBillAmount(billKey, fd), FORM_ACTION_DEADLINE_MS);
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
        className="text-left tabular-nums underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="fixed-composition-amount"
        aria-label={`Change amount ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="bill-amount-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          Monthly amount
        </label>
        <input
          id={inputId}
          name="amount"
          required
          inputMode="decimal"
          defaultValue={shown}
          aria-invalid={result?.errors?.amount ? true : undefined}
          aria-describedby={result?.errors?.amount ? 'bill-amount-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="bill-amount-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="bill-amount-save">
          {busy ? 'Saving…' : 'Save amount'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {result?.errors?.amount ? (
        <p id="bill-amount-error" className="text-xs text-red-500" role="alert">
          {result.errors.amount}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="bill-amount-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
