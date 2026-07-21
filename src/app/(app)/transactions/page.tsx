import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { auth } from '@/auth';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { MerchantLensCard } from '@/components/finance/merchant-lens-card';
import { TransactionFilters } from '@/components/finance/transaction-filters';
import { TransactionList } from '@/components/finance/transaction-list';
import { buttonVariants } from '@/components/ui/button';
import type { FlowType, TxnFilter } from '@/lib/engine/transactions/query';
import { SharedTransactionList } from '@/components/finance/shared-transaction-list';
import { getSharedTransactionsView } from '@/server/household';
import { getTransactions, getWithheldAccountSummary } from '@/server/transactions';
import { getVisibleGroups } from '@/server/categories';

const VALID_TYPES: FlowType[] = ['all', 'income', 'expense', 'transfer'];

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
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
  const from = str(sp.from);
  const to = str(sp.to);
  const page = Math.max(1, parseInt(str(sp.page), 10) || 1);

  const filter: TxnFilter = {
    search,
    accountId: account || null,
    categoryId: category || null,
    merchant: merchant || null,
    type,
    from: from || null,
    to: to || null,
  };
  // Same predicate as TransactionFilters.hasFilters — empty-register copy
  // branches on it (ROADMAP ALSO CONSIDER / #186).
  const hasFilters =
    !!(search || account || category || merchant || from || to) || type !== 'all';

  const [{ rows, summary, accountOptions, pageInfo, lens }, categoryGroups, withheld, shared] =
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <div className="flex gap-2">
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
      <p className="text-sm text-muted-foreground">
        Every transaction across all your accounts — checking, savings, credit,
        and more. Cash and other purchases not pulled automatically can be added
        by hand.
      </p>

      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />

      <TransactionFilters
        accountOptions={accountOptions}
        categoryOptions={categoryGroups.flatMap((g) => g.categories)}
        current={{ search, account, category, merchant, type, from, to }}
      />

      {/* Merchant Pattern Lens (§Later #19, DECISIONS #250): deterministic
          profile of the filtered merchant; absent when the engine abstains. */}
      {lens && <MerchantLensCard lens={lens} />}
      <TransactionList
        rows={rows}
        summary={summary}
        pageInfo={pageInfo}
        categoryGroups={categoryGroups}
        hasFilters={hasFilters}
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
