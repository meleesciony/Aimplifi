'use client';

/**
 * Put a repeating bill back on the spending plan. Confirmed because it MOVES
 * A MONEY FIGURE: the fixed total rises and guilt-free spending drops.
 * Same two-step arm as TakeBillOffPlanButton. Transactions stay.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirmArm } from '@/components/ui/confirm-action';
import { putRepeatingBillBackOnPlan } from '@/server/bill-rename-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function PutBillBackOnPlanButton({
  billKey,
  billName,
}: {
  billKey: string;
  billName: string;
}) {
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);
  async function confirmPutBack() {
    setPending(true);
    try {
      await withDeadline(putRepeatingBillBackOnPlan(billKey), FORM_ACTION_DEADLINE_MS);
    } catch {
      // Deadline: the write usually COMMITTED — fall through to re-sync.
    } finally {
      window.location.reload();
    }
  }

  if (!confirm.isArmed('put-back')) {
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-label={`Put ${billName} back on the plan`}
        data-testid="bill-put-back"
        onClick={() => confirm.arm('put-back')}
      >
        Put back
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Put back?</span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        className="h-auto px-1.5 py-0.5 text-red-400"
        data-testid="bill-put-back-confirm"
        onClick={() => void confirmPutBack()}
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
