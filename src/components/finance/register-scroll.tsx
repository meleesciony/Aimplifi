'use client';

/**
 * Keep the reader's place across a register mutation's reload.
 *
 * WHY A RELOAD AT ALL. Every inline edit on /transactions confirms itself by
 * reloading the page — deliberately, not lazily. `router.refresh()`'s
 * application was a coin-flip at human pacing (the probe in
 * scripts/audit-probes/recategorize-mutation.ts landed 0 of 2 rounds), so the
 * re-rendered row is the only confirmation that cannot lie
 * (#164/#166/#167, docs/lessons/mutation-form-recipe.md). That recipe stays.
 *
 * WHY THE PLACE IS LOST ANYWAY. Owner report, 2026-08-03: "changing a field in
 * activity … completely refresh page and bring me to the top … very annoying
 * when I'm trying to log many at a time." The browser restores scroll on a
 * reload by itself, but it cannot here: `(app)/loading.tsx` paints a ~600px
 * skeleton first, and a restore into a document shorter than the target offset
 * clamps to the top. Measured on the pre-fix build at 380×800 — a reader 4,451px
 * down the register landed at 114px after excluding one row, and 5,511px down
 * landed at the same 114px after re-filing a category.
 *
 * THE FIX. Save the offset immediately before the reload, restore it once the
 * new list has mounted. One writer, one reader, one key.
 *
 * The save is bundled INTO the reload (`reloadPreservingScroll`) rather than
 * left as a step each mutation remembers: this replaced fifteen separate
 * `window.location.reload()` call sites across three components, and a fence
 * copied per call site misses call sites
 * (docs/lessons/fence-by-construction-not-per-call-site.md). A mutation added
 * later gets the behaviour by calling the same reload everything else calls.
 *
 * When the offset may be spent — TTL, view match, malformed value — lives in
 * `register-scroll-store.ts`, where the node suite can execute every branch.
 */
import { useEffect } from 'react';
import {
  decodeSavedScroll,
  encodeSavedScroll,
} from '@/components/finance/register-scroll-store';

/** Per-tab, and consumed on read. */
const KEY = 'aimplifi:register-scroll';

/** Which register view an offset was measured in — filters change the list. */
function currentView(): string {
  return window.location.pathname + window.location.search;
}

/**
 * Reload /transactions, keeping the reader where they were.
 *
 * Never throws: sessionStorage is unavailable in some privacy modes and over
 * quota in others, and losing the scroll position must never cost the reader
 * the confirmation reload itself.
 */
export function reloadPreservingScroll(): void {
  try {
    sessionStorage.setItem(
      KEY,
      encodeSavedScroll({
        y: Math.round(window.scrollY),
        at: Date.now(),
        view: currentView(),
      }),
    );
  } catch {
    // No place to stash it — reload anyway; the write still needs confirming.
  }
  window.location.reload();
}

/**
 * Restores the saved offset on mount. Rendered ONCE by the register page, not
 * per list: both lists on /transactions (your own and a household partner's
 * "Shared with you") write the same key, and two readers would race for one
 * value.
 *
 * The read CLEARS the key, so one save can never be spent twice.
 * `window.scrollTo` clamps to the document height on its own, so a list that
 * came back shorter than it went (a row that left the current filter) lands at
 * the new bottom rather than failing.
 */
export function RegisterScrollRestorer(): null {
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(KEY);
      if (raw !== null) sessionStorage.removeItem(KEY);
    } catch {
      return;
    }
    const y = decodeSavedScroll(raw, Date.now(), currentView());
    if (y === null) return;
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  }, []);
  return null;
}
