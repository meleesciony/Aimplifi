/**
 * The analyst questions Ask reads — a CLOSED grammar, and its printer.
 *
 * Comparing two months, or averaging a run of them, is asked a thousand ways. An
 * earlier attempt (unshipped) tried to read them all with pattern lists; each review
 * found another phrasing that slipped into the wrong reading, and each fix was one more
 * list. This module takes the other side of that trade:
 *
 *   - It reads a handful of sentence SHAPES, written out below, and nothing else. A
 *     question outside them is not an analyst question as far as this module is
 *     concerned — it returns null and the question goes wherever it went before.
 *   - Every position in a shape must be accounted for. No shape tolerates words it does
 *     not name, so a sentence that merely CONTAINS "vs" or "average" is not claimed.
 *   - `analystQuestionText` prints an intent back as a sentence in the grammar, and the
 *     suite checks that reading what it prints returns the same intent. That is what
 *     the follow-up buttons send — the typed box is the minor way in.
 *   - The answer states its reading ("Dining Out — September 2026 against August
 *     2026"), so a reader who meant something else can see it at once.
 *
 * The shapes (case, trailing punctuation and extra spaces ignored):
 *
 *   compare [my] [TARGET] [spending|spend] [in|for|during] MONTH (to|vs|versus|with|and|against) MONTH₂
 *   [my] [TARGET] [spending|spend] [in] MONTH (vs|versus) MONTH₂
 *   did i spend (more|less) [on TARGET] [in] MONTH than [in] MONTH₂
 *   [what is|what's] [my] average [monthly] [TARGET] (spending|spend) [RANGE]
 *   [what is|what's] [my] average [monthly] (spending|spend) on TARGET [RANGE]
 *
 *   MONTH  := <month name> [<year>] | last month | this month
 *   MONTH₂ := MONTH | the month before | the same month last year
 *   RANGE  := (over|for|in) [the] (last|past) N months          (N from 2 to 24; 6 when absent)
 *   TARGET := a category or group, as `resolveSpendTarget` reads it; absent = all spending
 *
 * Pure: no I/O; the caller passes `today` and the target resolver.
 */
import { addMonthsToMonthKey, monthKey, type ISODate } from '@/lib/dates';

/** What a TARGET resolved to. Opaque here: the caller's own target type rides through. */
export interface AnalystTarget<T> {
  target: T;
  label: string;
}

export type AnalystIntent<T> =
  | { kind: 'spend_compare'; currentYm: string; baselineYm: string; target: AnalystTarget<T> | null }
  /** The months `fromYm`…`toYm` inclusive — always finished months, ending last month. */
  | { kind: 'spend_average'; fromYm: string; toYm: string; months: number; target: AnalystTarget<T> | null };

/** Reads a TARGET phrase, or null when it names nothing known. */
export type TargetReader<T> = (phrase: string) => AnalystTarget<T> | null;

export const DEFAULT_AVERAGE_MONTHS = 6;
const MIN_AVERAGE_MONTHS = 2;
const MAX_AVERAGE_MONTHS = 24;

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may', 'may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
] as const;

export const ANALYST_MONTH_TITLE = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Full names before abbreviations, so "march" is never half-read as "mar". */
const MONTH_WORD = MONTHS.flatMap((names) => [...names])
  .sort((a, b) => b.length - a.length)
  .join('|');
const MONTH_RE = `(?:(?:${MONTH_WORD})(?: 20\\d{2})?|last month|this month)`;
const MONTH2_RE = `(?:${MONTH_RE}|the month before|the same month last year)`;

/** Words that mean "all of it" in the TARGET position. */
const ALL_SPENDING = new Set(['', 'all', 'total', 'overall', 'all my', 'my total', 'my overall', 'everything']);

/**
 * Words a TARGET phrase may not contain. Each one means the phrase is saying more than
 * a category name — a second thing, a place, an exclusion — and reading only the part
 * that happens to match a category would answer a different question.
 */
const NOT_IN_A_TARGET = /\b(?:at|from|with|and|or|vs|versus|than|to|by|plus|not|except|without|but|per|each)\b|\d/;

