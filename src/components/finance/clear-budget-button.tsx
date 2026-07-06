'use client';

/**
 * Clear-a-budget-target button (#166). Was an inline server-component form
 * action — whose post-action page refresh was the same coin-flip as
 * router.refresh() in the probes (scripts/audit-probes/budget-mutation.ts: "CLEAR did NOT
 * remove the row" while the DB row was gone). Same recipe as
 * BudgetTargetForm: direct action call, own busy flag, deadline-bounded,
 * full reload — the row visibly disappearing is the confirmation.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearBudget } from '@/server/budget-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function ClearBudgetButton({ categoryId, name }: { categoryId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  async function onClear() {
    setBusy(true);
    try {
      await withDeadline(clearBudget(categoryId), FORM_ACTION_DEADLINE_MS);
    } catch {
      // Deadline: the clear usually COMMITTED — the reload shows the truth.
    } finally {
      window.location.reload();
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      disabled={busy}
      aria-label={`Clear target for ${name}`}
      data-testid={`budget-clear-${categoryId}`}
      onClick={() => void onClear()}
      className="h-auto px-2 py-0.5 text-xs text-muted-foreground"
    >
      {busy ? 'Clearing…' : 'Clear'}
    </Button>
  );
}
