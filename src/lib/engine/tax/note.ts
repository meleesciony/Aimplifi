/**
 * The per-transaction note: what the reader writes to remember what something was
 * ("mum's prescription", "half of this was the deposit").
 *
 * One author for the rule, because the note is written from one surface today and
 * will be written from more later, and a cap enforced in the control but not in the
 * action is not a cap. Pure: string in, string-or-null out.
 *
 * WHAT THIS IS NOT. It is not structured data and nothing may ever read it as such.
 * The tax CLASS is the field a report groups by (`./classes.ts`); the note is prose
 * a human reads, carried verbatim into the export beside the row it belongs to and
 * summed by nothing. That separation is the whole reason both shipped together — a
 * note alone invites "medical" to be typed where no export can ever find it.
 */

/**
 * Long enough for a sentence of context, short enough that the column cannot become
 * a document store — and short enough that a note stays readable in a CSV cell
 * beside its amount, which is where most of them will actually be read.
 */
export const TXN_NOTE_MAX_CHARS = 500;

export type NoteError = 'too-long';

/**
 * Normalize a note as typed into the value stored, or an error the caller shows.
 *
 * - Trims the ends, because trailing whitespace is never meant and would print as a
 *   ragged CSV cell; the INTERIOR is left exactly as typed — line breaks and double
 *   spaces are the reader's own prose, and the CSV encoder already quotes them.
 * - Empty (or whitespace-only) becomes `null`, not `''`, so "cleared the note" and
 *   "never wrote one" are the same state in the database rather than two that read
 *   the same on screen and sort differently in a report.
 * - Over the cap REJECTS rather than silently truncating: a note is the reader's own
 *   words, and quietly cutting the end off someone's record of what a charge was is
 *   a data loss they would not find out about until the export (the L.30 rule — a
 *   broken value names its cause instead of arriving mangled).
 */
export function normalizeNote(
  raw: string | null | undefined,
): { ok: true; note: string | null } | { ok: false; error: NoteError } {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return { ok: true, note: null };
  if (trimmed.length > TXN_NOTE_MAX_CHARS) return { ok: false, error: 'too-long' };
  return { ok: true, note: trimmed };
}

/** The message a reader sees for a rejected note. One author, so the control and the
 *  action cannot disagree about what the limit is. */
export function noteErrorMessage(error: NoteError): string {
  switch (error) {
    case 'too-long':
      return `That note is longer than ${TXN_NOTE_MAX_CHARS} characters — nothing was saved. Shorten it and try again.`;
  }
}
