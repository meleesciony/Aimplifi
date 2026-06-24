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

const THROTTLE_MS = 10_000;
const STAMP_KEY = 'aimplifi:lastAutoSync';

function recentlySynced(): boolean {
  try {
    const last = Number(sessionStorage.getItem(STAMP_KEY) ?? '0');
    return Number.isFinite(last) && Date.now() - last < THROTTLE_MS;
  } catch {
    return false; // storage unavailable → just sync
  }
}

function stampNow(): void {
  try {
    sessionStorage.setItem(STAMP_KEY, String(Date.now()));
  } catch {
    // ignore — throttling is best-effort
  }
}

export function AutoSync({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true; // guard React's dev double-invoke / any remount this session
    if (recentlySynced()) return;
    stampNow();

    let cancelled = false;
    void (async () => {
      try {
        const r = await syncSimplefinNow();
        // Only re-fetch server data when something actually changed — a no-change
        // sync shouldn't trigger a full re-render on every load.
        if (!cancelled && r.ok && (r.added ?? 0) > 0) router.refresh();
      } catch {
        // best-effort background refresh — never surface a failure to the user
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, router]);

  return null;
}
