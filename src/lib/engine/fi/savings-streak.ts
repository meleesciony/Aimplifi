/**
 * Savings-rate streak (TASKS 1.4 / DECISIONS #205).
 *
 * Pure: walks an ascending MonthlyFlow[] backward from the latest full month
 * and counts consecutive months whose savingsRateBps meets minRateBps
 * (default 0 = strictly positive — "saved something"; a 0-bps month saved
 * nothing and breaks, so the streak sentence never calls a 0.0% month
 * positive — audit P2). Null rates (no income) and rates below the floor
 * break the streak. Also flags a personal-best latest month.
 *
 * Never recomputes rates — only reads savingsRateBps already on each flow.
 * Integer bps only; no floats.
 */
import type { MonthlyFlow } from '@/lib/engine/fi/insights';

export interface SavingsStreakResult {
  /** Consecutive qualifying months ending at the latest; 0 if latest fails. */
  streakMonths: number;
  minRateBps: number;
  latestRateBps: number | null;
  /** True when latest non-null rate is strictly greater than every prior non-null. */
  isPersonalBest: boolean;
  /** Max non-null rate in the series (incl. latest). */
  bestRateBps: number | null;
  /** Max non-null rate excluding the latest month. */
  priorBestRateBps: number | null;
}

export function computeSavingsStreak(
  flows: readonly MonthlyFlow[],
  opts?: { minRateBps?: number },
): SavingsStreakResult {
  const minRateBps = opts?.minRateBps ?? 0;
  if (flows.length === 0) {
    return {
      streakMonths: 0,
      minRateBps,
      latestRateBps: null,
      isPersonalBest: false,
      bestRateBps: null,
      priorBestRateBps: null,
    };
  }

  const latest = flows[flows.length - 1]!;
  const latestRateBps = latest.savingsRateBps;

  let streakMonths = 0;
  // The default floor is EXCLUSIVE of zero: a caller passing a positive minRateBps
  // keeps inclusive `>=` semantics (the 15%-floor test), so only the default changes.
  const qualifies = (rate: number | null): boolean =>
    rate === null ? false : minRateBps === 0 ? rate > 0 : rate >= minRateBps;
  for (let i = flows.length - 1; i >= 0; i--) {
    if (!qualifies(flows[i]!.savingsRateBps)) break;
    streakMonths += 1;
  }

  const priorRates = flows
    .slice(0, -1)
    .map((f) => f.savingsRateBps)
    .filter((r): r is number => r !== null);
  const priorBestRateBps = priorRates.length ? Math.max(...priorRates) : null;
  const allRates = flows.map((f) => f.savingsRateBps).filter((r): r is number => r !== null);
  const bestRateBps = allRates.length ? Math.max(...allRates) : null;
  // The positivity gate is load-bearing: a negative latest rate that merely beats
  // every other negative month is "least bad", not a personal best — and pct1
  // would render it "-0.0%", a zero-looking claim about a number that isn't zero
  // (audit P2: a zero is a claim and must name which zero).
  const isPersonalBest =
    latestRateBps !== null &&
    latestRateBps > 0 &&
    (priorBestRateBps === null || latestRateBps > priorBestRateBps);

  return {
    streakMonths,
    minRateBps,
    latestRateBps,
    isPersonalBest,
    bestRateBps,
    priorBestRateBps,
  };
}
