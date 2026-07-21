/**
 * Doc Extractor v1 — card-statement text extraction, PURE pieces (AI plan §3.3
 * reshaped per its adversarial verdict; DECISIONS #247).
 *
 * The user pastes the text of a card statement; an LLM locates the fields; the
 * grounded result PREFILLS the existing manual-statement form. The model is a
 * span-pointer only — the JSON contract has NO value channel:
 *
 *   {"fields":[{"field":"<id>","sourceSpan":"<verbatim substring>","confidence":<0..1>}]}
 *
 * Every prefilled value is derived BY CODE from the span, after the span is
 * verified to literally exist in the text the model saw. The model labels and
 * copies; it never sums, computes, or authors a figure — so the Trust Center's
 * "AI-originated dollar figures: 0" invariant holds by construction, not by
 * validation. Prompt injection inside a pasted statement is harmless by the
 * same construction: the worst a hostile paste can do is point at spans that
 * still must exist verbatim, still must parse, and still face the human.
 *
 * Failure direction (STATUS lesson "precision fix that fabricates is worse"):
 * every ambiguity — two money tokens in a span, a two-digit year, a span the
 * text doesn't contain — resolves to ABSTAIN (the human types that field), and
 * the final save still runs the byte-identical parseManualStatement gate plus
 * a human confirm. A wrong number can only reach the ledger by the human
 * confirming a visibly-wrong prefill next to its quoted source span.
 *
 * Everything here is pure + deterministic. The network call lives in
 * src/server/llm-statement-extract.ts and is obtainable ONLY through the
 * fencing constructor statementExtractFor() (demo → null, audit-sunk), per the
 * fence-by-construction lesson.
 */
import { compareDates, isoDate, type ISODate } from '@/lib/dates';
import { centsFromDollarString } from '@/lib/money';
// 10000 bps is RESERVED app-wide for a HUMAN-dictated value (Why-This-Category
// §3.1; parseLlmCategory documents the fabricated-origin failure). Same cap,
// same single source of truth.
import { RULE_CONFIDENCE_BPS } from '@/lib/engine/categorize/pipeline';

/** The statement fields the extractor may point at. Closed set. */
export const EXTRACT_FIELD_IDS = [
  'statementBalance',
  'minimumPayment',
  'cycleEnd',
  'dueDate',
  'apr',
] as const;
export type ExtractFieldId = (typeof EXTRACT_FIELD_IDS)[number];

const FIELD_SET: ReadonlySet<string> = new Set(EXTRACT_FIELD_IDS);

/**
 * A span is a pointer, not a paragraph: label + value. Longer means the model
 * is dumping text instead of pointing, and grounding cost/ambiguity rises.
 */
const MAX_SPAN_CHARS = 160;

/** One validated span claim from the model (value NOT included — by design). */
export interface LlmFieldSpan {
  field: ExtractFieldId;
  sourceSpan: string;
  confidenceBps: number;
}

/** One grounded field: span verified in-text, value derived by code from it. */
export interface GroundedField {
  field: ExtractFieldId;
  sourceSpan: string;
  confidenceBps: number;
  /**
   * ManualStatementInput-shaped string, byte-compatible with what the user
   * would have typed: "1234.56" for money, "YYYY-MM-DD" for dates, "24.99"
   * for APR. parseManualStatement remains the one validation gate at save.
   */
  value: string;
}

export interface GroundedStatementExtract {
  fields: GroundedField[];
  /** Fields the model claimed but code could not ground/derive unambiguously. */
  abstained: ExtractFieldId[];
}

