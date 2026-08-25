/**
 * Mortgage extra-principal what-if (Wave 3 leftover, DECISIONS #517).
 *
 * Originates NO new amortization. Both legs call `planDebtPayoff` on a single
 * MORTGAGE — the same integer-cents walk the debt planner already pins in
 * EDGE_CASES §Debt-payoff. Mortgages stay OUT of `loadDebtAccounts` (Ramsey
 * BS6, not BS2); this module is the dedicated, values-neutral calculator.
 *
 * Unknown APR is not 0%. A stored 0 is a known zero. Extra principal is a
 * what-if, never a nudge to prepay.
 */
import { planDebtPayoff } from '@/lib/engine/debt/payoff';

export interface MortgageCandidate {
  id: string;
  name: string;
  type: string;
  balanceCents: number;
  aprBps: number | null;
  minimumPaymentCents: number | null;
}

export type MortgageMissingTerm = 'rate' | 'minimum' | 'rate-and-minimum';

export type MortgageEarlyPayoffPick =
  | { kind: 'none' }
  | { kind: 'paid-off'; candidate: MortgageCandidate }
  | { kind: 'incomplete'; candidate: MortgageCandidate; missing: MortgageMissingTerm }
  | {
      kind: 'ready';
      candidate: MortgageCandidate & { aprBps: number; minimumPaymentCents: number };
    };

export interface MortgageEarlyPayoffInput {
  id: string;
  name: string;
  balanceCents: number;
  aprBps: number;
  minimumPaymentCents: number;
  extraMonthlyCents: number;
}

export interface MortgageEarlyPayoff {
  accountId: string;
  accountName: string;
  balanceCents: number;
  aprBps: number;
  minimumPaymentCents: number;
  extraMonthlyCents: number;
  /** Null when that leg never clears (negative amortization / cap). */
  baselineMonths: number | null;
  extraMonths: number | null;
  /** Only when both legs clear. */
  monthsSaved: number | null;
  baselineInterestCents: number;
  extraInterestCents: number;
  /** Only when both legs clear — an unfinished walk is not a comparable interest total. */
  interestSavedCents: number | null;
}

function isMortgageOwed(row: MortgageCandidate): boolean {
  return row.type === 'MORTGAGE' && row.balanceCents > 0;
}

function isReady(
  row: MortgageCandidate,
): row is MortgageCandidate & { aprBps: number; minimumPaymentCents: number } {
  return (
    isMortgageOwed(row) &&
    row.aprBps !== null &&
    row.minimumPaymentCents !== null &&
    row.minimumPaymentCents > 0
  );
}

function missingTerm(row: MortgageCandidate): MortgageMissingTerm {
  const noRate = row.aprBps === null;
  const noMin = row.minimumPaymentCents === null || row.minimumPaymentCents <= 0;
  if (noRate && noMin) return 'rate-and-minimum';
  if (noRate) return 'rate';
  return 'minimum';
}

/** Largest owed balance first; id tie-break so the pick is stable. */
function byBalanceDesc(a: MortgageCandidate, b: MortgageCandidate): number {
  if (b.balanceCents !== a.balanceCents) return b.balanceCents - a.balanceCents;
  return a.id.localeCompare(b.id);
}

/**
 * One mortgage for the calculator. Ready rows beat incomplete ones. Several
 * ready mortgages → the largest balance (named in copy). Auto loans and cards
 * are never selected.
 */
export function pickMortgageForEarlyPayoff(
  accounts: readonly MortgageCandidate[],
): MortgageEarlyPayoffPick {
  const mortgages = accounts.filter((row) => row.type === 'MORTGAGE').slice().sort(byBalanceDesc);
  const owed = mortgages.filter((row) => row.balanceCents > 0);
  if (owed.length === 0) {
    if (mortgages.length === 0) return { kind: 'none' };
    return { kind: 'paid-off', candidate: mortgages[0] };
  }
  const ready = owed.filter(isReady);
  if (ready.length > 0) return { kind: 'ready', candidate: ready[0] };
  return { kind: 'incomplete', candidate: owed[0], missing: missingTerm(owed[0]) };
}

export function mortgageEarlyPayoff(input: MortgageEarlyPayoffInput): MortgageEarlyPayoff {
  const extraMonthlyCents = Math.max(0, input.extraMonthlyCents);
  const debt = {
    id: input.id,
    name: input.name,
    balanceCents: Math.max(0, input.balanceCents),
    aprBps: input.aprBps,
    minimumPaymentCents: Math.max(0, input.minimumPaymentCents),
  };
  const baseline = planDebtPayoff({
    debts: [debt],
    strategy: 'avalanche',
    extraMonthlyCents: 0,
  });
  const withExtra = planDebtPayoff({
    debts: [debt],
    strategy: 'avalanche',
    extraMonthlyCents,
  });
  const bothClear = baseline.monthsToDebtFree !== null && withExtra.monthsToDebtFree !== null;
  return {
    accountId: input.id,
    accountName: input.name,
    balanceCents: debt.balanceCents,
    aprBps: input.aprBps,
    minimumPaymentCents: debt.minimumPaymentCents,
    extraMonthlyCents,
    baselineMonths: baseline.monthsToDebtFree,
    extraMonths: withExtra.monthsToDebtFree,
    monthsSaved: bothClear
      ? Math.max(0, baseline.monthsToDebtFree! - withExtra.monthsToDebtFree!)
      : null,
    baselineInterestCents: baseline.totalInterestCents,
    extraInterestCents: withExtra.totalInterestCents,
    interestSavedCents: bothClear
      ? Math.max(0, baseline.totalInterestCents - withExtra.totalInterestCents)
      : null,
  };
}
