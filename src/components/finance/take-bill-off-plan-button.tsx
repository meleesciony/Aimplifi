'use client';

/**
 * Take a repeating bill off the spending plan. Confirmed because it MOVES
 * A MONEY FIGURE: the fixed total drops and guilt-free spending rises.
 * Same two-step arm as DeleteReserveButton. Transactions stay.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirmArm } from '@/components/ui/confirm-action';
import { takeRepeatingBillOffPlan } from '@/server/bill-rename-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function TakeBillOffPlanButton({
  billKey,
  billName,
}: {
  billKey: string;
  billName: string;
}) {
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);
  async function confirmTakeOff() {
    setPending(true);
    try {
      await withDeadline(takeRepeatingBillOffPlan(billKey), FORM_ACTION_DEADLINE_MS);
    } catch {
      // Deadline: the write usually COMMITTED — fall through to re-sync.
    } finally {
      window.location.reload();
    }
  }

  if (!confirm.isArmed('take-off')) {
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={`Take ${billName} off the plan`}
        data-testid="bill-take-off"
        onClick={() => confirm.arm('take-off')}
      >
        ✕
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Take off plan?</span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        className="h-auto px-1.5 py-0.5 text-red-400"
        data-testid="bill-take-off-confirm"
        onClick={() => void confirmTakeOff()}
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
