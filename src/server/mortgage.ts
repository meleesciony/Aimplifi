/**
 * Mortgage read-path for the extra-principal calculator (DECISIONS #517).
 * Separate from `loadDebtAccounts`, which deliberately excludes mortgages.
 */
import { getProvider } from '@/lib/providers/demo';
import { accountLabel } from '@/lib/engine/account/display-name';
import type { MortgageCandidate } from '@/lib/engine/debt/mortgage-early-payoff';

export async function loadMortgageCandidates(userId: string): Promise<MortgageCandidate[]> {
  const snap = await getProvider().getFinanceSnapshot(userId);
  return snap.accounts
    .filter((a) => a.type === 'MORTGAGE')
    .map((a) => ({
      id: a.id,
      name: accountLabel(a),
      type: a.type,
      balanceCents: a.currentBalanceCents,
      aprBps: a.aprBps,
      minimumPaymentCents: a.minimumPaymentCents ?? null,
    }));
}
