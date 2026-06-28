/**
 * Pure mapper: SimpleFIN investment HOLDINGS → Pulse Holding rows (DECISIONS #124).
 * No I/O. The single boundary where a brokerage feed's decimal-string positions
 * become the integer-cents shape the portfolio engine + Holding model consume.
 *
 * Model fit: a Pulse Holding stores a PER-SHARE priceCents (the engine computes
 * marketValue = round(quantity × priceCents)). SimpleFIN reports a TOTAL
 * market_value + a share count, so we derive priceCents = round(market_value ÷
 * shares). For whole-cent-divisible positions this round-trips exactly; for odd
 * fractional positions it can differ from the SimpleFIN total by a sub-cent ×
 * shares (negligible, and never affects net worth — the account balance stays
 * authoritative; holdings are a within-account breakdown).
 *
 * Resilience: a single un-mappable position (no usable symbol/shares/value, or a
 * value out of safe-integer range) is SKIPPED and COUNTED, never thrown — so one
 * weird row can't lose the whole portfolio (mirrors the transaction-skip idiom in
 * syncFromSimplefin). Same-symbol lots are AGGREGATED into one position.
 *
 * Bounds are kept identical to server/investments.ts::addHolding, so a synced row
 * can never be one addHolding would reject (and thus never one the engine throws on).
 *
 * UNVERIFIED against a live SimpleFIN server — implemented from the protocol as of
 * the Jan-2026 cutoff (docs/SIMPLEFIN_WALKTHROUGH.md).
 */
import { roundHalfAwayFromZero } from '@/lib/money';
import { type SimplefinHolding, simplefinAmountToCents } from './simplefin-map';

/** Mirrors the addHolding ticker rule: A–Z, 0–9, "." or "-", 1–20 chars. */
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;
const NAME_MAX = 120;

export interface MappedSfHolding {
  symbol: string;
  name: string | null;
  /** Shares held; finite, > 0 (fractional OK). */
  quantity: number;
  /** Total cost basis, safe-integer cents ≥ 0 (0 when the feed omits it). */
  costBasisCents: number;
  /** Current price per share, safe-integer cents ≥ 0 (derived from market_value ÷ shares). */
  priceCents: number;
}

export interface HoldingsMapResult {
  /** Engine-valid positions, aggregated by symbol, ordered by symbol. */
  holdings: MappedSfHolding[];
  /** Count of INPUT holdings not represented in the output (un-mappable or out of bounds). */
  skipped: number;
}

/** Decimal share-count string → positive finite number, or null if unusable. */
function parseShareCount(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s.trim().replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Best-effort non-negative cents from an optional decimal string; null if absent/garbage. */
function parseNonNegCents(s: string | undefined): number | null {
  if (s == null || s.trim() === '') return null;
  try {
    const v = simplefinAmountToCents(s);
    return v >= 0 ? v : null; // a negative cost/value (short or feed glitch) is out of model scope
  } catch {
    return null;
  }
}

interface Agg {
  name: string | null;
  quantity: number;
  costBasisCents: number;
  marketValueCents: number;
  rawCount: number; // input rows folded into this symbol (for honest skip accounting)
}

/**
 * Map + aggregate a brokerage account's holdings. Pure and total: never throws;
 * un-mappable rows are skipped and counted.
 */
export function mapSimplefinHoldings(raw: readonly SimplefinHolding[] = []): HoldingsMapResult {
  const agg = new Map<string, Agg>();
  let skipped = 0;

  for (const h of raw) {
    const symbol = (h.symbol ?? '').trim().toUpperCase();
    const shares = parseShareCount(h.shares);
    const marketValueCents = parseNonNegCents(h.market_value);
    // A position must have a valid ticker, a positive share count, and a value we can
    // record. Without any of these we cannot place it in the model — skip + count.
    if (!SYMBOL_RE.test(symbol) || shares == null || marketValueCents == null) {
      skipped++;
      continue;
    }
    // Cost basis is best-effort: a missing/garbage cost_basis falls back to 0 (the
    // engine reports gainPct null) rather than losing a position we CAN value.
    const costBasisCents = parseNonNegCents(h.cost_basis) ?? 0;
    const name = ((h.description ?? '').trim() || null)?.slice(0, NAME_MAX) ?? null;

    const cur = agg.get(symbol);
    if (cur) {
      cur.quantity += shares;
      cur.costBasisCents += costBasisCents;
      cur.marketValueCents += marketValueCents;
      cur.rawCount++;
      if (!cur.name && name) cur.name = name;
    } else {
      agg.set(symbol, { name, quantity: shares, costBasisCents, marketValueCents, rawCount: 1 });
    }
  }

  const holdings: MappedSfHolding[] = [];
  for (const [symbol, a] of agg) {
    // Derive the per-share price the model stores. roundHalfAwayFromZero throws via
    // cents() if the result is out of safe-integer range (absurd inputs) → skip.
    let priceCents: number;
    try {
      priceCents = roundHalfAwayFromZero(a.marketValueCents / a.quantity);
    } catch {
      skipped += a.rawCount;
      continue;
    }
    // Final bounds — identical to addHolding, so a synced row is always engine-valid.
    const ok =
      Number.isSafeInteger(a.costBasisCents) &&
      a.costBasisCents >= 0 &&
      Number.isSafeInteger(priceCents) &&
      priceCents >= 0 &&
      Number.isFinite(a.quantity) &&
      a.quantity > 0 &&
      Math.abs(a.quantity * priceCents) <= Number.MAX_SAFE_INTEGER;
    if (!ok) {
      skipped += a.rawCount;
      continue;
    }
    holdings.push({ symbol, name: a.name, quantity: a.quantity, costBasisCents: a.costBasisCents, priceCents });
  }

  holdings.sort((x, y) => (x.symbol < y.symbol ? -1 : x.symbol > y.symbol ? 1 : 0));
  return { holdings, skipped };
}
