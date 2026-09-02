/**
 * Shared first-run connect actions (DECISIONS #176 / Wave 1.5).
 *
 * Extracted from EmptyDashboard so coach/goals/calendar can keep the same
 * SimpleFIN + Plaid + CSV/manual paths and testids while framing their own
 * page payoff. Callers own the StepIndicator placement (dashboard: above the
 * welcome h1; route empties: inside their card header).
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { ConnectSimplefin } from '@/components/finance/connect-simplefin';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { CONNECT_ONBOARDING_FOOTNOTE } from '@/lib/copy/onboarding-empty-copy';

// A brand-new user has never synced anything — the same shape
// classifyFreshness(null, today) returns. connected=false means ConnectSimplefin
// never reads it anyway, but the type wants a real FreshnessResult.
const NEVER_SYNCED = { level: 'unknown' as const, daysSince: null, referenceDate: null };

const DEFAULT_FOOTNOTE = CONNECT_ONBOARDING_FOOTNOTE;

export function ConnectOnboardingPanel({ footnote = DEFAULT_FOOTNOTE }: { footnote?: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Connect a bank — takes about a minute:</p>
        {/* orphaned={null}: this panel renders only for a first-run user with nothing
            connected — a user whose SimpleFIN accounts outlived their connection has data
            and therefore never sees the onboarding empty state; /accounts carries the
            reconnect framing for them (K.2b). */}
        {/* historyDepth: a first-run user has no accounts at all, which is the one input for
            which the engine's answer is 'no-rows' — the same sentence this panel would want. */}
        <ConnectSimplefin connected={false} health={NEVER_SYNCED} orphaned={null} historyDepth={{ state: 'no-rows' }} />
        <ConnectAccountsButton />
      </div>
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Prefer not to link an account yet?</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/transactions/import"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="onboard-import"
          >
            Import a CSV from your bank
          </Link>
          <Link
            href="/accounts"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="onboard-manual"
          >
            Add an account manually
          </Link>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{footnote}</p>
    </div>
  );
}
