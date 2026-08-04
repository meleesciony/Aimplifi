'use client';

/**
 * Fixed / Discretionary label on a register row (DECISIONS #378).
 * The display-only rendering of the row's class — used wherever the dial may
 * not write (out-of-scope rows, uncategorized rows, the shared demo). Editable
 * rows get SpendClassSelect instead (DECISIONS #397); the badge and the select
 * share the same testid / data attributes so a surface can assert the class
 * without caring which control rendered it.
 *
 * WHY THIS IS A CLIENT COMPONENT NOW. The out-of-scope case carried its
 * explanation in a `title` attribute, which a phone cannot show — there is no
 * hover on touch. So on the owner's screenshot (2026-08-03) the chip read
 * "Not counted" with no way, anywhere in the app, to find out what that meant.
 * A tooltip that only a mouse can open is not a disclosure. The reason chip is
 * therefore a real button that opens a real panel.
 *
 * THE DEMO FENCE STILL HOLDS. Only the out-of-scope chip becomes a button; a
 * Fixed / Discretionary badge stays an inert span, because the thing the demo
 * is fenced away from is WRITING the class, and there is nothing to explain
 * about a working dial. The e2e asserts the demo's Groceries row has no
 * `button[data-testid="txn-spend-class"]`, and the disclosure button carries
 * its own testid inside the labelled span, so that lock is untouched.
 */
import { useEffect, useRef, useState } from 'react';
import {
  OUT_OF_SCOPE_HEADING,
  outOfScopeChipLabel,
  outOfScopeExplanation,
  spendClassLabel,
  type OutOfScopeReason,
  type SpendClass,
} from '@/lib/engine/spending-plan/spend-class';

/** Same chrome as Details / Rule… on the register row — one definition, so the
 *  row's chips cannot drift apart in size again (REGRESSION_LEDGER 2026-08-03). */
export const ROW_CHIP =
  'tap-target inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50';

/** The explanation panel's preferred width, and the page gutter it must keep. */
const PANEL_PX = 240;
const GUTTER_PX = 8;

/**
 * Where to put the panel so ALL of it is on screen, as an offset from the chip.
 *
 * Flipping left/right anchoring is not enough and was measured failing: the chip
 * follows however wide the merchant name and the Details / Rule… links ahead of
 * it happen to be, so on the 380px register a chip near the right edge overflows
 * when left-anchored AND overflows the other way when right-anchored (the panel
 * is wider than the space either side of it). The panel is therefore CLAMPED to
 * the viewport rather than anchored to an edge of the chip.
 */
export function panelOffset(
  chipLeft: number,
  viewportWidth: number,
): { left: number; width: number } {
  const width = Math.min(PANEL_PX, Math.max(0, viewportWidth - GUTTER_PX * 2));
  // Math.max last: with a viewport narrower than the panel, the lower bound wins
  // and the panel starts at the gutter rather than at a negative coordinate.
  const clamped = Math.max(GUTTER_PX, Math.min(chipLeft, viewportWidth - GUTTER_PX - width));
  return { left: clamped - chipLeft, width };
}

export function SpendClassBadge({
  spendClass,
  reason,
}: {
  spendClass: SpendClass;
  /**
   * Why this row has no dial, from `outOfScopeReason`. REQUIRED rather than
   * optional: an absent value would silently reprint the generic label at
   * exactly the call site that forgot to compute it, which is the failure this
   * whole change exists to remove. `null` is the honest value for a row that
   * HAS a class (Fixed / Discretionary), and for one whose reason a caller
   * genuinely cannot derive.
   */
  reason: OutOfScopeReason | null;
}) {
  const [open, setOpen] = useState(false);
  /** Measured on open, the way the row's action menu picks up vs down. */
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A row with a class: inert label, exactly as before.
  if (spendClass !== 'out-of-scope' || reason === null) {
    return (
      <span
        data-testid="txn-spend-class"
        data-spend-class={spendClass}
        className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        {spendClassLabel(spendClass)}
      </span>
    );
  }

  const label = outOfScopeChipLabel(reason);
  return (
    <span
      className="relative inline-flex min-w-0 flex-col"
      data-testid="txn-spend-class"
      data-spend-class={spendClass}
      data-spend-class-reason={reason}
      ref={rootRef}
    >
      <button
        type="button"
        data-testid="txn-spend-class-why"
        aria-expanded={open}
        aria-label={`${label} — why this has no Fixed or Discretionary choice`}
        className={ROW_CHIP}
        onClick={() => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setPlace(panelOffset(rect.left, window.innerWidth));
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>
      {open ? (
        <span
          role="note"
          data-testid="txn-spend-class-why-panel"
          className="absolute top-full z-20 mt-0.5 rounded border bg-background p-2 text-left shadow-md"
          style={{ left: place?.left ?? 0, width: place?.width ?? PANEL_PX }}
        >
          <span className="block text-[10px] font-medium text-foreground">
            {OUT_OF_SCOPE_HEADING}
          </span>
          <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
            {outOfScopeExplanation(reason)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