/**
 * Mask digit runs that look like account/card numbers BEFORE the text leaves
 * the machine: 9+ digits, allowing up to TWO whitespace/dash characters
 * between digits — covering "4400 1234 5678 9010", double-spaced columnar
 * layouts ("4400  1234"), a PDF line wrap ("4400 1234\n5678 9010", including
 * \r\n), and "1-800-555-0199" (critic #247 cycle-1 P1-2; single-separator-only
 * leaked all of these). Dates and money survive: "06/15/2026 - 07/14/2026"
 * breaks at the slashes, "1,234.56" at the comma/dot, and the " - " between
 * two range dates is 3 chars. Over-masking is the SAFE direction — a masked
 * span fails grounding and the field abstains. This is best-effort masking,
 * not a guarantee (the UI copy says so): an exotic separator can slip through,
 * which is why the disclosure also tells the user to paste only the summary
 * section. Grounding runs against THIS text — exactly what the model saw.
 */
export function scrubAccountNumbers(text: string): string {
  return text.replace(/\d(?:[\s-]{0,2}\d){8,}/g, '[removed]');
}

/**
 * Validate the model's JSON reply against the span-pointer contract. Returns:
 *   - null  — structurally invalid, or non-empty claims with ZERO survivors
 *             (the guardrail discarded the reply → 'rejected'),
 *   - []    — a well-formed reply honestly claiming no fields were found,
 *   - spans — the surviving claims (malformed entries dropped; a field id
 *             claimed more than once is dropped entirely — conflicting claims
 *             are an abstention, not a coin flip).
 */
export function parseLlmStatementExtract(raw: unknown): LlmFieldSpan[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const fields = (raw as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return null;

  const seen = new Map<ExtractFieldId, LlmFieldSpan | 'dup'>();
  for (const entry of fields) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const field = o.field;
    if (typeof field !== 'string' || !FIELD_SET.has(field)) continue;
    const id = field as ExtractFieldId;
    if (seen.has(id)) {
      seen.set(id, 'dup');
      continue;
    }
    const span = o.sourceSpan;
    if (typeof span !== 'string' || span.trim() === '' || span.length > MAX_SPAN_CHARS) continue;
    // A span must carry LABEL context, not just a number: a bare "$980.11"
    // span renders as the tautology `Statement balance ← "$980.11"`, giving
    // the reviewing human nothing to check the LABELING against (critic #247
    // cycle-1 P2-2). At least one letter means the quoted span shows the
    // statement's own wording next to the prefill.
    if (!/[A-Za-z]/.test(span)) continue;
    const conf = o.confidence;
    if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) continue;
    seen.set(id, {
      field: id,
      sourceSpan: span,
      confidenceBps: Math.min(Math.round(conf * 10000), RULE_CONFIDENCE_BPS),
    });
  }

  const out: LlmFieldSpan[] = [];
  for (const v of seen.values()) if (v !== 'dup') out.push(v);
  if (fields.length > 0 && out.length === 0) return null;
  return out;
}

// A $-prefixed money token. The trailing (?![.,]?\d) rejects tokens adjoined
// by more number ("$1,234.567", euro-grouped "$1.234,56") instead of deriving
// a confident truncation (critic #247 cycle-1 P2-1).
const DOLLAR_TOKEN_RE = /-?\s?\$\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?(?![.,]?\d)/g;
// A bare 2-decimal token (dates can't match — no dot).
const BARE_TOKEN_RE = /(?<![\d,.$-])-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?![.,]?\d)/g;

/**
 * Exactly-one-candidate money derivation, with the candidate set spanning BOTH
 * tiers: if a $-token and a distinct bare token coexist ("Pay 35.00 toward
 * $1,234.56"), the span is ambiguous and abstains (critic #247 cycle-1 P2-1 —
 * the old tier rule silently picked the $ one). Negatives matter: a credit
 * balance prints "-$45.00", "($45.00)", "$45.00 CR", or with a unicode minus
 * "−$45.00" (critic cycle-1 P1-3), and dropping the sign would prefill a
 * plausible positive that the save gate accepts — every recognized negative
 * form abstains. Returns the comma-stripped dollar string ("1234.56") or null.
 */
