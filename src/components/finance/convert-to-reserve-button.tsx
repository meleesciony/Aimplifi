'use client';

/**
 * THE CONVERT LEVER (C.23 / DECISIONS #431) — "make this repeating expense a
 * reserve". The row already carries the series' whole cost and rhythm, so the
 * button sends only the convert identity (payee canonical, or unnamed billKey). The server re-derives the verdict from the
 * SAME `getSpendingPlan` output the card rendered (never a client-asserted
 * state) and commits the reserve + the pair overlay (NOT_BILL for a payee, BillOffPlan for unnamed).
 *
 * Same mutation recipe as `ReserveForm` (#164/#166, `mutation-form-recipe`):
 * own busy flag, deadline-bounded await, full reload on success — the reloaded
 * card is the confirmation that cannot lie (the bill's row flips to a reserve
 * line, or the refusal shows why not).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createReserveFromSeries } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function ConvertToReserveButton({ merchantCanonical }: { /** Convert identity: payee merchantCanonical, or unnamed billKey. */ merchantCanonical: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(
        createReserveFromSeries(merchantCanonical),
        FORM_ACTION_DEADLINE_MS,
      );
      if (res.ok) {
        // Full reload: the re-rendered basis is the confirmation that cannot
        // lie — the bill's row is gone and a reserve line sits inside the total.
        window.location.reload();
        return;
      }
      // A whole-form refusal (a no-longer-convertible series, the count cap,
      // a duplicate) belongs beside the row it came from, not in a toast.
      setError(res.error ?? 'That could not be saved — try again.');
    } catch {
      // Deadline: the write usually COMMITTED and only the confirmation was
      // lost — re-sync rather than report a false failure (#164 recovery rule).
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={onClick} disabled={busy} data-testid="convert-to-reserve">
        {busy ? 'Making it a reserve…' : 'Make it a reserve'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-red-500" data-testid="convert-to-reserve-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
