import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ConnectAccountsButton } from '@/components/finance/connect-accounts-button';
import { MoneyDialsForm } from '@/components/settings/money-dials-form';
import { RichLifeForm } from '@/components/settings/rich-life-form';
import { DeleteMyDataForm } from '@/components/settings/delete-my-data-form';
import { SignOutEverywhere } from '@/components/settings/sign-out-everywhere';
import { CategoryManager } from '@/components/settings/category-manager';
import { CustomCategoryManager } from '@/components/settings/custom-category-manager';
import { FixedCostsCard } from '@/components/settings/fixed-costs-card';
import { getCategoryCatalog } from '@/server/categories';
import { getSpendingPlan } from '@/server/spending-plan';
import { getCategoryMeta } from '@/server/category-meta';
import { categoryName } from '@/lib/engine/categorize/categories';
import { getCustomCategories } from '@/server/category-meta';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
import { loadDialCatalog, resolvedMoneyDialIds } from '@/server/money-dials';
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
import { TransferRepairCard } from '@/components/settings/transfer-repair-card';
import { getTransferFlagRepairPreview } from '@/server/transfer-flag-repair';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getThresholdTuning } from '@/server/tuning';
import { getLatestSelfAuditSnapshot } from '@/server/self-audit';
import { listLearnedPhrases } from '@/server/vocab';
import { getTaxYears } from '@/server/tax';
import { LearnedPhrases } from '@/components/settings/learned-phrases';
import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';
import { isDemoUser } from '@/lib/demo-user';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { accountLabel } from '@/lib/engine/account/display-name';

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const userId = session.user.id;
  const [user, accounts, txnCount, statementCount, goalCount, budgetCount, ruleCount, categoryCatalog, customCategories, accuracy, tuning, selfAudit, learnedPhrases, taxYears, attachmentCount, dialCatalog] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          hourlyWageCents: true,
          swrBps: true,
          expectedReturnBps: true,
          moneyDials: true,
          paymentAccountId: true,
          reserveHoldingAccountId: true,
          currentAge: true,
          retirementAge: true,
          endAge: true,
          inflationBps: true,
          savingsTargetBps: true,
          // C.13 / P1.3 — the reader's one-line Rich Life (nullable: null = unset).
          richLifeVision: true,
        },
      }),
      prisma.account.findMany({
        where: { userId },
        select: { id: true, name: true, type: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      prisma.transaction.count({ where: { account: { userId } } }),
      prisma.statement.count({ where: { account: { userId } } }),
      // Reserves (C.23/H.4) share this table and are a fixed cost, not a goal —
      // counting them here told a reader with 2 goals and 3 reserves they had 5
      // goals, in a data-deletion preview (critic P2-2). `not` alone would drop
      // every `kind IS NULL` savings goal (critic P0-1), hence the OR.
      prisma.goal.count({
        where: { userId, OR: [{ kind: null }, { kind: { not: RESERVE_KIND } }] },
      }),
      prisma.budget.count({ where: { userId } }),
      prisma.categorizationRule.count({ where: { userId } }),
      getCategoryCatalog(userId),
      getCustomCategories(userId),
      getCategorizationAccuracy(userId),
      getThresholdTuning(userId),
      getLatestSelfAuditSnapshot(userId),
      listLearnedPhrases(userId),
      getTaxYears(userId),
      // O.13h — named in the deletion preview because it is the only thing there
      // the reader personally uploaded.
      prisma.transactionAttachment.count({ where: { transaction: { account: { userId } } } }),
      loadDialCatalog(userId),
    ]);
  const householdView = await getHouseholdView();
  // H.7b — computed per load (the sweep's own read + a pure replay; ~200ms on a
  // 3k-row corpus). Sequential after the block above deliberately: it shares the
  // Prisma pool with fifteen parallel queries there.
  const transferRepairPreview = await getTransferFlagRepairPreview(userId);
  if (!user) redirect('/sign-in');

  const customGroups = CUSTOM_CATEGORY_GROUPS;

  // Slice-6 critic C-14: a reconciled predecessor is not a valid funding choice — the
  // boundary remaps it to its successor anyway, so offering the folded $0.00 twin here
  // (often under a near-identical name) invites a confusing dead pick.
  const supersededFunding = await activeSupersededPredecessorIds([userId]);
  const eligibleAccounts = accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !supersededFunding.has(a.id))
    .map((a) => ({ id: a.id, name: accountLabel(a) }));

  // C.23 / DECISIONS #431 — the Fixed-costs card. The plan is the heavy loader
  // (live detection over the snapshot), so it runs sequentially like the H.7b
  // sweep rather than inside the parallel block. `fixedSetup` rides the plan,
  // computed with the same arrays and sets the plan consumed — the card renders
  // the loader's verdict, never a re-derivation.
  const plan = await getSpendingPlan(userId);
  const categoryMeta = await getCategoryMeta(userId);
  const holdingAccount = user.reserveHoldingAccountId
    ? accounts.find((a) => a.id === user.reserveHoldingAccountId)
    : undefined;
  const holdingAccountId = holdingAccount?.id ?? null;
  const holdingAccountLabel = holdingAccount ? accountLabel(holdingAccount) : null;

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
    attachments: attachmentCount,
  });

  const moneyDialIds = resolvedMoneyDialIds(user.moneyDials, dialCatalog);
  const dialOptions = dialCatalog
    .filter((e) => !e.hidden || moneyDialIds.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, group: e.group }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Anchor target for every surface that prints a figure computed from these dials and
          offers to change them (`/coach`'s wealth-target card). It WRAPS the form rather than
          sitting beside it as an empty node: a zero-height sibling inside `space-y-4` silently
          added a gap above this card on every settings visit, and an empty div is not focusable,
          so following the link scrolled the page and moved no focus at all. `tabIndex={-1}`
          makes it a programmatic focus target; `scroll-mt` clears the sticky desktop header. */}
      <div id="money-dials" tabIndex={-1} className="scroll-mt-20 focus:outline-none">
      <MoneyDialsForm
        current={{
          hourlyWageCents: user.hourlyWageCents,
          swrBps: user.swrBps,
          expectedReturnBps: user.expectedReturnBps,
          moneyDials: moneyDialIds,
          paymentAccountId: user.paymentAccountId,
          currentAge: user.currentAge,
          retirementAge: user.retirementAge,
          endAge: user.endAge,
          inflationBps: user.inflationBps,
          savingsTargetBps: user.savingsTargetBps,
        }}
        accounts={eligibleAccounts}
        dialOptions={dialOptions}
        canWrite={!isDemoUser(userId)}
      />
      </div>
      <p className="px-1 text-xs text-muted-foreground" data-testid="assumptions-change">
        {COACH_COPY.assumptionsChange()}
      </p>

      {/* C.13 / P1.3 — the Rich Life one-liner. Demo is fenced like every typed
          input: the card reads the row's value (null for demo) while its form
          stays off and the action refuses. */}
      <RichLifeForm current={user.richLifeVision} canWrite={!isDemoUser(userId)} />

      {/* C.23 / DECISIONS #431 — the guided Fixed-costs section: the app's
          own basis, the detected proposals, and the reserve figure with its
          named home. Sits under the dials because it is the same category of
          thing — what the reader wants the plan to count. */}
      <FixedCostsCard
        plan={plan}
        nameOfCategory={(id) => categoryName(id, categoryMeta)}
        eligibleAccounts={eligibleAccounts}
        holdingAccountId={holdingAccountId}
        holdingAccountLabel={holdingAccountLabel}
        canWrite={!isDemoUser(userId)}
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
        {/* Tax-year export (O.1). One link per year the reader has actually tagged
            something into, computed with the SAME predicate the report totals by —
            never a year picker offering 2019, because a link that downloads an empty
            file is a question the reader has to open a spreadsheet to answer. */}
        <CardContent className="space-y-2 border-t pt-3" data-testid="tax-export">
          <div>
            <p className="text-sm font-medium">Tax year</p>
            <p className="text-xs text-muted-foreground">
              Everything you or your rules tagged — medical, child care, charitable and the rest —
              grouped by category with a total for each. It&apos;s a record of your own tagging, not
              tax advice, and Aimplifi decides nothing about what you can claim.
            </p>
          </div>
          {taxYears.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="tax-export-empty">
              Nothing tagged yet. Open any transaction&apos;s tag on the{' '}
              <Link href="/transactions" className="underline underline-offset-2">
                transactions page
              </Link>{' '}
              to file it under a tax category — or give a{' '}
              <Link href="/rules" className="underline underline-offset-2">
                rule
              </Link>{' '}
              a tax tag and it tags matching transactions for you. The years you tag will appear
              here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {taxYears.map((year) => (
                <a
                  key={year}
                  href={`/api/export?format=tax-year-csv&year=${year}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  data-testid="export-tax-year"
                  data-year={year}
                >
                  {year} taxes (CSV)
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2026-07-21 agent review A2: not just prose — the real Plaid connect button
          lives here too (it's self-contained; OAuth round-trips return to this page).
          SimpleFIN connect + connection management stay on /accounts, where the
          connection's actual state is known and rendered. */}
      <Card data-testid="connections-card">
        <CardHeader className="pb-2">
          <CardDescription>Bank connections</CardDescription>
          <CardTitle className="text-base">Connect a bank or brokerage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Connect with Plaid right here, or use the Accounts page for SimpleFIN (a few
            dollars/year, no business gate) and for managing existing connections. Access tokens
            are encrypted at rest (AES-256-GCM); only account masks (last 4) are ever stored.
          </p>
          <ConnectAccountsButton />
          <div>
            <Link
              href="/accounts"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              data-testid="settings-manage-connections"
            >
              Manage connections on Accounts
            </Link>
          </div>
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
            <CustomCategoryManager
              categories={customCategories}
              groups={customGroups}
              canWrite={!isDemoUser(userId)}
            />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Built-in categories
            </h3>
            {/* Both are off for the demo, for two DIFFERENT reasons. Renaming: it is
                one shared row, so a name typed here would be read by the next
                anonymous visitor. Removing (O.17c): the row stores no words, only
                ids — the harm is that one visitor takes a category out of the
                pickers every visitor after them chooses from. Each action refuses
                demo server-side as well; these props keep the UI from offering a
                door that fails. */}
            <CategoryManager
              catalog={categoryCatalog}
              canRename={!isDemoUser(userId)}
              canRemove={!isDemoUser(userId)}
            />
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

      {/* H.7b — the transfer-flag repair. Sits beside AI trust because it is the
          same contract from the other side: the AI's mistakes are the user's to
          correct, with the change stated before it happens and undoable after. */}
      <Card data-testid="transfer-repair-settings-card">
        <CardHeader className="pb-2">
          <CardDescription>Transactions held out of your totals by an outdated transfer mark</CardDescription>
          <CardTitle className="text-base">Transfer mark repair</CardTitle>
        </CardHeader>
        <CardContent>
          <TransferRepairCard preview={transferRepairPreview} canApply={!isDemoUser(userId)} />
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
                      ? 'shrink-0 rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300'
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
