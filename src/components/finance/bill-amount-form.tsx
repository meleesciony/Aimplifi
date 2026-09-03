'use client';

/**
 * Change or clear a repeating bill's monthly amount. Name and cadence stay
 * put. Save still refuses blank. Clear deletes the overlay, not a zero.
 * Same mutation recipe as GoalMonthlyControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  clearBillAmount,
  updateBillAmount,
  type BillAmountResult,
} from '@/server/bill-amount-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function BillAmountControl({
  billKey,
  monthlyCents,
  hasOverlay,
  amountTestId = 'fixed-composition-amount',
}: {
  billKey: string;
  monthlyCents: number;
  hasOverlay: boolean;
  amountTestId?: string;
}) {
  const inputId = `bill-amount-${billKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<BillAmountResult | null>(null);
  const shown = formatCents(cents(monthlyCents));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy('save');
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
      setBusy(null);
    }
  }

  async function onClear() {
    setBusy('clear');
    try {
      const res = await withDeadline(clearBillAmount(billKey), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(null);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left tabular-nums underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid={amountTestId}
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
        <Button type="submit" size="sm" disabled={busy !== null} data-testid="bill-amount-save">
          {busy === 'save' ? 'Saving…' : 'Save amount'}
        </Button>
        {hasOverlay ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onClear}
            data-testid="bill-amount-clear"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear amount'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
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
