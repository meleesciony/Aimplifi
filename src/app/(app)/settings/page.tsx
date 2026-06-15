import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { MoneyDialsForm } from '@/components/settings/money-dials-form';
import { PAYMENT_ACCOUNT_TYPES, parseStoredDials } from '@/lib/engine/settings/dials';
import { prisma } from '@/lib/db';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const userId = session.user.id;
  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        hourlyWageCents: true,
        swrBps: true,
        expectedReturnBps: true,
        moneyDials: true,
        paymentAccountId: true,
      },
    }),
    prisma.account.findMany({
      where: { userId },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
  ]);
  if (!user) redirect('/sign-in');

  const eligibleAccounts = accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))
    .map((a) => ({ id: a.id, name: a.name }));

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
        }}
        accounts={eligibleAccounts}
      />

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
          <CardTitle className="text-base">Plaid (dormant)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This deployment runs in demo mode with seeded data. To connect real
          accounts, add <code className="rounded bg-accent px-1">PLAID_CLIENT_ID</code>,{' '}
          <code className="rounded bg-accent px-1">PLAID_SECRET</code> and set{' '}
          <code className="rounded bg-accent px-1">DATA_PROVIDER=plaid</code> — see{' '}
          <code className="rounded bg-accent px-1">docs/PLAID_WALKTHROUGH.md</code>. Access tokens
          are encrypted at rest (AES-256-GCM); only account masks (last 4) are ever stored.
        </CardContent>
      </Card>

      <Card data-testid="privacy-card">
        <CardHeader className="pb-2">
          <CardDescription>Privacy</CardDescription>
          <CardTitle className="text-base">Delete my data</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Deleting your account removes every account, transaction, statement,
          rule, correction, goal, and audit record (cascade delete), and — when
          Plaid is connected — calls <code className="rounded bg-accent px-1">/item/remove</code>{' '}
          to revoke bank access. The full path is documented in{' '}
          <code className="rounded bg-accent px-1">docs/PRIVACY.md</code>. In demo mode the
          dataset is re-creatable with <code className="rounded bg-accent px-1">npx prisma db seed</code>,
          so deletion is exposed once real accounts exist (Phase 5 UI).
        </CardContent>
      </Card>
    </div>
  );
}
