'use client';

/**
 * Change a savings goal's already-saved amount. Name, target, monthly
 * contribution, and target date stay put. Same mutation recipe as
 * GoalTargetControl. Zero is valid.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateGoalSaved, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function GoalSavedControl({
  goalId,
  savedCents,
}: {
  goalId: string;
  savedCents: number;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const shown = formatCents(cents(savedCents));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateGoalSaved(goalId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="goal-row-saved"
        aria-label={`Change saved ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="goal-saved-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`goal-saved-${goalId}`}>
          Already saved
        </label>
        <input
          id={`goal-saved-${goalId}`}
          name="saved"
          required
          inputMode="decimal"
          defaultValue={formatCents(cents(savedCents))}
          aria-invalid={result?.errors?.saved ? true : undefined}
          aria-describedby={result?.errors?.saved ? 'goal-saved-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="goal-saved-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-saved-save">
          {busy ? 'Saving…' : 'Save amount'}
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
      {result?.errors?.saved ? (
        <p id="goal-saved-error" className="text-xs text-red-500" role="alert">
          {result.errors.saved}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="goal-saved-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
