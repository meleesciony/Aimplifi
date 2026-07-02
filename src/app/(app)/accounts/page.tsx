import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccountsList } from '@/components/finance/accounts-list';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
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
      {/* currency-guard disclosure (#135 residual) — nothing rendered for all-USD users */}
      <CurrencyExclusionBanner summary={data.withheld} />
      <AccountsList data={data} />
    </div>
  );
}
