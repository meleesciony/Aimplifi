import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AddTransactionForm } from '@/components/finance/add-transaction-form';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';
import { getVisibleCategories } from '@/server/categories';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

export const metadata = { title: "Add transaction" };

export default async function NewTransactionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const [allAccounts, categoryOptions, superseded] = await Promise.all([
    prisma.account.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    // Visible assignable categories incl. the user's customs (DECISIONS #111).
    getVisibleCategories(userId),
    // Slice-6 critics B-F2/C-4: a reconciled predecessor is read-only history — a manual
    // row typed onto it dated after cutover would be dropped from every sum. The server
    // action refuses too; hiding it here prevents the dead-end pick.
    activeSupersededPredecessorIds([userId]),
  ]);
  const accounts = allAccounts.filter((a) => !superseded.has(a.id));

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Add transaction</h1>
      <p className="text-sm text-muted-foreground">
        Record cash, a check, or anything not pulled in automatically.
      </p>
      <AddTransactionForm
        accounts={accounts}
        categoryOptions={categoryOptions}
        defaultDate={getProvider().today(userId)}
      />
    </div>
  );
}
