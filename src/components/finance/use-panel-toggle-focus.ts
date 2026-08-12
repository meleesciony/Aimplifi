'use client';

import { useRef, type MouseEvent } from 'react';

/**
 * O.20f (critic P2-d): keep focus on the reader's own screen when a
 * BreakdownPanel's inner Hide closes it.
 *
 * The panel is conditionally rendered on the opening control's selection state
 * (`selected && <BreakdownPanel/>`), so the Hide button lives INSIDE the
 * subtree the panel's own `onToggle(false)` unmounts — without this hook, the
 * focused element is removed and focus falls to <body>, which a keyboard or
 * screen-reader user cannot see. The OPENING control (bar, chip, segment) is
 * always mounted, so the call site records it on click and restores focus to
 * it when the panel collapses.
 *
 * Wire-up: `onClick={(e) => { rememberOpener(e); setSelected(...); }}` on every
 * opening control, and `onToggle={(o) => { if (!o) setSelected(null);
 * restoreFocus(o); }}` on the panel.
 */
export function usePanelToggleFocus(): {
  rememberOpener: (e: MouseEvent<HTMLButtonElement>) => void;
  restoreFocus: (nowOpen: boolean) => void;
} {
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const rememberOpener = (e: MouseEvent<HTMLButtonElement>) => {
    openerRef.current = e.currentTarget;
  };
  const restoreFocus = (nowOpen: boolean) => {
    if (!nowOpen) {
      const el = openerRef.current;
      openerRef.current = null;
      el?.focus();
    }
  };
  return { rememberOpener, restoreFocus };
}
