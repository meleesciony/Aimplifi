'use client';

/**
 * Attach a statement to a manual card from a Cards “No due date yet” row.
 * Same writer as Accounts — setManualCardStatement — no second action.
 */
import { useState } from 'react';
import {
  ManualCardStatementForm,
  type ManualStatementFormValues,
} from '@/components/finance/manual-card-statement-form';
import { setManualCardStatement, type CardStatementResult } from '@/server/card-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function CardStatementControl({ accountId }: { accountId: string }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CardStatementResult | null>(null);

  async function onSubmit(values: ManualStatementFormValues) {
    setBusy(true);
    try {
      const res = await withDeadline(
        setManualCardStatement({ accountId, ...values }),
        FORM_ACTION_DEADLINE_MS,
      );
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
        className="tap-target mt-1 inline-flex items-center justify-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        data-testid="card-row-statement-add"
        aria-label="Add a statement for this card"
        onClick={() => setEditing(true)}
      >
        + Add statement — get “how much &amp; when” for this card
      </button>
    );
  }

  return (
    <div className="mt-2" data-testid="card-row-statement">
      <ManualCardStatementForm
        pending={busy}
        onCancel={() => {
          setEditing(false);
          setResult(null);
        }}
        onSubmit={onSubmit}
      />
      {result && !result.ok && result.errors ? (
        <p className="mt-1 text-xs text-red-500" role="alert">
          {result.errors.join(' ')}
        </p>
      ) : null}
    </div>
  );
}
