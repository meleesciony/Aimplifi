/**
 * Debt payoff engine (Wave 3, DECISIONS #95). Fixed-installment amortization
 * for liabilities (LOAN / MORTGAGE / CREDIT) with two orderings:
 *   - avalanche: highest APR first  (least interest — the recommended default)
 *   - snowball:  smallest balance first (earliest first win — motivation)
 *
 * This is a SEPARATE module from the Cash-Needed engine on purpose: Cash-Needed
 * is credit-card-revolving-only and silently drops loans (slice5 / DECISIONS
 * #29). Fixed-payment amortization is genuinely different math, so duplicating
 * nothing — it just shares the integer-cents + roundHalfAwayFromZero conventions.
 *
 * Pure: integer cents in, integer cents out. No I/O, no `new Date()`. Monthly
 * periodic interest = round(balance * aprBps / 10000 / 12). The total monthly
 * budget (Σ minimums + extra) is held CONSTANT; minimums freed by paid-off
 * debts roll into the focus debt — the snowball/avalanche mechanic. Pinned to
 * the hand-verified table in docs/EDGE_CASES.md §Debt-payoff.
 */
import { roundHalfAwayFromZero } from '@/lib/money';

export type DebtStrategy = 'avalanche' | 'snowball';

export interface DebtInput {
  id: string;
  name: string;
  /** Amount owed, positive cents. */
  balanceCents: number;
  /** Annual rate in basis points (0 allowed; 649 = 6.49%). */
  aprBps: number;
  /** Fixed monthly minimum payment, cents (>= 0). */
  minimumPaymentCents: number;
}

export interface DebtPlanInput {
  debts: DebtInput[];
  strategy: DebtStrategy;
  /** Extra paid on top of every minimum, applied to the focus debt. */
  extraMonthlyCents: number;
}

export interface DebtPayoffPerDebt {
  id: string;
  name: string;
  /** 1-based month the debt hit zero; null if not cleared within the cap. */
  payoffMonth: number | null;
  interestCents: number;
}

export interface DebtPayoffResult {
  strategy: DebtStrategy;
  /** 1-based month the LAST debt clears; null on negative amortization (never, within the cap). */
  monthsToDebtFree: number | null;
  /** 1-based month the FIRST debt clears — the motivational signal; null if none clear. */
  firstPayoffMonth: number | null;
  totalInterestCents: number;
  totalPaidCents: number;
  /** Debts ordered by payoff month (soonest first); never-cleared debts last. */
  perDebt: DebtPayoffPerDebt[];
}

/** 100 years — matches fi.ts MAX_MONTHS; a payoff beyond this is reported as "never". */
const MAX_MONTHS = 1200;

function monthlyInterest(balanceCents: number, aprBps: number): number {
  if (balanceCents <= 0 || aprBps <= 0) return 0;
  return roundHalfAwayFromZero((balanceCents * aprBps) / 10000 / 12);
}

type Working = { aprBps: number; balanceCents: number };

/** Indices of still-owed debts, ordered so the FOCUS debt comes first. */
function focusOrder(debts: Working[], strategy: DebtStrategy): number[] {
  const owed = debts.map((_, i) => i).filter((i) => debts[i].balanceCents > 0);
  owed.sort((a, b) => {
    if (strategy === 'avalanche') {
      if (debts[b].aprBps !== debts[a].aprBps) return debts[b].aprBps - debts[a].aprBps; // highest APR first
      return debts[a].balanceCents - debts[b].balanceCents; // tie → smaller balance first
    }
    if (debts[a].balanceCents !== debts[b].balanceCents) return debts[a].balanceCents - debts[b].balanceCents; // smallest first
    return debts[b].aprBps - debts[a].aprBps; // tie → higher APR first
  });
  return owed;
}

export function planDebtPayoff(input: DebtPlanInput): DebtPayoffResult {
  const debts = input.debts.map((d) => ({
    ...d,
    balanceCents: Math.max(0, d.balanceCents),
    minimumPaymentCents: Math.max(0, d.minimumPaymentCents),
  }));
  const n = debts.length;
  const interestAccrued = new Array<number>(n).fill(0);
  const payoffMonth: (number | null)[] = new Array<number | null>(n).fill(null);

  const budget =
    debts.reduce((s, d) => s + d.minimumPaymentCents, 0) + Math.max(0, input.extraMonthlyCents);
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const owedRemains = () => debts.some((d) => d.balanceCents > 0);

  while (owedRemains() && month < MAX_MONTHS) {
    month++;
    const startTotal = debts.reduce((s, d) => s + d.balanceCents, 0);

    // 1) accrue interest on every owed debt
    for (let i = 0; i < n; i++) {
      if (debts[i].balanceCents <= 0) continue;
      const interest = monthlyInterest(debts[i].balanceCents, debts[i].aprBps);
      debts[i].balanceCents += interest;
      interestAccrued[i] += interest;
      totalInterest += interest;
    }

    // 2) pay each owed debt its minimum (freed minimums of paid-off debts stay
    //    in `available` — that is the snowball/avalanche rollover)
    let available = budget;
    for (let i = 0; i < n; i++) {
      if (debts[i].balanceCents <= 0) continue;
      const pay = Math.min(debts[i].minimumPaymentCents, debts[i].balanceCents, available);
      debts[i].balanceCents -= pay;
      available -= pay;
      totalPaid += pay;
      if (debts[i].balanceCents === 0 && payoffMonth[i] === null) payoffMonth[i] = month;
    }

    // 3) throw the remaining budget at the strategy-ordered focus debt(s)
    for (const i of focusOrder(debts, input.strategy)) {
      if (available <= 0) break;
      const pay = Math.min(debts[i].balanceCents, available);
      debts[i].balanceCents -= pay;
      available -= pay;
      totalPaid += pay;
      if (debts[i].balanceCents === 0 && payoffMonth[i] === null) payoffMonth[i] = month;
    }

    // Negative-amortization guard: with a constant monthly budget, if this month
    // made no net progress on the total balance, no future month can either
    // (interest is monotonic in balance, payments are capped) — it will never be
    // paid off. Break here; this also prevents the balance from compounding past
    // Number.MAX_SAFE_INTEGER over the month cap.
    const endTotal = debts.reduce((s, d) => s + d.balanceCents, 0);
    if (endTotal > 0 && endTotal >= startTotal) break;
  }

  const allClear = !owedRemains();
  const clearedMonths = payoffMonth.filter((m): m is number => m !== null && m > 0);

  const perDebt: DebtPayoffPerDebt[] = debts
    .map((d, i) => ({ id: d.id, name: d.name, payoffMonth: payoffMonth[i], interestCents: interestAccrued[i] }))
    .sort((a, b) => {
      if (a.payoffMonth === null && b.payoffMonth === null) return 0;
      if (a.payoffMonth === null) return 1;
      if (b.payoffMonth === null) return -1;
      return a.payoffMonth - b.payoffMonth;
    });

  return {
    strategy: input.strategy,
    monthsToDebtFree: allClear ? month : null,
    firstPayoffMonth: clearedMonths.length ? Math.min(...clearedMonths) : null,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    perDebt,
  };
}
