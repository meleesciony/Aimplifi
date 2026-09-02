'use client';

/**
 * Change how often a typed reserve's cost comes around. Name and true
 * cost stay put. Converted (bill-paired) rows are not offered this control.
 * Same mutation recipe as ReserveNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateReserveCadence, type ReserveFormResult } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import {
  RESERVE_CADENCE_WORDS,
  type ReserveCadence,
} from '@/lib/engine/spending-plan/reserves';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function ReserveCadenceControl({
  reserveId,
  cadence,
}: {
  reserveId: string;
  cadence: ReserveCadence;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReserveFormResult | null>(null);
  const shown = RESERVE_CADENCE_WORDS[cadence];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateReserveCadence(reserveId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="reserve-row-cadence"
        aria-label={`Change how often ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="reserve-cadence-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`reserve-cadence-${reserveId}`}>
          How often
        </label>
        <select
          id={`reserve-cadence-${reserveId}`}
          name="cadence"
          defaultValue={cadence}
          aria-invalid={result?.errors?.cadence ? true : undefined}
          aria-describedby={result?.errors?.cadence ? 'reserve-cadence-error' : undefined}
          className={`w-40 ${inputCls}`}
          data-testid="reserve-cadence-input"
        >
          <option value="MONTHLY">Every month</option>
          <option value="QUARTERLY">Every 3 months</option>
          <option value="SEMIANNUAL">Twice a year</option>
          <option value="ANNUAL">Once a year</option>
        </select>
        <Button type="submit" size="sm" disabled={busy} data-testid="reserve-cadence-save">
          {busy ? 'Saving…' : 'Save rhythm'}
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
      {result?.errors?.cadence ? (
        <p id="reserve-cadence-error" className="text-xs text-red-500" role="alert">
          {result.errors.cadence}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="reserve-cadence-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