function deriveMoney(rawSpan: string): string | null {
  // Unicode minus / en / em dash → ASCII hyphen so the sign is CAPTURED.
  const span = rawSpan.replace(/[−–—]/g, '-');
  const dollars = [...span.matchAll(DOLLAR_TOKEN_RE)];
  // A bare match inside a $-token ("$ 35.00" → "35.00") is the same token,
  // not a second candidate — drop overlaps before counting.
  const dollarRanges = dollars.map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const bares = [...span.matchAll(BARE_TOKEN_RE)].filter((m) => {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    return !dollarRanges.some(([ds, de]) => s < de && e > ds);
  });

  let m: RegExpMatchArray | null = null;
  if (dollars.length === 1 && bares.length === 0) m = dollars[0];
  else if (dollars.length === 0 && bares.length === 1) m = bares[0];
  if (m === null) return null;

  const token = m[0];
  if (token.includes('-')) return null; // explicit negative → abstain
  const start = m.index ?? 0;
  const before = span.slice(0, start);
  const prevChar = before.replace(/\s+$/, '').slice(-1);
  const after = span.slice(start + token.length);
  if (prevChar === '(' && /^\s*\)/.test(after)) return null; // "($45.00)" → abstain
  if (/^\s*\)?\s*CR(?:EDIT)?\b/i.test(after)) return null; // "$45.00 CR" → abstain
  // Cycle-2 NEW-1: sign forms ADJACENT to the token — a trailing minus
  // ("45.00-", ledger/fixed-width style; unicode already normalized above) or
  // a CR/CREDIT word immediately BEFORE the token ("CR $45.00") — also carry
  // the sign and must abstain, not derive a plausible positive.
  if (/^\s*-/.test(after)) return null;
  if (/\bCR(?:EDIT)?\s*[:\s]*$/i.test(before)) return null;

  const normalized = token.replace(/[$\s]/g, '').replace(/,/g, '');
  try {
    centsFromDollarString(normalized);
  } catch {
    return null;
  }
  return normalized;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// 4-digit year required: "07/14/26" is ambiguous (which century? which pivot?)
// and a statement's dates always print somewhere with the full year.
const US_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const NAME_DATE_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface DateCandidate {
  raw: string; // YYYY-MM-DD shaped, not yet calendar-validated
  start: number;
  end: number;
}

