import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AddTransactionForm } from '@/components/finance/add-transaction-form';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';
import { getVisibleCategories } from '@/server/categories';

export const metadata = { title: "Add transaction" };

export default async function NewTransactionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const [accounts, categoryOptions] = await Promise.all([
    prisma.account.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    // Visible assignable categories incl. the user's customs (DECISIONS #111).
    getVisibleCategories(userId),
  ]);

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
