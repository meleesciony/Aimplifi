import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ImportCsvForm } from '@/components/finance/import-csv-form';
import { prisma } from '@/lib/db';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

export const metadata = { title: "Import transactions" };

export default async function ImportTransactionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const [allAccounts, superseded] = await Promise.all([
    prisma.account.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    // Slice-6 critics B-F2/C-4: same fence as manual entry — a reconciled predecessor is
    // read-only history, so it is not an import target (the server action refuses too).
    activeSupersededPredecessorIds([session.user.id]),
  ]);
  const accounts = allAccounts.filter((a) => !superseded.has(a.id));

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Import transactions</h1>
      <p className="text-sm text-muted-foreground">
        Bring in real transactions from any bank — export a CSV from your bank or
        another app and paste it here. No bank connection required.
      </p>
      <ImportCsvForm accounts={accounts} />
    </div>
  );
}
