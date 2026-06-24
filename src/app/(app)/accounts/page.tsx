import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccountsList } from '@/components/finance/accounts-list';
import { getAccountsView } from '@/server/transactions';

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const data = await getAccountsView(session.user.id);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <p className="text-sm text-muted-foreground">
        Everything you own and owe, in one place. Tap any account to see its
        transactions.
      </p>
      <AccountsList data={data} />
    </div>
  );
}
