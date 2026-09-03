'use client';

/**
 * Change a savings goal's target date. Name, target, saved, and monthly
 * contribution stay put. Same mutation recipe as GoalMonthlyControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateGoalTargetDate, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { formatMonth } from '@/lib/dates';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function GoalTargetDateControl({
  goalId,
  targetDate,
}: {
  goalId: string;
  targetDate: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const month = targetDate && /^\d{4}-(0[1-9]|1[0-2])/.test(targetDate) ? targetDate.slice(0, 7) : '';
  const shown = month ? `by ${formatMonth(month)}` : 'Set date';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateGoalTargetDate(goalId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="goal-row-target-date"
        aria-label={month ? `Change target date ${formatMonth(month)}` : 'Set target date'}
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="goal-target-date-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`goal-target-date-${goalId}`}>
          Target date
        </label>
        <input
          id={`goal-target-date-${goalId}`}
          name="targetDate"
          type="month"
          required
          defaultValue={month}
          aria-invalid={result?.errors?.targetDate ? true : undefined}
          aria-describedby={result?.errors?.targetDate ? 'goal-target-date-error' : undefined}
          className={`w-40 ${inputCls}`}
          data-testid="goal-target-date-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-target-date-save">
          {busy ? 'Saving…' : 'Save date'}
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
      {result?.errors?.targetDate ? (
        <p id="goal-target-date-error" className="text-xs text-red-500" role="alert">
          {result.errors.targetDate}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="goal-target-date-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
