import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MoneyDialsForm } from '@/components/settings/money-dials-form';
import { DeleteMyDataForm } from '@/components/settings/delete-my-data-form';
import { CategoryManager } from '@/components/settings/category-manager';
import { CustomCategoryManager } from '@/components/settings/custom-category-manager';
import { getCategoryCatalog } from '@/server/categories';
import { getCustomCategories } from '@/server/category-meta';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { PAYMENT_ACCOUNT_TYPES, parseStoredDials } from '@/lib/engine/settings/dials';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { deletionSummary } from '@/lib/engine/account/deletion';
import { getVapidPublicKey } from '@/lib/push';
import { PushOptIn } from '@/components/settings/push-optin';
import { prisma } from '@/lib/db';

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const userId = session.user.id;
  const [user, accounts, txnCount, statementCount, goalCount, budgetCount, ruleCount, categoryCatalog, customCategories] =
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
    ]);
  if (!user) redirect('/sign-in');

  const customGroups = CUSTOM_CATEGORY_GROUPS;

  const eligibleAccounts = accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map((a) => ({ id: a.id, name: a.name }));

  const vapidPublicKey = getVapidPublicKey();

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

      <Card data-testid="privacy-card">
        <CardHeader className="pb-2">
          <CardDescription>Privacy — your data is yours to erase</CardDescription>
          <CardTitle className="text-base">Delete my data</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteMyDataForm summary={deletion} />
        </CardContent>
      </Card>
    </div>
  );
}
