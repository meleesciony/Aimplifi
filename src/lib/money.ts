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
 * Multiply an amount by a basis-points rate (e.g. APR), with the documented
 * rounding rule. `divisor` lets callers express e.g. monthly interest:
 *   mulBps(carried, aprBps, 12)  ==  round(carried * aprBps / 10000 / 12)
 */
export function mulBps(amount: Cents, bps: number, divisor = 1): Cents {
  return roundHalfAwayFromZero((amount * bps) / 10000 / divisor);
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
