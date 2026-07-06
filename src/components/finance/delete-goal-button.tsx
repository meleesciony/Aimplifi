'use client';

/**
 * Two-step delete confirmation for a savings goal (DECISIONS #83). The goals page is a
 * server component whose delete was a one-click server-action form; this small client
 * wrapper adds an inline "Delete? Yes/Cancel" guard before calling the deleteGoal action,
 * matching the manual-account delete pattern. No modal/focus-trap needed.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { deleteGoal } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function DeleteGoalButton({ goalId, goalName }: { goalId: string; goalName: string }) {
  const [confirming, setConfirming] = useState(false);
  // #166: explicit useState busy flag + deadline-bounded await + router.refresh,
  // the #164 pattern — useTransition's pending entangles with the router's
  // lanes, so a wedged action application froze this card at "Delete? Yes"
  // forever while the row was already gone server-side (audit agent-2 P1).
  const [pending, setPending] = useState(false);
  async function confirmDelete() {
    setPending(true);
    try {
      await withDeadline(deleteGoal(goalId), FORM_ACTION_DEADLINE_MS);
    } catch {
      // Deadline: the delete usually COMMITTED — fall through to re-sync.
    } finally {
      // Full reload, not router.refresh() — see BudgetTargetForm (#166).
      window.location.reload();
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={`Delete ${goalName}`}
        data-testid="goal-delete"
        onClick={() => setConfirming(true)}
      >
        ✕
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Delete?</span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        className="h-auto px-1.5 py-0.5 text-red-400"
        data-testid="goal-delete-confirm"
        onClick={() => void confirmDelete()}
      >
        Yes
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        className="h-auto px-1.5 py-0.5 text-muted-foreground"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </span>
  );
}
