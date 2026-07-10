import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccountsList } from '@/components/finance/accounts-list';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { HouseholdSharingCard } from '@/components/finance/household-sharing-card';
import { getAccountsView } from '@/server/transactions';
import { getAccountSharingView } from '@/server/household';

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // Sharing is a SEPARATE query path from getAccountsView (#192/T9): partner
  // rows must never enter the duplicate detector's input set.
  const [data, sharing] = await Promise.all([
    getAccountsView(session.user.id),
    getAccountSharingView(),
  ]);

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
      {/* Household members only — solo and demo users render nothing here (T6). */}
      {sharing.kind === 'member' && <HouseholdSharingCard view={sharing} />}
    </div>
  );
}
