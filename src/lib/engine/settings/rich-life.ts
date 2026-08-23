/**
 * The "My Rich Life" vision line (C.13 · Sethi — plan P1.3): one freeform string
 * the reader types in Settings ("In one line, what does a rich life look like for
 * you?") and the FI Coach echoes atop /coach. It is PERSONAL INPUT shown back to
 * the same person, never data: no engine sums or routes on it, and nothing may
 * ever read it as structured data (the tax-note rule, applied to a shorter
 * question). The echo is a sentence built around their words, so this module is
 * the one author for what can enter that sentence.
 *
 * One author for the rule: the action's check and the module's message share
 * the SAME constant, and the settings input deliberately carries NO maxLength —
 * a cap enforced in the control but not in the action is not a cap, and a
 * control cap makes the action's rejection unreachable and silently truncates
 * the reader's answer (critic F1; the note module's doctrine).
 *
 * Pure: string in, string-or-null out.
 */

/** Long enough for one line of meaning, short enough that the column cannot become
 *  a document store and the coach echo stays a single quiet line. */
export const RICH_LIFE_MAX_CHARS = 120;

export type RichLifeError = 'too-long';

/** Control characters (Cc: ASCII control, DEL, NEL U+0085) and the U+2028/2029
 *  line/paragraph separators a clipboard can paste. Replaced with a space, never
 *  dropped: dropping a tab would JOIN the two words it separated. */
const TO_SPACE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * Normalize the vision as typed into the value stored, or an error the caller shows.
 *
 * - Replaces control/separator characters with a SPACE, never a drop
 *   ("line\tone" → "line one", not "lineone") — a drop rewrites the reader's
 *   line just as badly as truncating it would; a separator at either end only
 *   trims.
 * - Trims the ends; the INTERIOR is left exactly as typed — capitalization and
 *   spacing are the reader's own prose.
 * - Empty (or whitespace-only) → null, so "cleared the vision" and "never wrote
 *   one" are the same state in the database rather than two that render the
 *   same and sort differently.
 * - Over the cap REJECTS rather than silently truncating: the line is the
 *   reader's own words, and cutting the end off their answer rewords it without
 *   telling them (the L.30 rule — a broken value names its cause instead of
 *   arriving mangled).
 */
export function normalizeRichLifeVision(
  raw: string | null | undefined,
): { ok: true; vision: string | null } | { ok: false; error: RichLifeError } {
  const cleaned = (raw ?? '').replace(TO_SPACE, ' ').trim();
  if (cleaned.length === 0) return { ok: true, vision: null };
  if (cleaned.length > RICH_LIFE_MAX_CHARS) return { ok: false, error: 'too-long' };
  return { ok: true, vision: cleaned };
}

/** The message a reader sees for a rejected vision. One author, so the control and
 *  the action cannot disagree about what the limit is. */
export function richLifeErrorMessage(error: RichLifeError): string {
  switch (error) {
    case 'too-long':
      return `That line is longer than ${RICH_LIFE_MAX_CHARS} characters — nothing was saved. Shorten it and try again.`;
  }
}
