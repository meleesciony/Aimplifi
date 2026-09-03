'use client';

/**
 * Flip a transaction between money out and money in. Magnitude stays.
 * Splits are not offered this control. Same mutation recipe as TxnAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  flipTransactionDirection,
  type TxnAmountResult,
} from '@/server/transaction-amount-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function TxnDirectionControl({
  transactionId,
  amountCents,
  compact = false,
  flipTestId = 'txn-direction-flip',
}: {
  transactionId: string;
  amountCents: number;
  compact?: boolean;
  flipTestId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnAmountResult | null>(null);
  const isIn = amountCents > 0;
  const current = isIn ? 'Money in' : 'Money out';
  const next = isIn ? 'Mark as money out' : 'Mark as money in';

  async function onFlip() {
    setBusy(true);
    try {
      const res = await withDeadline(flipTransactionDirection(transactionId), FORM_ACTION_DEADLINE_MS);
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

  if (compact) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={busy}
          onClick={onFlip}
          aria-label={next}
          data-testid={flipTestId}
        >
          {busy ? 'Saving…' : current}
        </Button>
        {result?.error ? (
          <p className="text-xs text-red-500" role="alert" data-testid="txn-direction-form-error">
            {result.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground" data-testid="detail-direction">
          {current}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onFlip}
          data-testid={flipTestId}
        >
          {busy ? 'Saving…' : next}
        </Button>
      </div>
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-direction-form-error">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
