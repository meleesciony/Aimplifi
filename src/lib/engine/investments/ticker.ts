/**
 * Ticker-symbol validation — ONE definition shared by manual entry (`addHolding`) AND
 * SimpleFIN holdings ingest (`mapSimplefinHoldings`), so the two validators can never drift.
 * The #127 live-ingest audit flagged them as coupled: a symbol the sync mapper accepts must
 * also be one the manual path would accept, since both persist to the same `Holding.symbol`.
 *
 * Charset: A–Z, 0–9, ".", "-", and "/", 1–20 chars, after upper-casing. The "/" (added in the
 * #127 tail) accepts slash share-class and crypto-pair tickers — BRK/B, BTC/USD — that a plain
 * alphanumeric rule silently dropped. Space-bearing OCC option symbols (e.g.
 * "AAPL  240119C00150000") remain OUT by design: a space is too easily a mis-parsed descriptor
 * rather than a ticker, and the full OCC symbol exceeds 20 chars anyway — a documented skip.
 *
 * Pure: no I/O.
 */
export const TICKER_RE = /^[A-Z0-9./-]{1,20}$/;

/**
 * Normalize a raw symbol (trim + upper-case) and validate against {@link TICKER_RE}.
 * Returns the normalized ticker, or null when the input is empty or not a valid ticker.
 */
export function parseTicker(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  return TICKER_RE.test(s) ? s : null;
}
