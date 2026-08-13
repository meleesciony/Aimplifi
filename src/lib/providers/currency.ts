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

/**
 * What the withhold hides — the disclosure's input (#135 residual: a withheld account must
 * not vanish SILENTLY from /accounts and the dashboard headline).
 */
export interface WithheldAccountSummary {
  /** How many of the user's accounts are withheld (non-USD). */
  count: number;
  /** Distinct withheld currency tokens, sorted for a stable display order. */
  currencies: string[];
}

/**
 * Summarize the accounts the currency guard withholds. Pure; accepts any rows that carry
 * `currency` (an unfiltered account list, or rows already pre-filtered to non-USD — the
 * predicate is idempotent). The exact complement of `isSupportedCurrency`, so the disclosure
 * can never disagree with the withhold itself.
 */
export function summarizeWithheldAccounts(
  accounts: ReadonlyArray<{ currency: string | null }>,
): WithheldAccountSummary {
  const withheld = accounts.filter((a) => !isSupportedCurrency(a.currency));
  // Every withheld row has a non-null currency (null is supported), hence the cast-free map.
  const currencies = [...new Set(withheld.map((a) => a.currency))].filter(
    (c): c is string => c !== null,
  ).sort();
  return { count: withheld.length, currencies };
}

/**
 * Human-readable label for the withheld currency list. Letter-code tokens (ISO or
 * unofficial/crypto: EUR, GBP, BTC) are shown uppercased and deduped; everything else — a
 * SimpleFIN non-ISO currency URL, a numeric ISO-4217 code like '840', a 2-letter fragment
 * like 'US' that reads as a country — is folded into "other currencies" rather than pasted
 * into user-facing copy (checker: '840'/'US'/'doge' are feed tokens, not display names).
 */
export function formatWithheldCurrencies(currencies: readonly string[]): string {
  const codes = currencies.filter((c) => /^[A-Za-z]{3,5}$/.test(c));
  // Dedupe AFTER uppercasing ('doge' and 'DOGE' are one currency) — but detect opaque
  // tokens from the pre-dedupe count, so case-variants alone never claim "and other currencies".
  const printable = [...new Set(codes.map((c) => c.toUpperCase()))].sort();
  const hasOpaque = codes.length < currencies.length;
  if (printable.length === 0) return 'other currencies';
  const joined = printable.join(', ');
  // "and other currencies", not the bare "and others" (U.27): the noun-less form parses as
  // "EUR, and other ACCOUNTS" — a plausible misreading right beside sentences this same string
  // feeds that already talk about accounts ("an account in {label} is left out"). Spelling out
  // the noun this list is actually a list OF removes the ambiguity at the source, so every
  // consumer inherits the fix for free.
  return hasOpaque ? `${joined} and other currencies` : joined;
}

/** The disclosure banner's full copy — see withheldBannerCopy. */
export interface WithheldBannerCopy {
  title: string;
  description: string;
}

/**
 * The banner's complete copy, built PURELY from the summary so every grammar branch is
 * unit-testable (checker: five singular/plural branches previously shipped unlocked).
 * Returns null when nothing is withheld — the component renders nothing.
 *
 * Copy follows the coaching guardrails: educational (why the figures exclude them), states
 * the assumption inline (no FX — a 1:1 rate would be wrong), no shame, no promised ship
 * date. The title says "not in U.S. dollars", NOT "foreign currency": crypto (BTC via
 * Plaid's unofficial_currency_code) is a first-class withheld case and isn't foreign.
 */
export function withheldBannerCopy(summary: WithheldAccountSummary): WithheldBannerCopy | null {
  if (summary.count === 0) return null;
  const one = summary.count === 1;
  const label = formatWithheldCurrencies(summary.currencies);
  // One account can't be "in other currencies" (plural) — fold to the singular form.
  const inWhat = one && label === 'other currencies' ? 'another currency' : label;
  return {
    title: `${summary.count} ${one ? 'account' : 'accounts'} not included — not in U.S. dollars`,
    description:
      `Aimplifi can't convert other currencies to U.S. dollars yet, so ` +
      `${one ? 'an account' : 'accounts'} in ${inWhat} ${one ? 'is' : 'are'} left out of every ` +
      `total, trend, and projection shown — counting ${one ? 'it' : 'them'} at a one-to-one ` +
      `rate would be inaccurate. Nothing is deleted: the account data and history stay saved.`,
  };
}

