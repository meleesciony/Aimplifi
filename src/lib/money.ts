/**
 * money.ts — the ONLY money utilities in the codebase.
 *
 * Conventions (binding, see docs/PHASE_0_ARCHITECTURE.md §2 and docs/EDGE_CASES.md):
 *  - All money values are integer cents, carried in the branded `Cents` type.
 *  - Transactions: outflow NEGATIVE, inflow POSITIVE.
 *  - Account balances: stored POSITIVE; the account `type` decides whether the
 *    balance counts as an asset or a liability in net worth.
 *  - Rounding rule: round-half-away-from-zero, applied at every materialized step.
 *  - Formatting to dollars happens ONLY at the UI boundary, via formatCents().
 */

export type Cents = number & { __brand: 'cents' };

/** Construct Cents from an integer number of cents. Throws on non-integers. */
export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`cents() requires a safe integer, got ${n}`);
  }
  return n as Cents;
}

export const ZERO: Cents = cents(0);

/**
 * Round a (possibly fractional) cent value to integer cents,
 * half away from zero: 0.5 → 1, -0.5 → -1, 1.4 → 1, -1.4 → -1.
 */
export function roundHalfAwayFromZero(value: number): Cents {
  const sign = value < 0 ? -1 : 1;
  return cents(sign * Math.round(Math.abs(value)));
}

/** Sum a list of Cents. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return cents(total);
}

export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

/** max(0, a) — used for "remaining due" style floors. */
export function floorAtZero(a: Cents): Cents {
  return a < 0 ? ZERO : a;
}

export function minCents(a: Cents, b: Cents): Cents {
  return a <= b ? a : b;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a >= b ? a : b;
}

/**
 * Average-daily-balance interest for one billing cycle (two-balance form).
 * The balance is `startBalanceCents` for `daysAtStartBalance` days, then
 * `endBalanceCents` for the remaining `cycleDays - daysAtStartBalance` days.
 * Interest = daily periodic rate × Σ(daily balances), rounded ONCE at the end:
 *   DPR = aprBps / 10000 / 365   (365-day year — the standard issuer convention)
 *   interest = round( (startBalance·dStart + endBalance·(cycleDays−dStart)) · DPR )
 * Integer cents in; the only float arithmetic is the single rate multiply, with
 * round-half-away-from-zero at that one materialized step (the same
 * single-materialized-round discipline used throughout money.ts).
 * `daysAtStartBalance` is clamped to [0, cycleDays]. New purchases are NOT
 * modeled — callers project interest on the existing balance and say so. The
 * grace-period decision (paid in full ⇒ no interest) belongs to the caller,
 * which simply doesn't call this when nothing is carried. The integer numerator
 * is asserted safe before the divide so overflow fails loud, never silently.
 */
export function averageDailyBalanceInterestCents(args: {
  startBalanceCents: Cents;
  endBalanceCents: Cents;
  aprBps: number;
  cycleDays: number;
  daysAtStartBalance: number;
}): Cents {
  const { startBalanceCents, endBalanceCents, aprBps, cycleDays } = args;
  if (cycleDays <= 0 || aprBps <= 0) return ZERO;
  const dStart = Math.max(0, Math.min(args.daysAtStartBalance, cycleDays));
  const sumDailyBalances = startBalanceCents * dStart + endBalanceCents * (cycleDays - dStart);
  const numerator = sumDailyBalances * aprBps;
  if (!Number.isSafeInteger(numerator)) {
    throw new Error(`averageDailyBalanceInterestCents: numerator ${numerator} exceeds safe-integer range`);
  }
  return roundHalfAwayFromZero(numerator / 10000 / 365);
}

/** Round UP to the next multiple of $50 (5000 cents). Used for transfer advice. */
export function roundUpToNext50Dollars(amount: Cents): Cents {
  if (amount <= 0) return ZERO;
  return cents(Math.ceil(amount / 5000) * 5000);
}

/**
 * Parse an exact decimal-dollar string ("1234.56", "-12", "0.5") into Cents
 * without ever touching float arithmetic on the fractional part.
 * Used by the seed and import paths; throws on malformed input.
 */
export function centsFromDollarString(s: string): Cents {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`centsFromDollarString: malformed amount "${s}"`);
  const [, sign, whole, frac = ''] = m;
  const fracPadded = (frac + '00').slice(0, 2);
  const value = parseInt(whole, 10) * 100 + parseInt(fracPadded, 10);
  return cents(sign === '-' ? -value : value);
}

/**
 * Format integer cents as US dollars for display: 123456 → "$1,234.56",
 * -50 → "-$0.50". The ONLY place cents become a dollar string.
 */
export function formatCents(amount: Cents, opts?: { signDisplay?: 'auto' | 'always' }): string {
  const sign = amount < 0 ? '-' : amount > 0 && opts?.signDisplay === 'always' ? '+' : '';
  const abs = Math.abs(amount);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, '0');
  const withCommas = dollars.toLocaleString('en-US');
  return `${sign}$${withCommas}.${centsPart}`;
}
