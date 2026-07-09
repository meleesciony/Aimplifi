/**
 * Sanitized sync-failure reasons (Gap 1 §4).
 *
 * A caught provider sync error must be reduced to a SAFE, non-sensitive label before it
 * is persisted on the connection row (SimpleFinConnection.lastSyncError / PlaidItem.
 * lastSyncError), because a raw SimpleFIN/Plaid error can embed the credential-bearing
 * access URL (Hostile Critic SEC-SF-4 / STATUS SimpleFIN #5). `safeSyncErrorReason`
 * returns ONLY a value from a fixed, allow-listed set — never the raw message — so the
 * stored signal is leak-proof by construction. The reason is diagnostic breadcrumb only;
 * the user-facing reconnect copy (engine/sync/health.ts) never echoes it.
 */

export type SyncFailureReason = 'auth' | 'timeout' | 'network' | 'server' | 'unknown';

const REASONS: readonly SyncFailureReason[] = ['auth', 'timeout', 'network', 'server', 'unknown'];

/** True for a valid persisted reason (guards reads of legacy/hand-set values). */
export function isSyncFailureReason(v: unknown): v is SyncFailureReason {
  return typeof v === 'string' && (REASONS as readonly string[]).includes(v);
}

/**
 * Classify a caught sync error into a coarse, secret-free reason. Only the error's
 * class name and HTTP-status-like markers are inspected; the free-text message (which
 * may carry the access URL) is never returned or pattern-matched for anything but a
 * bare status code. Anything unrecognized collapses to 'unknown'.
 */
export function safeSyncErrorReason(err: unknown): SyncFailureReason {
  const name = err instanceof Error ? err.name : '';
  if (/Abort|Timeout/i.test(name)) return 'timeout';

  const status = httpStatusOf(err);
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status != null && status >= 500) return 'server';
  if (status != null && status >= 400) return 'network';

  if (/TypeError|FetchError|Network/i.test(name)) return 'network';
  return 'unknown';
}

/** Best-effort read of a numeric HTTP status off a thrown error/response-like object. */
function httpStatusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const s = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return null;
}
