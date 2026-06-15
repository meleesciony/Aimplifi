'use client';

/**
 * "Delete my data" — the irreversible-action gate. The destructive button is
 * disabled until the user types the exact confirmation phrase (client-side check
 * mirrors the server's `confirmationMatches`, which re-validates). Shows a live
 * summary of what will be removed; the permanence warning precedes the control
 * and is announced with it (aria-describedby). When there's nothing stored, the
 * form is suppressed entirely.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DELETE_CONFIRMATION_PHRASE,
  confirmationMatches,
  type DeletionSummaryRow,
} from '@/lib/engine/account/deletion';
import { deleteMyData } from '@/server/account-actions';

export function DeleteMyDataForm({ summary }: { summary: DeletionSummaryRow[] }) {
  const [confirm, setConfirm] = useState('');
  const armed = confirmationMatches(confirm);

  if (summary.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="deletion-summary">
        There&apos;s no stored data to delete yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground">Deleting your account permanently removes:</p>
        <ul className="text-foreground" data-testid="deletion-summary">
          {summary.map((r) => (
            <li key={r.label}>
              • <span className="tabular-nums">{r.count.toLocaleString()}</span> {r.label}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          …and all derived history: recurring detections, scheduled items, balance
          snapshots, card payments, autopay settings, and your audit log.
        </p>
      </div>

      {/* Warning precedes the control and is announced with it (aria-describedby). */}
      <p id="delete-warning" className="text-xs text-muted-foreground">
        This is permanent and can&apos;t be undone — and any bank connection is revoked. In
        demo mode you can restore the sample data anytime with{' '}
        <code className="rounded bg-accent px-1">npx prisma db seed</code>.
      </p>

      <form action={deleteMyData} className="space-y-2" data-testid="delete-form">
        <label className="block space-y-1">
          <span className="text-sm">
            Type <code className="rounded bg-accent px-1">{DELETE_CONFIRMATION_PHRASE}</code> to confirm
          </span>
          <input
            name="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            aria-label={`Type "${DELETE_CONFIRMATION_PHRASE}" to confirm deletion`}
            aria-describedby="delete-warning"
            data-testid="delete-confirm"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </label>
        <Button
          type="submit"
          variant="destructive"
          disabled={!armed}
          aria-describedby="delete-warning"
          data-testid="delete-submit"
        >
          Delete my data permanently
        </Button>
      </form>
    </div>
  );
}
