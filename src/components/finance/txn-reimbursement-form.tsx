'use client';

/**
 * Track reimbursement on a list row without opening detail.
 * Same setReimbursement writer as the Activity action menu / detail.
 * Cycle: unset → awaiting → received → unset.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { setReimbursement } from '@/server/transaction-flags-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';

export function TxnReimbursementControl({
  transactionId,
  reimbursement,
  triggerTestId = 'txn-reimbursement',
}: {
  transactionId: string;
  reimbursement: string | null;
  triggerTestId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = reimbursementState(reimbursement);

  async function onCycle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const next =
      state === null ? 'awaiting' : state === 'awaiting' ? 'received' : null;
    try {
      const res = await withDeadline(
        setReimbursement({ transactionId, state: next }),
        FORM_ACTION_DEADLINE_MS,
      );
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  const label =
    busy
      ? 'Saving…'
      : state === null
        ? 'Reimburse'
        : state === 'awaiting'
          ? 'Awaiting'
          : 'Reimbursed';
  const aria =
    state === null
      ? 'Mark as awaiting reimbursement'
      : state === 'awaiting'
        ? 'Mark reimbursement received'
        : 'Stop tracking reimbursement';

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        data-testid={triggerTestId}
        aria-pressed={state !== null}
        aria-label={aria}
        className="h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        onClick={() => void onCycle()}
      >
        {label}
      </Button>
      {error ? (
        <p className="max-w-[12rem] text-[10px] text-red-500" role="alert" data-testid={`${triggerTestId}-error`}>
          {error}
        </p>
      ) : null}
    </span>
  );
}
