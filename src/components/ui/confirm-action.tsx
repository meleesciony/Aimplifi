'use client';

/**
 * The one two-tap confirm (2026-07-21 agent review, finding B1).
 *
 * Six surfaces — synced-account delete, manual-account delete, Plaid disconnect,
 * custom-category delete, leave-household, delete-goal — each hand-rolled the same
 * "click once to arm, click again to commit" state machine, and each had its own
 * idea of what the armed row looks like.
 *
 * What is shared here, and what deliberately is NOT:
 *   • `useConfirmArm` — the STATE MACHINE. All six now behave identically, and
 *     Escape cancels on every one of them (previously nothing did: the only way
 *     out of an armed destructive control was to find and click Cancel).
 *   • `ConfirmPrompt` — the armed row for the three plain-`<button>` surfaces,
 *     which were already byte-identical apart from their labels and test ids.
 *   • NOT the armed row for the three shadcn-`<Button>` surfaces. Those render
 *     different elements (variants, icons, "Keep"/"Confirm leave" labels), and a
 *     component with enough props to reproduce all six markups exactly would be a
 *     worse abstraction than the duplication it replaced (LOOP_ENGINEERING rule 2).
 *     They share the state machine and keep their own markup.
 *
 * Behaviour preserved from every copy: the armed state does NOT auto-expire, and
 * clicking elsewhere does not cancel it — an armed control waits for a decision.
 * Both buttons disable while the mutation is in flight, so a double-tap can't
 * re-fire and Cancel can't race a commit that already left.
 */
import { useCallback, useEffect, useState } from 'react';

export interface ConfirmArm {
  /** The armed target's key, or null when nothing is armed. */
  armedId: string | null;
  isArmed: (id: string) => boolean;
  /** Arm one target. Arming a second disarms the first — one decision at a time. */
  arm: (id: string) => void;
  disarm: () => void;
}

/**
 * Arm/disarm state for a two-tap confirm, keyed by target id so ONE hook covers a
 * list of rows. Single-control surfaces pass a constant key (e.g. 'delete').
 *
 * Escape disarms. The listener is bound only while something is armed, so an idle
 * page carries no key handler.
 */
export function useConfirmArm(): ConfirmArm {
  const [armedId, setArmedId] = useState<string | null>(null);
  const disarm = useCallback(() => setArmedId(null), []);
  const arm = useCallback((id: string) => setArmedId(id), []);
  const isArmed = useCallback((id: string) => armedId === id, [armedId]);

  useEffect(() => {
    if (armedId === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setArmedId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [armedId]);

  return { armedId, isArmed, arm, disarm };
}

/**
 * The armed row: what the action will do, then confirm and cancel.
 *
 * `flex-wrap` (the one change from the three copies this replaces) is the 380px
 * fix from the same review, finding A5: the prompt sentence plus two buttons
 * could not fit one line on a narrow phone, and without wrapping the cluster
 * pushed its own row's content out of view instead of breaking.
 */
export function ConfirmPrompt({
  prompt,
  confirmLabel = 'Yes',
  confirmTestId,
  confirmAriaLabel,
  rowTestId,
  pending = false,
  className,
  onConfirm,
  onCancel,
}: {
  /** What is about to happen, in the user's terms ("Delete, with its history?"). */
  prompt: string;
  /** Defaults to "Yes"; pass a busy label while the mutation is in flight. */
  confirmLabel?: string;
  confirmTestId?: string;
  confirmAriaLabel?: string;
  rowTestId?: string;
  pending?: boolean;
  /** Layout classes owned by the host row (spacing, shrink behaviour). */
  className?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span
      data-testid={rowTestId}
      className={`flex flex-wrap items-center gap-1 text-xs${className ? ` ${className}` : ''}`}
    >
      <span className="text-muted-foreground">{prompt}</span>
      <button
        type="button"
        data-testid={confirmTestId}
        aria-label={confirmAriaLabel}
        disabled={pending}
        onClick={onConfirm}
        className="rounded px-1.5 py-0.5 text-red-400 hover:bg-accent disabled:opacity-50"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onCancel}
        className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        Cancel
      </button>
    </span>
  );
}
