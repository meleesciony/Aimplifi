'use client';

/**
 * Change or clear a repeating bill's cadence. Name and amount stay put.
 * Save still refuses blank. Clear deletes the overlay, not a fake monthly.
 * Same mutation recipe as BillAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  clearBillCadence,
  updateBillCadence,
  type BillCadenceResult,
} from '@/server/bill-cadence-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import {
  BILL_CADENCE_WORDS,
  isBillCadence,
  type BillCadence,
} from '@/lib/engine/spending-plan/bill-rename';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

function cadenceWord(cadence: string | null): string {
  if (cadence && isBillCadence(cadence)) return BILL_CADENCE_WORDS[cadence];
  return 'how often';
}

export function BillCadenceControl({
  billKey,
  cadence,
  hasOverlay,
  cadenceTestId = 'fixed-composition-cadence',
}: {
  billKey: string;
  cadence: string | null;
  hasOverlay: boolean;
  cadenceTestId?: string;
}) {
  const inputId = `bill-cadence-${billKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<BillCadenceResult | null>(null);
  const shown = cadenceWord(cadence);
  const selected: BillCadence = cadence && isBillCadence(cadence) ? cadence : 'MONTHLY';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy('save');
    try {
      const res = await withDeadline(updateBillCadence(billKey, fd), FORM_ACTION_DEADLINE_MS);
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
      const res = await withDeadline(clearBillCadence(billKey), FORM_ACTION_DEADLINE_MS);
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
        className="text-left text-xs underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid={cadenceTestId}
        aria-label={`Change how often ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="bill-cadence-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          How often
        </label>
        <select
          id={inputId}
          name="cadence"
          defaultValue={selected}
          aria-invalid={result?.errors?.cadence ? true : undefined}
          aria-describedby={result?.errors?.cadence ? `${inputId}-error` : undefined}
          className={`w-44 ${inputCls}`}
          data-testid="bill-cadence-input"
        >
          <option value="WEEKLY">Every week</option>
          <option value="BIWEEKLY">Every two weeks</option>
          <option value="MONTHLY">Every month</option>
          <option value="QUARTERLY">Every 3 months</option>
          <option value="SEMIANNUAL">Twice a year</option>
          <option value="ANNUAL">Once a year</option>
        </select>
        <Button type="submit" size="sm" disabled={busy !== null} data-testid="bill-cadence-save">
          {busy === 'save' ? 'Saving…' : 'Save rhythm'}
        </Button>
        {hasOverlay ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onClear}
            data-testid="bill-cadence-clear"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear rhythm'}
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
      {result?.errors?.cadence ? (
        <p id={`${inputId}-error`} className="text-xs text-red-500" role="alert">
          {result.errors.cadence}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="bill-cadence-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
