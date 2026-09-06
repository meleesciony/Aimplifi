'use client';

/**
 * Exclude or include a charge in totals from a list row.
 * Same setExcludeFromTotals writer as the Activity action menu.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { setExcludeFromTotals } from '@/server/transaction-flags-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function TxnExcludeControl({
  transactionId,
  excluded,
  triggerTestId = 'txn-exclude',
}: {
  transactionId: string;
  excluded: boolean;
  triggerTestId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(
        setExcludeFromTotals({ transactionId, exclude: !excluded }),
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

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        data-testid={triggerTestId}
        aria-pressed={excluded}
        aria-label={excluded ? 'Include in totals again' : 'Exclude from totals'}
        className="h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        onClick={() => void onToggle()}
      >
        {busy ? 'Saving…' : excluded ? 'Excluded' : 'Exclude'}
      </Button>
      {error ? (
        <p className="max-w-[12rem] text-[10px] text-red-500" role="alert" data-testid={`${triggerTestId}-error`}>
          {error}
        </p>
      ) : null}
    </span>
  );
}
