/**
 * The reader's free-form tags (TASKS O.11d) — the pure half.
 *
 * A tag is a LABEL, in the family of `note`: no money engine reads one, and the
 * "tag total" a register filtered by a tag shows is `summarizeTransactions` over
 * the filtered rows — the very function the unfiltered summary strip uses. This
 * module therefore contains NO arithmetic at all: what lives here is naming, and
 * naming hygiene is exactly as load-bearing as arithmetic when two spellings of
 * one label can make one chip and its total look like two.
 *
 * This is a plain module, not a `'use server'` file, for the L.7 reason
 * `categories.ts` spells out: a `'use server'` file may export only async
 * functions, and BOTH writers of a tag name — the server action and the client's
 * input validation — must share one definition. Same reasoning as
 * `normalizeCategoryName`: each side trimming "in its own way" is how "Dining" and
 * "Dining " become two entries in one picker.
 */
import { categoryNameLength, MAX_CATEGORY_NAME, normalizeCategoryName } from '@/lib/engine/categorize/categories';

/**
 * The ceiling on a tag name, and the reason it is the CATEGORY ceiling: both are
 * short labels a reader types and a column renders, and one constant means the two
 * label kinds cannot drift into accepting different lengths for the same UI. In
 * CODE POINTS (see `categoryNameLength` — 40 CJK characters must not fail where 40
 * emoji pass, and must not silently exceed the limit either).
 */
export const MAX_TAG_NAME = MAX_CATEGORY_NAME;

/**
 * Normalize a tag name the reader typed. Delegates every rule — NFC, control and
 * zero-width/bidi stripping, whitespace collapse, trim — to the category
 * normalizer rather than restating them, so a tag can never survive with an
 * invisible character a category would have stripped. A tag whose name carries a
 * zero-width space is a chip pixel-identical to its twin and byte-different;
 * L.12c is the cautionary tale for a "harmless-looking" normalizer nobody tests.
 */
export function normalizeTagName(raw: string): string {
  return normalizeCategoryName(raw);
}

/** Length in CODE POINTS — the same count `MAX_TAG_NAME` is expressed in. */
export function tagNameLength(name: string): number {
  return categoryNameLength(name);
}

/**
 * The one place a tag name's validity is DECIDED, so the client's input and the
 * server's writer refuse the same strings for the same reasons — the reason a
 * client-only check is not a check (see the custom-category action's header).
 * Returns the normalized name, or the reader-facing sentence explaining why there
 * is none. A tag carries NO authority beyond a label (unlike a tax class), so the
 * only meanings that must be refused are "no name at all" and "too long to read".
 */
export function validateTagName(raw: string): { name: string } | { error: string } {
  const name = normalizeTagName(raw);
  if (name === '') return { error: 'Give the tag a name.' };
  if (tagNameLength(name) > MAX_TAG_NAME) {
    // "to 40", not "under 40" — a name of exactly 40 code points is VALID, and
    // the refusal must not imply otherwise. (The sibling name validators say
    // "under N" for the same > check; this file states the true bound. One
    // family-wide copy sweep is the follow-up, not six edits in one slice.)
    return { error: `Keep the name to ${MAX_TAG_NAME} characters.` };
  }
  return { name };
}

/** The shape carried on a transaction row — id (filter/delete key) + name (chip). */
export interface TxnTagRef {
  id: string;
  name: string;
}

/**
 * Display order for a row's chips: code-point order by name, decided in ONE place
 * so the register, the detail view, and any future surface list the same tags in
 * the same order. Deliberately NOT `localeCompare`: chip order must not change
 * with the runtime's locale, and a stable byte order is the cheapest promise the
 * reader can actually rely on. Returns a new array; never mutates the row.
 */
export function sortTagsForDisplay(tags: readonly TxnTagRef[]): TxnTagRef[] {
  return [...tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
