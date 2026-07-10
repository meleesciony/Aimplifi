/**
 * Savings-rate streak (TASKS 1.4 / DECISIONS #205).
 *
 * Pure: walks an ascending MonthlyFlow[] backward from the latest full month
 * and counts consecutive months whose savingsRateBps meets minRateBps
 * (default 0 = "saved something"). Null rates (no income) and rates below
 * the floor break the streak. Also flags a personal-best latest month.
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
  for (let i = flows.length - 1; i >= 0; i--) {
    const rate = flows[i]!.savingsRateBps;
    if (rate === null || rate < minRateBps) break;
    streakMonths += 1;
  }

  const priorRates = flows
    .slice(0, -1)
    .map((f) => f.savingsRateBps)
    .filter((r): r is number => r !== null);
  const priorBestRateBps = priorRates.length ? Math.max(...priorRates) : null;
  const allRates = flows.map((f) => f.savingsRateBps).filter((r): r is number => r !== null);
  const bestRateBps = allRates.length ? Math.max(...allRates) : null;
  const isPersonalBest =
    latestRateBps !== null &&
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
