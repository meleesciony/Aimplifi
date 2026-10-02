/**
 * Shared first-run connect actions (DECISIONS #176 / Wave 1.5).
 *
 * Extracted from EmptyDashboard so coach/goals/calendar can keep the same
 * Plaid + CSV/manual paths and testids while framing their own
 * page payoff. Callers own the StepIndicator placement (dashboard: above the
 * welcome h1; route empties: inside their card header).
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { CONNECT_ONBOARDING_FOOTNOTE, CONNECT_ONBOARDING_HEADING } from '@/lib/copy/onboarding-empty-copy';

const DEFAULT_FOOTNOTE = CONNECT_ONBOARDING_FOOTNOTE;

export function ConnectOnboardingPanel({ footnote = DEFAULT_FOOTNOTE }: { footnote?: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">{CONNECT_ONBOARDING_HEADING}</p>
        {/* One way to link a bank: Plaid. SimpleFIN stood here too until it was retired
            as a way in (DECISIONS #780). */}
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
