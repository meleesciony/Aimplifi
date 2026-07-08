/**
 * Investments engine — pure portfolio valuation + performance math (DECISIONS #77).
 *
 * Closes the investment-tracking gap (the one dimension an honest competitive review
 * scored a clear loss to Simplifi, and which the app itself declared a known gap):
 * holdings → market value, cost basis, unrealized gain, allocation; plus
 * time-weighted return (TWR — removes cash-flow timing) and money-weighted return
 * (XIRR — the investor's actual dollar-weighted rate).
 *
 * Pure + deterministic: integer cents in, no I/O, no `new Date()`. Share prices and
 * quantities may be fractional; every materialized money value is rounded ONCE,
 * half-away-from-zero (the money.ts discipline). Returns are unitless decimals
 * (0.10 = 10%) — formatted to a percentage only at the UI boundary.
 */
import { type ISODate, compareDates, daysBetween } from '@/lib/dates';
import { type Cents, roundHalfAwayFromZero, subCents, sumCents } from '@/lib/money';

export interface Holding {
  symbol: string;
  name?: string;
  /** Shares held; may be fractional. */
  quantity: number;
  /** Total amount invested in this position, integer cents. */
  costBasisCents: Cents;
  /** Current price per share, integer cents. */
  priceCents: Cents;
  /**
   * Authoritative TOTAL market value, integer cents — when the SOURCE reports the
   * position's total directly (a brokerage feed; DECISIONS #129). Used verbatim. When
   * omitted (a manual holding), market value is derived as round(quantity × priceCents).
   * Deriving from a rounded per-share price loses low-price / high-quantity lots, so a
   * source that knows the real total must pass it here rather than only a per-share price.
   */
  marketValueCents?: Cents;
  /**
   * Display-only provenance of where this holding came from — 'manual' (the default, a
   * user-entered position) or a feed key ('simplefin'; 'plaid' when #5 lands). Like
   * `name`, it carries no weight in any valuation math; it exists so the UI can badge a
   * synced position (DECISIONS #180). Absent/'manual' → the row shows no provenance badge.
   */
  source?: string;
}

export interface PositionValuation {
  symbol: string;
  name?: string;
  quantity: number;
  priceCents: Cents;
  marketValueCents: Cents;
  costBasisCents: Cents;
  unrealizedGainCents: Cents;
  /** unrealizedGain / costBasis; null when cost basis is non-positive (return undefined). */
  gainPct: number | null;
  /** Share of total portfolio market value, [0, 1]. */
  weight: number;
  /** Display-only provenance (see Holding.source); passed through, never used in math. */
  source?: string;
}

export interface Portfolio {
  positions: PositionValuation[];
  totalMarketValueCents: Cents;
  totalCostBasisCents: Cents;
  totalUnrealizedGainCents: Cents;
  totalGainPct: number | null;
}

/**
 * Market value of a position. When the source supplied an authoritative total
 * (`marketValueCents`, e.g. a brokerage feed), use it verbatim — deriving from a
 * rounded per-share price would lose low-price / high-quantity lots (DECISIONS #129).
 * Otherwise (a manual holding) derive round(quantity × price per share). Gain is
 * always market value − cost basis.
 */
export function valuePosition(h: Holding): PositionValuation {
  let marketValueCents: Cents;
  if (h.marketValueCents != null) {
    // Authoritative total from the source. Validate here too — fail loud with a located
    // message, mirroring the derive path — so the pure module is self-defending for any
    // caller, not only the SimpleFIN path that already bounds it at the provider boundary.
    if (!Number.isSafeInteger(h.marketValueCents) || h.marketValueCents < 0) {
      throw new Error(`valuePosition: ${h.symbol} authoritative market value (${h.marketValueCents}¢) is not a non-negative safe integer`);
    }
    marketValueCents = h.marketValueCents;
  } else {
    const raw = h.quantity * h.priceCents;
    if (!Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) {
      // Match the money.ts discipline: fail loud BEFORE rounding, with a located message.
      throw new Error(`valuePosition: ${h.symbol} market value (${h.quantity} × ${h.priceCents}¢) exceeds safe range`);
    }
    marketValueCents = roundHalfAwayFromZero(raw);
  }
  const unrealizedGainCents = subCents(marketValueCents, h.costBasisCents);
  return {
    symbol: h.symbol,
    name: h.name,
    quantity: h.quantity,
    priceCents: h.priceCents,
    marketValueCents,
    costBasisCents: h.costBasisCents,
    unrealizedGainCents,
    gainPct: h.costBasisCents > 0 ? unrealizedGainCents / h.costBasisCents : null,
    weight: 0,
    source: h.source,
  };
}

