/**
 * First-run state for a brand-new (zero-account) user (DECISIONS #43). The
 * cash-needed engine needs accounts, so instead of computing it we welcome the
 * user and get them connected — this IS Step 1 of the guided first-run flow
 * (Competitive-Gap Gap 3 §3): bank → confirm payment account → see your
 * Cash-Needed number.
 *
 * Connect actions live in ConnectOnboardingPanel (shared with route-specific
 * empties on coach/goals/calendar — TASKS 1.5). Dashboard keeps the generic
 * welcome framing; those routes explain their own payoff.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectOnboardingPanel } from '@/components/onboarding/connect-onboarding-panel';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { EMPTY_DASHBOARD_DESCRIPTION } from '@/lib/copy/onboarding-empty-copy';

export function EmptyDashboard() {
  return (
    <Card data-testid="empty-dashboard">
      <CardHeader>
        <StepIndicator step={1} />
        {/* This card is the entire page for a brand-new (zero-account) user on
            dashboard (and remaining EmptyDashboard routes) — it's the only
            heading those pages render, so it must be the page's <h1>, not the
            CardTitle default of <h2> (production-readiness backlog, 2026-06-24). */}
        <CardTitle as="h1" className="text-xl">Welcome to Aimplifi 👋</CardTitle>
        <CardDescription data-testid="empty-dashboard-description">
          {EMPTY_DASHBOARD_DESCRIPTION}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectOnboardingPanel />
      </CardContent>
    </Card>
  );
}
