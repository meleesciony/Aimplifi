'use client';

/**
 * Remove a stored monthly target this page no longer tracks (#789, critic cycle 1 P2-3):
 * a target on Investment & Savings, which is never spending. Same writer as the row
 * control (`clearBudget`) — no second action — so the sentence naming it is not
 * permanent.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearBudget } from '@/server/budget-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function RemoveUntrackedTargetButton({ categoryId, name }: { categoryId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function onRemove() {
    setBusy(true);
    setFailed(false);
    try {
      await withDeadline(clearBudget(categoryId), FORM_ACTION_DEADLINE_MS);
      window.location.reload();
    } catch (err) {
      // A deadline usually means the write committed and only the confirmation was lost
      // (`action-deadline.ts`): reload, and the page shows whether the target is gone
      // (#792; #789 critic cycle 3, P3-3). A real refusal says so instead (critic cycle 2, P3-5).
      if (err instanceof ActionDeadline) {
        window.location.reload();
        return;
      }
      setBusy(false);
      setFailed(true);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={busy}
        onClick={() => void onRemove()}
        aria-label={`Remove target: the monthly target on ${name}`}
        data-testid={`budget-untracked-remove-${categoryId}`}
      >
        {busy ? 'Removing…' : 'Remove target'}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-destructive" data-testid={`budget-untracked-remove-error-${categoryId}`}>
          Couldn’t remove the target. Try again.
        </span>
      )}
    </>
  );
}
