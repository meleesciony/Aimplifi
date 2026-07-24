/**
 * Pure mapper: Plaid `/investments/holdings/get` positions → Pulse Holding rows
 * (TASKS 4.3, the Plaid parity of simplefin-holdings.ts). No I/O. The single
 * boundary where Plaid's float-dollar positions become the integer-cents shape the
 * portfolio engine + Holding model consume.
 *
 * Plaid's response splits a position across two arrays: a `holdings[]` row (keyed by
 * account_id + security_id, carrying quantity, institution_value, cost_basis, currency)
 * and a `securities[]` row (the security_id → ticker_symbol + name + type). This mapper
 * JOINs them by security_id, so the caller passes one account's holdings plus the shared
 * securities list.
 *
 * Model fit (identical to SimpleFIN, DECISIONS #124/#129 — one convention across
 * providers): Plaid reports a position's TOTAL `institution_value` + a share count. We
 * keep that total as the AUTHORITATIVE marketValueCents (the engine uses it verbatim),
 * AND derive a per-share priceCents = round(institution_value ÷ shares) for display —
 * NOT Plaid's own `institution_price`, so the derived-vs-authoritative relationship, and
 * the `isPerShareApproximate` badge that reads it, behave the same for a SimpleFIN and a
 * Plaid lot. Storing only a per-share price would lose low-price / high-quantity lots (a
 * penny-stock lot reconstructs to $0). Net worth is unaffected either way — the account
 * balance stays authoritative; holdings are a within-account breakdown.
 *
 * Resilience: a single un-mappable position (no usable ticker / share count / value, or a
 * value out of safe-integer range) is SKIPPED and COUNTED, never thrown. A `cash`-type
 * security (the brokerage's uninvested-cash sweep, already inside the account balance) is
 * NOT a security position and is dropped WITHOUT counting as skipped — it isn't a glitch.
 * Same-symbol lots are AGGREGATED into one position.
 *
 * Currency (DECISIONS #156, #135): a position whose value currency is not USD is WITHHELD
 * and counted SEPARATELY as `withheldNonUsd` — never folded into `skipped`. The app does no
 * FX, so a crypto lot (Plaid's `unofficial_currency_code`) or a foreign-denominated lot is
 * withheld rather than summed at a fake 1:1. Uses the SAME resolvePlaidCurrency +
 * isSupportedCurrency rule as mapPlaidAccount, so the account and its holdings agree.
 *
 * Bounds are kept identical to simplefin-holdings.ts / server/investments.ts::addHolding,
 * so a synced row can never be one addHolding / the engine would reject, nor one the
 * production Postgres 32-bit Int column would overflow on (which the reconcile catch would
 * otherwise swallow into a silent VANISH).
 *
 * UNVERIFIED against live Plaid — implemented from the /investments/holdings/get schema as
 * of the Jan-2026 cutoff. The MAPPING is unit-tested with realistic fixtures; the network
 * call is not (no sandbox creds in this build env).
 */
import { roundHalfAwayFromZero } from '@/lib/money';
import { parseTicker } from '@/lib/engine/investments/ticker';
import { isSupportedCurrency, resolvePlaidCurrency } from './currency';

const NAME_MAX = 120;
/**
 * The storage ceiling for a persisted cents column. Prisma `Int` is a signed 32-bit
 * INTEGER on the production Postgres datasource (DECISIONS #35), max 2,147,483,647 cents
 * = $21,474,836.47 PER position. Above this, Postgres rejects the write; because the
 * reconcile swallows a per-row write error, an over-ceiling total would silently VANISH
 * from /investments in production (invisible on 64-bit SQLite in CI). So every persisted
 * cents value is bounded HERE at the mapper boundary — an oversize position is SKIPPED +
 * COUNTED, identically on both DBs. Same ceiling as simplefin-holdings.ts.
 */
const MAX_DB_CENTS = 2_147_483_647;

