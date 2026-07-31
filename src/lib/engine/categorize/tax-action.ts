/**
 * The rule THEN-action "tag this for taxes" (O.15 slice 6) — one pure decision,
 * shared by the ingest pipeline and the apply-to-history writer so a row tagged
 * on tonight's sync and a row tagged by the same rule's backfill are tagged by
 * the same reasoning.
 *
 * WHY THIS EXISTS. Simplifi puts a "Tax Related" toggle on the CATEGORY and feeds
 * a tax report from it. DECISIONS #345(c) measured that shape against this codebase
 * and refused it: `applyCategory`, `recategorize`, the keyword-rule apply, the
 * backfill, Plaid and SimpleFIN each write `categoryId` independently, so a
 * per-category flag would have to be honoured at six call sites — the
 * fence-by-call-site anti-pattern that has cost this repo a P0 before. The rule
 * machinery, by contrast, is already ONE fenced path with a counted, previewed
 * apply-to-existing. So the flag lives on the rule.
 *
 * THE TWO SEMANTIC DECISIONS, each a failure-direction call:
 *
 *  1. WRITE-TIME STAMP, never a read-time lookup. A read-time "is this category
 *     tax-related?" would silently re-tag months of history the moment the reader
 *     edited a category — changing a total they may already have handed a
 *     preparer. A stamp can only ever UNDER-tag (a row filed before the rule
 *     existed stays untagged until the reader applies the rule to history, which
 *     is a gesture with a count in front of it), and an under-tag is VISIBLE: the
 *     export shows less, and less is a number the reader can question. An
 *     over-tag is invisible in exactly the same way a fabricated deduction is.
 *
 *  2. NEVER OVERWRITE A TAG THAT IS ALREADY THERE. A tag on a row is a claim about
 *     a deduction, and the reader is the only one who can make it. This holds for
 *     an UNRECOGNIZED stored value too — a class this version does not know reads
 *     back as untagged everywhere else (`isTaxClass`), but overwriting it would
 *     destroy the only record of what the reader chose, whereas leaving it merely
 *     leaves the row out of a total, which is the visible direction again.
 *
 * Pure: no clock, no I/O, no database. The caller decides WHICH rows are offered
 * here; this module decides only whether a given row takes the stamp.
 */
import { isTaxClass, type TaxClass } from '../tax/classes';

/** What a row already carries, and what the matched rule wants to put on it. */
export interface TaxStampInput {
  /**
   * The rule's stored `setTaxClass` column. Null on every rule written before this
   * slice, and on every rule whose author left the action blank.
   */
  readonly ruleTaxClass: string | null | undefined;
  /**
   * The row's current `taxClass`. Null/blank means untagged; ANY other value —
   * recognized or not — means the reader has already answered this question.
   */
  readonly currentTaxClass: string | null | undefined;
}

/**
 * The class to WRITE, or null for "leave this row exactly as it is".
 *
 * Returning null rather than the unchanged value is deliberate: every caller
 * counts what it writes, and the counts this feeds are shown to the reader as
 * "tagged N transactions". A no-op that reported itself as a write would make the
 * preview promise more than the apply performs — the same honesty the rename
 * action's `OR: [{ merchantId: null }, …]` clause buys on its own count.
 */
export function resolveRuleTaxStamp(input: TaxStampInput): TaxClass | null {
  const wanted = input.ruleTaxClass;
  // The read-path gate. `setTaxClass` is a free String column (so a class can be
  // added without migrating rows), which means an unknown slug can reach here from
  // a hand-edited row or a downgrade. It must tag NOTHING rather than write a value
  // no surface can label — `taxClassLabel` would render it as an unlabelled blank
  // in the export, which is a total nobody can check.
  if (!isTaxClass(wanted)) return null;
  // Decision 2: an already-answered row is never re-answered.
  if (hasTag(input.currentTaxClass)) return null;
  return wanted;
}

/**
 * Does this row already carry a tag? Blank and whitespace-only are treated as
 * untagged: the per-row control writes null to clear, but a string column reached
 * by any other writer could hold '' and an empty drawer is not a claim.
 */
export function hasTag(currentTaxClass: string | null | undefined): boolean {
  return currentTaxClass != null && currentTaxClass.trim() !== '';
}

/**
 * Normalize the builder's submitted value for storage: a blank select means "this
 * rule tags nothing", and anything outside the closed set is refused rather than
 * stored, so `resolveRuleTaxStamp`'s read-path gate stays a defence in depth
 * instead of the only guard.
 */
export function normalizeSetTaxClass(raw: string | null | undefined): TaxClass | null {
  const trimmed = (raw ?? '').trim();
  return isTaxClass(trimmed) ? trimmed : null;
}
