import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { type DataFreshnessSummary, dataFreshnessBanner } from '@/lib/engine/sync/health';
import { SyncAllButton } from '@/components/finance/sync-all-button';

/**
 * Dashboard heads-up when the user's linked bank feed has gone quiet (Gap 1 §3–4).
 * Renders nothing for a fresh feed / a manual-only or demo user (shouldWarn=false),
 * so the common case and the seeded demo are byte-identical.
 *
 * All copy lives in the pure `dataFreshnessBanner` (unit-tested — it never asserts a
 * connection is "broken", only that data is old, and phrases the fix as optional).
 * role="status", not "alert": a persistent qualifier of the figures, not an interruption.
 *
 * When canSync, Sync now runs the same syncAllAccounts writer as Accounts (DECISIONS #688)
 * so a quiet feed does not require leaving Home.
 */
export function StaleDataBanner({
  summary,
  canSync = false,
}: {
  summary: DataFreshnessSummary;
  /** False on demo / no linked banks — Sync would be a dead control. */
  canSync?: boolean;
}) {
  const copy = dataFreshnessBanner(summary);
  if (!copy) return null;
  return (
    <Alert role="status" data-testid="stale-data-banner">
      <AlertTitle>Your data may be out of date</AlertTitle>
      <AlertDescription>
        {copy}{' '}
        {canSync ? (
          <>
            <SyncAllButton connected variant="inline" flashKey="dashboard" />
            {' · '}
          </>
        ) : null}
        <Link href="/accounts" className="font-medium underline underline-offset-2">
          Go to Accounts
        </Link>
      </AlertDescription>
    </Alert>
  );
}
