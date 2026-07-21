/**
 * Merchant Pattern Lens — deterministic per-merchant behavioral profile
 * (AI_DIFFERENTIATION_PLAN §Later #19, reshaped per its adversarial verdict:
 * "ship the deterministic profile + templated narration; drop the
 * generative-LLM framing"; DECISIONS #250).
 *
 * Pure: no I/O, no model calls, integer cents throughout. Every figure is a
 * plain aggregate of the user's OWN rows at ONE canonical merchant — nothing
 * is estimated, predicted, or inferred. Honest-abstention rules (hand-verified
 * in docs/EDGE_CASES.md §Merchant Pattern Lens):
 *
 *   • aggregate pseudo-merchants (Zelle/checks/ATM…) → null: many unrelated
 *     payees behind one canonical are not "a relationship";
 *   • fewer than LENS_MIN_PATTERN_SAMPLE qualifying charges → facts only
 *     (count/total/first/last), no typical, no trend — thin history never
 *     earns a pattern claim;
 *   • trend windows cover FULL calendar months only (the current partial month
 *     is never averaged), and a window renders only when the relationship
 *     spans it at month granularity (firstYm ≤ window start) — otherwise
 *     months before the first charge would read as $0 behavior;
 *   • no time-of-day / day-of-week claims exist anywhere: Transaction.date is
 *     date-only, so the data cannot support them (the §19 verdict's flagship
 *     failure). The copy layer enforces this with a banned-lexicon test.
 *
 * Median uses the exact §Unusual Charge Radar integer convention, so over the
 * same rows the lens and the anomaly radar always agree about "typical". (The
 * grouping keys differ upstream — the lens takes the row's stored canonical,
 * the radar re-normalizes rawDescriptor — identical unless a stored canonical
 * predates a KNOWN_MERCHANTS edit; recorded residual, STATUS §Merchant
 * Pattern Lens.)
 */
import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { type ISODate, addMonthsClamped, compareDates, isoDate, startOfMonth } from '@/lib/dates';
import { isAggregateCanonical } from '@/lib/engine/categorize/normalize';

/** Minimal row shape: the register's TxnView is a superset. Split parents are
 *  excluded upstream (the register query never loads them). */
export interface LensTxn {
  date: string; // YYYY-MM-DD
  amountCents: number; // signed: outflow negative
  /** Canonical merchant display name (already normalized upstream). */
  merchant: string;
  status: string; // PENDING | POSTED
  isTransfer: boolean;
}

/** One fully-covered 3-calendar-month window of qualifying charges. */
export interface LensWindow {
  fromYm: string; // YYYY-MM inclusive
  toYm: string; // YYYY-MM inclusive
  chargeCount: number;
  totalCents: Cents;
  /** roundHalfAwayFromZero(totalCents / LENS_WINDOW_MONTHS). */
  avgPerMonthCents: Cents;
}

export interface MerchantProfile {
  /** Canonical name, echoed with the ROW's casing (never the query's). */
  merchant: string;
  /** Qualifying charges: POSTED, non-transfer, negative, date ≤ today. */
  chargeCount: number;
  /** Sum of qualifying charge magnitudes (all history ≤ today). */
  totalCents: Cents;
  firstSeen: ISODate;
  lastSeen: ISODate;
  /** Median charge magnitude (anomaly-engine convention); null below the floor. */
  typicalCents: Cents | null;
  /** True when chargeCount ≥ LENS_MIN_PATTERN_SAMPLE. */
  hasPattern: boolean;
  /** Last 3 full calendar months; null unless the pattern floor is met AND
   *  firstYm ≤ window start. */
  recentWindow: LensWindow | null;
  /** The 3 full months before recentWindow; same rendering rule. */
  priorWindow: LensWindow | null;
}

/** Below this many qualifying charges the profile makes no pattern claims. */
export const LENS_MIN_PATTERN_SAMPLE = 3;
/** Width of each trend window, in full calendar months. */
export const LENS_WINDOW_MONTHS = 3;

/** Same inclusion rule as the anomaly engine (split parents excluded upstream). */
function isQualifyingCharge(t: LensTxn): boolean {
  return t.status === 'POSTED' && !t.isTransfer && t.amountCents < 0;
}

function windowOf(
  charges: readonly { ym: string; magnitude: number }[],
  fromYm: string,
  toYm: string,
): LensWindow {
  let count = 0;
  let total = 0;
  for (const c of charges) {
    if (c.ym < fromYm || c.ym > toYm) continue;
    count += 1;
    total += c.magnitude;
  }
  return {
    fromYm,
    toYm,
    chargeCount: count,
    totalCents: cents(total),
    avgPerMonthCents: roundHalfAwayFromZero(total / LENS_WINDOW_MONTHS),
  };
}

/** Median with the documented integer convention (sorted ascending input). */
function medianOfSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Build the profile for ONE merchant (case-insensitive exact canonical match)
 * from the user's row set. Returns null when there is nothing honest to say:
 * an aggregate pseudo-merchant, or zero qualifying charges.
 */
export function buildMerchantProfile(
  rows: readonly LensTxn[],
  merchant: string,
  today: ISODate,
): MerchantProfile | null {
  const wanted = merchant.trim().toLowerCase();
  if (wanted === '') return null;

  let display: string | null = null;
  const charges: { date: ISODate; ym: string; magnitude: number }[] = [];
  for (const t of rows) {
    if (t.merchant.toLowerCase() !== wanted) continue;
    if (display === null) display = t.merchant; // row casing wins, first seen
    if (!isQualifyingCharge(t)) continue;
    const d = isoDate(t.date);
    if (compareDates(d, today) > 0) continue; // never judge the future
    charges.push({ date: d, ym: t.date.slice(0, 7), magnitude: -t.amountCents });
  }
  if (display === null || charges.length === 0) return null;
  if (isAggregateCanonical(display)) return null; // many payees ≠ one relationship

  charges.sort((a, b) => compareDates(a.date, b.date));
  const firstSeen = charges[0].date;
  const lastSeen = charges[charges.length - 1].date;
  const firstYm = firstSeen.slice(0, 7);
  const total = charges.reduce((s, c) => s + c.magnitude, 0);
  const hasPattern = charges.length >= LENS_MIN_PATTERN_SAMPLE;

  let typical: Cents | null = null;
  let recentWindow: LensWindow | null = null;
  let priorWindow: LensWindow | null = null;
  if (hasPattern) {
    const magnitudes = charges.map((c) => c.magnitude).sort((a, b) => a - b);
    typical = cents(medianOfSorted(magnitudes));

    const som = startOfMonth(today);
    const recentFromYm = addMonthsClamped(som, -LENS_WINDOW_MONTHS).slice(0, 7);
    const recentToYm = addMonthsClamped(som, -1).slice(0, 7);
    const priorFromYm = addMonthsClamped(som, -2 * LENS_WINDOW_MONTHS).slice(0, 7);
    const priorToYm = addMonthsClamped(som, -(LENS_WINDOW_MONTHS + 1)).slice(0, 7);

    if (firstYm <= recentFromYm) recentWindow = windowOf(charges, recentFromYm, recentToYm);
    if (firstYm <= priorFromYm) priorWindow = windowOf(charges, priorFromYm, priorToYm);
  }

  return {
    merchant: display,
    chargeCount: charges.length,
    totalCents: cents(total),
    firstSeen,
    lastSeen,
    typicalCents: typical,
    hasPattern,
    recentWindow,
    priorWindow,
  };
}
