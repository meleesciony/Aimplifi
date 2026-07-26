/**
 * render-safe.ts — one sanitizer for any bank-supplied string about to be PAINTED or COMPARED.
 *
 * Extracted verbatim from `components/finance/continued-accounts-view.ts` (TASKS L.15) with no
 * behaviour change: the duplicate-disclosure copy module moved into the engine tree when the
 * reminder/digest/notify engines became its consumers, and `src/lib/**` must not import from
 * `src/components/**`. `continued-accounts-view.ts` re-exports both symbols, so every existing
 * importer is untouched.
 *
 * Bidi overrides, zero-width and other default-ignorable characters, plus C0/C1 controls.
 *
 * Account names arrive from a bank feed unmodified (`simplefin.ts:475`, `plaid.ts:344` write the
 * provider's name straight through) and manual names are only `trim()`-ed. Two critic findings turn
 * on this: U+202E reverses the rest of a button face at render time, and U+200B / doubled spaces
 * make two byte-DIFFERENT labels paint IDENTICALLY — defeating any collision check that compares
 * raw strings. Sanitizing once, at construction, makes the rendered string equal the compared
 * string, which is what lets the uniqueness argument hold on screen and not just in memory.
 */

/** Shown when a name sanitizes away to nothing — never an empty control face. */
export const UNNAMED_ACCOUNT = 'Unnamed account';

const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * The cleaning step on its own — identical normalization, WITHOUT the `Unnamed account`
 * fallback. The nickname parser (TASKS L.7) needs to SEE an empty result so it can treat
 * "the user cleared the box" as clearing the nickname rather than storing the placeholder
 * as a name. Everything else should keep calling `renderSafe`.
 */
export function sanitizeName(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

export function renderSafe(raw: string): string {
  const cleaned = sanitizeName(raw);
  return cleaned === '' ? UNNAMED_ACCOUNT : cleaned;
}
