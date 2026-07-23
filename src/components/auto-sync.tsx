'use client';

/**
 * Auto-sync on page load (DECISIONS #91). Mounted once in the app layout, so it
 * runs on a full page load / refresh but NOT on client-side (soft) navigations —
 * the layout doesn't remount on those. That matches "sync whenever the site is
 * opened or refreshed". It calls the real SimpleFIN sync server action in the
 * background (never blocking render) and refreshes the server-rendered data only
 * if the sync actually ingested new rows.
 *
 * A short sessionStorage throttle coalesces rapid reloads / multiple tabs so a
 * refresh-happy user can't hammer the SimpleFIN bridge into a rate-limit (which
 * would break syncing — the opposite of the goal). THROTTLE_MS is intentionally
 * small so any realistic refresh still pulls fresh data.
 *
 * `enabled` is false for users without a SimpleFIN connection (demo / manual
 * only), so it's a no-op for them — no pointless server round-trip per load.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { syncSimplefinNow } from '@/server/simplefin-actions';
import { syncPlaidNow } from '@/server/plaid-actions';

const THROTTLE_MS = 10_000;
const STAMP_KEY = 'aimplifi:lastAutoSync';
/** Plaid bills per API call, so its background pull is throttled far harder. */
const PLAID_THROTTLE_MS = 15 * 60_000;
const PLAID_STAMP_KEY = 'aimplifi:lastAutoSyncPlaid';

function recentlySynced(key: string, windowMs: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(key) ?? '0');
    return Number.isFinite(last) && Date.now() - last < windowMs;
  } catch {
    return false; // storage unavailable → just sync
  }
}

function stampNow(key: string): void {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // ignore — throttling is best-effort
  }
}

export function AutoSync({ enabled, plaid = false }: { enabled: boolean; plaid?: boolean }) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if ((!enabled && !plaid) || ran.current) return;
    ran.current = true; // guard React's dev double-invoke / any remount this session

    let cancelled = false;
    void (async () => {
      let changed = false;
      if (enabled && !recentlySynced(STAMP_KEY, THROTTLE_MS)) {
        stampNow(STAMP_KEY);
        try {
          const r = await syncSimplefinNow();
          if (r.ok && (r.added ?? 0) > 0) changed = true;
        } catch {
          // best-effort background refresh — never surface a failure to the user
        }
      }
      // Plaid gets its OWN, much longer throttle: unlike the SimpleFIN bridge,
      // production Plaid calls are billed per request and this fires on every full
      // page load. The on-demand "Sync now" button covers the impatient case.
      if (plaid && !recentlySynced(PLAID_STAMP_KEY, PLAID_THROTTLE_MS)) {
        stampNow(PLAID_STAMP_KEY);
        try {
          const r = await syncPlaidNow();
          if (r.ok && ((r.added ?? 0) > 0 || (r.statementsWritten ?? 0) > 0)) changed = true;
        } catch {
          // same contract as above
        }
      }
      // Only re-fetch server data when something actually changed — a no-change
      // sync shouldn't trigger a full re-render on every load.
      if (!cancelled && changed) router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, plaid, router]);

  return null;
}
