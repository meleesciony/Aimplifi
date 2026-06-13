import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AddTransactionForm } from '@/components/finance/add-transaction-form';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';

export default async function NewTransactionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Add transaction</h1>
      <p className="text-sm text-muted-foreground">
        Record cash, a check, or anything not pulled in automatically.
      </p>
      <AddTransactionForm accounts={accounts} defaultDate={getProvider().today()} />
    </div>
  );
}
