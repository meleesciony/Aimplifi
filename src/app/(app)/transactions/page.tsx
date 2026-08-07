import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Upload, Wand2 } from 'lucide-react';
import { auth } from '@/auth';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { MerchantLensCard } from '@/components/finance/merchant-lens-card';
import { TransactionFilters } from '@/components/finance/transaction-filters';
import { TransactionList } from '@/components/finance/transaction-list';
import { buttonVariants } from '@/components/ui/button';
import type { FlowType, TxnFilter } from '@/lib/engine/transactions/query';
import { VALID_FLOW_TYPES, VALID_SPEND_CLASSES } from '@/lib/engine/transactions/links';
import { registerEmptyReason } from '@/lib/engine/transactions/empty-reason';
import { isoDate } from '@/lib/dates';
import { SharedTransactionList } from '@/components/finance/shared-transaction-list';
import { RegisterScrollRestorer } from '@/components/finance/register-scroll';
import { getSharedTransactionsView } from '@/server/household';
import { getTransactions, getWithheldAccountSummary } from '@/server/transactions';
import { getVisibleGroups } from '@/server/categories';
import { isDemoUser } from '@/lib/demo-user';
import { getProvider } from '@/lib/providers/demo';

// The `?type=` vocabulary is owned by `links.ts` (O.16) so the return-trip
// builder and this reader cannot drift into accepting different values.
const VALID_TYPES: FlowType[] = VALID_FLOW_TYPES;

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** A URL date bound, or '' when it is not a readable calendar date. */
function isoDateOrEmpty(v: string): string {
  if (v === '') return '';
  try {
    isoDate(v);
    return v;
  } catch {
    return '';
  }
}

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const sp = await searchParams;
  const search = str(sp.q);
  const account = str(sp.account);
  const category = str(sp.category);
  const merchant = str(sp.merchant);
  const typeRaw = str(sp.type);
  const type = (VALID_TYPES as string[]).includes(typeRaw) ? (typeRaw as FlowType) : 'all';
  // A date bound is only a bound if it IS a date. `filterTransactions` casts
  // these with an unguarded `isoDate`, which THROWS — so before this guard
  // `/transactions?to=banana` was a 500 on the register, reachable from any
  // hand-edited or stale link (found by the K.3 critic, F5). An unreadable
  // bound is dropped rather than fatal, which also keeps this page and
  // `registerEmptyReason` agreeing on what counts as a date.
  const from = isoDateOrEmpty(str(sp.from));
  const to = isoDateOrEmpty(str(sp.to));
  // Owner request 2026-07-27 ("make it easier to see unclassified items in
  // activity"). Its own axis, not a value of `type` or `category`: it asks whether
  // the app has DECIDED, not what it decided — and the category dropdown cannot
  // express it at all, because the 'uncategorized' placeholder is deliberately
  // stripped from every assignable list (categorize/assign.ts).
  const unclassified = str(sp.unclassified) === '1';
  // O.15: the coach's outstanding-reimbursements figure links here — a figure
  // that names rows must open on those rows. Unknown values read as "no filter".
  const reimbRaw = str(sp.reimb);
  const reimbursement = reimbRaw === 'awaiting' || reimbRaw === 'received' ? reimbRaw : null;
  const spendClassRaw = str(sp.spendClass);
  const spendClass = (VALID_SPEND_CLASSES as readonly string[]).includes(spendClassRaw)
    ? (spendClassRaw as 'fixed' | 'guilt-free')
    : null;
  const page = Math.max(1, parseInt(str(sp.page), 10) || 1);

  const filter: TxnFilter = {
    search,
    accountId: account || null,
    categoryId: category || null,
    merchant: merchant || null,
    type,
    from: from || null,
    to: to || null,
    unclassified,
    reimbursement,
    spendClass,
  };
  // Same predicate as TransactionFilters.hasFilters — empty-register copy
  // branches on it (ROADMAP ALSO CONSIDER / #186). Split at the merchant axis
  // (owner, 2026-08-07): the empty state may name a merchant as THE cause only
  // when nothing else is narrowing the set too.
  const hasFiltersBesidesMerchant =
    !!(search || account || category || from || to) ||
    type !== 'all' ||
    unclassified ||
    reimbursement !== null ||
    spendClass !== null;
  const hasFilters = hasFiltersBesidesMerchant || !!merchant;

  const [{ rows, summary, accountOptions, pageInfo, lens, unclassifiedCount, oldestDate, newestDate }, categoryGroups, withheld, shared] =
    await Promise.all([
      getTransactions(session.user.id, filter, page),
      getVisibleGroups(session.user.id),
      getWithheldAccountSummary(session.user.id),
      // Separate path from getTransactions (§4.5 / T9 twin of slice 2) — personal
      // summary + picker stay the viewer's own set.
      getSharedTransactionsView(),
    ]);

  return (
    <div className="space-y-4">
      {/* Puts the reader back where they were after an inline edit's
          confirmation reload (owner, 2026-08-03). Mounted ONCE for the whole
          page — both lists below write the same saved offset. */}
      <RegisterScrollRestorer />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <div className="flex gap-2">
          {/* O.13a: the register is where the owner notices a descriptor whose text
              changes every time, so it is where the rule builder has to be reachable
              from. */}
          <Link
            href="/rules"
            data-testid="rules-link"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Wand2 className="size-4" aria-hidden />
            {/* sr-only rather than `hidden` below sm: `display:none` would leave this
                control with NO accessible name on a phone, which is the width the
                a11y gate runs at. The label still costs no layout there. */}
            <span className="sr-only sm:not-sr-only">Rules</span>
          </Link>
          <Link
            href="/transactions/import"
            data-testid="import-txn-link"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Upload className="size-4" aria-hidden /> Import
          </Link>
          <Link
            href="/transactions/new"
            data-testid="add-txn-link"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Plus className="size-4" aria-hidden /> Add
          </Link>
        </div>
      </div>
      {/* O.5 critic F-10: this sentence claimed "every transaction across all your
          accounts" unconditionally, which is false the moment the reader arrives
          filtered — and arriving filtered stopped being rare once a category figure
          became a link into this page. The filter controls below already show WHAT
          is applied; what the standing copy owed the reader was to stop asserting
          the opposite. */}
      <p className="text-sm text-muted-foreground">
        {hasFilters ? (
          <>
            Showing a filtered slice of your transactions — the controls below say
            which. Clear them to see every account.
          </>
        ) : (
          <>
            Every transaction across all your accounts — checking, savings, credit,
            and more. Cash and other purchases not pulled automatically can be added
            by hand.
          </>
        )}{' '}
        Each row is labeled Fixed or Discretionary for your Plan
        {isDemoUser(session.user.id)
          ? ' (suggestions only on the shared demo).'
          : ' — change the selector if we got it wrong (applies to that category).'}
      </p>

      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />

      <TransactionFilters
        accountOptions={accountOptions}
        categoryOptions={categoryGroups.flatMap((g) => g.categories)}
        current={{
          search,
          account,
          category,
          merchant,
          type,
          from,
          to,
          unclassified,
          reimbursement,
          spendClass: spendClass ?? '',
        }}
        unclassifiedCount={unclassifiedCount}
        today={getProvider().today(session.user.id)}
        oldestDate={oldestDate}
      />

      {/* W.7: Plan Fixed is budget|typical, not this window's outflows — say so
          when the Class filter is what brought the reader here. */}
      {spendClass !== null && (
        <p className="text-xs text-muted-foreground" data-testid="txn-spend-class-basis">
          {spendClass === 'fixed'
            ? 'Showing transactions classified Fixed in this date window. Your Plan Fixed figure uses budget or typical averages, so it may not match Net below.'
            : 'Showing transactions classified Discretionary in this date window. Your Plan guilt-free figure is income − savings − fixed, so it may not match Net below.'}
        </p>
      )}

      {/* Merchant Pattern Lens (§Later #19, DECISIONS #250): deterministic
          profile of the filtered merchant; absent when the engine abstains. */}
      {lens && <MerchantLensCard lens={lens} />}
      <TransactionList
        rows={rows}
        summary={summary}
        pageInfo={pageInfo}
        categoryGroups={categoryGroups}
        // Computed HERE, from the same two bounds the filter bar prints as
        // "History available from …" above, so the empty state and that line
        // can never tell the reader two different things (owner, 2026-08-06).
        // `filter.from`/`filter.to`, never the raw `from`/`to`: those are '' when
        // absent (`str()`), and an empty string is not null — it would reach
        // `isoDate('')`. Reading the SAME values the query was run with is also
        // the only way this sentence can describe the window that produced the
        // zero it is explaining.
        emptyReason={registerEmptyReason({
          hasFilters,
          from: filter.from ?? null,
          to: filter.to ?? null,
          oldest: oldestDate,
          newest: newestDate,
          // `filter.merchant`, for the same reason the dates are read off the
          // filter: this sentence must describe the query that produced the
          // zero it is explaining.
          merchant: filter.merchant ?? null,
          otherFilters: hasFiltersBesidesMerchant,
        })}
        // The CSV remedy is REFUSED for the shared demo user
        // (`transaction-actions.ts` returns DEMO_ENTRY_BLOCKED), and on
        // production every anonymous visitor IS that user — so offering it
        // there sends the reader to a form that will turn them away, and they
        // stop looking for the real route (K.3 critic, F1).
        canImportCsv={!isDemoUser(session.user.id)}
        canEditSpendClass={!isDemoUser(session.user.id)}
      />

      {shared.kind === 'member' && (
        <SharedTransactionList
          householdName={shared.householdName}
          rows={shared.rows}
          truncated={shared.truncated}
        />
      )}
    </div>
  );
}
