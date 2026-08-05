'use client';

/**
 * Two-step delete for a declared reserve (C.23 / H.4), mirroring
 * `DeleteGoalButton` — same confirm-arm guard, same #164/#166 busy-flag and
 * deadline recipe, same full reload rather than `router.refresh()`.
 *
 * Confirmed rather than one-click because deleting a reserve MOVES A MONEY
 * FIGURE: the fixed total drops and guilt-free spending rises by the same
 * amount on the page the reader is standing on.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirmArm } from '@/components/ui/confirm-action';
import { deleteReserve } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function DeleteReserveButton({
  reserveId,
  reserveName,
}: {
  reserveId: string;
  reserveName: string;
}) {
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);
  async function confirmDelete() {
    setPending(true);
    try {
      await withDeadline(deleteReserve(reserveId), FORM_ACTION_DEADLINE_MS);
    } catch {
      // Deadline: the delete usually COMMITTED — fall through to re-sync.
    } finally {
      window.location.reload();
    }
  }

  if (!confirm.isArmed('delete')) {
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={`Remove ${reserveName}`}
        data-testid="reserve-delete"
        onClick={() => confirm.arm('delete')}
      >
        ✕
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Remove?</span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        className="h-auto px-1.5 py-0.5 text-red-400"
        data-testid="reserve-delete-confirm"
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
        onClick={confirm.disarm}
      >
        Cancel
      </Button>
    </span>
  );
}
