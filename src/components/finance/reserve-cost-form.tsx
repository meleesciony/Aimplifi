'use client';

/**
 * Change a typed reserve's true cost. Cadence and name stay put.
 * Converted (bill-paired) rows are not offered this control.
 * Same mutation recipe as ReserveNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateReserveCost, type ReserveFormResult } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';
import { RESERVE_CADENCE_WORDS, type ReserveCadence } from '@/lib/engine/spending-plan/reserves';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function ReserveCostControl({
  reserveId,
  trueCostCents,
  cadence,
}: {
  reserveId: string;
  trueCostCents: number;
  cadence: ReserveCadence;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReserveFormResult | null>(null);
  const shown = `${formatCents(cents(trueCostCents))} ${RESERVE_CADENCE_WORDS[cadence]}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateReserveCost(reserveId, fd), FORM_ACTION_DEADLINE_MS);
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
        className="mt-0.5 block text-left text-xs underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="reserve-row-basis"
        aria-label={`Change cost ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-0.5 space-y-1" data-testid="reserve-cost-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`reserve-cost-${reserveId}`}>
          Whole cost
        </label>
        <input
          id={`reserve-cost-${reserveId}`}
          name="amount"
          required
          inputMode="decimal"
          defaultValue={formatCents(cents(trueCostCents))}
          aria-invalid={result?.errors?.amount ? true : undefined}
          aria-describedby={result?.errors?.amount ? 'reserve-cost-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="reserve-cost-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="reserve-cost-save">
          {busy ? 'Saving…' : 'Save cost'}
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
        <p id="reserve-cost-error" className="text-xs text-red-500" role="alert">
          {result.errors.amount}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="reserve-cost-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
