/**
 * Which register rows the reader has opened, kept for the browser session (U.1b).
 *
 * On a phone a register row is two or three lines until it is opened; opening shows every
 * control the row has. Every write on this page confirms itself with a full reload (the
 * #167 recipe — `reloadPreservingScroll`, which the row's menus AND its ten inline
 * editors all call), so React state alone would close the row the reader was working in
 * the moment their edit landed. `RegisterScrollRestorer` already
 * puts them back at the same scroll offset; this puts the row back in the same state. Same
 * reason the Account cleanup section on /accounts is sticky.
 *
 * sessionStorage, not localStorage: it is the place in a task, not a preference. Storage
 * can be unavailable (private mode, a blocked site) — every access is guarded, and with no
 * storage the rows simply start closed after a reload.
 */
const KEY = 'aimplifi:register-open-rows';

/**
 * Stale ids (rows on another page, deleted rows) are harmless but should not pile up, so
 * the list is bounded — far above anything a reader opens in a session. It was 30, and a
 * cap a reader can reach closes a row they did not touch: opening the 31st closed the
 * first, and where there is no scroll anchoring (Safari) the row under the reader's thumb
 * jumped by the closed row's height — 142–158px (critic cycle 4).
 */
export const MAX_OPEN_ROWS = 500;

/** The ids in `raw`, or an empty set for anything that is not a JSON array of strings. */
export function parseOpenRows(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string').slice(-MAX_OPEN_ROWS));
  } catch {
    return new Set();
  }
}

/** `open` with `id` set to `nextOpen`, newest last, capped at MAX_OPEN_ROWS (oldest dropped). */
export function withRowOpen(open: ReadonlySet<string>, id: string, nextOpen: boolean): Set<string> {
  const ids = [...open].filter((v) => v !== id);
  if (nextOpen) ids.push(id);
  return new Set(ids.slice(-MAX_OPEN_ROWS));
}

export function readOpenRows(): Set<string> {
  try {
    return parseOpenRows(window.sessionStorage.getItem(KEY));
  } catch {
    return new Set();
  }
}

export function writeOpenRows(open: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...open]));
  } catch {
    // No storage: the rows start closed after the next reload. Nothing to report.
  }
}
