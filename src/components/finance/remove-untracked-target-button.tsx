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
import { withDeadline } from '@/components/triage/action-deadline';
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
    } catch {
      // Critic cycle 2, P3-5: a failed removal says so instead of reloading as if it worked.
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
        aria-label={`Remove the monthly target on ${name}`}
        data-testid={`budget-untracked-remove-${categoryId}`}
      >
        {busy ? 'Removing…' : 'Remove target'}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-destructive" data-testid={`budget-untracked-remove-error-${categoryId}`}>
          Couldn’t remove the target — nothing changed. Try again.
        </span>
      )}
    </>
  );
}
