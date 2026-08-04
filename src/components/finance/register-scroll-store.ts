/**
 * The decision half of the register's scroll restore: what a saved offset means
 * and when it may be spent. Kept out of `register-scroll.tsx` — and free of
 * `window` / `sessionStorage` — so every refusal below is reachable from the
 * node test suite. A guard nothing executes is only a claim that something is
 * handled (docs/lessons/a-dead-branch-is-a-claim-that-something-is-handled.md).
 *
 * See `register-scroll.tsx` for why the register reloads at all.
 */

/**
 * How long a saved offset stays valid. The save and the load it is for are one
 * continuous action, so this only has to outlast a slow reload.
 *
 * It exists because the reload is not guaranteed to reach the restorer: an
 * expired session redirects to /sign-in instead, and a reader who signs back in
 * minutes later would otherwise be thrown down the page by an offset saved
 * before the interruption.
 */
export const SAVED_SCROLL_TTL_MS = 60_000;

export type SavedScroll = {
  /** Window offset in px at the moment of the write. */
  y: number;
  /** Epoch ms of the write. */
  at: number;
  /** pathname + search the offset was measured in — filters change the list. */
  view: string;
};

export function encodeSavedScroll(saved: SavedScroll): string {
  return JSON.stringify(saved);
}

/**
 * The offset to restore, or null to leave the page where the browser put it.
 *
 * Every refusal fails toward NOT restoring, which is exactly the behaviour
 * before this feature existed — whereas restoring the wrong offset is a jump
 * the reader never asked for. That asymmetry is why the checks are cheap and
 * why an unparseable value is discarded rather than guessed at.
 */
export function decodeSavedScroll(
  raw: string | null,
  now: number,
  view: string,
): number | null {
  if (raw === null) return null;
  let saved: { y?: unknown; at?: unknown; view?: unknown };
  try {
    saved = JSON.parse(raw) as typeof saved;
  } catch {
    return null; // not a value this build wrote
  }
  if (saved === null || typeof saved !== 'object') return null;
  const { y, at, view: savedView } = saved;
  // y <= 0 is the top of the page: nothing to restore, and restoring it would
  // fight the browser rather than help.
  if (typeof y !== 'number' || !Number.isFinite(y) || y <= 0) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  // A clock that moved backwards (a system time change mid-reload) makes the age
  // meaningless, so it is refused the same way a stale one is.
  const age = now - at;
  if (age < 0 || age > SAVED_SCROLL_TTL_MS) return null;
  if (savedView !== view) return null;
  return y;
}
