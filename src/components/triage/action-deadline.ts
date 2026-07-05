/**
 * Bounded wait for one server-action round-trip (the triage pending-stall fix,
 * probed 2026-07-05). Next.js cancels a superseded action's response stream when
 * rapid sequential actions overlap (client-side net::ERR_ABORTED on the action
 * POST); the action's RETURN VALUE rides the first chunk, so the race is usually
 * harmless — but when the stream is severed BEFORE the value chunk parses, the
 * awaited promise never settles. Un-bounded, that leaves useTransition's
 * `pending` true forever and every triage button disabled until a full reload
 * (the phase2-triage "button stuck disabled" flake, STATUS 2026-07-04/05).
 *
 * The write itself has usually COMMITTED (server-side probes put the action at
 * ~5ms) — only the confirmation was lost — so callers must NOT treat a deadline
 * as "nothing was saved": recover by re-syncing authoritative state, not by
 * rolling back the optimistic update.
 */

/** Distinguishes a severed-stream deadline from a real action failure. */
export class ActionDeadline extends Error {
  constructor() {
    super('The action did not confirm in time (response stream likely severed).');
    this.name = 'ActionDeadline';
  }
}

/** One generous round-trip budget: far above any healthy action (~5ms server +
 *  stream), far below the point where a user gives up on a frozen screen. */
export const ACTION_DEADLINE_MS = 15_000;

/** Resolve/reject with `p`, or reject with ActionDeadline at the deadline. The
 *  timer is cleared on settle so a healthy action leaks nothing. */
export function withDeadline<T>(p: Promise<T>, deadlineMs: number = ACTION_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ActionDeadline()), deadlineMs);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