/** One position of a Plaid investment account (`/investments/holdings/get` `holdings[]`). */
export interface PlaidHolding {
  account_id: string;
  security_id: string;
  /** TOTAL market value of the position, dollars (authoritative — DECISIONS #129). */
  institution_value: number;
  /** TOTAL cost basis, dollars; nullable (Plaid can't always report it). */
  cost_basis?: number | null;
  /** Shares held, float; negative for a short (out of model scope → skipped). */
  quantity: number;
  /** Plaid's own per-share price, dollars — deliberately UNUSED (we derive from the total). */
  institution_price?: number | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

/** Security metadata (`/investments/holdings/get` `securities[]`), joined by security_id. */
export interface PlaidSecurity {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  /** 'equity' | 'etf' | 'mutual fund' | 'cash' | 'cryptocurrency' | 'fixed income' | … */
  type?: string | null;
}

export interface MappedPlaidHolding {
  symbol: string;
  name: string | null;
  /** Shares held; finite, > 0 (fractional OK). */
  quantity: number;
  /** Total cost basis, safe-integer cents ≥ 0 (0 when Plaid omits it). */
  costBasisCents: number;
  /** Current price per share, safe-integer cents ≥ 0 (derived from institution_value ÷ shares). */
  priceCents: number;
  /** Authoritative TOTAL market value, safe-integer cents ≥ 0 (Plaid's institution_value). */
  marketValueCents: number;
}

export interface PlaidHoldingsMapResult {
  /** Engine-valid positions, aggregated by symbol, ordered by symbol. */
  holdings: MappedPlaidHolding[];
  /** INPUT holdings not represented (un-mappable / out of bounds). Excludes cash sweeps. */
  skipped: number;
  /** INPUT holdings WITHHELD because their value currency isn't USD (no FX — DECISIONS #156). */
  withheldNonUsd: number;
}

/** Dollars → non-negative integer cents within the DB ceiling, or null if not usable. */
function dollarsToNonNegCents(amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  // Bound the magnitude BEFORE rounding: roundHalfAwayFromZero wraps cents(), which throws
  // on a non-safe-integer — so an over-ceiling amount must short-circuit here, not reach it.
  if (Math.abs(amount) * 100 > MAX_DB_CENTS) return null;
  const c = roundHalfAwayFromZero(amount * 100);
  return c >= 0 ? c : null; // a negative value (short position / feed glitch) is out of model scope
}

interface Agg {
  name: string | null;
  quantity: number;
  costBasisCents: number;
  marketValueCents: number;
  rawCount: number; // input rows folded into this symbol (for honest skip accounting)
}

/**
 * Map + aggregate ONE Plaid investment account's holdings, joined to the item's securities.
 * Pure and total: never throws; un-mappable rows are skipped and counted, cash sweeps are
 * dropped silently, non-USD lots are withheld and counted apart.
 */
export function mapPlaidHoldings(
  holdings: readonly PlaidHolding[] = [],
  securities: readonly PlaidSecurity[] = [],
): PlaidHoldingsMapResult {
  const securityById = new Map(securities.map((s) => [s.security_id, s]));
  const agg = new Map<string, Agg>();
  let skipped = 0;
  let withheldNonUsd = 0;

  for (const h of holdings) {
    const security = securityById.get(h.security_id);
    // The brokerage's uninvested-cash sweep is not a security position — its value is
    // already inside the account balance. Drop it WITHOUT counting as skipped (it isn't a
    // glitch), so a normal cash-carrying brokerage doesn't report a permanent skipped ≥ 1.
    if (security?.type === 'cash') continue;

    // Currency FIRST (before the symbol join), on the HOLDING's value currency: a non-USD
    // lot is withheld (no FX) and counted as withheldNonUsd, NOT skipped — a foreign/crypto
    // position is working-as-intended. Per-row so a EUR lot drops while a same-symbol USD
    // lot still aggregates (DECISIONS #156).
    if (!isSupportedCurrency(resolvePlaidCurrency(h.iso_currency_code, h.unofficial_currency_code))) {
      withheldNonUsd++;
      continue;
    }

    const symbol = security ? parseTicker(security.ticker_symbol) : null;
    const shares = Number.isFinite(h.quantity) && h.quantity > 0 ? h.quantity : null;
    const marketValueCents = dollarsToNonNegCents(h.institution_value);
    // A position must have a valid ticker, a positive share count, and a value we can
    // record. Without any of these we cannot place it in the model — skip + count.
    if (symbol == null || shares == null || marketValueCents == null) {
      skipped++;
      continue;
    }
    // Cost basis is best-effort: a missing/garbage cost_basis falls back to 0 (the engine
    // reports gainPct null) rather than losing a position we CAN value.
    const costBasisCents = dollarsToNonNegCents(h.cost_basis) ?? 0;
    const name = ((security?.name ?? '').trim() || null)?.slice(0, NAME_MAX) ?? null;

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

  const result: MappedPlaidHolding[] = [];
  for (const [symbol, a] of agg) {
    // Derive the per-share price the model stores. roundHalfAwayFromZero throws via cents()
    // if the result is out of safe-integer range (absurd inputs) → skip.
    let priceCents: number;
    try {
      priceCents = roundHalfAwayFromZero(a.marketValueCents / a.quantity);
    } catch {
      skipped += a.rawCount;
      continue;
    }
    // Final bounds — every persisted cents value is a non-negative integer within the DB
    // column ceiling, so a synced row is always engine-valid AND storable (identical rails
    // to simplefin-holdings.ts). Aggregation of same-symbol lots can push a sum over the
    // ceiling even when each row was in-range, so the check runs post-aggregation.
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
    result.push({
      symbol,
      name: a.name,
      quantity: a.quantity,
      costBasisCents: a.costBasisCents,
      priceCents,
      marketValueCents: a.marketValueCents,
    });
  }

  result.sort((x, y) => (x.symbol < y.symbol ? -1 : x.symbol > y.symbol ? 1 : 0));
  return { holdings: result, skipped, withheldNonUsd };
}
