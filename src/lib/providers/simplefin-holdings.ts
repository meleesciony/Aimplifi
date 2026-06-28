/**
 * Pure mapper: SimpleFIN investment HOLDINGS → Pulse Holding rows (DECISIONS #124).
 * No I/O. The single boundary where a brokerage feed's decimal-string positions
 * become the integer-cents shape the portfolio engine + Holding model consume.
 *
 * Model fit: SimpleFIN reports a position's TOTAL market_value + a share count. We
 * keep that total as the AUTHORITATIVE marketValueCents (the engine uses it verbatim),
 * AND derive a per-share priceCents = round(market_value ÷ shares) for display. Storing
 * only the per-share price would lose low-price / high-quantity lots — a penny-stock lot
 * reconstructs to $0, a sub-dollar lot to ~2× its real value (DECISIONS #129, backlog
 * #5, fixing the #124 round-trip drift). Net worth is unaffected regardless — the
 * account balance stays authoritative; holdings are a within-account breakdown.
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
/**
 * The storage ceiling for a persisted cents column. Prisma `Int` is a signed 32-bit
 * INTEGER on the production Postgres datasource (DECISIONS #35), max 2,147,483,647 cents
 * = $21,474,836.47 PER position. A value above this is rejected by Postgres at write time;
 * because reconcileSimplefinHoldings swallows a per-row write error, an over-ceiling total
 * would silently VANISH from /investments in production (invisible on 64-bit SQLite in CI).
 * So we bound every persisted cents value (priceCents, costBasisCents, AND the new
 * marketValueCents) to this ceiling at the mapper boundary — an oversize position is then
 * SKIPPED + COUNTED, identically on both DBs, instead of being silently dropped by the
 * reconcile catch (DECISIONS #129, critic P1-1). A single >$21.4M position is out of the
 * current model's scope (same ceiling the cost-basis column has always had); widening these
 * totals to BigInt is the documented follow-up if such positions come into scope.
 */
const MAX_DB_CENTS = 2_147_483_647;

export interface MappedSfHolding {
  symbol: string;
  name: string | null;
  /** Shares held; finite, > 0 (fractional OK). */
  quantity: number;
  /** Total cost basis, safe-integer cents ≥ 0 (0 when the feed omits it). */
  costBasisCents: number;
  /** Current price per share, safe-integer cents ≥ 0 (derived from market_value ÷ shares). */
  priceCents: number;
  /** Authoritative TOTAL market value, safe-integer cents ≥ 0 (the feed's market_value). */
  marketValueCents: number;
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
    // Final bounds — every persisted cents value is a non-negative integer within the DB
    // column ceiling (MAX_DB_CENTS), so a synced row is always engine-valid AND storable:
    // it can never be a value addHolding/the engine would reject, NOR one the production
    // Postgres Int column would overflow on (which the reconcile would silently swallow).
    // marketValueCents is the authoritative total the engine now consumes verbatim.
    const ok =
      Number.isSafeInteger(a.costBasisCents) &&
      a.costBasisCents >= 0 &&
      a.costBasisCents <= MAX_DB_CENTS &&
      Number.isSafeInteger(priceCents) &&
      priceCents >= 0 &&
      priceCents <= MAX_DB_CENTS &&
      Number.isSafeInteger(a.marketValueCents) &&
      a.marketValueCents >= 0 &&
      a.marketValueCents <= MAX_DB_CENTS &&
      Number.isFinite(a.quantity) &&
      a.quantity > 0 &&
      Math.abs(a.quantity * priceCents) <= Number.MAX_SAFE_INTEGER;
    if (!ok) {
      skipped += a.rawCount;
      continue;
    }
    holdings.push({ symbol, name: a.name, quantity: a.quantity, costBasisCents: a.costBasisCents, priceCents, marketValueCents: a.marketValueCents });
  }

  holdings.sort((x, y) => (x.symbol < y.symbol ? -1 : x.symbol > y.symbol ? 1 : 0));
  return { holdings, skipped };
}