/**
 * Display provenance for a holding's `source` (DECISIONS #180) — the pure decision behind
 * the /investments "Synced" badge, extracted so the UI logic is unit-locked without a DOM
 * (the #118 priceChangeBadge pattern). A user-entered position (`source` absent or
 * 'manual') gets NO badge — that is the unremarkable default, and it keeps the all-manual
 * demo portfolio's /investments byte-identical. Any real feed key (currently 'simplefin';
 * 'plaid' when #5's holdings sync lands) is provenance worth surfacing → a "Synced" badge.
 * Source strings are code-set, never user input, so no value is trusted here beyond the
 * manual/absent short-circuit.
 */
export function holdingProvenance(source: string | undefined): { label: string; title: string } | null {
  if (!source || source === 'manual') return null;
  return { label: 'Synced', title: 'Synced from your linked brokerage' };
}

/** Aggregate holdings into a portfolio with totals and allocation weights. */
export function summarizePortfolio(holdings: readonly Holding[]): Portfolio {
  const valued = holdings.map(valuePosition);
  const totalMarketValueCents = sumCents(valued.map((p) => p.marketValueCents));
  const totalCostBasisCents = sumCents(valued.map((p) => p.costBasisCents));
  const totalUnrealizedGainCents = subCents(totalMarketValueCents, totalCostBasisCents);
  const positions = valued.map((p) => ({
    ...p,
    weight: totalMarketValueCents > 0 ? p.marketValueCents / totalMarketValueCents : 0,
  }));
  return {
    positions,
    totalMarketValueCents,
    totalCostBasisCents,
    totalUnrealizedGainCents,
    totalGainPct: totalCostBasisCents > 0 ? totalUnrealizedGainCents / totalCostBasisCents : null,
  };
}

/**
 * True when a position's authoritative total can NOT be reconstructed from its rounded
 * per-share price — i.e. round(quantity × priceCents) ≠ marketValueCents (a sub-cent /
 * fractional lot, e.g. 10,000 sh whose $50.00 total implies $0.005/share but displays as
 * $0.01). The UI uses this to mark the per-share figure as approximate (≈) so a row's
 * "{qty} @ {price}" never appears to contradict the authoritative total beside it
 * (DECISIONS #129, critic NWBR-1). For a derived (manual) position the two always agree by
 * construction, so this is false. Pure + total: an out-of-range product can't reconcile, so
 * it returns true rather than throwing.
 */
export function isPerShareApproximate(p: Pick<PositionValuation, 'quantity' | 'priceCents' | 'marketValueCents'>): boolean {
  const raw = p.quantity * p.priceCents;
  if (!Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) return true;
  return roundHalfAwayFromZero(raw) !== p.marketValueCents;
}

