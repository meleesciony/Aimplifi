import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { auth } from '@/auth';
import { TransactionFilters } from '@/components/finance/transaction-filters';
import { TransactionList } from '@/components/finance/transaction-list';
import { buttonVariants } from '@/components/ui/button';
import type { FlowType, TxnFilter } from '@/lib/engine/transactions/query';
import { getTransactions } from '@/server/transactions';
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
  const typeRaw = str(sp.type);
  const type = (VALID_TYPES as string[]).includes(typeRaw) ? (typeRaw as FlowType) : 'all';
  const from = str(sp.from);
  const to = str(sp.to);
  const page = Math.max(1, parseInt(str(sp.page), 10) || 1);

  const filter: TxnFilter = {
    search,
    accountId: account || null,
    categoryId: category || null,
    type,
    from: from || null,
    to: to || null,
  };

  const [{ rows, summary, accountOptions, pageInfo }, categoryGroups] = await Promise.all([
    getTransactions(session.user.id, filter, page),
    getVisibleGroups(session.user.id),
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

      <TransactionFilters
        accountOptions={accountOptions}
        current={{ search, account, category, type, from, to }}
      />
      <TransactionList rows={rows} summary={summary} pageInfo={pageInfo} categoryGroups={categoryGroups} />
    </div>
  );
}
