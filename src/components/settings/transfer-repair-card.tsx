'use client';

/**
 * H.7b — the transfer-flag repair control (/settings), critic-cycled. Renders
 * the server-computed preview (what would change, stated BEFORE it changes),
 * the one caution the check cannot see for itself (a genuine card-sourced
 * cash advance), an explicit apply, and Undo on the recorded run.
 *
 * Mutation recipe = budget-target-form's, for its reasons verbatim: explicit
 * onSubmit → direct server-action call, own busy flag, deadline-bounded await,
 * full reload on success (router.refresh() was a coin-flip in probes, and this
 * card's own numbers are server-rendered — a reload is the one confirmation
 * that can't lie). On a deadline the write usually COMMITTED and only the
 * confirmation was lost — re-sync rather than report a false failure. One
 * deliberate exception (critic P2-6): an apply that cleared NOTHING changed
 * nothing server-side, so it renders its outcome inline instead of reloading
 * into silence.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cents, formatCents } from '@/lib/money';
import {
  applyTransferFlagRepairAction,
  undoTransferFlagRepairAction,
} from '@/server/transfer-flag-repair-actions';
import type { TransferFlagRepairPreview } from '@/server/transfer-flag-repair';
import {
  REPAIR_BUSY_APPLY,
  REPAIR_BUSY_UNDO,
  REPAIR_DEMO_NOTE,
  REPAIR_GENERIC_ERROR,
  REPAIR_UNDO_LABEL,
  repairAllSkippedNote,
  repairApplyLabel,
  repairCashAdvanceCaution,
  repairClaim,
  repairExplainer,
  repairLastRunLine,
  repairNothingLine,
  repairOutOfScopeNote,
  repairShowRowsLabel,
  repairUndoneLine,
} from './transfer-repair-copy';

export function TransferRepairCard({
  preview,
  canApply,
}: {
  preview: TransferFlagRepairPreview;
  /** False for the shared demo — the server fences the write anyway
   * (DEMO_ENTRY_BLOCKED); this keeps the UI from offering a door that fails,
   * the CategoryManager precedent. */
  canApply: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function run(invoke: () => Promise<{ ok: boolean; error?: string; cleared?: number }>) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await withDeadline(invoke(), FORM_ACTION_DEADLINE_MS);
      if (res.ok) {
        if (res.cleared === 0) {
          // Nothing changed server-side; a reload would land on a page that
          // never says what the click did (critic P2-6).
          setNotice({ kind: 'info', text: repairAllSkippedNote() });
          return;
        }
        window.location.reload();
        return;
      }
      setNotice({ kind: 'error', text: res.error ?? REPAIR_GENERIC_ERROR });
    } catch {
      // Deadline: the write usually committed — re-sync, don't report a false failure.
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  const outOfScope = repairOutOfScopeNote(preview.declinedOutOfScopeCount);

  return (
    <div className="space-y-3" data-testid="transfer-repair-card">
      <p className="text-sm text-muted-foreground">{repairExplainer()}</p>

      {preview.clearCount > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground" data-testid="transfer-repair-claim">
            {repairClaim(preview)}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="transfer-repair-caution">
            {repairCashAdvanceCaution()}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {repairShowRowsLabel(preview.clearCount)}
            </summary>
            <ul className="mt-2 space-y-1" data-testid="transfer-repair-rows">
              {preview.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular-nums text-muted-foreground">{r.date}</span>
                  <span className="min-w-0 flex-1 truncate">{r.rawDescriptor}</span>
                  <span className="text-muted-foreground">{r.accountName}</span>
                  {r.categoryName !== null && (
                    <span className="text-muted-foreground">· {r.categoryName}</span>
                  )}
                  <span className="tabular-nums">
                    {formatCents(cents(r.amountCents), { signDisplay: 'always' })}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          {canApply ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => applyTransferFlagRepairAction());
              }}
            >
              <Button type="submit" size="sm" disabled={busy} data-testid="transfer-repair-apply">
                {busy ? REPAIR_BUSY_APPLY : repairApplyLabel(preview.clearCount)}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="transfer-repair-demo-note">
              {REPAIR_DEMO_NOTE}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="transfer-repair-nothing">
          {repairNothingLine(preview)}
        </p>
      )}

      {outOfScope !== null && (
        <p className="text-xs text-muted-foreground" data-testid="transfer-repair-out-of-scope">
          {outOfScope}
        </p>
      )}

      {preview.lastRun !== null &&
        (preview.lastRun.undone ? (
          <p className="text-xs text-muted-foreground" data-testid="transfer-repair-undone-line">
            {repairUndoneLine({ clearedCount: preview.lastRun.clearedCount })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2" data-testid="transfer-repair-last-run">
            <p className="text-xs text-muted-foreground">
              {repairLastRunLine({
                clearedCount: preview.lastRun.clearedCount,
                skippedCount: preview.lastRun.skippedCount,
                inflowCents: preview.lastRun.inflowCents,
                outflowCents: preview.lastRun.outflowCents,
              })}
            </p>
            {canApply && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget); // captured before the handler returns
                  void run(() => undoTransferFlagRepairAction(fd));
                }}
              >
                <input type="hidden" name="runId" value={preview.lastRun.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  data-testid="transfer-repair-undo"
                >
                  {busy ? REPAIR_BUSY_UNDO : REPAIR_UNDO_LABEL}
                </Button>
              </form>
            )}
          </div>
        ))}

      {notice !== null && (
        <p
          className={notice.kind === 'error' ? 'text-xs text-red-500' : 'text-xs text-muted-foreground'}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          data-testid={notice.kind === 'error' ? 'transfer-repair-error' : 'transfer-repair-info'}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