/** Geometric link of sub-period returns: Π(1 + r) − 1. */
export function linkReturns(returns: readonly number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

export interface ReturnPeriod {
  /** Market value at the START of the sub-period, AFTER any cash flow at that boundary. */
  startValueCents: number;
  /** Market value at the END of the sub-period, BEFORE the next boundary flow. */
  endValueCents: number;
}

/**
 * Time-weighted return: geometric link of each sub-period's holding-period return,
 * which removes the effect of cash-flow TIMING (the fair measure of the investments
 * themselves, independent of when the investor added or withdrew money). Split the
 * series at every external cash flow; each period's start value must already include
 * that flow. A period whose start value is ≤ 0 contributes 0% by convention (no
 * capital at risk); callers MUST split the series at every flow so a period's start
 * reflects the post-flow value — a non-positive start otherwise signals a mis-split.
 */
export function timeWeightedReturn(periods: readonly ReturnPeriod[]): number {
  return linkReturns(
    periods.map((p) => (p.startValueCents > 0 ? p.endValueCents / p.startValueCents - 1 : 0)),
  );
}

export interface DatedFlow {
  date: ISODate;
  /** Money INTO the portfolio is NEGATIVE (a cost); money OUT / ending value POSITIVE. */
  amountCents: number;
}

/** Net present value of dated flows at annual rate r (actual/365 from the first flow). */
function npvAt(amts: readonly number[], ts: readonly number[], r: number): number {
  let s = 0;
  for (let i = 0; i < amts.length; i++) s += amts[i] / Math.pow(1 + r, ts[i]);
  return s;
}

/**
 * Money-weighted return (XIRR): the constant annual rate r making the net present
 * value of the dated flows zero — Σ amountᵢ / (1 + r)^yearsᵢ = 0 — with years measured
 * actual/365 from the EARLIEST flow (leap days are not special-cased; the standard
 * actual/365 convention). Sign convention: contributions negative, withdrawals and
 * the current value positive. Flows are sorted by date internally, so input order
 * doesn't matter.
 *
 * Scope: built for a CONVENTIONAL cash flow (money in, then money out / current value
 * — at most one sign change), the case for a personal portfolio, where the IRR is
 * unique. Solved by Newton's method (accepted ONLY when the residual NPV is negligible,
 * never merely on a small step) with a bracketing bisection fallback across the whole
 * (−1, ∞) domain — so deep losses (r near −1) and large gains are both reachable.
 * Returns null when: fewer than two flows; all flows the same sign; or no sign-bracketed
 * root can be found (e.g. a non-conventional multi-sign-change series this solver can't
 * resolve). It NEVER returns a non-root — a returned number always satisfies NPV(r) ≈ 0.
 */
export function xirr(flows: readonly DatedFlow[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amountCents > 0) || !flows.some((f) => f.amountCents < 0)) return null;

  const sorted = [...flows].sort((a, b) => compareDates(a.date, b.date));
  const base = sorted[0].date;
  const ts = sorted.map((f) => daysBetween(base, f.date) / 365);
  const amts = sorted.map((f) => f.amountCents);
  const scale = amts.reduce((s, a) => s + Math.abs(a), 0);
  const resTol = Math.max(1e-6, scale * 1e-9); // an NPV this small (in cents) counts as zero
  const isRoot = (r: number) => Number.isFinite(r) && r > -1 && Math.abs(npvAt(amts, ts, r)) <= resTol;

  // Newton's method — accept only on a negligible RESIDUAL, not merely a small step.
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npvAt(amts, ts, r);
    let d = 0;
    for (let j = 0; j < amts.length; j++) d += (-ts[j] * amts[j]) / Math.pow(1 + r, ts[j] + 1);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-12) {
      r = next;
      break;
    }
    r = next;
  }
  if (isRoot(r)) return r;

  // Bisection over (−1, ∞): grow the upper bound until the endpoints bracket a sign
  // change of NPV, then bisect. For a conventional flow NPV → +∞ as r → −1⁺ and is
  // strictly monotonic, so this resolves the unique root — including deep losses.
  const lo = -1 + 1e-9;
  const fLo = npvAt(amts, ts, lo);
  if (!Number.isFinite(fLo)) return null;
  let hi = 1;
  let fHi = npvAt(amts, ts, hi);
  for (let g = 0; g < 64 && fLo * fHi > 0 && hi < 1e9; g++) {
    hi *= 2;
    fHi = npvAt(amts, ts, hi);
  }
  if (!(Number.isFinite(fHi) && fLo * fHi < 0)) return null;

  let a = lo;
  let fa = fLo;
  let b = hi;
  for (let i = 0; i < 300; i++) {
    const mid = (a + b) / 2;
    const fm = npvAt(amts, ts, mid);
    if (Math.abs(fm) <= resTol || (b - a) / 2 < 1e-13) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  const mid = (a + b) / 2;
  return isRoot(mid) ? mid : null;
}

/** Annualized money-weighted return as a percentage, rounded — UI convenience. */
export function formatReturnPct(r: number | null): string {
  return r === null || !Number.isFinite(r) ? '—' : `${(r * 100).toFixed(2)}%`;
}
