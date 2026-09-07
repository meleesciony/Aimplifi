import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CardAddControl } from '@/components/finance/card-add-control';
import { CardsBreakdown } from '@/components/finance/cards-breakdown';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PushOptIn } from '@/components/settings/push-optin';
import { HouseholdScopeToggle } from '@/components/dashboard/household-scope-toggle';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import { getDashboardData } from '@/server/finance';
import type { ManualCardBilling } from '@/server/transactions';
import { getVapidPublicKey } from '@/lib/push';

export const metadata = { title: "Credit cards" };

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  // No accounts yet → first-run onboarding (the cash-needed engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  // Household scope toggle (TASKS 4.2 slice 5) — same searchParam contract as
  // /dashboard: getDashboardData re-derives the EFFECTIVE scope (falls back to
  // 'mine' without live partners), so a stale `?scope=household` link never errors.
  const requestedScope = (await searchParams).scope === 'household' ? 'household' : 'mine';
  const data = await getDashboardData(session.user.id, requestedScope);

  const creditAccounts = await prisma.account.findMany({
    where: { userId, type: 'CREDIT' },
    select: { id: true, name: true, displayName: true, provider: true, aprBps: true },
  });
  const canRenameCard = !isDemoUser(session.user.id);
  const canAddCard = canRenameCard;
  const vapidPublicKey = getVapidPublicKey();
  const plaidCount = await prisma.plaidItem.count({ where: { userId } });
  const canDeepenHistory = canRenameCard && plaidCount > 0;

  const cardRenameById: Record<string, { feedName: string; hasOverlay: boolean }> = {};
  const canAddStatementById: Record<string, boolean> = {};
  const manualCreditIds = creditAccounts.filter((a) => a.provider === 'manual').map((a) => a.id);
  for (const a of creditAccounts) {
    cardRenameById[a.id] = { feedName: a.name, hasOverlay: Boolean(a.displayName) };
    canAddStatementById[a.id] = a.provider === 'manual';
  }
  // Same shape Accounts builds for manual cards — Edit/Clear on Cards needs it.
  const cardBilling: Record<string, ManualCardBilling> = {};
  if (manualCreditIds.length > 0) {
    const [statements, autopays] = await Promise.all([
      prisma.statement.findMany({
        where: { accountId: { in: manualCreditIds } },
        orderBy: { cycleEnd: 'desc' },
        select: {
          accountId: true,
          cycleEnd: true,
          dueDate: true,
          statementBalanceCents: true,
          minimumPaymentCents: true,
        },
      }),
      prisma.autopayConfig.findMany({
        where: { accountId: { in: manualCreditIds } },
        select: { accountId: true, mode: true, fixedAmountCents: true },
      }),
    ]);
    const newestStatement = new Map<string, (typeof statements)[number]>();
    for (const s of statements) if (!newestStatement.has(s.accountId)) newestStatement.set(s.accountId, s);
    const autopayByAccount = new Map(autopays.map((a) => [a.accountId, a]));
    for (const a of creditAccounts) {
      if (a.provider !== 'manual') continue;
      const ap = autopayByAccount.get(a.id);
      const s = newestStatement.get(a.id);
      const common = {
        aprBps: a.aprBps,
        autopayMode: ap?.mode ?? null,
        autopayFixedAmountCents: ap?.mode === 'FIXED_AMOUNT' ? ap.fixedAmountCents : null,
      };
      cardBilling[a.id] = s
        ? {
            hasStatement: true,
            statementBalanceCents: s.statementBalanceCents,
            minimumPaymentCents: s.minimumPaymentCents,
            dueDate: s.dueDate,
            cycleEnd: s.cycleEnd,
            ...common,
          }
        : { hasStatement: false, ...common };
    }
  }

  // "No credit cards yet" is a claim about what the user HAS, but `cards` only
  // holds cards the engine could place a due date on — so a linked card whose
  // issuer sent no statement fell into this branch and was told to connect the
  // bank it was already connected to (owner-reported 2026-07-23). Undatable cards
  // still count as cards; CardsBreakdown lists them under "No due date yet".
  if (data.payInFull.cards.length === 0 && data.payInFull.unknownDueDateCards.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Credit cards</h1>
        {data.household?.hasPartners && (
          <HouseholdScopeToggle scope={data.scope} householdName={data.household.name} basePath="/cards" />
        )}
        {/* 2026-07-21 agent review A1: don't dead-end to /accounts — offer the real
            connect/add affordances inline. Plaid's button is self-contained (token
            minted on click); SimpleFIN connect stays on /accounts, where its
            connection state is actually known. */}
        <Card className="border-dashed" data-testid="cards-empty">
          <CardContent className="space-y-4 py-8 text-sm text-muted-foreground">
            <p className="text-center">
              No credit cards yet. Connect the bank that issues your card — or add it
              manually — to get your “how much &amp; when to pay every card in full” plan here.
            </p>
            <div className="mx-auto flex max-w-sm flex-col items-stretch gap-2">
              <ConnectAccountsButton />
              {canAddCard ? (
                <CardAddControl
                  triggerTestId="cards-empty-manual"
                  triggerLabel="Add a card manually"
                  idleClassName={buttonVariants({ variant: 'outline', size: 'sm' })}
                />
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href="/transactions/import"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="cards-empty-import"
                >
                  Import a CSV
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

      {canDeepenHistory ? (
        <Card data-testid="cards-deepen-history-card">
          <CardHeader className="pb-2">
            <CardDescription>Bank history</CardDescription>
            <CardTitle className="text-base">Only seeing a few months?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Pull a longer window from a bank you already connected — same deepen control as
              Accounts and Home. Helps card statements and due dates fill in. Aimplifi never moves
              money.
            </p>
            <div data-testid="deepen-history-panel">
              <ConnectAccountsButton deepenHistory />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {vapidPublicKey ? (
        <Card data-testid="cards-notifications-card">
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
      ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit cards</h1>
      {data.household?.hasPartners && (
        <HouseholdScopeToggle
          scope={data.scope}
          householdName={data.household.name}
          basePath="/cards"
          withheldCount={data.householdWithheldCount}
          duplicates={data.householdDuplicates}
        />
      )}
      {canAddCard ? <CardAddControl /> : null}
      <CardsBreakdown
        payInFull={data.payInFull}
        minimum={data.minimum}
        paymentAccountName={data.paymentAccountName}
        today={data.today}
        accountOwnerLabel={data.accountOwnerLabel}
        cardMask={data.cardMask}
        cardDuplicates={data.cardDuplicates}
        householdName={data.scope === 'household' ? data.household?.name ?? null : null}
        canRenameCard={canRenameCard}
        cardRenameById={cardRenameById}
        canAddStatementById={canAddStatementById}
        cardBilling={cardBilling}
      />

      {canDeepenHistory ? (
        <Card data-testid="cards-deepen-history-card">
          <CardHeader className="pb-2">
            <CardDescription>Bank history</CardDescription>
            <CardTitle className="text-base">Only seeing a few months?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Pull a longer window from a bank you already connected — same deepen control as
              Accounts and Home. Helps card statements and due dates fill in. Aimplifi never moves
              money.
            </p>
            <div data-testid="deepen-history-panel">
              <ConnectAccountsButton deepenHistory />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {vapidPublicKey ? (
        <Card data-testid="cards-notifications-card">
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
      ) : null}
    </div>
  );
}