/**
 * Compact inline note stating the currency-exclusion assumption AT a projection or total
 * that was computed on USD-only data (the coaching guardrail: every projection states its
 * assumptions inline — #135 residual 25). Returns null when nothing is withheld, so all-USD
 * surfaces stay byte-identical. Complements the page-level CurrencyExclusionBanner
 * (#141/#149): the banner announces the exclusion once at the top of the page; this restates
 * it where the figure is shown, matching the app's per-projection assumption style ("assuming
 * X% returns", "estimated from your last 6 months"). Factual basis note — no shame, no
 * promised ship date.
 */
export function withheldInlineNote(summary: WithheldAccountSummary): string | null {
  if (summary.count === 0) return null;
  const one = summary.count === 1;
  return (
    `Excludes ${summary.count} account${one ? '' : 's'} not in U.S. dollars — ` +
    `Aimplifi doesn't convert other currencies yet.`
  );
}

/**
 * The note for a FILE the guard withheld rows from (U.23) — the transactions CSV today.
 *
 * Its own author rather than a reuse of `withheldBannerCopy` or `withheldInlineNote`, because
 * what this surface owes its reader is a different fact. Both siblings say a FIGURE excludes
 * some accounts; a reader holding either sentence over a file of rows can reasonably conclude
 * their rows are present and merely un-summarized. Here the rows themselves are absent, and the
 * reader's next act — sum the amount column, or keep this file as their archive — is one the
 * app never sees. So this note says the transactions are not in the file, in those words. (The
 * same reason U.19/U.20 gave each handover surface its own author: a sibling's clause is false
 * the moment the surface stops printing what the sibling described.)
 *
 * COUNT SCOPE, the thing both U.23 critics caught independently. This note's count comes from
 * `getWithheldRegisterAccountSummary` — the accounts THIS FILE could have carried — while the
 * banner counts every non-USD account the reader owns, of any type. So the two legitimately
 * disagree: a reader with a euro checking account and a yen brokerage sees "2 accounts" on
 * screen and one account named here, and both are right about their own subject. What the note
 * therefore may NOT do is spend that scoped count on a claim about the app: the totals sentence
 * below states the RULE, with no number in it, and every counted clause names this file.
 *
 * Copy follows the same guardrails as its siblings: educational, states the assumption (no FX)
 * inline, no shame, no promised ship date, and — the #141 rule — "not in U.S. dollars" rather
 * than "foreign", because crypto is a first-class withheld case and isn't foreign. "Saved" names
 * Aimplifi explicitly: in a downloaded file, an unplaced "stays saved" can read as a promise
 * about the file the reader is holding (`a-disclosure-written-for-a-page-is-false-in-an-email`).
 */
export function withheldExportNote(summary: WithheldAccountSummary): string | null {
  if (summary.count === 0) return null;
  const one = summary.count === 1;
  const label = formatWithheldCurrencies(summary.currencies);
  // The codes ride a parenthetical, so the opaque case can simply omit it: "one account that
  // isn't in U.S. dollars" is the whole of what we can honestly say about a feed token, and
  // "(other currencies)" after it would add nothing but noise.
  const codes = label === 'other currencies' ? '' : ` (${label})`;
  return (
    `Note: this file leaves out ${one ? 'one account' : `${summary.count} accounts`} that ` +
    `${one ? "isn't" : "aren't"} in U.S. dollars${codes}. Aimplifi can't convert other ` +
    `currencies to U.S. dollars yet, so none of ${one ? 'its' : 'their'} transactions are in ` +
    `this file — counting those transactions in a column of dollars at a one-to-one rate would ` +
    `be inaccurate. Accounts that aren't in U.S. dollars are left out of Aimplifi's totals for ` +
    `the same reason. Nothing is deleted: the ${one ? 'account' : 'accounts'} and ` +
    `${one ? 'its' : 'their'} history stay saved in Aimplifi.`
  );
}
