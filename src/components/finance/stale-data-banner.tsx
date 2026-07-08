import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { type DataFreshnessSummary, dataFreshnessBanner } from '@/lib/engine/sync/health';

/**
 * Dashboard heads-up when the user's linked bank feed has gone quiet (Gap 1 §3–4).
 * Renders nothing for a fresh feed / a manual-only or demo user (shouldWarn=false),
 * so the common case and the seeded demo are byte-identical.
 *
 * All copy lives in the pure `dataFreshnessBanner` (unit-tested — it never asserts a
 * connection is "broken", only that data is old, and phrases the fix as optional).
 * role="status", not "alert": a persistent qualifier of the figures, not an interruption.
 */
export function StaleDataBanner({ summary }: { summary: DataFreshnessSummary }) {
  const copy = dataFreshnessBanner(summary);
  if (!copy) return null;
  return (
    <Alert role="status" data-testid="stale-data-banner">
      <AlertTitle>Your data may be out of date</AlertTitle>
      <AlertDescription>
        {copy}{' '}
        <Link href="/accounts" className="font-medium underline underline-offset-2">
          Go to Accounts
        </Link>
      </AlertDescription>
    </Alert>
  );
}
