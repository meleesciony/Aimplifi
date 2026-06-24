'use client';

/**
 * Two-step delete confirmation for a savings goal (DECISIONS #83). The goals page is a
 * server component whose delete was a one-click server-action form; this small client
 * wrapper adds an inline "Delete? Yes/Cancel" guard before calling the deleteGoal action,
 * matching the manual-account delete pattern. No modal/focus-trap needed.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteGoal } from '@/server/goal-actions';

export function DeleteGoalButton({ goalId, goalName }: { goalId: string; goalName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

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
        onClick={() => start(async () => { await deleteGoal(goalId); router.refresh(); })}
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