function normalize(question: string): string {
  return question
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bvs\./g, 'vs')
    .replace(/[?.!\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthIndex(word: string): number {
  return MONTHS.findIndex((names) => (names as readonly string[]).includes(word));
}

/** A MONTH phrase → its "YYYY-MM", or null when it names a month that has not begun. */
function readMonth(phrase: string, today: ISODate): string | null {
  const todayYm = monthKey(today);
  if (phrase === 'this month') return todayYm;
  if (phrase === 'last month') return addMonthsToMonthKey(todayYm, -1);
  const [word, year] = phrase.split(' ');
  const i = monthIndex(word!);
  if (i < 0) return null;
  const mm = String(i + 1).padStart(2, '0');
  if (year) {
    const ym = `${year}-${mm}`;
    return ym > todayYm ? null : ym;
  }
  // No year: the most recent month of that name, counting the one in progress.
  const thisYear = `${today.slice(0, 4)}-${mm}`;
  return thisYear > todayYm ? `${Number(today.slice(0, 4)) - 1}-${mm}` : thisYear;
}

/** Whole months from `a` to `b` ("YYYY-MM"), signed. */
function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

function readSecondMonth(phrase: string, firstYm: string, firstPhrase: string, today: ISODate): string | null {
  if (phrase === 'the month before') return addMonthsToMonthKey(firstYm, -1);
  if (phrase === 'the same month last year') return addMonthsToMonthKey(firstYm, -12);
  // A second month named without a year, after a first month named WITH one, is the month
  // of that name NEAREST the first — "May 2025 to April" is April 2025, "December 2025 to
  // January" is January 2026 — never the first month itself, never one still to come; at
  // a tie ("June 2025 to June") the later one, which is the June a reader means.
  const [word, year] = phrase.split(' ');
  const firstHasYear = /^[a-z]+ \d{4}$/.test(firstPhrase);
  if (firstHasYear && !year && monthIndex(word!) >= 0) {
    const mm = String(monthIndex(word!) + 1).padStart(2, '0');
    const y = Number(firstYm.slice(0, 4));
    const todayYm = monthKey(today);
    const candidates = [y - 1, y, y + 1]
      .map((yy) => `${yy}-${mm}`)
      .filter((ym) => ym !== firstYm && ym <= todayYm);
    const gap = (ym: string) => Math.abs(monthsBetween(firstYm, ym));
    candidates.sort((a, b) => gap(a) - gap(b) || (a < b ? 1 : -1));
    return candidates[0] ?? null;
  }
  return readMonth(phrase, today);
}

/** A TARGET phrase → the target, `null` for all spending, or `undefined` when it cannot be read. */
function readTarget<T>(raw: string, read: TargetReader<T>): AnalystTarget<T> | null | undefined {
  const phrase = raw.trim();
  if (ALL_SPENDING.has(phrase)) return null;
  const target = read(phrase);
  if (!target) return undefined;
  // The phrase IS the category's own name ("Food and Drink"): nothing is left over.
  if (target.label.toLowerCase() === phrase) return target;
  return NOT_IN_A_TARGET.test(phrase) ? undefined : target;
}

/** Strips one optional leading word group. */
const dropLead = (s: string, re: RegExp) => s.replace(re, '').trimStart();
/** Strips one optional trailing word group. */
const dropTail = (s: string, re: RegExp) => s.replace(re, '').trimEnd();

function readCompare<T>(q: string, today: ISODate, read: TargetReader<T>): AnalystIntent<T> | null {
  // The two months and what stands between them; nothing may follow the second.
  const m = new RegExp(`^(.*?)\\b(${MONTH_RE}) (to|vs|versus|with|and|against|than|than in) (${MONTH2_RE})$`).exec(q);
  if (!m) return null;
  const [, headRaw, first, joiner, second] = m as unknown as [string, string, string, string, string];
  const head = headRaw.trim();

  let targetPhrase: string;
  if (head.startsWith('compare')) {
    if (joiner.startsWith('than')) return null;
    if (head !== 'compare' && !head.startsWith('compare ')) return null;
    let rest = head.slice('compare'.length).trim();
    rest = dropTail(rest, /(?:^| )(?:in|for|during)$/);
    rest = dropTail(rest, /(?:^| )(?:spending|spend)$/);
    rest = dropLead(rest, /^my(?: |$)/);
    targetPhrase = rest;
  } else if (head.startsWith('did i spend ')) {
    if (!joiner.startsWith('than')) return null;
    const d = /^did i spend (?:more|less)(?: on (.+?))?(?: in)?$/.exec(head);
    if (!d) return null;
    targetPhrase = d[1] ?? '';
  } else {
    // The bare shape: only "vs" / "versus" may join, so an ordinary sentence that
    // happens to hold two months around "to" or "and" is not claimed.
    if (joiner !== 'vs' && joiner !== 'versus') return null;
    let rest = dropTail(head, /(?:^| )in$/);
    rest = dropTail(rest, /(?:^| )(?:spending|spend)$/);
    rest = dropLead(rest, /^my(?: |$)/);
    targetPhrase = rest;
  }

  const target = readTarget(targetPhrase, read);
  if (target === undefined) return null;
  const currentYm = readMonth(first, today);
  if (!currentYm) return null;
  const baselineYm = readSecondMonth(second, currentYm, first, today);
  if (!baselineYm) return null;
  return { kind: 'spend_compare', currentYm, baselineYm, target };
}

function readAverage<T>(q: string, today: ISODate, read: TargetReader<T>): AnalystIntent<T> | null {
  let rest = dropLead(q, /^(?:what is|what's|whats) /);
  rest = dropLead(rest, /^my /);
  if (rest !== 'average' && !rest.startsWith('average ')) return null;
  rest = rest.slice('average'.length).trim();
  rest = dropLead(rest, /^monthly(?: |$)/);

  let months = DEFAULT_AVERAGE_MONTHS;
  const range = / ?(?:over|for|in) (?:the )?(?:last|past) (\d{1,2}) months$/.exec(rest);
  if (range) {
    months = Number(range[1]);
    if (months < MIN_AVERAGE_MONTHS || months > MAX_AVERAGE_MONTHS) return null;
    rest = rest.slice(0, range.index).trim();
  }

  // "[TARGET] spending" or "spending on TARGET" — the word itself is required.
  let targetPhrase: string;
  const on = /^(?:spending|spend) on (.+)$/.exec(rest);
  const before = /^(?:(.+) )?(?:spending|spend)$/.exec(rest);
  if (on) targetPhrase = on[1]!;
  else if (before) targetPhrase = before[1] ?? '';
  else return null;

  const target = readTarget(targetPhrase, read);
  if (target === undefined) return null;
  const toYm = addMonthsToMonthKey(monthKey(today), -1);
  return { kind: 'spend_average', fromYm: addMonthsToMonthKey(toYm, -(months - 1)), toYm, months, target };
}

/** Reads a question as an analyst intent, or null when it is not written in the grammar. */
export function readAnalystQuestion<T>(question: string, today: ISODate, read: TargetReader<T>): AnalystIntent<T> | null {
  const q = normalize(question);
  if (!q) return null;
  return readCompare(q, today, read) ?? readAverage(q, today, read);
}

/** "YYYY-MM" → "September 2026". */
export function analystMonthLabel(ym: string): string {
  return `${ANALYST_MONTH_TITLE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/**
 * The intent as a sentence in the grammar. Months are always written with their year,
 * so the sentence means the same thing whenever it is read back.
 */
export function analystQuestionText<T>(intent: AnalystIntent<T>): string {
  const what = intent.target ? `${intent.target.label} spending` : 'spending';
  if (intent.kind === 'spend_compare') {
    return `Compare ${what} in ${analystMonthLabel(intent.currentYm)} to ${analystMonthLabel(intent.baselineYm)}`;
  }
  return `Average monthly ${what} over the last ${intent.months} months`;
}
