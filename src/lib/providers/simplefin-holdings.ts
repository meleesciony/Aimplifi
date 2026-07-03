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
 * Currency (DECISIONS #156, residual 20): a position whose reported `currency` is not
 * USD (or absent) is WITHHELD and counted SEPARATELY as `withheldNonUsd` — never folded
 * into `skipped` (a foreign lot is working-as-intended, not an un-mappable glitch). The
 * app does no FX, so summing a non-USD value at a fake 1:1 would silently corrupt the
 * USD /investments total ("a withheld figure beats a silently wrong one"). This uses the
 * SAME isSupportedCurrency rule as the account-level guard (DECISIONS #135) — one currency
 * definition, no divergence — so a non-USD ISO code, a crypto/non-ISO URL, or any opaque
 * token is withheld, while null/omitted (demo/CSV/manual = no currency) stays USD.
 *
 * UNVERIFIED against a live SimpleFIN server — implemented from the protocol as of
 * the Jan-2026 cutoff (docs/SIMPLEFIN_WALKTHROUGH.md).
 */
import { roundHalfAwayFromZero } from '@/lib/money';
import { parseTicker } from '@/lib/engine/investments/ticker';
import { canonicalizeCurrency, isSupportedCurrency } from './currency';
import { type SimplefinHolding, simplefinAmountToCents } from './simplefin-map';

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
  /** Count of INPUT holdings WITHHELD because their currency isn't USD (no FX — DECISIONS
   *  #156). Kept distinct from `skipped`: a withheld foreign lot is working-as-intended, not
   *  a glitch, so folding it into the un-mappable count would misrepresent sync health. */
  withheldNonUsd: number;
}

/**
 * True when a position's reported currency is confidently NOT U.S. dollars, using the SAME
 * support rule as the account-level guard (DECISIONS #135): null/omitted → assumed USD
 * (golden-safe — demo/CSV/manual carry no currency); 'usd'/'USD' → USD; any non-USD ISO
 * code, crypto/non-ISO URL, or opaque token → withheld. We do no FX, so a withheld figure
 * beats a value summed at a wrong 1:1. (If a feed ever misuses this field for a security
 * identifier, that lot is withheld — visible + recoverable — rather than silently corrupting
 * the USD total; the owner can narrow this to ISO-only in one line if live data warrants.)
 */
function isNonUsdHolding(raw: string | null | undefined): boolean {
  return !isSupportedCurrency(canonicalizeCurrency(raw));
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
  let withheldNonUsd = 0;

  for (const h of raw) {
    // Currency FIRST: a non-USD lot is withheld (no FX) and counted as withheldNonUsd, NOT
    // skipped — even when it's also un-mappable, a foreign position is working-as-intended,
    // not a glitch. Per-row (before symbol aggregation) so a EUR lot is dropped while a
    // same-symbol USD lot still aggregates normally (DECISIONS #156, residual 20).
    if (isNonUsdHolding(h.currency)) {
      withheldNonUsd++;
      continue;
    }
    const symbol = parseTicker(h.symbol); // shared with addHolding; accepts BRK/B, BTC/USD (#127 tail)
    const shares = parseShareCount(h.shares);
    const marketValueCents = parseNonNegCents(h.market_value);
    // A position must have a valid ticker, a positive share count, and a value we can
    // record. Without any of these we cannot place it in the model — skip + count.
    if (symbol == null || shares == null || marketValueCents == null) {
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
  return { holdings, skipped, withheldNonUsd };
}
