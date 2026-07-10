/**
 * PII scrub for Ask unknown-question mining (TASKS 2.2 / DECISIONS #208).
 * PURE — strips emails, currency amounts, and digit runs so the ledger can be
 * mined for vocabulary without retaining recoverable PII. Never used for
 * display; the live Ask path still sees the raw question.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** $1,234.56 / $12 / 1,234.56 — currency-shaped tokens before bare digits. */
const AMOUNT_RE = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{3})+\.\d{1,2}\b|\b\d+\.\d{2}\b/g;
/** Remaining digit runs (phones, card fragments, years, bare integers). */
const DIGITS_RE = /\d+/g;

const MAX_SCRUBBED_LEN = 500;

/**
 * Scrub a question for the UnknownQuestion ledger. Order: emails → amounts →
 * digits, then collapse whitespace. Empty / whitespace-only input → "".
 */
export function scrubQuestionText(raw: string): string {
  const text = (raw ?? '').trim().slice(0, MAX_SCRUBBED_LEN);
  if (!text) return '';
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(AMOUNT_RE, '[amount]')
    .replace(DIGITS_RE, '[num]')
    .replace(/\s+/g, ' ')
    .trim();
}
