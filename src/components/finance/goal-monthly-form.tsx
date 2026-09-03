'use client';

/**
 * Change a savings goal's monthly contribution. Name, target, saved,
 * and target date stay put. Same mutation recipe as GoalTargetControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateGoalMonthly, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function GoalMonthlyControl({
  goalId,
  monthlyCents,
}: {
  goalId: string;
  monthlyCents: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const shown =
    monthlyCents && monthlyCents > 0 ? `${formatCents(cents(monthlyCents))}/mo` : 'Set monthly';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateGoalMonthly(goalId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="goal-row-monthly"
        aria-label={
          monthlyCents && monthlyCents > 0
            ? `Change monthly ${formatCents(cents(monthlyCents))}`
            : 'Set monthly contribution'
        }
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="goal-monthly-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`goal-monthly-${goalId}`}>
          Monthly contribution
        </label>
        <input
          id={`goal-monthly-${goalId}`}
          name="monthly"
          required
          inputMode="decimal"
          defaultValue={monthlyCents && monthlyCents > 0 ? formatCents(cents(monthlyCents)) : ''}
          aria-invalid={result?.errors?.monthly ? true : undefined}
          aria-describedby={result?.errors?.monthly ? 'goal-monthly-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="goal-monthly-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-monthly-save">
          {busy ? 'Saving…' : 'Save monthly'}
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
      {result?.errors?.monthly ? (
        <p id="goal-monthly-error" className="text-xs text-red-500" role="alert">
          {result.errors.monthly}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="goal-monthly-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
