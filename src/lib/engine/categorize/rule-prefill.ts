/**
 * Turning ONE transaction into a pre-filled rule key (TASKS O.13b).
 *
 * Owner, 2026-07-30, after O.13a/O.13c shipped the rule builder:
 *
 *   "From transaction page, whenever clicking a transaction, should have rules
 *    pull up so you can change specifically for that transaction. This should
 *    work for prior and forward transactions. Having to remember which
 *    transaction and how to populate them exactly as written is too cumbersome."
 *
 * He is describing a real defect, not a preference. `/rules` accepted no prefill
 * of any kind — the builder took the category list and the existing rules and
 * nothing else — so the only way to author a key was to remember the bank's
 * text and retype it. And the register never rendered `rawDescriptor` at all
 * (it shows the app's cleaned-up merchant name), so the string the rule matches
 * against was not on screen anywhere he could copy it from. O.13's own brand
 * work widened that gap: `MACYS LENOX SQUARE` now DISPLAYS as `Macy's`, which
 * matches nothing as typed. Asking him to reproduce a descriptor he cannot see
 * is asking him to guess.
 *
 * WHY EVERY TOKEN IS PRE-FILLED, INCLUDING THE VOLATILE ONES
 *
 * The tempting move is to be clever — drop `1084` from `costco whse 1084`
 * automatically, since dropping it is the whole point of a typed key. This
 * refuses to. The wave's governing failure direction (TASKS Wave O.13) is that a
 * rule executes without asking again, so every ambiguity resolves toward
 * matching too LITTLE rather than too much. A key we silently widened is a key
 * the reader never typed, filing rows he never saw, and the preview count he is
 * shown would be the consequence of OUR guess wearing his authority.
 *
 * So the prefill is the most conservative key that is guaranteed to match the
 * row he clicked — every token, in statement order — and the widening is his
 * gesture: delete a chip, watch the count grow. That is exactly the interaction
 * O.13j built the chips for, and it teaches the semantics in one move.
 *
 * `volatile` marks the tokens that look like they change every statement, so the
 * UI can point at them ("these usually change"). It is a HINT ON A CHIP HE CAN
 * SEE, never a deletion we perform for him.
 *
 * Pure and deterministic: no clock, no I/O, no locale-dependent comparison.
 */
import { MIN_KEYWORD_LENGTH, parseKeywords } from './keyword-rule';

/**
 * Statement noise that identifies a payment RAIL or a batch, never a payee:
 * ACH class codes, point-of-sale markers, reference labels. A rule keyed on
 * these matches whatever else shares the rail, which is the widest possible
 * accident — so they are flagged even when they carry no digit.
 */
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  'ach',
  'ckcd',
  'debit',
  'des',
  'eft',
  'ind',
  'indn',
  'pos',
  'ppd',
  'pmt',
  'purchase',
  'ref',
  'tran',
  'trn',
  'web',
  'xxx',
  'xxxx',
]);

export interface RulePrefill {
  /**
   * The suggested key: every storable token of the raw descriptor, in the order
   * the bank printed them. Guaranteed to match the transaction it came from.
   */
  keywords: string[];
  /**
   * The subset of `keywords` that looks statement-specific — a store number, a
   * masked card fragment, a transaction id, an ACH class code. Advisory only.
   */
  volatile: string[];
}

/**
 * True when a token looks like it identifies this STATEMENT LINE rather than the
 * payee: it carries a digit (store numbers, card fragments, transaction ids,
 * dates), it carries a `*` (the `TST*`/`SQ*` processor prefixes), or it is a
 * known rail/batch word.
 */
function isVolatileToken(token: string): boolean {
  if (/\d/.test(token)) return true;
  if (token.includes('*')) return true;
  // Banks glue punctuation to rail words (`~ Tran: 88213` tokenizes as `tran:`,
  // because only commas, whitespace and `|` separate keywords). Strip the edges
  // for the LOOKUP only — the keyword itself stays exactly as the bank printed
  // it, since matching is a literal substring test.
  return NOISE_TOKENS.has(token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''));
}

/**
 * Suggest a rule key from a raw bank descriptor.
 *
 * Tokenization is `parseKeywords` — the SAME splitter the builder applies to
 * text the reader types — so a prefilled chip and a typed chip are the same kind
 * of thing, and the key round-trips through the builder's own FormData contract
 * unchanged. Tokens below the stored minimum length are dropped here rather than
 * offered and then refused on save (`MIN_KEYWORD_LENGTH` is a floor on the READ
 * path too, O.13c critic cycle 1).
 *
 * An empty or unusable descriptor yields an EMPTY key, never a token-free
 * "match everything" — the builder already refuses that, and this must not be
 * the one caller that hands it a way in.
 */
export function suggestRuleKeywords(rawDescriptor: string): RulePrefill {
  const keywords = parseKeywords(rawDescriptor).filter(
    (t) => t.length >= MIN_KEYWORD_LENGTH,
  );
  return { keywords, volatile: keywords.filter(isVolatileToken) };
}
