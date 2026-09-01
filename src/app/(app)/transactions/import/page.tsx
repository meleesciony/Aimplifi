import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ImportCsvForm } from '@/components/finance/import-csv-form';
import { CsvImportGuides } from '@/components/finance/csv-import-guides';
import { prisma } from '@/lib/db';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { CSV_IMPORT_INTRO } from '@/lib/copy/csv-import-copy';

export const metadata = { title: "Import transactions" };

export default async function ImportTransactionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const [allAccounts, superseded, plaidItems] = await Promise.all([
    // P2-2 (critic): the picker must offer only register accounts — the rows a
    // CSV import creates are POSTED register rows, so an investment/loan target
    // would hide the imported history from every register surface. Same
    // SPENDING_ACCOUNT_TYPES basis the register, /api/export and the engines use.
    prisma.account.findMany({
      where: { userId: session.user.id, type: { in: [...SPENDING_ACCOUNT_TYPES] } },
      select: { id: true, name: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    // Slice-6 critics B-F2/C-4: same fence as manual entry — a reconciled predecessor is
    // read-only history, so it is not an import target (the server action refuses too).
    activeSupersededPredecessorIds([session.user.id]),
    // TASKS H.2 — the user's connected institutions (live PlaidItem.institution,
    // the same names /accounts shows) drive the per-bank export guide cards.
    prisma.plaidItem.findMany({
      where: { userId: session.user.id, institution: { not: null } },
      select: { institution: true },
      distinct: ['institution'],
    }),
  ]);
  const accounts = allAccounts.filter((a) => !superseded.has(a.id));
  const institutions = plaidItems.map((p) => p.institution as string);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Import transactions</h1>
      <p className="text-sm text-muted-foreground" data-testid="csv-import-intro">
        {CSV_IMPORT_INTRO}
      </p>
      <ImportCsvForm accounts={accounts} />
      <CsvImportGuides institutions={institutions} />
    </div>
  );
}
