/**
 * One-shot message that survives the reliable-mutation recipe's full reload
 * (#167). The recipe (see GoalForm, #166) confirms a mutation via the
 * re-rendered page — but surfaces whose confirmation is a TEXT REPORT (the
 * backfill honest count, the accounts "Statement saved" toast) would lose that
 * text to the reload. It rides sessionStorage across exactly one reload; the
 * reader consumes it. Best-effort: a storage error (private mode, quota)
 * degrades to no message, never a crash.
 */

function storageKey(key: string): string {
  return `aimplifi-flash:${key}`;
}

export function setFlash(key: string, message: string): void {
  try {
    sessionStorage.setItem(storageKey(key), message);
  } catch {
    /* best-effort */
  }
}

export function takeFlash(key: string): string | null {
  try {
    const k = storageKey(key);
    const m = sessionStorage.getItem(k);
    if (m !== null) sessionStorage.removeItem(k);
    return m;
  } catch {
    return null;
  }
}
