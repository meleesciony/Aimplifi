/**
 * Unusual Charge Radar v1 — per-merchant median+MAD outlier detection
 * (AI_DIFFERENTIATION_PLAN §3-Later #12, reshaped slice; DECISIONS #249).
 *
 * Pure and deterministic: no I/O, no model calls, integer cents throughout.
 * A charge is "unusual" only against the user's OWN history at that merchant —
 * never a flat "large transaction" threshold. The double-bill half of the plan
 * item stays deferred (Transaction.date is date-only; a same-day double-charge
 * and two legitimate visits are indistinguishable — the plan's own verdict).
 *
 * Failure-direction bias (the #231 lesson): a FALSE POSITIVE here shouts
 * "unusual!" at a legitimate charge on the dashboard, while a false negative
 * merely stays quiet — so every rule below is calibrated toward precision:
 *   • baseline needs ≥ MIN_SAMPLE charges at the merchant (thin history never flags);
 *   • the threshold is multiplicative AND additive (K_MAD × MAD + FLOOR_CENTS), so
 *     a constant-priced subscription (MAD = 0) needs a genuinely large spike to
 *     flag — a $2.50 price bump never does (that is price-increase's job);
 *   • only above-median charges flag (an unusually SMALL charge is not a risk);
 *   • aggregate pseudo-merchants (ATM, checks, Zelle — heterogeneous payees behind
 *     one canonical) are excluded entirely;
 *   • at most one flag per merchant and MAX_RESULTS overall.
 *
 * Median/MAD use one documented integer convention (hand-verified in
 * docs/EDGE_CASES.md §Unusual Charge Radar): sort ascending; odd n → middle
 * element; even n → floor of the mean of the two middle elements. MAD is the
 * median (same convention) of absolute deviations from the median.
 */
import { type Cents, cents } from '@/lib/money';
import { type ISODate, compareDates, daysBetween } from '@/lib/dates';
import { isAggregateCanonical, normalizeMerchant } from '@/lib/engine/categorize/normalize';

/** Minimal transaction shape the detector needs (superset-compatible with coach txns). */
export interface AnomalyTxn {
  id: string;
  date: string; // ISODate string (YYYY-MM-DD)
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  status: string;
  isSplitParent?: boolean;
}

export interface UnusualCharge {
  /** Stable identity of the flagged transaction (dismissal fact-key anchor). */
  txnId: string;
  merchantCanonical: string;
  date: ISODate;
  /** The charge magnitude, verbatim |amountCents| of the flagged row. */
  amountCents: Cents;
  /** Median charge magnitude at this merchant (documented integer convention). */
  typicalCents: Cents;
  /** MAD of charge magnitudes at this merchant (same convention). */
  madCents: Cents;
  /** Number of qualifying charges in the baseline, INCLUDING the flagged one. */
  sampleCount: number;
  /** amountCents − typicalCents (> 0 by construction: above-median only). */
  deviationCents: Cents;
}

/** Baseline must have at least this many charges (including the candidate). */
export const ANOMALY_MIN_SAMPLE = 6;
/** Multiplicative half of the threshold: deviation must exceed K × MAD … */
export const ANOMALY_K_MAD = 4;
/** … plus this additive floor, so MAD≈0 merchants need a genuinely large spike. */
export const ANOMALY_FLOOR_CENTS = 4000;
/** Flag-eligibility window: only charges aged 0–44 days (age < this value) may FLAG. */
export const ANOMALY_RECENT_WINDOW_DAYS = 45;
/** Overall cap on reported anomalies (top by deviation). */
export const ANOMALY_MAX_RESULTS = 3;

/** The single inclusion rule: a POSTED, non-transfer, non-split-parent outflow. */
function isQualifyingCharge(t: AnomalyTxn): boolean {
  return t.status === 'POSTED' && !t.isTransfer && !(t.isSplitParent ?? false) && t.amountCents < 0;
}

/** Median with the documented integer convention (sorted ascending input). */
function medianOfSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Detect per-merchant unusual charges. Baseline = the merchant's whole charge
 * history up to `today`; only charges dated within ANOMALY_RECENT_WINDOW_DAYS
 * of `today` are eligible to flag (an old outlier informs the baseline but is
 * no longer news). Returns at most ANOMALY_MAX_RESULTS entries, at most one
 * per merchant, ordered by deviation descending (ties: merchant ascending,
 * then txnId ascending — a locale-free total order).
 */
export function detectUnusualCharges(
  transactions: readonly AnomalyTxn[],
  today: ISODate,
): UnusualCharge[] {
  // Group qualifying charge magnitudes by canonical merchant.
  const byMerchant = new Map<string, { txns: AnomalyTxn[]; canonical: string }>();
  for (const t of transactions) {
    if (!isQualifyingCharge(t)) continue;
    if (compareDates(t.date as ISODate, today) > 0) continue; // never judge the future
    const canonical = normalizeMerchant(t.rawDescriptor).canonical;
    if (isAggregateCanonical(canonical)) continue; // ATM/checks/Zelle: not one merchant
    const slot = byMerchant.get(canonical) ?? { txns: [], canonical };
    slot.txns.push(t);
    byMerchant.set(canonical, slot);
  }

  const flags: UnusualCharge[] = [];
  for (const { txns, canonical } of byMerchant.values()) {
    if (txns.length < ANOMALY_MIN_SAMPLE) continue;

    const magnitudes = txns.map((t) => -t.amountCents).sort((a, b) => a - b);
    const median = medianOfSorted(magnitudes);
    const mad = medianOfSorted(magnitudes.map((x) => Math.abs(x - median)).sort((a, b) => a - b));
    const threshold = ANOMALY_K_MAD * mad + ANOMALY_FLOOR_CENTS;

    // One flag per merchant: the recent charge with the LARGEST deviation
    // (ties: later date, then larger txnId — deterministic).
    let best: AnomalyTxn | null = null;
    let bestDeviation = 0;
    for (const t of txns) {
      const age = daysBetween(t.date as ISODate, today);
      if (age >= ANOMALY_RECENT_WINDOW_DAYS) continue; // stale: baseline-only
      const deviation = -t.amountCents - median;
      if (deviation <= threshold) continue; // strictly-greater flag rule
      if (
        best === null ||
        deviation > bestDeviation ||
        (deviation === bestDeviation &&
          (compareDates(t.date as ISODate, best.date as ISODate) > 0 ||
            (t.date === best.date && t.id > best.id)))
      ) {
        best = t;
        bestDeviation = deviation;
      }
    }
    if (!best) continue;

    flags.push({
      txnId: best.id,
      merchantCanonical: canonical,
      date: best.date as ISODate,
      amountCents: cents(-best.amountCents),
      typicalCents: cents(median),
      madCents: cents(mad),
      sampleCount: txns.length,
      deviationCents: cents(bestDeviation),
    });
  }

  flags.sort(
    (a, b) =>
      b.deviationCents - a.deviationCents ||
      (a.merchantCanonical < b.merchantCanonical ? -1 : a.merchantCanonical > b.merchantCanonical ? 1 : 0) ||
      (a.txnId < b.txnId ? -1 : a.txnId > b.txnId ? 1 : 0),
  );
  return flags.slice(0, ANOMALY_MAX_RESULTS);
}
