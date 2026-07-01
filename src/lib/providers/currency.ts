/**
 * Currency guard for live aggregator ingest (DECISIONS #135; #127 live-ingest audit #3/#10).
 *
 * The app does NO foreign-exchange: every stored cents value is treated as USD. A live feed
 * (Plaid / SimpleFIN) can report a balance in another currency (EUR) or a zero-decimal one
 * (JPY/KRW); summed into net worth at a fake 1:1 that silently corrupts the headline. Rather
 * than fabricate a USD figure we CANONICALIZE the feed's currency code and, at the read
 * boundary, WITHHOLD non-USD accounts ("a withheld figure beats a silently wrong one"). USD-
 * only today; the canonical code is PERSISTED on Account.currency so a future increment can
 * surface foreign accounts properly (and add real FX) — the data is preserved, not destroyed.
 *
 * Pure: no I/O. Tested in tests/unit/currency.test.ts.
 */

/**
 * Canonical currency code, or null when none is reported (legacy / demo / manual = assumed USD).
 * A 3-letter ISO-4217 code is upper-cased; any other token (a SimpleFIN non-ISO URL, a crypto /
 * unofficial code, a 4-letter symbol) is returned trimmed AS-IS so it can never equal 'USD' and
 * is therefore withheld.
 */
export function canonicalizeCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === '') return null;
  return /^[a-z]{3}$/i.test(t) ? t.toUpperCase() : t;
}

/**
 * Plaid balances carry `iso_currency_code` (ISO-4217) OR `unofficial_currency_code`
 * (crypto / unofficial); exactly one is populated, ISO preferred (Plaid docs).
 */
export function resolvePlaidCurrency(
  iso: string | null | undefined,
  unofficial?: string | null,
): string | null {
  // Canonicalize EACH first, THEN coalesce: `iso ?? unofficial` only falls through on
  // null/undefined, so a blank/whitespace iso ('') would SHADOW a populated unofficial/crypto
  // code and canonicalize to null (= assumed USD = summed at 1:1). canonicalizeCurrency('') is
  // already null, so coalescing the canonicalized values lets an empty iso fall through to the
  // unofficial code (DECISIONS #135 critic P2 — fail-open hardening).
  return canonicalizeCurrency(iso) ?? canonicalizeCurrency(unofficial);
}

/**
 * Supported = denominated in USD. null (legacy, demo, manual rows, or a feed that omits the
 * code) is assumed USD so existing data and the golden demo stay byte-identical. Everything
 * else is withheld from the net-worth read paths.
 */
export function isSupportedCurrency(code: string | null | undefined): boolean {
  return code == null || code === 'USD';
}
