import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MoneyDialsForm } from '@/components/settings/money-dials-form';
import { DeleteMyDataForm } from '@/components/settings/delete-my-data-form';
import { SignOutEverywhere } from '@/components/settings/sign-out-everywhere';
import { CategoryManager } from '@/components/settings/category-manager';
import { CustomCategoryManager } from '@/components/settings/custom-category-manager';
import { getCategoryCatalog } from '@/server/categories';
import { getCustomCategories } from '@/server/category-meta';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { PAYMENT_ACCOUNT_TYPES, parseStoredDials } from '@/lib/engine/settings/dials';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { deletionSummary } from '@/lib/engine/account/deletion';
import { getVapidPublicKey, pushProviderConfigured } from '@/lib/push';
import { emailProviderConfigured } from '@/lib/email';
import { errorTrackingConfigured } from '@/lib/errors';
import { buildActivationChecklist, activationSummary } from '@/lib/engine/ops/activation';
import { PushOptIn } from '@/components/settings/push-optin';
import { HouseholdCard } from '@/components/settings/household-card';
import { getHouseholdView } from '@/server/household';
import { AccuracyMetrics, SelfAuditMetrics } from '@/components/triage/accuracy-card';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getThresholdTuning } from '@/server/tuning';
import { getLatestSelfAuditSnapshot } from '@/server/self-audit';
import { listLearnedPhrases } from '@/server/vocab';
import { LearnedPhrases } from '@/components/settings/learned-phrases';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const userId = session.user.id;
  const [user, accounts, txnCount, statementCount, goalCount, budgetCount, ruleCount, categoryCatalog, customCategories, accuracy, tuning, selfAudit, learnedPhrases] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          hourlyWageCents: true,
          swrBps: true,
          expectedReturnBps: true,
          moneyDials: true,
          paymentAccountId: true,
          currentAge: true,
          retirementAge: true,
          endAge: true,
          inflationBps: true,
        },
      }),
      prisma.account.findMany({
        where: { userId },
        select: { id: true, name: true, type: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      prisma.transaction.count({ where: { account: { userId } } }),
      prisma.statement.count({ where: { account: { userId } } }),
      prisma.goal.count({ where: { userId } }),
      prisma.budget.count({ where: { userId } }),
      prisma.categorizationRule.count({ where: { userId } }),
      getCategoryCatalog(userId),
      getCustomCategories(userId),
      getCategorizationAccuracy(userId),
      getThresholdTuning(userId),
      getLatestSelfAuditSnapshot(userId),
      listLearnedPhrases(userId),
    ]);
  const householdView = await getHouseholdView();
  if (!user) redirect('/sign-in');

  const customGroups = CUSTOM_CATEGORY_GROUPS;

  const eligibleAccounts = accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map((a) => ({ id: a.id, name: a.name }));

  const vapidPublicKey = getVapidPublicKey();

  // Operator activation checklist (Wave 0.5): compute env-var PRESENCE booleans here
  // in the server component (via the existing *Configured() helpers) and pass only the
  // derived rows down — no raw process.env value ever reaches the client. CRON_SECRET
  // has no helper; its presence is read inline (server-only) the same way.
  const activation = buildActivationChecklist({
    cronSecret: !!process.env.CRON_SECRET,
    email: emailProviderConfigured(),
    push: pushProviderConfigured(),
    errorTracking: errorTrackingConfigured(),
  });
  const activationCount = activationSummary(activation);

  const deletion = deletionSummary({
    accounts: accounts.length,
    transactions: txnCount,
    statements: statementCount,
    goals: goalCount,
    budgets: budgetCount,
    rules: ruleCount,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <MoneyDialsForm
        current={{
          hourlyWageCents: user.hourlyWageCents,
          swrBps: user.swrBps,
          expectedReturnBps: user.expectedReturnBps,
          moneyDials: parseStoredDials(user.moneyDials),
          paymentAccountId: user.paymentAccountId,
          currentAge: user.currentAge,
          retirementAge: user.retirementAge,
          endAge: user.endAge,
          inflationBps: user.inflationBps,
        }}
        accounts={eligibleAccounts}
      />
      <p className="px-1 text-xs text-muted-foreground" data-testid="assumptions-change">
        {COACH_COPY.assumptionsChange()}
      </p>

      <Card data-testid="export-card">
        <CardHeader className="pb-2">
          <CardDescription>Your data is yours</CardDescription>
          <CardTitle className="text-base">Export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <a
            href="/api/export?format=transactions-csv"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-transactions-csv"
          >
            Transactions (CSV)
          </a>
          <a
            href="/api/export?format=net-worth-csv"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-net-worth-csv"
          >
            Net worth (CSV)
          </a>
          <a
            href="/api/export?format=net-worth-pdf"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="export-net-worth-pdf"
          >
            Net worth report (PDF)
          </a>
        </CardContent>
      </Card>

      <Card data-testid="connections-card">
        <CardHeader className="pb-2">
          <CardDescription>Bank connections</CardDescription>
          <CardTitle className="text-base">Connect a bank or brokerage</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Link an account from the{' '}
          <a href="/accounts" className="underline hover:text-foreground">Accounts</a> page —
          SimpleFIN (a few dollars/year, no business gate) or Plaid. Access tokens are encrypted at
          rest (AES-256-GCM); only account masks (last 4) are ever stored.
        </CardContent>
      </Card>

      {vapidPublicKey && (
        <Card data-testid="notifications-card">
          <CardHeader className="pb-2">
            <CardDescription>Proactive heads-ups</CardDescription>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Get a push when a card payment is due within a few days or your checking is on track to
              dip below $0. Aimplifi never moves money — these are heads-ups so nothing catches you by
              surprise.
            </p>
            <PushOptIn publicKey={vapidPublicKey} />
          </CardContent>
        </Card>
      )}

      <Card data-testid="categories-card">
        <CardHeader className="pb-2">
          <CardDescription>Make the category list your own</CardDescription>
          <CardTitle className="text-base">Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your categories
            </h3>
            <CustomCategoryManager categories={customCategories} groups={customGroups} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Show or hide built-in categories
            </h3>
            <CategoryManager catalog={categoryCatalog} />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="ai-trust-card">
        <CardHeader className="pb-2">
          <CardDescription>How well the AI files your transactions</CardDescription>
          <CardTitle className="text-base">AI trust</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <AccuracyMetrics result={accuracy} tuning={tuning} />
          <SelfAuditMetrics snapshot={selfAudit} />
          <LearnedPhrases phrases={learnedPhrases} />
          <p className="text-xs text-muted-foreground">
            Aimplifi’s AI never invents a figure — every number is computed from your own
            transactions. This is how accurately it files them, scored against the categories you
            confirm.
          </p>
          <p className="text-xs text-muted-foreground" data-testid="engagement-disclosure">
            We also keep a first-party log of which dashboard cards you open, expand, or skip —
            only to personalize layout and quiet ignored tips later. Nothing is sent to third-party
            analytics; delete your account and the log goes with it.
          </p>
          <p className="text-xs" data-testid="trust-center-link">
            <Link href="/trust" className="underline underline-offset-2">
              Open the AI Trust Center
            </Link>{' '}
            <span className="text-muted-foreground">
              — where AI runs, its hard limits, and a ledger of model calls on your data.
            </span>
          </p>
        </CardContent>
      </Card>

      <Card data-testid="activation-card">
        <CardHeader className="pb-2">
          <CardDescription>Operator — which integrations are live on this deployment</CardDescription>
          <CardTitle className="text-base">Activation checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground" data-testid="activation-summary">
            {activationCount.live} of {activationCount.total} systems live. Dormant systems are safe
            no-ops — they turn on only when their environment variables are set (never shown here, only
            their names).
          </p>
          <ul role="list" className="space-y-2">
            {activation.map((row) => (
              <li
                key={row.key}
                data-testid={`activation-row-${row.key}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                  {row.status === 'dormant' && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Set to activate:{' '}
                      <span className="font-mono">{row.missing.join(', ')}</span>
                    </div>
                  )}
                </div>
                <span
                  data-testid={`activation-status-${row.key}`}
                  className={
                    row.status === 'live'
                      ? 'shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300'
                      : 'shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                  }
                >
                  {row.status === 'live' ? 'Live' : 'Dormant'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="household-card">
        <CardHeader className="pb-2">
          <CardDescription>{HOUSEHOLD_COPY.teamSportTagline()}</CardDescription>
          <CardTitle className="text-base">Household</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="household-disclosure">
            {HOUSEHOLD_COPY.disclosure()}
          </p>
          <HouseholdCard view={householdView} />
        </CardContent>
      </Card>

      <Card data-testid="security-card">
        <CardHeader className="pb-2">
          <CardDescription>Security — control your signed-in sessions</CardDescription>
          <CardTitle className="text-base">Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Demo destroy fence (#244 critic P1-3): an epoch bump would sign out
              every concurrent demo visitor; deletion would wipe the shared demo
              for everyone. Honest note instead; the actions refuse demo server-side too. */}
          {isDemoUser(userId) ? (
            <p className="text-sm text-muted-foreground" data-testid="demo-sessions-note">
              The demo is a shared account, so session controls are off here — in your own
              free account you can sign out of all devices anytime.
            </p>
          ) : (
            <SignOutEverywhere />
          )}
        </CardContent>
      </Card>

      <Card data-testid="privacy-card">
        <CardHeader className="pb-2">
          <CardDescription>Privacy — your data is yours to erase</CardDescription>
          <CardTitle className="text-base">Delete my data</CardTitle>
        </CardHeader>
        <CardContent>
          {isDemoUser(userId) ? (
            <p className="text-sm text-muted-foreground" data-testid="demo-delete-note">
              The demo is a shared account, so it can’t be deleted — in your own free
              account, everything you store is yours to erase, permanently, anytime.
            </p>
          ) : (
            <DeleteMyDataForm summary={deletion} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