/** All date-shaped tokens in a span (closed format set), in textual order. */
function dateCandidates(span: string): DateCandidate[] {
  const out: DateCandidate[] = [];
  for (const m of span.matchAll(ISO_DATE_RE)) {
    const start = m.index ?? 0;
    out.push({ raw: `${m[1]}-${m[2]}-${m[3]}`, start, end: start + m[0].length });
  }
  for (const m of span.matchAll(US_DATE_RE)) {
    const start = m.index ?? 0;
    out.push({ raw: `${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`, start, end: start + m[0].length });
  }
  for (const m of span.matchAll(NAME_DATE_RE)) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const start = m.index ?? 0;
    out.push({ raw: `${m[3]}-${pad2(month)}-${pad2(+m[2])}`, start, end: start + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

function validDate(raw: string): ISODate | null {
  try {
    return isoDate(raw);
  } catch {
    return null;
  }
}

/**
 * Exactly-one-candidate date derivation across the closed format set:
 * YYYY-MM-DD, M/D/YYYY (read as US month-first — the app's statement formats
 * are US; the quoted span sits next to the prefill for the human to check),
 * and "Month D, YYYY" (full or abbreviated name). Two dates in one span, a
 * two-digit year, or a non-calendar date (02/30/2026) abstain. Returns
 * YYYY-MM-DD or null.
 */
function deriveDate(span: string): string | null {
  const candidates = dateCandidates(span);
  if (candidates.length !== 1) return null;
  return validDate(candidates[0].raw);
}

/** The text joining two dates that makes them a RANGE, not two mentions. */
const RANGE_SEPARATOR_RE = /^\s*(?:-|–|—|to|through)\s*$/i;

/**
 * cycleEnd only: the canonical statement layout prints the cycle as a range
 * ("Statement period: 06/15/2026 - 07/14/2026"), and a range's END is
 * deterministic — take the later date when a span holds EXACTLY two dates
 * joined by nothing but a range separator, in ascending order. Anything else
 * (three dates, no separator between them, reversed order) falls back to the
 * exactly-one rule and abstains on ambiguity.
 */
function deriveCycleEnd(span: string): string | null {
  const candidates = dateCandidates(span);
  if (candidates.length === 2) {
    const [a, b] = candidates;
    if (!RANGE_SEPARATOR_RE.test(span.slice(a.end, b.start))) return null;
    const first = validDate(a.raw);
    const second = validDate(b.raw);
    if (first === null || second === null || compareDates(second, first) <= 0) return null;
    return second;
  }
  return deriveDate(span);
}

/**
 * Exactly-one-candidate APR derivation: one percent-suffixed token ("24.99%").
 * A bare "24.99" without the % is not accepted — too easily a money figure.
 * Range/shape enforcement stays with parseManualStatement at save (one gate,
 * no drift). Returns the percentage string ("24.99") or null.
 */
function deriveApr(span: string): string | null {
  const tokens = span.match(/(?<![\d.,])\d{1,3}(?:\.\d{1,2})?\s?%/g) ?? [];
  if (tokens.length !== 1) return null;
  const value = tokens[0].replace(/[\s%]/g, '');
  try {
    centsFromDollarString(value); // same digits[.dd] shape check the gate uses
  } catch {
    return null;
  }
  return value;
}

const DERIVE: Record<ExtractFieldId, (span: string) => string | null> = {
  statementBalance: deriveMoney,
  minimumPayment: deriveMoney,
  cycleEnd: deriveCycleEnd,
  dueDate: deriveDate,
  apr: deriveApr,
};

/**
 * Ground the model's span claims against the (scrubbed) source text and derive
 * each value by code. A span the text does not contain verbatim, or a span
 * whose value can't be derived under the exactly-one-candidate rules, abstains.
 */
export function groundStatementExtract(
  scrubbedText: string,
  spans: readonly LlmFieldSpan[],
): GroundedStatementExtract {
  const fields: GroundedField[] = [];
  const abstained: ExtractFieldId[] = [];
  for (const s of spans) {
    const value = scrubbedText.includes(s.sourceSpan) ? DERIVE[s.field](s.sourceSpan) : null;
    if (value === null) abstained.push(s.field);
    else fields.push({ ...s, value });
  }
  return { fields, abstained };
}

/** Human labels for the paste panel + abstention copy. UI-boundary only. */
export const EXTRACT_FIELD_LABELS: Record<ExtractFieldId, string> = {
  statementBalance: 'Statement balance',
  minimumPayment: 'Minimum payment',
  cycleEnd: 'Statement closing date',
  dueDate: 'Payment due date',
  apr: 'APR',
};

/** Build the (deterministic) span-pointer prompt for one pasted statement. */
export function buildStatementExtractPrompt(scrubbedText: string): string {
  return [
    'From the credit-card statement text below, locate these fields:',
    '- statementBalance: the new/current statement balance',
    '- minimumPayment: the minimum payment due',
    '- cycleEnd: the statement closing date (period end)',
    '- dueDate: the payment due date',
    '- apr: the purchase APR',
    'For each field you can find, copy the EXACT substring of the text that contains its value — verbatim, including punctuation, at most one short line. Include the field’s label text from the document (e.g. "New balance $1,234.56", not just "$1,234.56"). Do not compute, reformat, or paraphrase anything.',
    'Respond with ONLY a JSON object, no prose:',
    '{"fields":[{"field":"<one of statementBalance|minimumPayment|cycleEnd|dueDate|apr>","sourceSpan":"<exact substring>","confidence":<number 0..1>}]}',
    'Omit any field whose value does not appear in the text.',
    'STATEMENT TEXT:',
    scrubbedText,
  ].join('\n');
}
