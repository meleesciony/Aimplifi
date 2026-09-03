'use client';

/**
 * Change a savings goal's target. Name, saved, monthly contribution,
 * and target date stay put. Same mutation recipe as GoalNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateGoalTarget, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function GoalTargetControl({
  goalId,
  targetCents,
}: {
  goalId: string;
  targetCents: number;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const shown = formatCents(cents(targetCents));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateGoalTarget(goalId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="goal-row-target"
        aria-label={`Change target ${shown}`}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="goal-target-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`goal-target-${goalId}`}>
          Target
        </label>
        <input
          id={`goal-target-${goalId}`}
          name="target"
          required
          inputMode="decimal"
          defaultValue={formatCents(cents(targetCents))}
          aria-invalid={result?.errors?.target ? true : undefined}
          aria-describedby={result?.errors?.target ? 'goal-target-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="goal-target-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-target-save">
          {busy ? 'Saving…' : 'Save target'}
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
      {result?.errors?.target ? (
        <p id="goal-target-error" className="text-xs text-red-500" role="alert">
          {result.errors.target}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="goal-target-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
