/**
 * USER-AUTHORED keyword match keys for categorization rules (TASKS O.13a).
 *
 * The owner, live, with screenshots of Simplifi's rule builder:
 *
 *   "You have the ability to change things like 'contains tjmax'. Because the
 *    card number and other numbers always change. This aids in future pain."
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A LOOSER LEARNER
 *
 * Every match key this app has shipped so far is DERIVED: the merchant canonical
 * the normalizer computes (`CategorizationRule.merchantId`), or the descriptor
 * signature the learner fingerprints (#161). When the derivation is wrong the
 * reader has no lever — his statement says `tjmaxx 0181 0966`, the store number
 * and the trailing sequence move every visit, so the signature never repeats and
 * the canonical is a one-off. He re-files the same shop forever.
 *
 * A keyword key inverts the authority: the reader names the substring that
 * identifies the payee and the app matches it literally. That is licensed here
 * for the same reason it is refused in `learn.ts` — the key is not inferred from
 * behaviour, it is TYPED, visible in a rule list, editable and deletable. The
 * app is not guessing; it is executing an instruction.
 *
 * THE SEMANTICS, and each one is a failure-direction decision:
 *
 *  - ALL keywords must be present (AND), in any order. Simplifi's own helper text
 *    ("All keywords must be present for a rule to apply") and the reason is
 *    conservative: adding a keyword can only ever NARROW the match, so a reader
 *    tightening a rule cannot accidentally widen it.
 *  - LITERAL, case-insensitive substring on the RAW statement text — no
 *    whitespace collapsing, no punctuation stripping, no fuzzy matching. `tjmaxx`
 *    therefore does NOT match `TJ MAXX`. That is deliberate: a rule auto-files
 *    money without asking again, so it must fail in the direction of matching too
 *    LITTLE (the row stays in review, where the reader sees it) rather than too
 *    much (a silent mis-file). The rule builder shows the reader how many of
 *    their existing rows a key matches, which makes an under-match visible
 *    immediately and is a better teacher than any normalization.
 *  - An EMPTY key matches NOTHING, never everything. `merchantCanonical: null`
 *    already means "any merchant" in `ruleMatches`, so a keyword rule that lost
 *    its keywords would otherwise become a file-everything rule — the same trap
 *    `toRuleLike` guards for an orphaned merchant reference, and the same answer.
 *
 * Pure and deterministic: no clock, no I/O, no locale-dependent comparison
 * (`toLowerCase` on both sides, which is what the register's own search uses).
 */

/**
 * Priority band for a typed keyword rule: above the 100 an explicit "Always"
 * merchant rule carries, because it is the most specific instruction in the
 * system — the reader wrote the key himself, against text he can see, for a case
 * the normalizer got wrong. A merchant rule generalises from an inferred
 * identity; this one does not generalise at all.
 */
export const KEYWORD_RULE_PRIORITY = 110;

/**
 * Shortest keyword the builder will store. An empty key is refused because it
 * would match everything; a ONE-letter key is the same defect wearing a value —
 * measured on the seeded dataset, `e` matched 680 of 855 rows and `a` matched
 * 714. The match-count preview cannot warn a brand-new user whose history is
 * empty, so the floor is structural rather than advisory.
 */
export const MIN_KEYWORD_LENGTH = 3;

/** Longest keyword in a key, for the minimum-length floor. */
export function longestKeywordLength(keywords: readonly string[]): number {
  return keywords.reduce((max, k) => Math.max(max, k.length), 0);
}

/**
 * The reader's typed input, split into keyword tokens the way the rule builder
 * shows them as chips: commas OR whitespace separate keywords (Simplifi:
 * "Commas or spaces enter a new keyword"), case is folded, blanks dropped, and
 * duplicates collapsed so `tjmaxx tjmaxx` is one condition rather than two.
 *
 * Order is PRESERVED (first occurrence wins) because the chips are rendered back
 * to the reader in the order they typed them; matching itself is order-free.
 */
export function parseKeywords(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const token = raw.trim().toLowerCase();
    if (token === '') continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Storage codec. Keywords are space-joined, which is lossless BY CONSTRUCTION:
 * `parseKeywords` splits on whitespace and commas, so no surviving token can
 * contain either. Stored as one column so the schema stays portable between
 * Postgres and the SQLite dev/test database (no array or Json column type).
 */
export function encodeKeywords(keywords: readonly string[]): string {
  return keywords.join(' ');
}

/** Decode a stored key. A null/blank column yields `[]` — which matches nothing. */
export function decodeKeywords(stored: string | null | undefined): string[] {
  if (stored == null) return [];
  return parseKeywords(stored);
}

/**
 * Does this statement text carry EVERY keyword? Empty key ⇒ false (see the
 * header: an empty key must never become a match-everything rule).
 */
export function keywordsMatch(keywords: readonly string[], rawDescriptor: string): boolean {
  if (keywords.length === 0) return false;
  const haystack = rawDescriptor.toLowerCase();
  // BOTH sides are folded. `parseKeywords` already lowercases, so a stored key
  // arrives folded — but this function is public and a caller that skipped the
  // parser (a test, a future call site, a hand-built rule) would otherwise get a
  // silent `false` from an upper-case keyword, which is the SILENT half of the
  // under-match direction. My own docblock claimed both sides before the code did
  // (caught by this file's own case-insensitivity test).
  return keywords.every((k) => haystack.includes(k.toLowerCase()));
}

/**
 * How SPECIFIC a keyword key is, for deterministic precedence between two
 * keyword rules that both match: more keywords first, then longer total match
 * text, then the rule id (supplied by the caller) so the order can never depend
 * on the order rows came back from the database. Both tie-breaks are needed —
 * `["costco","gas"]` and `["costco"]` differ in count, while `["costco gas"]`
 * (one long token) and `["costco"]` differ only in length.
 */
export function keywordSpecificity(keywords: readonly string[]): number {
  const total = keywords.reduce((sum, k) => sum + k.length, 0);
  return keywords.length * 1000 + total;
}
