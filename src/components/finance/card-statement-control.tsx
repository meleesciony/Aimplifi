'use client';

/**
 * Attach or edit a statement on a manual card from Cards.
 * Same writers as Accounts — setManualCardStatement / clearManualCardStatement.
 */
import { useState } from 'react';
import {
  ManualCardStatementForm,
  type ManualStatementFormValues,
} from '@/components/finance/manual-card-statement-form';
import {
  clearManualCardStatement,
  setManualCardStatement,
  type CardStatementResult,
} from '@/server/card-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';
import { formatISODate, isoDate } from '@/lib/dates';
import type { ManualCardBilling } from '@/server/transactions';

export function CardStatementControl({
  accountId,
  billing,
}: {
  accountId: string;
  /** When present and hasStatement, show Edit / Clear instead of Add. */
  billing?: ManualCardBilling;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CardStatementResult | null>(null);
  const hasStatement = Boolean(billing?.hasStatement);

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

  async function onClear() {
    setBusy(true);
    try {
      const res = await withDeadline(clearManualCardStatement(accountId), FORM_ACTION_DEADLINE_MS);
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
    if (hasStatement && billing) {
      return (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="card-row-statement-summary">
            Statement {formatCents(cents(billing.statementBalanceCents ?? 0))} · due{' '}
            {billing.dueDate ? formatISODate(isoDate(billing.dueDate)) : '—'} · min{' '}
            {formatCents(cents(billing.minimumPaymentCents ?? 0))}
          </span>
          <button
            type="button"
            data-testid="card-row-statement-edit"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            data-testid="card-row-statement-clear"
            disabled={busy}
            onClick={() => void onClear()}
            className="tap-target inline-flex items-center justify-center rounded px-1.5 py-0.5 text-red-400 hover:bg-accent disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      );
    }
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
        billing={billing}
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
