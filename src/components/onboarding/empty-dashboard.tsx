/**
 * First-run state for a brand-new (zero-account) user (DECISIONS #43). The
 * cash-needed engine needs accounts, so instead of computing it we welcome the
 * user and point them at the three ways to get data in.
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export function EmptyDashboard() {
  return (
    <Card data-testid="empty-dashboard">
      <CardHeader>
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
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">Get started:</p>
        <div className="flex flex-col gap-2">
          <Link href="/accounts" className={buttonVariants({ variant: 'default' })} data-testid="onboard-connect">
            Connect a bank or brokerage
          </Link>
          <Link href="/transactions/import" className={buttonVariants({ variant: 'outline' })} data-testid="onboard-import">
            Import a CSV from your bank
          </Link>
          <Link href="/accounts" className={buttonVariants({ variant: 'outline' })} data-testid="onboard-manual">
            Add an account manually
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Connecting a bank needs Plaid configured; otherwise CSV import and manual entry work with no
          setup. Your data is private to your account.
        </p>
      </CardContent>
    </Card>
  );
}
