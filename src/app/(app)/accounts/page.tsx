import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccountsList } from '@/components/finance/accounts-list';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { HouseholdSharingCard } from '@/components/finance/household-sharing-card';
import { getAccountDetail, getAccountsView } from '@/server/transactions';
import { getAccountSharingView } from '@/server/household';
import { loadMortgageCandidates } from '@/server/mortgage';
import { pickMortgageForEarlyPayoff } from '@/lib/engine/debt/mortgage-early-payoff';
import { MortgageEarlyPayoffCard } from '@/components/finance/mortgage-early-payoff-card';

export const metadata = { title: "Accounts" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const sp = await searchParams;
  // `?detail=<id>` — which account's in-place panel is open (U.3 mortgage
  // dead-end; U.8 spending-row sibling). Loaded ONLY when open, and scoped
  // to the signed-in user inside getAccountDetail: a foreign or stale id
  // resolves to null and the page renders exactly as with no param.
  // INVESTMENT still does not render the panel (`dest.kind === 'holdings'`).
  const detailParam = Array.isArray(sp.detail) ? (sp.detail[0] ?? '') : (sp.detail ?? '');
  // Sharing is a SEPARATE query path from getAccountsView (#192/T9): partner
  // rows must never enter the duplicate detector's input set.
  const [data, sharing, detail, mortgages] = await Promise.all([
    getAccountsView(session.user.id),
    getAccountSharingView(),
    detailParam ? getAccountDetail(session.user.id, detailParam) : Promise.resolve(null),
    loadMortgageCandidates(session.user.id),
  ]);
  const mortgagePick = pickMortgageForEarlyPayoff(mortgages);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <p className="text-sm text-muted-foreground">
        {/* "to open it", not "to see its transactions" (2026-08-11): only
            spending accounts open the register — a brokerage opens its
            holdings and everything else expands its detail right here, so the
            old sentence promised 8 of 11 account types a page that is empty
            for them by construction. */}
        Everything you own and owe, in one place. Tap an account to open it.
      </p>
      {/* currency-guard disclosure (#135 residual) — nothing rendered for all-USD users */}
      <CurrencyExclusionBanner summary={data.withheld} />
      <AccountsList data={data} detail={detail} />
      {/* After the list, not inside the net-worth / row pair: a card in the
          middle of a hit-tested page hides the first target behind the 380px
          nav (#516 category-bar timeout). */}
      <MortgageEarlyPayoffCard pick={mortgagePick} />
      {/* Household members only — solo and demo users render nothing here (T6). */}
      {sharing.kind === 'member' && <HouseholdSharingCard view={sharing} />}
    </div>
  );
}
