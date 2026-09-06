'use client';

/**
 * Change or clear a category's monthly budget target on the By-category row.
 * Same writer as BudgetTargetForm (setBudget / clearBudget) — no second action.
 * The bottom "Set a monthly target" form stays for categories not on this list.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearBudget, setBudget, type BudgetFormResult } from '@/server/budget-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function BudgetRowTargetControl({
  categoryId,
  name,
  budgetCents,
}: {
  categoryId: string;
  name: string;
  budgetCents: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<BudgetFormResult | null>(null);
  const hasTarget = budgetCents !== null && budgetCents > 0;
  const shown = hasTarget ? ` / ${formatCents(cents(budgetCents!))}` : 'Set target';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('categoryId', categoryId);
    setBusy('save');
    try {
      const res = await withDeadline(setBudget(null, fd), FORM_ACTION_DEADLINE_MS);
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
      await withDeadline(clearBudget(categoryId), FORM_ACTION_DEADLINE_MS);
      window.location.reload();
      return;
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
        className={`text-left underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground ${
          hasTarget ? 'text-muted-foreground tabular-nums' : 'text-xs text-muted-foreground'
        }`}
        data-testid={`budget-row-target-${categoryId}`}
        aria-label={
          hasTarget
            ? `Change target for ${name}: ${formatCents(cents(budgetCents!))}`
            : `Set monthly target for ${name}`
        }
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-1.5" data-testid={`budget-row-target-form-${categoryId}`}>
      <label className="sr-only" htmlFor={`budget-row-amount-${categoryId}`}>
        Monthly target for {name}
      </label>
      <input
        id={`budget-row-amount-${categoryId}`}
        name="amount"
        type="text"
        inputMode="decimal"
        required
        defaultValue={hasTarget ? String((budgetCents! / 100).toFixed(2)) : ''}
        placeholder="500"
        className={inputCls}
        data-testid={`budget-row-amount-${categoryId}`}
        autoFocus
      />
      <Button type="submit" size="sm" disabled={busy !== null} data-testid={`budget-row-target-save-${categoryId}`}>
        {busy === 'save' ? 'Saving…' : 'Save'}
      </Button>
      {hasTarget ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void onClear()}
          data-testid={`budget-clear-${categoryId}`}
        >
          {busy === 'clear' ? 'Clearing…' : 'Clear'}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {result?.amountError ? (
        <p className="w-full text-xs text-red-500" role="alert" data-testid={`budget-row-target-error-${categoryId}`}>
          {result.amountError}
        </p>
      ) : null}
    </form>
  );
}
