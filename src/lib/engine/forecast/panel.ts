/**
 * Basis sentences behind the forecast's per-day drilldown (O.20d).
 *
 * The one sentence this module must never emit is "these rows add up to the
 * balance": the balance line is CUMULATIVE, and a day's rows sum to the day's
 * CHANGE, never the balance shown on the chart. The second sentence states that
 * distinction for the reader — engine-composed with the RENDERED figure
 * embedded, per the O.18c rule (a sentence written in a .tsx cannot be locked
 * by a unit test).
 */
import { type Cents, formatCents } from '@/lib/money';

export function forecastDayBasis(
  deltaCents: Cents,
  eventCount: number,
): readonly [string, ...string[]] {
  const flow = eventCount === 1 ? 'scheduled flow' : 'scheduled flows';
  return [
    `The ${formatCents(deltaCents)} is this day's net change to the projected balance — the ${eventCount} ${flow} that land on it, signed.`,
    `The balance line is cumulative — the starting balance plus every earlier day's change — so these rows never add up to the balance shown on the chart.`,
  ];
}
