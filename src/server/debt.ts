/**
 * Debt read-path (Wave 3, DECISIONS #97). Turns the finance snapshot's
 * liabilities into the pure debt-payoff engine's `DebtInput[]`. Single shared
 * source for BOTH the /goals Debt Freedom planner and the Ask `debt_payoff`
 * intent, so they can never disagree (the assistant never originates a number).
 *
 * Scope: CREDIT cards + LOANs with a positive balance (mortgages are excluded
 * from the snowball by convention — Ramsey BS6, not BS2). Card minimums are
 * estimated when no Account-level minimum is stored, matching the Cash-Needed
 * engine's floor (max $35, 1% of balance); LOANs use their stored
 * `minimumPaymentCents` (added in #96) and fall back to 0 (extra-only payoff).
 */
import { getProvider } from '@/lib/providers/demo';
import { roundHalfAwayFromZero } from '@/lib/money';
import type { DebtInput } from '@/lib/engine/debt/payoff';
import { accountLabel } from '@/lib/engine/account/display-name';

/** $35 floor — mirrors estimateMinimumPayment in the Cash-Needed engine. */
const CARD_MIN_FLOOR_CENTS = 3500;

function minimumFor(type: string, balanceCents: number, stored: number | null | undefined): number {
  if (stored != null && stored > 0) return stored;
  // 1% of balance, floored at $35 — integer-cents, via the project's single money
  // rounding rule (not a `* 0.01` float on cents); mirrors estimateMinimumPayment.
  if (type === 'CREDIT') return Math.max(CARD_MIN_FLOOR_CENTS, roundHalfAwayFromZero(balanceCents / 100));
  return 0; // a loan without a stored minimum relies on the extra payment
}

export async function loadDebtAccounts(userId: string): Promise<DebtInput[]> {
  const snap = await getProvider().getFinanceSnapshot(userId);
  return snap.accounts
    .filter((a) => (a.type === 'CREDIT' || a.type === 'LOAN') && a.currentBalanceCents > 0)
    .map((a) => ({
      id: a.id,
      name: accountLabel(a),
      balanceCents: a.currentBalanceCents,
      aprBps: a.aprBps ?? 0,
      minimumPaymentCents: minimumFor(a.type, a.currentBalanceCents, a.minimumPaymentCents),
    }))
    // largest APR first as a stable default ordering for display before any strategy is applied
    .sort((x, y) => y.aprBps - x.aprBps);
}
