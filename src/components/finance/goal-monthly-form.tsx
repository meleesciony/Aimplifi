'use client';

/**
 * Change or clear a savings goal's monthly contribution. Name, target,
 * saved, and target date stay put. Same mutation recipe as GoalTargetControl.
 * Save still refuses blank. Clear writes null, not zero.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearGoalMonthly, updateGoalMonthly, type GoalFormResult } from '@/server/goal-actions';
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
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const hasMonthly = Boolean(monthlyCents && monthlyCents > 0);
  const shown = hasMonthly ? `${formatCents(cents(monthlyCents!))}/mo` : 'Set monthly';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy('save');
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
      setBusy(null);
    }
  }

  async function onClear() {
    setBusy('clear');
    try {
      const res = await withDeadline(clearGoalMonthly(goalId), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(null);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="goal-row-monthly"
        aria-label={
          hasMonthly
            ? `Change monthly ${formatCents(cents(monthlyCents!))}`
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
          defaultValue={hasMonthly ? formatCents(cents(monthlyCents!)) : ''}
          aria-invalid={result?.errors?.monthly ? true : undefined}
          aria-describedby={result?.errors?.monthly ? 'goal-monthly-error' : undefined}
          className={`w-28 ${inputCls}`}
          data-testid="goal-monthly-input"
        />
        <Button type="submit" size="sm" disabled={busy !== null} data-testid="goal-monthly-save">
          {busy === 'save' ? 'Saving…' : 'Save monthly'}
        </Button>
        {hasMonthly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onClear}
            data-testid="goal-monthly-clear"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear monthly'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
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
