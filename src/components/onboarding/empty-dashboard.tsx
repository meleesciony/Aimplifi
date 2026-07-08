/**
 * First-run state for a brand-new (zero-account) user (DECISIONS #43). The
 * cash-needed engine needs accounts, so instead of computing it we welcome the
 * user and get them connected — this IS Step 1 of the guided first-run flow
 * (Competitive-Gap Gap 3 §3): bank → confirm payment account → see your
 * Cash-Needed number.
 *
 * The SimpleFIN and Plaid connect widgets are rendered INLINE (not linked out
 * to /accounts) so the SimpleFIN token walkthrough is visible on this very
 * screen with zero navigation — both are the same self-contained, already-
 * tested components /accounts uses, just given `connected=false` directly
 * (no DB read needed: a zero-account user by definition has no connection).
 * A successful connect reloads the current page (connect-simplefin.tsx /
 * connect-accounts-button.tsx), so this component naturally stops rendering
 * once accountCount > 0 — no wizard state to manage.
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ConnectSimplefin } from '@/components/finance/connect-simplefin';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { StepIndicator } from '@/components/onboarding/step-indicator';

// A brand-new user has never synced anything — the same shape
// classifyFreshness(null, today) returns. connected=false means ConnectSimplefin
// never reads it anyway, but the type wants a real FreshnessResult.
const NEVER_SYNCED = { level: 'unknown' as const, daysSince: null, referenceDate: null };

export function EmptyDashboard() {
  return (
    <Card data-testid="empty-dashboard">
      <CardHeader>
        <StepIndicator step={1} />
        {/* This card is the entire page for a brand-new (zero-account) user across every
            cash-engine-backed route (dashboard, cards, coach, goals, calendar, ...) — it's
            the only heading those pages render, so it must be the page's <h1>, not the
            CardTitle default of <h2> (production-readiness backlog, 2026-06-24). */}
        <CardTitle as="h1" className="text-xl">Welcome to Aimplifi 👋</CardTitle>
        <CardDescription>
          Add your accounts and Aimplifi will tell you exactly how much you need, and by when, to pay
          every card in full — plus your net worth, spending, and savings rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Connect a bank — takes about a minute:</p>
          <ConnectSimplefin connected={false} health={NEVER_SYNCED} />
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
        <p className="text-xs text-muted-foreground">
          Your data is private to your account. Next, Aimplifi will ask which account pays your
          cards (30 seconds) — then show your Cash-Needed number, zero navigation required.
        </p>
      </CardContent>
    </Card>
  );
}
