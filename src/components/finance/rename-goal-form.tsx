'use client';

/**
 * Name a savings goal already on /goals. Dollars stay put —
 * this control is a NAME. Same mutation recipe as ReserveNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { renameGoal, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function GoalNameControl({
  goalId,
  name,
}: {
  goalId: string;
  name: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(renameGoal(goalId, fd), FORM_ACTION_DEADLINE_MS);
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
        className="text-left text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="goal-row-name"
        aria-label={`Rename ${name}`}
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="goal-rename-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`goal-rename-${goalId}`}>
          Goal name
        </label>
        <input
          id={`goal-rename-${goalId}`}
          name="name"
          required
          defaultValue={name}
          aria-invalid={result?.errors?.name ? true : undefined}
          aria-describedby={result?.errors?.name ? 'goal-rename-error' : undefined}
          className={`w-44 ${inputCls}`}
          data-testid="goal-rename-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-rename-save">
          {busy ? 'Saving…' : 'Save name'}
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
      {result?.errors?.name ? (
        <p id="goal-rename-error" className="text-xs text-red-500" role="alert">
          {result.errors.name}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="goal-rename-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
