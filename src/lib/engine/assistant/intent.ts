/**
 * Ask Aimplifi — deterministic NL → typed intent parser (DECISIONS #75).
 *
 * This is the routing brain of the assistant, and it is PURE and RULE-BASED: a
 * question maps to one of a small, closed set of typed intents with no model
 * call (LOOP_ENGINEERING rule #5 — routing/branching is code, not vibes). The
 * server answers an intent by calling the SAME tested engines the dedicated
 * views use, so the assistant can never originate a number. The LLM is only a
 * fallback that maps a genuinely-unrecognized question onto one of these same
 * typed intents, and even then its proposal is re-resolved + validated through
 * THIS module before any data is touched (see llm.ts / server/assistant.ts).
 *
 * Pure: string in, typed object out. No I/O, no `new Date()` — `today` is given.
 */
import { addMonthsClamped, addMonthsToMonthKey, daysInMonth, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { centsFromDollarString, formatCents, type Cents } from '@/lib/money';
import { CATEGORIES, CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';

/** A resolved calendar window over month keys (inclusive), with a display label. */
export interface Timeframe {
  fromYm: string; // YYYY-MM
  toYm: string; // YYYY-MM
  label: string; // e.g. "this month", "last month", "May 2026", "the last 3 months"
}

/** What a spending question is about: a single leaf category or a whole group. */
export type SpendTarget =
  | { type: 'category'; categoryId: string; label: string }
  // A fixed SET of leaf categories summed under one umbrella word (e.g. "utilities"
  // = electricity + gas + water + trash + the combined-utilities catch-all). Added
  // #154: the utility split moved those leaves out of `utilities`, so a single-id
  // target would silently under-report the umbrella total.
  | { type: 'categories'; categoryIds: string[]; label: string }
  | { type: 'group'; group: string; label: string };

export type AssistantIntent =
  | { kind: 'net_worth' }
  | { kind: 'account_balance'; query: string }
  | { kind: 'spend_total'; timeframe: Timeframe }
  | { kind: 'spend_by_category'; timeframe: Timeframe; target: SpendTarget }
  // A per-MERCHANT spend total ("how much did I spend at Costco"). `merchant` is
  // the user's cleaned, lowercased query term; the answer matches it against the
  // transactions' canonical merchant names (#168) and derives the display name
  // from the data, so no merchant string is ever fabricated.
  | { kind: 'merchant_spend'; timeframe: Timeframe; merchant: string }
  | { kind: 'top_categories'; timeframe: Timeframe; limit: number }
  // Optionally scoped to one merchant ("biggest purchase at Costco", TASKS
  // 2.7); `merchant` follows the merchant_spend contract — the user's cleaned
  // query term, matched against the transactions' own canonical names.
  | { kind: 'largest_purchases'; timeframe: Timeframe; limit: number; merchant?: string }
  | { kind: 'income'; timeframe: Timeframe }
  | { kind: 'safe_to_spend' }
  | { kind: 'cash_needed' }
  | { kind: 'debt_payoff' }
  | { kind: 'debt_free_by_date'; targetDate: ISODate; label: string }
  | { kind: 'savings_goal_by_date'; targetDate: ISODate; targetCents: number | null; label: string }
  | { kind: 'retire_at_age'; targetAge: number; label: string }
  /** Stated wealth target, no deadline — W.1's compounding planner via Ask (W.4). */
  | { kind: 'wealth_target'; targetCents: number; label: string }
  | { kind: 'subscriptions' }
  /** 90-day committed + card dues — same engine as dashboard Cash flow radar (DECISIONS #488). */
  | { kind: 'cash_flow_radar' }
  /** Recurring-only balance walk — same engine as /forecast (DECISIONS #72 / #75). */
  | { kind: 'forecast' }
  | { kind: 'savings_rate' }
  | { kind: 'unknown'; question: string };

export type AssistantIntentKind = AssistantIntent['kind'];

export const ASSISTANT_INTENT_KINDS: readonly AssistantIntentKind[] = [
  'net_worth',
  'account_balance',
  'spend_total',
  'spend_by_category',
  'merchant_spend',
  'top_categories',
  'largest_purchases',
  'income',
  'safe_to_spend',
  'cash_needed',
  'debt_payoff',
  'debt_free_by_date',
  'savings_goal_by_date',
  'retire_at_age',
  'wealth_target',
  'subscriptions',
  'cash_flow_radar',
  'forecast',
  'savings_rate',
  'unknown',
] as const;

// ─── timeframe parsing ──────────────────────────────────────────────────────

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
/** Month names for a concrete window label ("June 2026"). Exported so the
 *  conversation frame can re-label a carried deictic window (see frame.ts). */
export const MONTH_TITLE = [
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

/** Month names + abbreviations as one regex alternation (full names first so
 *  "january" is never half-claimed by "jan"). */
const MONTH_MATCH_ALT = [...MONTH_NAMES, 'sept', ...MONTH_ABBR].join('|');

/** The 0-based month index a matched name/abbreviation refers to, else null. */
function monthIndexOf(word: string): number | null {
  const i = (MONTH_NAMES as readonly string[]).indexOf(word);
  if (i >= 0) return i;
  if (word === 'sept') return 8;
  const j = (MONTH_ABBR as readonly string[]).indexOf(word);
  return j >= 0 ? j : null;
}


// ─── numeric dates & bare years (TASKS 2.7) ─────────────────────────────────

/**
 * A 4-digit token read as a calendar year: 2000 through the CURRENT year. A
 * future year is deliberately NOT a window — "how much will I spend in 2027"
 * is a forecast question, and a past-tense figure under it (or worse, a
 * silently-defaulted this-month window) answers a different question. The
 * shape still counts as a date (see `unresolvedDateShape`), so the routes
 * abstain rather than guess.
 */
function bareYearValue(t: string, today: ISODate): number | null {
  if (!/^20\d{2}$/.test(t)) return null;
  const y = Number(t);
  return y <= Number(today.slice(0, 4)) ? y : null;
}

/**
 * A numeric-date token — "3/5" (US M/D), "3/2025" (M/YYYY), "3/5/2025" — read
 * as its containing calendar MONTH, the same shipped rule as the worded
 * "on March 5" (the month window, disclosed by the label). Null for anything
 * invalid or ambiguous: a 13th month (we do not guess DD/MM), a day the month
 * doesn't have, a two-digit year, a future year. A year-less M/D resolves to
 * the most recent non-future occurrence of that month, mirroring the
 * month-name rule below.
 */
function numericDateYm(t: string, today: ISODate): { ym: string; month: number; year: number } | null {
  const m = /^(\d{1,2})\/(\d{1,4})(?:\/(\d{4}))?$/.exec(t);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  let year: number;
  let day: number | null;
  if (m[3] !== undefined) {
    year = Number(m[3]);
    day = Number(m[2]);
  } else if (m[2].length === 4) {
    year = Number(m[2]);
    day = null;
  } else {
    day = Number(m[2]);
    year = month > tm ? ty - 1 : ty;
  }
  if (year < 2000 || year > ty) return null;
  if (day !== null && (day < 1 || day > daysInMonth(year, month))) return null;
  return { ym: `${year}-${String(month).padStart(2, '0')}`, month, year };
}

/** A tight year range typed as one token ("2024-2025"), both years valid. */
function yearRangeToken(t: string, today: ISODate): { lo: number; hi: number } | null {
  const m = /^(20\d{2})[-–—](20\d{2})$/.exec(t);
  if (!m) return null;
  const a = bareYearValue(m[1], today);
  const b = bareYearValue(m[2], today);
  if (a === null || b === null) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/**
 * A token that is date-SHAPED (a numeric date or a 4-digit 20xx year), whether
 * or not it resolves to a window. Used to END a merchant phrase ("at costco
 * 2025" is the store costco in the 2025 window, not a store named "costco
 * 2025") — shape-level on purpose, so an unresolvable date never becomes part
 * of a store name either.
 */
const DATE_SHAPED_TOKEN_RE = /^(?:20\d{2}(?:[-–—]20\d{2})?|\d{1,2}\/\d{1,4}(?:\/\d{2,4})?)$/;

/** A date shape ANYWHERE in the question: a numeric date, a standalone 20xx
 *  year (not part of a longer word/number, not a "$2025" amount), a
 *  year-first season ("2025/26"), or a fiscal year ("FY2025", "fy 25") —
 *  the last two are never windowed, so they always abstain (critic F6:
 *  income answered the silent this-month default under "in fy2025"). */
const DATE_SHAPE_RE = /(?<![\w/.$-])(?:\d{1,2}\/\d{1,4}(?:\/\d{2,4})?|20\d{2}(?:\/\d{1,4})?|fy\s?\d{2,4})(?![\w/])/i;

/**
 * True when the question names a date SHAPE that `parseExplicitTimeframe`
 * could NOT resolve into a window — a future year, "13/5", "3/5/26". Every
 * timeframe-carrying route must then ABSTAIN rather than fall back to the
 * silent this-month default: before TASKS 2.7, "how much did I spend on
 * groceries in 2025" answered the unhedged THIS-MONTH Groceries figure, and
 * "since 2024" the this-month total — a true figure under a different window,
 * the repo's cardinal sin. Shared by the parser's routes and `intentFromKind`
 * so no route answers a window another route refused.
 */
export function unresolvedDateShape(question: string, today: ISODate): boolean {
  return DATE_SHAPE_RE.test(question) && parseExplicitTimeframe(question, today) === null;
}

/**
 * Resolve a calendar window from free text, anchored on `today`. Defaults to the
 * current month when nothing is said. "last N months" is the trailing N months
 * ending with (and including) the current month.
 */
export function parseTimeframe(qRaw: string, today: ISODate): Timeframe {
  return parseExplicitTimeframe(qRaw, today) ?? thisMonth(today);
}

/** The current-month window — the timeframe used when a question names none. */
function thisMonth(today: ISODate): Timeframe {
  const todayYm = monthKey(today);
  return { fromYm: todayYm, toYm: todayYm, label: 'this month' };
}

/**
 * The same resolution as `parseTimeframe`, but `null` when the text names NO
 * timeframe at all (instead of silently defaulting to this month). The
 * conversation frame (TASKS 2.1) needs the difference: "what about last month?"
 * carries a timeframe slot to swap, "what about groceries?" does not — and a
 * silent default would overwrite the frame's timeframe with the current month.
 */
export function parseExplicitTimeframe(qRaw: string, today: ISODate): Timeframe | null {
  const q = qRaw.toLowerCase();
  const todayYm = monthKey(today);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));

  if (/\b(this|current) month\b/.test(q) || /\bmonth to date\b/.test(q) || /\bmtd\b/.test(q)) {
    return { fromYm: todayYm, toYm: todayYm, label: 'this month' };
  }

  // "since <year | month | last month>" — a window that runs THROUGH today
  // (TASKS 2.7). Checked before the bare last-month/month rules so "since
  // march" is March-through-today, not the March-only window it used to claim,
  // and "since last month" spans both months. A future "since" start resolves
  // nothing (falls through; the date-shape guard then abstains the route).
  {
    const sm = new RegExp(
      `\\bsince\\s+(?:the\\s+)?(?:(20\\d{2})|((?:last|previous|prior)\\s+(?:month|year))|(${MONTH_MATCH_ALT})(?:\\s+(20\\d{2}))?)\\b`,
    ).exec(q);
    if (sm) {
      if (sm[1]) {
        const yr = bareYearValue(sm[1], today);
        if (yr !== null) return { fromYm: `${yr}-01`, toYm: todayYm, label: `since ${yr}` };
      } else if (sm[2]) {
        // "since last year" runs from LAST January through today — one inch
        // from "since 2025", which already did (critic cycle 1, F5).
        return /year/.test(sm[2])
          ? { fromYm: `${y - 1}-01`, toYm: todayYm, label: 'since last year' }
          : { fromYm: addMonthsToMonthKey(todayYm, -(1)), toYm: todayYm, label: 'since last month' };
      } else if (sm[3]) {
        const mi = monthIndexOf(sm[3]);
        if (mi !== null) {
          const yr = sm[4] ? Number(sm[4]) : mi + 1 > m ? y - 1 : y;
          const fromYm = `${yr}-${String(mi + 1).padStart(2, '0')}`;
          if (fromYm <= todayYm) {
            return { fromYm, toYm: todayYm, label: `since ${MONTH_TITLE[mi]} ${yr}` };
          }
        }
      }
    }
  }

  if (/\b(last|previous|prior|past) month\b/.test(q)) {
    const p = addMonthsToMonthKey(todayYm, -(1));
    return { fromYm: p, toYm: p, label: 'last month' };
  }
  if (/\b(this year|year to date|year-to-date|ytd)\b/.test(q)) {
    return { fromYm: `${y}-01`, toYm: todayYm, label: `${y} so far` };
  }
  if (/\b(last|previous|prior) year\b/.test(q)) {
    return { fromYm: `${y - 1}-01`, toYm: `${y - 1}-12`, label: `${y - 1}` };
  }
  const lastN = q.match(/\b(?:last|past|previous|trailing)\s+(\d{1,2})\s+months?\b/);
  if (lastN) {
    const n = Math.max(1, Math.min(24, Number(lastN[1])));
    return { fromYm: addMonthsToMonthKey(todayYm, -(n - 1)), toYm: todayYm, label: `the last ${n} months` };
  }

  // Explicit month name (optionally with a 4-digit year). "may" is also a modal
  // verb, so only treat it as a month with a preposition before it or a year after.
  for (let i = 0; i < 12; i++) {
    const name = MONTH_NAMES[i];
    const abbr = MONTH_ABBR[i];
    const namedRe = new RegExp(`\\b(${name}|${abbr})\\b`);
    if (!namedRe.test(q)) continue;
    if (i === 4) {
      // May: require disambiguation so "how much may I spend" isn't a month.
      const mayMonth = /\b(in|during|for|of|back in|since)\s+may\b/.test(q) || /\bmay\s+\d{4}\b/.test(q);
      if (!mayMonth) continue;
    }
    const yearMatch = q.match(new RegExp(`(?:${name}|${abbr})\\s+(\\d{4})`)) ?? q.match(/\b(20\d{2})\b/);
    let year = yearMatch ? Number(yearMatch[1]) : y;
    if (!yearMatch && i + 1 > m) year = y - 1; // most recent past occurrence
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    // An explicitly-dated FUTURE month is not a window either (TASKS 2.7
    // critic F3): "how much did I make in December 2030" used to get a
    // definitive past-tense answer about a window four years out, and "since
    // march 2027" fell through the since-rule only to be claimed HERE as a
    // March-2027-only window. Resolve nothing — the date-shape guard abstains
    // the route. (A year-less month is always resolved to the past above, so
    // only explicit years can land here.)
    if (ym > todayYm) return null;
    return { fromYm: ym, toYm: ym, label: `${MONTH_TITLE[i]} ${year}` };
  }

  // Numeric dates (TASKS 2.7): "3/5" (US M/D), "3/2025", "3/5/2025" — the
  // containing MONTH window, the same shipped rule as the worded "on March 5",
  // disclosed by the label. An INVALID shape ("13/5", "3/45", a two-digit
  // year) resolves nothing — deliberately `null` right here rather than
  // falling through, so the date-shape guard abstains the route instead of a
  // co-present bare year answering a window the user didn't name.
  {
    const nm = /(?<![\w/.$-])(\d{1,2}\/\d{1,4}(?:\/\d{4})?)(?![\w/])/.exec(q);
    if (nm) {
      const d = numericDateYm(nm[1], today);
      return d ? { fromYm: d.ym, toYm: d.ym, label: `${MONTH_TITLE[d.month - 1]} ${d.year}` } : null;
    }
  }

  // Bare year(s) (TASKS 2.7): "in 2025" → that calendar year; the current year
  // → January through today (the YTD window and label); two or more years →
  // the span ("between 2024 and 2025", "from 2024 to 2026", "2024-2025"). A
  // FUTURE year poisons the whole set — "between 2024 and 2027" must not
  // half-answer 2024 — and a comparison ("2024 vs 2025") is not a window we
  // can represent, so both resolve nothing and the shape guard abstains.
  {
    const years: number[] = [];
    const range = /(?<![\w/.$-])(20\d{2})\s*[-–—]\s*(20\d{2})(?![\w/])/.exec(q);
    if (range) {
      const lo = bareYearValue(range[1], today);
      const hi = bareYearValue(range[2], today);
      if (lo === null || hi === null) return null; // a future endpoint poisons it
      years.push(lo, hi);
    } else {
      const re = /(?<![\w/.$-])(20\d{2})(?![\w/])/g;
      for (let ym = re.exec(q); ym; ym = re.exec(q)) {
        const yr = bareYearValue(ym[1], today);
        if (yr === null) return null; // a future year poisons the set
        years.push(yr);
      }
    }
    if (years.length > 0) {
      if (years.length > 1 && /\b(vs|versus|compared?|against)\b/.test(q)) return null;
      const lo = Math.min(...years);
      const hi = Math.max(...years);
      // Labels land mid-sentence in money copy ("You spent $X <label>.",
      // "No purchases at Costco <label>."), so a bare "2025" reads like part
      // of the store name — "in 2025" doesn't (critic F9).
      if (lo === hi) {
        return lo === y
          ? { fromYm: `${y}-01`, toYm: todayYm, label: `${y} so far` }
          : { fromYm: `${lo}-01`, toYm: `${lo}-12`, label: `in ${lo}` };
      }
      // A range ending in the CURRENT year is the same window as "since <lo>"
      // (lo-January through today) — label it that way, so the frame's
      // staleness re-labeling covers it for free (critic F8: a clamped
      // "2024–2026" label kept implying through-today after July).
      return hi === y
        ? { fromYm: `${lo}-01`, toYm: todayYm, label: `since ${lo}` }
        : { fromYm: `${lo}-01`, toYm: `${hi}-12`, label: `in ${lo}–${hi}` };
    }
  }

  return null;
}

// ─── target-date parsing (for the inverse "debt-free by <date>" planner) ──────

/** A resolved goal date with a human label, parsed from "by December 2027" etc. */
export interface TargetDate {
  date: ISODate;
  label: string; // "December 2027" | "the end of 2027"
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const endOfMonthDate = (year: number, month: number): ISODate =>
  isoDate(`${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`);
const endOfYearDate = (year: number): ISODate => isoDate(`${year}-12-31`);
const ymTitleOf = (date: ISODate): string => `${MONTH_TITLE[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/**
 * Extract a goal DATE from free text ("be debt-free by December 2027", "in 3 years",
 * "by next June", "by 2028"). A month/year resolves to the LAST day of that month, so
 * "by December" means by the end of December (user-favorable). Returns null when no
 * date is stated — the caller then keeps the forward debt_payoff intent. Deterministic,
 * no `Date` object, anchored on `today`, so it works zero-key in the demo (the LLM, if
 * it routes here, never supplies the date — this re-derives it; see llm.ts).
 */
export function parseTargetDate(qRaw: string, today: ISODate): TargetDate | null {
  const q = qRaw.toLowerCase();
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));

  // End of the month that `monthOffset` from today lands in (the user-favorable rule:
  // "in 18 months" / "by next month" mean by the END of that month, matching "by <Month>").
  const endOfOffsetMonth = (monthOffset: number): TargetDate => {
    const d = addMonthsClamped(today, Math.max(0, Math.min(1200, monthOffset)));
    const date = endOfMonthDate(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
    return { date, label: ymTitleOf(date) };
  };

  // "in N years" / "in N months" — an offset from today, resolved to that month's end.
  const inYears = q.match(/\bin\s+(\d{1,2})\s+years?\b/);
  if (inYears) return endOfOffsetMonth(Number(inYears[1]) * 12);
  const inMonths = q.match(/\bin\s+(\d{1,3})\s+months?\b/);
  if (inMonths) return endOfOffsetMonth(Number(inMonths[1]));

  // "by next month" / "by (the end of) this month".
  if (/\bnext month\b/.test(q)) return endOfOffsetMonth(1);
  if (/\b(this month|end of (the )?month|month[\s-]?end)\b/.test(q)) return endOfOffsetMonth(0);

  // "by next year".
  if (/\bnext year\b/.test(q)) return { date: endOfYearDate(ty + 1), label: `the end of ${ty + 1}` };

  // "by the end of <year>" / "by year end" / "end of the year".
  const endOfYr = q.match(/\bend of (?:the )?(20\d{2})\b/);
  if (endOfYr) {
    const yr = Number(endOfYr[1]);
    return { date: endOfYearDate(yr), label: `the end of ${yr}` };
  }
  if (/\b(end of (the )?year|year[\s-]?end)\b/.test(q)) {
    return { date: endOfYearDate(ty), label: `the end of ${ty}` };
  }

  // A BARE year with an UNAMBIGUOUS deadline cue ("debt-free by 2028") — checked BEFORE the month
  // loop so a month mentioned in passing ("started my loan in March, debt-free by 2028") can't
  // hijack the deadline. The cue must sit immediately before the year, so "by December 2027" (year
  // not adjacent to the cue) correctly falls through to the month loop below. "in <year>" is
  // deliberately EXCLUDED: it is just as often a START date ("started my loan in 2020, debt-free by
  // December 2027"), and including it let the start year hijack the real deadline (PARSE-1 class,
  // DECISIONS #125). A bare "in 2028" therefore yields no date and keeps the forward debt answer.
  const byYear = q.match(/\b(?:by|before|until|til|till)\s+(20\d{2})\b/);
  if (byYear) {
    const yr = Number(byYear[1]);
    return { date: endOfYearDate(yr), label: `the end of ${yr}` };
  }

  // A month name with an ADJACENT 4-digit year, else its next future occurrence. No global
  // "any year in the string" fallback — a lone month only pairs with a year written next to it.
  for (let i = 0; i < 12; i++) {
    const name = MONTH_NAMES[i];
    const abbr = MONTH_ABBR[i];
    if (!new RegExp(`\\b(${name}|${abbr})\\b`).test(q)) continue;
    if (i === 4) {
      // "May" is also a modal verb — require a cue or an explicit year (same rule as parseTimeframe).
      const ok =
        /\b(by|before|until|til|till|in|during|for|of|come)\s+may\b/.test(q) ||
        /\bnext may\b/.test(q) ||
        /\bmay\s+20\d{2}\b/.test(q);
      if (!ok) continue;
    }
    const month = i + 1;
    const adjacentYear = q.match(new RegExp(`(?:${name}|${abbr})\\.?\\s+(20\\d{2})`));
    // No adjacent year stated → the next future occurrence of that month.
    const year = adjacentYear ? Number(adjacentYear[1]) : month > tm ? ty : ty + 1;
    return { date: endOfMonthDate(year, month), label: `${MONTH_TITLE[i]} ${year}` };
  }

  return null;
}

// ─── target-amount parsing (for the inverse "save $X by <date>" planner, #126) ─

/**
 * Extract a stated dollar AMOUNT from free text ("save $15,000 by December", "$20k",
 * "2 million", "set aside 50,000"). DETERMINISTIC and conservative: the amount is the user's
 * OWN number, never the LLM's (the cardinal rule — the model supplies only the kind, the
 * amount is string-matched out of the user's text). Returns integer cents, or null when no
 * amount is clearly stated — the caller then ASKS for it rather than inventing one. A bare
 * unmarked number is NOT treated as an amount (so a year like "2028" can't become "$2,028"):
 * it must carry a "$", a magnitude suffix (k/m/mil/grand/thousand/million/bn/billion), the word
 * "dollars"/"bucks", a spoken count + magnitude ("ten million"), or thousands grouping.
 * Integer-cents throughout (no float on money): the base ≤2-decimal value parses via
 * centsFromDollarString, then scales by an integer multiplier; anything it can't parse
 * exactly falls through to null (ask, don't guess). W.4: "mil" is million; a compound
 * number-word ("twenty five million") abstains rather than reading the last word as the count.
 */
export function parseTargetAmount(qRaw: string): number | null {
  const q = qRaw.toLowerCase();

  // Strip grouping commas (centsFromDollarString accepts only \d+(.\d{1,2})?), parse, bound.
  const toCents = (numeric: string): number | null => {
    try {
      return centsFromDollarString(numeric.replace(/,/g, ''));
    } catch {
      return null;
    }
  };
  const finite = (n: number | null): number | null =>
    n !== null && Number.isFinite(n) && n > 0 && n <= 1e15 ? n : null;

  // The integer part: either a thousands-GROUPED number ("15,000" — needs ≥1 comma group)
  // OR a plain run of digits ("20000"). The grouped alternative REQUIRES a comma (`+`, not `*`):
  // with `*` an ungrouped "20000" matched `\d{1,3}`="200" + zero groups and the optional tail
  // let the whole match succeed WITHOUT backtracking to `\d+`, truncating "$20000" to $200 — a
  // 100x-wrong, never-stated figure (critic P0, #126). The `+` forces ungrouped numbers to `\d+`.
  const INT = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
  const NUMBER_WORD =
    'a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
  const MAG_WORD = 'k|m|mil|bn|grand|thousand|million|billion';
  const NON_MONEY_UNIT =
    'steps?|miles?|mi|km|kilometers?|meters?|points?|pts?|reps?|cal(?:ories)?|words?|ft|feet|members?|users?|followers?|views?|subscribers?|hours?|hrs?|minutes?|mins?|days?|items?|units?';

  // A compound spoken count ("twenty five million") would otherwise match the LAST
  // number-word and invent a 5×-wrong target. Hyphenated "twenty-five" is the same shape.
  if (new RegExp(`\\b(?:${NUMBER_WORD})[\\s-]+(?:${NUMBER_WORD})\\s+(?:${MAG_WORD})\\b`).test(q)) {
    return null;
  }
  if (/\b(half|quarter|third)(?:\s+of)?\s+a\s+(million|mil|billion)\b/.test(q)) return null;
  if (new RegExp(`(?:${INT}|${NUMBER_WORD})\\s+(?:${MAG_WORD})\\s+(?:${NON_MONEY_UNIT})\\b`).test(q)) {
    return null;
  }

  // 1) Magnitude form FIRST, so "$15k" isn't read as "$15" by the plain-dollar rule below.
  const MULT: Record<string, number> = {
    k: 1_000,
    grand: 1_000,
    thousand: 1_000,
    m: 1_000_000,
    mil: 1_000_000,
    million: 1_000_000,
    bn: 1_000_000_000,
    billion: 1_000_000_000,
  };
  const mag = q.match(new RegExp(`\\$?\\s?(${INT})(?:\\.(\\d{1,2}))?\\s*(${MAG_WORD})\\b`));
  if (mag) {
    const base = toCents(`${mag[1]}${mag[2] ? `.${mag[2]}` : ''}`);
    if (base !== null) return finite(base * MULT[mag[3]]);
  }

  // 2) Explicit "$" amount (optional grouping + ≤2 decimals).
  const dollar = q.match(new RegExp(`\\$\\s?(${INT})(?:\\.(\\d{1,2}))?`));
  if (dollar) return finite(toCents(`${dollar[1]}${dollar[2] ? `.${dollar[2]}` : ''}`));

  // 3) "<n> dollars/bucks".
  const worded = q.match(new RegExp(`(${INT})(?:\\.(\\d{1,2}))?\\s*(?:dollars|bucks)\\b`));
  if (worded) return finite(toCents(`${worded[1]}${worded[2] ? `.${worded[2]}` : ''}`));

  // 4) A thousands-grouped bare number (the comma marks it unambiguously as an amount), UNLESS
  // it is immediately followed by a non-money unit ("10,000 steps", "5,000 miles") — those are
  // quantities, not dollars (critic P2, #126). Only this rule lacks a currency marker, so it
  // alone needs the guard.
  const grouped = q.match(
    /\b(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?\b(?!\s*(?:steps?|miles?|mi|km|kilometers?|meters?|points?|pts?|reps?|cal(?:ories)?|words?|ft|feet|members?|users?|followers?|views?|subscribers?|hours?|hrs?|minutes?|mins?|days?|items?|units?)\b)/,
  );
  if (grouped) return finite(toCents(`${grouped[1]}${grouped[2] ? `.${grouped[2]}` : ''}`));

  // 5) Spoken count + magnitude ("ten million", "a million", "ten mil"). The word is a
  // dollar count, so scale by 100 cents then the magnitude. Digits already matched above.
  const WORD_TO_N: Record<string, number> = {
    a: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  const wordedMag = q.match(new RegExp(`\\b(${NUMBER_WORD})\\s+(${MAG_WORD})\\b`));
  if (wordedMag) return finite(WORD_TO_N[wordedMag[1]] * 100 * MULT[wordedMag[2]]);

  return null;
}

// ─── target-age parsing (for the inverse "retire at <age>" planner, #131) ──────

/**
 * Extract a stated retirement AGE from free text ("can I retire at 60?", "retire by age 67",
 * "when I'm 62"). DETERMINISTIC and conservative: the age is the user's OWN number — the LLM
 * supplies only the kind, the age is string-matched out of the user's text (the cardinal
 * no-fabrication rule). Bounded to [18, 110] (DIAL_LIMITS.retirementAge); returns null when no
 * plausible age is stated, so the caller keeps the forward answer rather than inventing one.
 * The caller gates this on retirement vocabulary, so a bare "by age 65" can't route here alone.
 */
export function parseTargetAge(qRaw: string): number | null {
  const q = qRaw.toLowerCase();
  // `retir(e|es|ed|ing|ement)` so the natural inflections ("retiring at 65", "retired at 60")
  // are covered, not just the bare "retire" — kept in lockstep with the routing gate below.
  const m =
    /\bretir(?:e|es|ed|ing|ement)(?:\s+\w+){0,3}?\s+(?:at|by)\s+(?:age\s+)?(\d{2,3})\b/.exec(q) ??
    /\b(?:at|by)\s+age\s+(\d{2,3})\b/.exec(q) ??
    /\bwhen\s+i(?:'m|\s+am)\s+(\d{2,3})\b/.exec(q);
  if (!m) return null;
  const age = Number(m[1]);
  if (!Number.isInteger(age) || age < 18 || age > 110) return null;
  return age;
}

// ─── category / group resolution ────────────────────────────────────────────

const GROUPS: readonly string[] = [...new Set(CATEGORIES.map((c) => c.group))].filter((g) => g !== 'Income');

function catTarget(id: string, label: string = CATEGORY_BY_ID.get(id)?.name ?? id): SpendTarget {
  return { type: 'category', categoryId: id, label };
}
/** Umbrella target: sum a fixed SET of leaf categories (e.g. the utilities family). */
function catsTarget(ids: string[], label: string): SpendTarget {
  return { type: 'categories', categoryIds: ids, label };
}
function groupTarget(group: string, label?: string): SpendTarget {
  return { type: 'group', group, label: label ?? group };
}

/**
 * Synonym table — ordered, first match wins, leaf categories before the broader
 * group so "groceries" beats "food". Every right-hand id/group exists in the
 * taxonomy (categories.ts). This is the only place user vocabulary is mapped.
 */
const SYNONYMS: { re: RegExp; target: SpendTarget }[] = [
  // Food & Dining
  { re: /\bgrocer(y|ies)\b|\bsupermarket\b/, target: catTarget('groceries') },
  { re: /\bcoffee\b|\bcafe\b|\bstarbucks\b/, target: catTarget('coffee') },
  { re: /\bfast[\s-]?food\b/, target: catTarget('fast-food') },
  { re: /\b(door[\s-]?dash|uber[\s-]?eats|grubhub|food delivery|take[\s-]?out)\b/, target: catTarget('food-delivery') },
  { re: /\b(alcohol|liquor|bars?|beer|wine|booze)\b/, target: catTarget('alcohol') },
  { re: /\b(dining|restaurants?|eating out|eat out)\b/, target: catTarget('dining') },
  { re: /\bfood\b/, target: groupTarget('Food & Dining', 'food & dining') },
  // Auto & Transport
  // "gas bill" / "natural gas" is the UTILITY, not gasoline — it must precede the
  // bare `gas`→fuel rule below (first-match-wins), or it is shadowed dead (#154
  // critic P1). A bare "gas" still falls through to fuel.
  { re: /\b(natural gas|gas bill|gas company|gas utility)\b/, target: catTarget('natural-gas') },
  { re: /\b(gas|fuel|gasoline|petrol)\b/, target: catTarget('fuel') },
  { re: /\b(uber|lyft|rideshare|ride[\s-]?share|taxi|cab)\b/, target: catTarget('transport') },
  { re: /\b(parking|tolls?)\b/, target: catTarget('parking') },
  { re: /\b(transit|subway|metro|bus fare|train fare)\b/, target: catTarget('public-transit') },
  { re: /\b(car|auto|automotive|transport(ation)?|vehicle|gas and|gas\/)\b/, target: groupTarget('Auto & Transport', 'auto & transport') },
  // Shopping
  { re: /\b(clothing|clothes|apparel|shoes)\b/, target: catTarget('clothing') },
  { re: /\belectronics?\b|\bgadgets?\b/, target: catTarget('electronics') },
  { re: /\bshopping\b|\bamazon\b/, target: groupTarget('Shopping', 'shopping') },
  // Home
  { re: /\b(rent|mortgage)\b/, target: catTarget('rent') },
  { re: /\b(housing|household)\b/, target: groupTarget('Home', 'home') },
  // Bills & Utilities — specific household utilities (#154) before the generic
  // "utilities" umbrella so "how much on electricity" hits the electricity leaf.
  // (The natural-gas synonym lives up in Auto & Transport, ahead of the bare
  // `gas`→fuel rule that would otherwise shadow it — critic P1.)
  { re: /\b(electric(ity)?|power bill|light bill)\b/, target: catTarget('electricity') },
  { re: /\b(water bill|water utility|sewer)\b/, target: catTarget('water') },
  { re: /\b(trash|garbage|recycling|waste)\b/, target: catTarget('trash') },
  // "utilities" is an UMBRELLA word: the split (#154) moved electric/gas/water/trash
  // to their own leaves, so summing only the `utilities` catch-all would silently
  // under-report (critic P2). Sum the whole family — but NOT phone/internet/insurance
  // (those live in this group yet aren't what people mean by "utilities").
  { re: /\butilit(y|ies)\b/, target: catsTarget(['utilities', 'electricity', 'natural-gas', 'water', 'trash'], 'utilities') },
  { re: /\b(phone|cell|mobile)\b/, target: catTarget('phone') },
  { re: /\b(internet|wi[\s-]?fi|cable|broadband)\b/, target: catTarget('internet') },
  { re: /\binsurance\b/, target: catTarget('insurance') },
  { re: /\bbills?\b/, target: groupTarget('Bills & Utilities', 'bills & utilities') },
  // Travel
  { re: /\b(flights?|airfare|air travel|plane tickets?)\b/, target: catTarget('air-travel') },
  { re: /\b(hotels?|lodging|airbnb)\b/, target: catTarget('hotel') },
  { re: /\b(travel|trips?|vacations?)\b/, target: groupTarget('Travel', 'travel') },
  // Health & Fitness
  { re: /\b(pharmacy|prescriptions?|meds|medication)\b/, target: catTarget('pharmacy') },
  { re: /\b(gym|fitness|workout)\b/, target: catTarget('fitness') },
  { re: /\b(dental|dentist)\b/, target: catTarget('dental') },
  { re: /\b(health|medical|doctor|hospital)\b/, target: groupTarget('Health & Fitness', 'health & fitness') },
  // Entertainment
  { re: /\b(games?|gaming|video[\s-]?games?)\b/, target: catTarget('games') },
  { re: /\b(music|spotify)\b/, target: catTarget('music') },
  { re: /\b(entertainment|movies?|netflix|streaming)\b/, target: catTarget('entertainment') },
  // Personal & Family
  { re: /\b(childcare|daycare|day[\s-]?care)\b/, target: catTarget('childcare') },
  { re: /\b(education|tuition|college|school)\b/, target: catTarget('education') },
  { re: /\b(personal care|haircut|salon|barber|grooming)\b/, target: catTarget('personal-care') },
  { re: /\b(pets?|vet|veterinar)\b/, target: catTarget('pets') },
  { re: /\bkids?\b/, target: catTarget('kids') },
  // Financial
  { re: /\b(subscriptions?)\b/, target: catTarget('subscriptions') },
  { re: /\b(fees?|charges)\b/, target: catTarget('fees') },
  { re: /\b(taxes?)\b/, target: catTarget('taxes') },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when the text right after a verbatim group-name match continues the NAME
 * rather than the sentence: "at home depot" is a question about one retailer,
 * and answering it with the Home GROUP puts rent + mortgage inside a figure for
 * a store (#111-era substring fallback; #226 → TASKS 2.6). Only a following
 * timeframe/total cue or end-of-object keeps the group reading — connectors are
 * NOT group-preserving ("at home and garden" is a store; critic cycle 1, F4:
 * the protective case, "home and utilities", is claimed by the `utilities`
 * synonym before this fallback ever runs).
 */
function groupMentionExtended(rest: string): boolean {
  for (const raw of rest.replace(/[’‘`]/g, "'").split(/\s+/)) {
    if (!raw) continue;
    const t = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (!t) continue; // punctuation glue decides nothing
    return !(TOTAL_SPEND_OBJECTS.has(t) || MERCHANT_STOP_WORDS.has(t));
  }
  return false;
}

/** Map free text to a spending target (leaf category or group), else null. The
 *  user's custom categories are matched by name AFTER the system synonyms (so a
 *  built-in mapping always wins) but BEFORE the verbatim-group fallback. */
export function resolveSpendTarget(
  qRaw: string,
  custom: readonly { id: string; name: string }[] = [],
): SpendTarget | null {
  // NFC so a custom category with a non-ASCII name ("Café") matches however the
  // caller's platform composed the bytes (the parser already normalizes; the
  // conversation frame passes raw fragments) — TASKS 2.6.
  const q = qRaw.normalize('NFC');

  // `custom` carries two kinds of row and they resolve at DIFFERENT priorities:
  // a RENAMED built-in (its id is in the static taxonomy) is the reader
  // overriding the app's own word for an existing bucket, so it outranks the
  // synonym table; a CUSTOM category is an additional bucket and stays below it,
  // as DECISIONS #111 decided, so adding one can never hijack a built-in phrase.
  //
  // Without the first half, a reader who renamed Hobbies to "Gas" asked about
  // "gas" and got the FUEL total — a different figure under a word that, on
  // their own screens, names something else (found by both O.17 critics). Every
  // answer prints the label of what it resolved, so the reader sees which bucket
  // replied.
  const renamedBuiltIns = custom.filter((c) => CATEGORY_BY_ID.has(c.id));
  const ownCategories = custom.filter((c) => !CATEGORY_BY_ID.has(c.id));

  // Longest name first so "golf club" beats "golf". Unicode-aware lookarounds
  // rather than JS's word-boundary escape, which is ASCII-word-based: against
  // an accented name there is no boundary after the accent, so the escape can
  // never match and the user's own category was unreachable (TASKS 2.6).
  // The escape is described rather than written here on purpose: writing it
  // into a comment is how a raw 0x08 landed in this file (source-hygiene).
  const matchByName = (list: readonly { id: string; name: string }[]): SpendTarget | null => {
    for (const c of [...list].sort((a, b) => b.name.length - a.name.length)) {
      const name = c.name.trim().toLowerCase().normalize('NFC');
      if (!name) continue;
      const re = new RegExp(`(?<![\p{L}\p{N}])${escapeRe(name)}(?![\p{L}\p{N}])`, 'u');
      if (re.test(q)) return catTarget(c.id, c.name.trim());
    }
    return null;
  };

  const renamed = matchByName(renamedBuiltIns);
  if (renamed) return renamed;

  for (const { re, target } of SYNONYMS) {
    if (re.test(q)) return target;
  }

  const own = matchByName(ownCategories);
  if (own) return own;
  // Fallback: a group name spoken verbatim (e.g. "personal & family"). Word-
  // bounded — "homegoods" is not a mention of Home — and not extended by a
  // further name word — "home depot" is a store, not the Home group (TASKS 2.6;
  // both used to hit the bare-substring `includes` and answered rent + mortgage
  // for a question about one retailer).
  for (const g of GROUPS) {
    const gl = g.toLowerCase();
    const m = new RegExp(`(?<![a-z0-9])${escapeRe(gl)}(?![a-z0-9])`).exec(q);
    if (!m) continue;
    if (groupMentionExtended(q.slice(m.index + gl.length))) continue;
    return groupTarget(g, gl);
  }
  return null;
}

/**
 * True when a category synonym matches the merchant phrase as a WHOLE (O.10a).
 * "gas" / "natural gas" / "uber eats" own their phrases; "costco gas" does not
 * — `\bgas\b` is only a proper substring, so Ask must keep the store, not Fuel.
 */
function categorySynonymOwnsWholePhrase(phrase: string): boolean {
  const p = phrase.normalize('NFC').toLowerCase().trim();
  if (!p) return false;
  for (const { re } of SYNONYMS) {
    re.lastIndex = 0;
    const m = re.exec(p);
    if (!m) continue;
    if (m.index === 0 && m[0].length === p.length) return true;
  }
  return false;
}

// ─── intent parsing ─────────────────────────────────────────────────────────

/**
 * Normalize: NFC-compose, lowercase, collapse whitespace. Punctuation (including a
 * trailing "?") is deliberately LEFT IN — every route regex below tolerates it, and the
 * merchant tokenizer strips it per-token. (#226 cycle 3: the comment used to claim it
 * stripped a trailing question mark, which it never did.)
 *
 * NFC matters for money (#226 cycle 4): DECOMPOSED "café" is "cafe" + U+0301, and a
 * combining mark is not a word character — so `\bcafe\b` matched it, and "how much did I
 * spend at café zurich" answered ALL COFFEE-SHOP spending for a question about one store,
 * while the composed spelling of the very same question abstained. Two byte sequences the
 * user cannot tell apart must not route differently.
 */
function normalize(question: string): string {
  return question.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const DEFAULT_TOP_LIMIT = 5;
const DEFAULT_LARGEST_LIMIT = 5;

/**
 * The deterministic router. Order matters: the most specific intents are tested
 * first so a phrase can't be claimed by a broader one (e.g. "savings rate" is
 * caught before the generic "savings" account match; "how much can I spend" is
 * safe-to-spend, tested before the past-tense "how much did I spend" total).
 */
/**
 * True when the question's dollar figure is a per-period RATE ("$500 a month",
 * "$500/mo", "$500 monthly") rather than a lump-sum target — solving a lump
 * goal from a rate contradicts the user's own number. The digit must sit
 * ADJACENT to the period cue (whitespace only), so "how much per month to save
 * $20,000 by 2027" does NOT fire (confirm-critic #126). Shared by the
 * savings-goal and afford routes (#166) so they can't disagree.
 */
/**
 * Objects after a spend-verb's at/on/with that still mean "the whole total"
 * ("on everything", "in total") or a month/date reference ("on March 5" — a
 * timeframe parseTimeframe already consumed). Anything else after at/on/with
 * is an unresolved target (merchant, card, "average") and abstains (#166).
 */
const TOTAL_SPEND_OBJECTS = new Set([
  'everything', 'everyone', 'all', 'total', 'it',
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may',
  'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december',
]);

/**
 * Objects after a spend-verb's at/with that are NOT merchants: statistical
 * qualifiers ("with average", "on median" — we compute no average-spend intent)
 * and PAYMENT METHODS ("spend WITH my card / with venmo" names how you paid, not
 * where). These keep abstaining to the honest unknown redirect rather than
 * routing to a merchant total that answers a confident-wrong "No spending at
 * Card" (#168 P1-fix). "with" is a merchant preposition for real stores
 * ("with Amazon") but far more often introduces a tender — hence the guard.
 */
const NON_MERCHANT_SPEND_OBJECTS = new Set([
  'average', 'averages', 'avg', 'mean', 'median', 'typically', 'usually',
  'card', 'cards', 'cash', 'credit', 'debit', 'check', 'cheque',
  'venmo', 'paypal', 'zelle', 'amex', 'visa', 'mastercard',
  // Account self-reference is a payment SOURCE, not a store ("from my checking
  // account" minted the merchant "checking account" — TASKS 2.7 critic N-1,
  // the #168 class). Costs "at Bank of America" the merchant reading (an
  // honest redirect); a fee question about a bank is far rarer than an
  // account-phrased spend question.
  'checking', 'savings', 'bank', 'account', 'accounts',
]);

/** Leading articles/possessives to skip before a merchant name ("at THE apple store"). */
const MERCHANT_LEADING_SKIP = new Set(['the', 'a', 'an', 'my']);

/** Words that end a merchant phrase — timeframe cues so "at costco last month"
 *  extracts "costco", not "costco last month". Month tokens live in
 *  TOTAL_SPEND_OBJECTS (also a stop set below). */
const MERCHANT_STOP_WORDS = new Set([
  'last', 'this', 'next', 'past', 'in', 'during', 'over', 'since', 'between',
  'for', 'from', 'to', 'ago', 'so', 'far', 'recently', 'lately',
  'month', 'months', 'week', 'weeks', 'year', 'years', 'day', 'days',
  'today', 'yesterday', 'ytd',
]);

/**
 * Extract the merchant phrase after a spend verb's AT/WITH, else null. "at X" /
 * "with X" is the merchant construction ("at Costco", "at Trader Joe's"); a bare
 * "on X" leans category ("on groceries", "on golf") and is handled separately —
 * if it didn't resolve to a category it abstains rather than becoming a merchant
 * we'd answer "No spending at <category-word>" for. Only reached when the object
 * did NOT resolve to a category (resolveSpendTarget ran first). Multi-word,
 * capped at 4 tokens, trimmed at the first timeframe/total cue.
 */
function extractSpendMerchant(q: string): string | null {
  // `[\s.…,:;!—–-]*` after the preposition: punctuation GLUE ("at... costco",
  // "at - costco", "at, costco") is filler between the preposition and the name,
  // not part of it — before this, "at... costco" matched nothing (the old `\s+`
  // required whitespace immediately after "at") and fell through to the
  // all-spending total (TASKS 2.6). The `\b` after at/with still rejects
  // "atcostco"-style non-words.
  const m = /\b(?:spend|spent|spending)\b[^.?!]*?\b(?:at|with)\b[\s.…,:;!—–-]*(.+)$/.exec(q);
  if (!m) return null;
  return extractMerchantPhrase(m[1]);
}

/**
 * The merchant tokenizer, shared by the parser's "spend at X" route and the
 * conversation frame's fragment route ("what about at Costco?", TASKS 2.1), so
 * the two can never disagree about what counts as a merchant name. Input is the
 * lowercase text AFTER the merchant preposition. Drops leading articles, stops
 * at the first timeframe/total cue, caps at 4 tokens.
 */
export function extractMerchantPhrase(after: string): string | null {
  const out: string[] = [];
  for (const raw of merchantTokens(after)) {
    // A punctuation-only token ("at - costco", "at .. costco") is filler between
    // words, not a word: skip it, or the dash becomes part of the store name and
    // the answer is a confident-wrong "No spending at - costco" (TASKS 2.6). A
    // token that stripped to nothing but was NOT mere punctuation (glyphs the
    // tokenizer deletes) still ENDS the phrase — never guess past something we
    // could not read. (The unreadable-object guards run before this, so that
    // arm is defense in depth.)
    const word = stripToken(raw);
    if (!word || !/[a-z0-9]/.test(word)) {
      if (/^[\s'&.,:;!?"“”()[\]…—–-]*$/.test(raw)) continue;
      break;
    }
    if (TOTAL_SPEND_OBJECTS.has(word) || MERCHANT_STOP_WORDS.has(word)) break;
    // A date-SHAPED token ends the phrase like a timeframe cue does (TASKS
    // 2.7): "at costco 2025" is the store costco in the 2025 window, not a
    // store named "costco 2025". Shape-level on the RAW token (stripToken
    // deletes "/" — "3/5" would strip to a lying "35"), so an unresolvable
    // date can't join a store name either. "at 76" survives: not a date shape.
    if (DATE_SHAPED_TOKEN_RE.test(raw.replace(/^[^0-9a-z$]+|[^0-9a-z]+$/g, ''))) break;
    out.push(word);
    if (out.length >= 4) break;
  }
  const phrase = out.join(' ').trim();
  return phrase || null;
}

/** The object's tokens: smart quotes folded to ASCII (a curly apostrophe carries no
 *  meaning — "mcdonald’s" IS "mcdonald's"), leading articles dropped. */
function merchantTokens(after: string): string[] {
  const tokens = after
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length && MERCHANT_LEADING_SKIP.has(tokens[0])) tokens.shift();
  return tokens;
}

const stripToken = (raw: string) => raw.replace(/[^a-z0-9'&.-]/g, '');

/**
 * A character that is part of a NAME (a letter, digit or combining mark) and is not
 * ASCII — i.e. name content the ASCII tokenizer would silently delete.
 *
 * Deliberately narrower than "any non-ASCII byte" (#226 cycle 3). Quotes, dashes,
 * emoji and other symbols are not name content: they carry nothing the tokenizer would
 * drop, so treating them as unreadable only refuses questions we can answer perfectly
 * well ("at “costco”", "at costco 🎉"). Cycle 2 made exactly that mistake with the
 * curly apostrophe and broke every phone-typed possessive store name.
 */
const NON_ASCII_NAME_CHAR = /(?![\x00-\x7F])[\p{L}\p{N}\p{M}]/u;

/** True when TEXT contains name content this parser cannot read (a store, a category,
 *  a person, in a script the ASCII tokenizers delete). Shared with the conversation
 *  frame and the LLM re-derivation, which must abstain on the same input the parser
 *  abstains on. */
export function containsUnreadableName(text: string): boolean {
  return NON_ASCII_NAME_CHAR.test(text.normalize('NFC'));
}

/**
 * The text after a spend question's at/with/on — the OBJECT the user named. Deliberately
 * NOT anchored to the verb: the object can be fronted ("At Costco, how much did I
 * spend?"), so a verb-then-preposition pattern misses it entirely and the question falls
 * to the all-spending total (#226 cycle 4). Returns null when the question names no
 * object at all.
 */
function spendObjectOf(q: string): string | null {
  // Same punctuation-glue tolerance as the merchant extractor ("at... costco",
  // "at - costco") so the guard and the extractor read the same object.
  const m = /\b(?:at|with|on)\b[\s.…,:;!—–-]*(.+)$/.exec(q);
  return m ? m[1] : null;
}

// ─── the spend_total licence (TASKS 2.6) ────────────────────────────────────

/**
 * Objects after at/with/on that the ALL-spending total still answers, beyond the
 * total/timeframe cues: idioms ("at least", "at the end of last month", "on
 * track") and self-reference ("with my spending"). Deliberately CONSERVATIVE: a
 * word missing from this set costs an honest redirect; a word wrongly present
 * costs the cardinal sin (the user's entire spending presented as the answer to
 * a question about one store). When in doubt, leave it out.
 */
const LICENSED_SPEND_OBJECTS = new Set([
  'least', 'most', 'first', 'once', 'twice', 'moment', 'point', 'time', 'times',
  'end', 'start', 'beginning', 'track', 'top', 'worst', 'best',
  'minimum', 'maximum', 'min', 'max', 'very',
  'spending', 'spend', 'spent', 'money',
]);

/** Prepositions/particles: "going on WITH my spending" — the outer preposition's
 *  "object" is just the inner preposition, whose own object is scanned on its own
 *  turn. */
const OBJECT_PREPOSITIONS = new Set(['at', 'with', 'on', 'in', 'of', 'for', 'from', 'to', 'by', 'about']);

/**
 * Question machinery: once the object phrase runs (uncomma'd) into the question
 * itself — "at the very least how much did i spend" — these words are the
 * QUESTION, not the object. Consulted ONLY by the licence scan. Auxiliaries are
 * split out because they are consumed only when the NEXT word is itself
 * question machinery ("did I", "do we") — "Do It Best" is a real ~1,400-store
 * hardware chain whose every word this scan otherwise recognizes, and it took
 * the all-spending total in fronted word order (critic cycle 2, NEW-1).
 */
const QUESTION_MACHINERY = new Set([
  'how', 'much', 'many', 'what', 'i', "i'm", 'we', 'you', 'me',
  'general', 'overall', 'altogether',
]);
const QUESTION_AUXILIARIES = new Set([
  'did', 'do', 'does', 'am', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'will', 'would', 'should', 'could', 'can', 'shall', 'might',
]);

/** The month tokens (a subset of TOTAL_SPEND_OBJECTS), so a day-of-month digit
 *  can be recognized as part of a DATE ("on March 5") and nothing else. */
const MONTH_TOKENS = new Set<string>([...MONTH_NAMES, ...MONTH_ABBR, 'sept']);

/** A day/year digit token, only ever consumed right after a month name. */
const DAY_OR_YEAR_RE = /^\d{1,4}(?:st|nd|rd|th)?$/;

/** Sentence punctuation that CLOSES an object phrase ("at Best Buy, how much…"). */
const OBJECT_TERMINATOR_RE = /[,.;:?!…]\s*$/;

/**
 * The first at/with/on object ANYWHERE in the question that the all-spending
 * total would not account for, else null. This is the POSITIVE LICENCE the
 * spend-family sink must earn (TASKS 2.6, the #226 inversion): four critic
 * cycles each hardened one verb-anchored guard, and each time the input moved
 * one syntactic inch — a fronted object ("At Costco, how much did I spend?"), a
 * sentence break, punctuation glue — and landed on `spend_total` anyway: the
 * user's ENTIRE spending, presented unhedged as the answer to a question about
 * one store. So the sink no longer trusts the guards in front of it: an
 * unconsumed object anywhere means we do not know what was asked, and the total
 * is the most confidently wrong thing we could say. Abstain instead.
 *
 * "Consumed" = a total word ("on everything"), a timeframe cue ("at the end of
 * last month", "on March 5"), a licensed idiom ("at least", "on track"), a
 * number/date, or another preposition (scanned on its own turn). Everything
 * else — a merchant the verb-anchored extractor missed, a payment method, a
 * word we cannot place — withholds the licence. Shared by the parser's sink,
 * the conversation frame, and `intentFromKind`, so no route can re-answer what
 * another abstained on.
 */
export function unconsumedSpendObject(question: string, today: ISODate): string | null {
  // "@" is "at" typed faster; the scanner must read it or "spend @ costco"
  // keeps the total (critic cycle 1, F5).
  const q = question.normalize('NFC').toLowerCase().replace(/@/g, ' at ');
  const prep = /\b(?:at|with|on|in)\b/g;
  for (let m = prep.exec(q); m; m = prep.exec(q)) {
    const raws = q
      .slice(m.index + m[0].length)
      .replace(/[’‘`]/g, "'")
      .split(/\s+/)
      .filter(Boolean);
    // EVERY word of the object must be consumed-class, up to the token that
    // CLOSES the object (sentence punctuation, or a timeframe cue). Cycle 1 of
    // this slice's critic (F1/F2, P0): the first consumed token used to license
    // the WHOLE object, so "at BEST buy", "at TOP golf", "at ALL saints", "at 5
    // guys" — real retailers whose first word the licence happened to recognize
    // — each took the user's entire spending. One licensed word is not a
    // licence for the words behind it.
    // Pre-trim so an auxiliary can look ahead at the NEXT word (NEW-1).
    const toks = raws
      .map((raw) => ({
        raw,
        punctOnly: /^[^\p{L}\p{N}]+$/u.test(raw),
        t: raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, ''),
        closes: OBJECT_TERMINATOR_RE.test(raw),
      }))
      .filter((x) => x.punctOnly || x.t);
    let sawWord = false;
    let prevWasMonth = false;
    let broke = false;
    for (let i = 0; i < toks.length && !broke; i++) {
      const { punctOnly, t, closes, raw } = toks[i];
      if (punctOnly) {
        // Bare punctuation: glue before the object ("at - costco" — decides
        // nothing), a CLOSER after it ("at least , then…").
        if (sawWord && /[,.;:?!…]/.test(raw)) broke = true;
        continue;
      }
      // A timeframe cue ENDS the object (mirroring extractMerchantPhrase):
      // whatever follows "…at the end of LAST MONTH" is the sentence, not the
      // object. Everything before it must already have been consumed.
      if (MERCHANT_STOP_WORDS.has(t)) break;
      // An auxiliary is question machinery only ahead of a question word
      // ("did I", "how much DO WE spend") — ahead of anything else it is a
      // store's word ("at DO IT best" — critic cycle 2, NEW-1).
      const next = toks[i + 1];
      const auxConsumed =
        QUESTION_AUXILIARIES.has(t) &&
        next !== undefined &&
        !next.punctOnly &&
        (QUESTION_MACHINERY.has(next.t) || QUESTION_AUXILIARIES.has(next.t));
      const consumed =
        MERCHANT_LEADING_SKIP.has(t) || // "at THE end", "with MY spending"
        TOTAL_SPEND_OBJECTS.has(t) || // "on everything", "on march…"
        LICENSED_SPEND_OBJECTS.has(t) || // "at least", "on track"
        OBJECT_PREPOSITIONS.has(t) || // "going on WITH …" — scanned on its own turn
        QUESTION_MACHINERY.has(t) || // "…at the very least HOW MUCH…"
        auxConsumed || // "…DID I spend", never "at DO it best"
        (prevWasMonth && DAY_OR_YEAR_RE.test(t)) || // "on march 5", "in may 2026"
        // A date token the timeframe parser can WINDOW is consumed — and only
        // those (TASKS 2.7): "in 2025", "on 3/5", "in 3/2025", "2024-2025".
        // A future year or an invalid date ("in 2027", "on 13/5") is NOT — the
        // parser cannot window it, so the total must not answer it. The same
        // recognizers feed parseExplicitTimeframe, so the licence consumes
        // exactly what the parser reads, never an approximation of it.
        bareYearValue(t, today) !== null ||
        numericDateYm(t, today) !== null ||
        yearRangeToken(t, today) !== null;
      if (!consumed) return t; // an object word the total does not answer
      sawWord = true;
      prevWasMonth = MONTH_TOKENS.has(t);
      if (closes) break; // "at least, …" — licensed and closed
    }
  }
  return null;
}

/**
 * The user's own custom category when the OBJECT — after articles, up to the
 * first timeframe/total cue — IS that category's name, else null. The sole
 * exception to the unreadable-object abstain (TASKS 2.6): "Café" is the user's
 * OWN vocabulary, readable by definition, so "how much did I spend on café?"
 * must reach their category instead of abstaining — while "at café zurich"
 * (a STORE whose name merely contains it) still abstains, because equality, not
 * containment, is required.
 */
export function customCategoryForObject(
  after: string,
  custom: readonly { id: string; name: string }[],
): SpendTarget | null {
  if (custom.length === 0) return null;
  const words: string[] = [];
  const raws = after.normalize('NFC').toLowerCase().replace(/[’‘`]/g, "'").split(/\s+/).filter(Boolean);
  let i = 0;
  for (; i < raws.length; i++) {
    const t = raws[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!t) continue;
    // Leading articles AND prepositions: the parser hands this the text after
    // the preposition, the frame hands it the whole fragment ("at café") — the
    // two routes must read the same shape the same way (critic cycle 1, F6).
    if (words.length === 0 && (MERCHANT_LEADING_SKIP.has(t) || OBJECT_PREPOSITIONS.has(t))) continue;
    if (TOTAL_SPEND_OBJECTS.has(t) || MERCHANT_STOP_WORDS.has(t)) break;
    words.push(t);
    if (words.length > 6) break;
  }
  const phrase = words.join(' ');
  if (!phrase) return null;
  // The TAIL after the cue that ended the phrase must itself be pure
  // timeframe/total cues. Equality tested on a PREFIX is containment in
  // disguise (critic cycle 2, NEW-2): "at café in 星巴克 town" truncated at
  // "in", matched "café", and the unreadable store rode through silently
  // dropped — the carve-out granting exactly what the unreadable guards exist
  // to refuse.
  for (; i < raws.length; i++) {
    const raw = raws[i];
    if (/^[^\p{L}\p{N}]+$/u.test(raw)) {
      // ASCII punctuation decides nothing; a glyph token ("… in 🍕") is an
      // object the phrase equality never saw.
      if (/^[\s'&.,:;!?"“”()[\]…—–-]*$/.test(raw)) continue;
      return null;
    }
    const t = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!t) continue;
    if (TOTAL_SPEND_OBJECTS.has(t) || MERCHANT_STOP_WORDS.has(t) || MERCHANT_LEADING_SKIP.has(t)) continue;
    return null; // the question says more than the category's name
  }
  for (const c of custom) {
    // label = the TRIMMED name: it lands verbatim in a money headline, and a
    // padded "  Café  " must not (critic cycle 1, F7).
    if (c.name.trim().toLowerCase().normalize('NFC') === phrase) return catTarget(c.id, c.name.trim());
  }
  return null;
}

/**
 * True when the object the user named cannot be READ — a store or category in a script
 * the ASCII tokenizer silently drops ("at 星巴克" → no merchant at all → the ALL-SPENDING
 * TOTAL, a true figure under a false question) or mangles mid-word ("with café zurich" →
 * merchant "caf zurich" → a confident-wrong "No spending at caf zurich"). If we cannot
 * read the object, we do not answer a different question: abstain, and let the LLM route
 * — which reads the raw words — have its turn.
 *
 * THE RAW TOKEN IS TESTED FIRST, ALWAYS. This is the third attempt at this guard, and
 * every previous version died on the same mistake: reasoning about the STRIPPED token.
 * Cycle 2 tested the first whitespace token while the tokenizer skipped leading articles
 * ("at THE 星巴克" walked straight through). Cycle 3 tested inside a stream that
 * terminated on a stop word computed from the stripped form — and "星巴克last" strips to
 * "last", a timeframe cue, so the stream ended before the guard ever saw the raw bytes
 * ("at 星巴克last month" → the all-spending total again). The stripped form of unreadable
 * text is a LIE; it must never be consulted before the raw form has been.
 */
export function spendObjectUnreadable(after: string): boolean {
  let taken = 0; // tokens that survived stripping — i.e. a name we can actually read
  let sawObject = false; // the user put SOMETHING after the preposition
  for (const raw of merchantTokens(after)) {
    if (NON_ASCII_NAME_CHAR.test(raw)) return true; // raw first — always
    const word = stripToken(raw);
    // A genuine timeframe/total cue ends the OBJECT, so anything after it is not part of
    // the name. But if the object up to here was there and yet NOTHING survived
    // stripping, we still never read it.
    if (TOTAL_SPEND_OBJECTS.has(word) || MERCHANT_STOP_WORDS.has(word)) return sawObject && taken === 0;
    sawObject = true;
    // Punctuation-only token ("at , 星巴克"): it ends the merchant PHRASE, but it must not
    // end this SCAN — cycle 3 walked an unreadable store in behind exactly such a token.
    // Nor does the tokenizer's 4-token cap end it: "at big apple corner store 星巴克" would
    // otherwise answer for "big apple corner store", a name the user never asked about
    // (#226 cycle 4). Only a genuine timeframe/total cue ends the object.
    if (!word) continue;
    taken += 1;
  }
  // The object was PRESENT but nothing survived stripping: a store written in glyphs the
  // tokenizer deletes entirely — "at ⓒⓞⓢⓣⓒⓞ", "at 🅲🅾🆂🆃🅲🅾", "on 🍕". These are not
  // letters, so NON_ASCII_NAME_CHAR (deliberately narrow, so emoji NEXT TO a name don't
  // cause a false abstain) says nothing about them — and cycle 4 walked straight through
  // to the ALL-spending total. The distinction that matters is not "is there a symbol?"
  // but "did the object survive being read?" (#226 cycle 4). "at costco 🎉" keeps its
  // answer; "at 🍕" does not get one.
  return sawObject && taken === 0;
}

/**
 * True for objects that name a payment method or a statistical qualifier rather
 * than a store ("amex", "card", "venmo", "average") — the #168 guard. Exported
 * so the conversation frame abstains on "same for Amex" exactly as the parser
 * abstains on "how much did I spend with Amex", instead of answering a
 * confident-wrong "No spending at Amex".
 */
export function isNonMerchantObject(word: string): boolean {
  return NON_MERCHANT_SPEND_OBJECTS.has(word);
}

// ─── largest_purchases scope (TASKS 2.7) ────────────────────────────────────

/** The nouns the largest-purchases route recognizes (also its scope anchor). */
const LARGEST_NOUNS = 'purchases?|transactions?|buy|bought|expenses?|charges?|payments?|things?|items?';

/**
 * How a largest-purchases question is SCOPED (TASKS 2.7): `{merchant}` for
 * "biggest purchase at costco", `{}` for the global ranking, and `null` when
 * the question names a scope the ranking cannot represent — a fronted store,
 * a payment method (#168), an unreadable name, a category modifier ("biggest
 * GROCERY purchase"), or any unconsumed object. Before this, every one of
 * those answered the GLOBAL biggest purchase, the merchant/category silently
 * dropped — a true figure under a false question. Shared by the parser's
 * route and `intentFromKind` (LLM + vocab), so no route re-answers a scope
 * another refused. Self-normalizing, so both callers read identical bytes.
 */
export function largestScope(
  question: string,
  today: ISODate,
  custom: readonly { id: string; name: string }[] = [],
): { merchant?: string } | null {
  const q = question.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  // "…purchase(s) at/with/from X" — the merchant construction, anchored like
  // the spend family's ("spend … at X"); a FRONTED object never anchors and
  // falls to the licence check below, which abstains it (the honest redirect).
  const led = new RegExp(
    `\\b(?:${LARGEST_NOUNS}|spent on)\\b[^.?!]*?\\b(?:at|with|from)\\b[\\s.…,:;!—–-]*(.+)$`,
  ).exec(q);
  if (led) {
    if (spendObjectUnreadable(led[1])) return null;
    const merchant = extractMerchantPhrase(led[1]);
    // A licensed idiom is not a store (critic F1: "biggest purchase at the
    // moment" answered "No purchases at Moment"); no phrase at all ("from last
    // month") names no store either. Both fall THROUGH to the global checks —
    // the ranking may still answer, or the licence below may abstain it.
    if (merchant && !isLicensedIdiomPhrase(merchant)) {
      if (merchant.split(' ').some((w) => NON_MERCHANT_SPEND_OBJECTS.has(w))) return null;
      return { merchant };
    }
  }
  // No anchored store: any remaining unconsumed at/with/on/in object, or name
  // content we cannot read, is a scope the global ranking does not answer.
  if (unconsumedSpendObject(q, today) !== null) return null;
  if (containsUnreadableName(q)) return null;
  // Words between the superlative and the noun scope the ranking somehow —
  // and the only scope the engine computes is the merchant one above. A
  // category ("biggest GROCERY purchase") or an arbitrary word ("biggest
  // COSTCO/WALMART/BANK purchase" — critic F2: all answered the GLOBAL
  // ranking, unhedged) abstains; only known benign intensifiers keep the
  // global answer. Scanning ONLY the intervening words keeps the nouns
  // themselves out of the synonym table ("biggest CHARGES" is the fees
  // synonym's word, and must stay a global ranking); an intervening word that
  // IS a largest-noun ("most expensive THING i bought") means the real noun
  // sat adjacent, so there is no modifier at all.
  const mod = new RegExp(
    `\\b(?:single largest|most expensive|biggest|largest|priciest|highest)\\s+((?:[\\w'&-]+\\s+){1,3}?)(?:${LARGEST_NOUNS})\\b`,
  ).exec(q);
  if (mod) {
    const words = mod[1].trim().split(/\s+/);
    const nounWordRe = new RegExp(`^(?:${LARGEST_NOUNS})$`);
    if (!words.some((w) => nounWordRe.test(w))) {
      if (resolveSpendTarget(mod[1], custom)) return null; // a category scope: no engine
      if (!words.every((w) => BENIGN_LARGEST_MODIFIERS.has(w))) return null; // an unknown scope
    }
  }
  return {};
}

/** Intensifiers between the superlative and the noun that do NOT scope the
 *  ranking ("my single biggest purchase", "the largest one-time expense").
 *  Anything else there is a scope we cannot represent — abstain, don't rank
 *  everything (critic F2). Conservative by design: a missing word here costs
 *  an honest redirect; a wrong word costs the global figure under a scoped
 *  question. */
const BENIGN_LARGEST_MODIFIERS = new Set([
  'single', 'one', 'one-time', 'individual', 'overall', 'ever', 'very',
  'actual', 'real', 'true', 'recent', 'new', 'own', 'my', 'the', 'a', 'an',
]);

/**
 * True when an extracted merchant PHRASE is really a licensed idiom or question
 * machinery, not a store name (TASKS 2.7 critic F1/F7): "at the moment" →
 * phrase "moment", "at the end of last month" → "end of", "at least $100" →
 * "least 100", "at what point did i…" → "what point did i". Every one of these
 * used to become a merchant and answer a confident-wrong "No purchases at
 * Moment…". The head word must be idiom/question vocabulary and every later
 * word idiom-class or numeric — so "best buy" (head licensed, "buy" is a real
 * word) and "do it best" (head is an auxiliary, not idiom vocabulary) stay
 * stores. Shared by the spend family, largestScope, and the conversation
 * frame, so no extractor mints a merchant another route knows is an idiom.
 */
export function isLicensedIdiomPhrase(phrase: string): boolean {
  const words = phrase.split(' ');
  if (!(LICENSED_SPEND_OBJECTS.has(words[0]) || QUESTION_MACHINERY.has(words[0]))) return false;
  return words
    .slice(1)
    .every(
      (w) =>
        LICENSED_SPEND_OBJECTS.has(w) ||
        QUESTION_MACHINERY.has(w) ||
        QUESTION_AUXILIARIES.has(w) ||
        OBJECT_PREPOSITIONS.has(w) ||
        MERCHANT_LEADING_SKIP.has(w) ||
        /^\d[\d.,]*$/.test(w),
    );
}

function statedAmountIsPerPeriodRate(q: string): boolean {
  return /\$?\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:\/\s*(?:mo|month|wk|week|yr|year|day)|(?:a|per|each)\s+(?:month|week|year|day|fortnight)|monthly|weekly|biweekly|fortnightly|yearly|annually)\b/.test(
    q,
  );
}

/** Two amounts, a floor/ceiling, or a negation — the parser must not pick one. */
function statedAmountIsComparedOrNegated(q: string): boolean {
  return (
    /\b(or|vs\.?|versus|between|more than|less than|at least|at most)\b/.test(q) ||
    /\b(not|never|except|excluding)\b/.test(q) ||
    /n't\b/.test(q)
  );
}

export function parseAssistantQuery(
  question: string,
  today: ISODate,
  custom: readonly { id: string; name: string }[] = [],
): AssistantIntent {
  const q = normalize(question);
  if (!q) return { kind: 'unknown', question };

  // Net worth
  if (/\bnet[\s-]?worth\b/.test(q)) return { kind: 'net_worth' };

  // Savings RATE (before the generic "savings" account match)
  if (/\bsavings? rate\b/.test(q) || /\bhow much (of my income )?(do i|am i) sav/.test(q)) {
    return { kind: 'savings_rate' };
  }

  // Subscriptions / recurring
  if (/\b(subscriptions?|recurring( (charges|bills|payments))?)\b/.test(q)) {
    return { kind: 'subscriptions' };
  }

  // Cash flow radar / will I run out (DECISIONS #488). Same engine as the
  // dashboard radar (committed scheduled + loans + card dues). Must NOT share
  // forecast's recurring-only walk — that printed an all-clear $12,495 on the
  // demo while radar projected Everyday Checking below $0 (trust blocker 2026-08-20).
  if (
    /\b(run(ning)? out of (money|cash)|go(ing)? negative|negative balance|overdraf|cash[\s-]?flow radar)\b/.test(
      q,
    )
  ) {
    return { kind: 'cash_flow_radar' };
  }

  // Forecast — recurring income/bills only (DECISIONS #72); complement to this-cycle cash-needed.
  if (
    /\b(forecast|cash[\s-]?flow|next (30|60|90) days|in (30|60|90) days)\b/.test(q) ||
    /\b(lowest|projected) balance\b/.test(q)
  ) {
    return { kind: 'forecast' };
  }

  // Debt-free BY a specific date (INVERSE planning, DECISIONS #125). Requires BOTH
  // debt-payoff vocabulary AND a parseable target date, and is tested BEFORE the
  // forward debt_payoff so "be debt-free by December 2027" solves for the required
  // payment while "when will I be debt-free?" (no date) stays the forward answer.
  {
    const namesCard = /\bcredit cards?\b/.test(q);
    const debtFreeVocab =
      /\bdebt[\s-]?free\b/.test(q) ||
      /\bout of debt\b/.test(q) ||
      (!namesCard &&
        /\b(pay off|payoff|paying off|pay down|paydown|get out of|clear|done with|finished? with|rid of)\b(?:\s+\w+){0,3}?\s+(debt|debts|loans?)\b/.test(
          q,
        )) ||
      (/\bloan\b/.test(q) && /\b(pay|payoff|pay off|pay down|clear)\b/.test(q));
    if (debtFreeVocab) {
      const target = parseTargetDate(q, today);
      if (target) return { kind: 'debt_free_by_date', targetDate: target.date, label: target.label };
    }
  }

  // Savings goal BY a specific date (INVERSE planning, mirror of debt_free_by_date, #126).
  // Requires a parseable target date AND a clearly-stated savings goal: an explicit goal
  // phrase ("savings goal", "save up", "emergency fund"…) OR a save/accumulate verb paired
  // with a concrete amount. Tested HERE — before the forward intents and before
  // account_balance's bare "savings" match — so "save $15k by December 2027" solves for the
  // monthly while "what's my savings rate?" (handled above) and "how much is in savings?"
  // stay themselves. The amount is parsed deterministically (parseTargetAmount); a stated
  // date with no amount still routes here so the answer can ASK for the amount, not invent it.
  {
    const strongGoalPhrase =
      /\bsavings? goals?\b/.test(q) ||
      /\bsaved? up\b/.test(q) ||
      /\b(set|put) aside\b/.test(q) ||
      /\b(sock|squirrel) away\b/.test(q) ||
      /\b(down[\s-]?payment|emergency fund|nest egg|rainy[\s-]?day fund)\b/.test(q);
    const amount = parseTargetAmount(q);
    // "saved" (past participle) included — "have $X saved by <date>" is the feature's own
    // canonical phrasing, and the \b after "save" doesn't cover it (critic P1, #126).
    const saveVerb = /\b(save|saved|saving|accumulate|put away)\b/.test(q);
    const reachVerb = /\b(reach|hit|get to)\b/.test(q);
    const wantsGoal = strongGoalPhrase || ((saveVerb || reachVerb) && amount !== null);
    // The stated amount is a per-period RATE only when a period cue sits ADJACENT to a dollar
    // figure ("$500 a month", "$500/mo", "$500 monthly") — solving a lump target from a rate
    // contradicts the user's own number, so skip those (often a safe_to_spend affordability ask).
    // Crucially this does NOT fire when "per month"/"monthly" is the QUANTITY BEING SOLVED FOR
    // ("how much per month to save $20,000 by 2027") — the digit must be adjacent, whitespace only
    // (confirm-critic #126: the broad whole-question guard blocked the feature's own canonical form).
    const amountIsRate = statedAmountIsPerPeriodRate(q);
    // A PAST/STATUS review with NO figure ("did I reach my savings goal in March", "…as of
    // December") isn't a forward plan — suppress ONLY the amount-free clarify path. Once a real
    // amount is present it's a concrete goal, so route it even with an inverted "have I"
    // ("have I got enough saved to reach $20,000 by 2028") (confirm-critic #126).
    const pastReviewNoFigure =
      amount === null && (/\b(did|have|has)\s+i\b/.test(q) || /\bas of\b/.test(q) || /\bso far\b/.test(q));
    if (!amountIsRate && !pastReviewNoFigure && wantsGoal) {
      const target = parseTargetDate(q, today);
      if (target) {
        return { kind: 'savings_goal_by_date', targetDate: target.date, targetCents: amount, label: target.label };
      }
    }
  }

  // Retire at a specific AGE (INVERSE planning, the third Plan-in-Words slice, #131). Requires
  // retirement vocabulary AND a parseable target age. Placed AFTER the date-based inverse
  // planners (a retire-at-age question carries no targetDate/amount, so those decline it) and
  // BEFORE the forward intents (cash_needed, safe_to_spend, spend, account_balance) so the
  // retirement words can't be poached. The age is the user's own number (parseTargetAge); a
  // retirement question with no age falls through (→ unknown, then the optional LLM fallback).
  // The inflection set matches parseTargetAge's first regex (retire/retires/retired/retiring/retirement).
  if (/\bretir(?:e|es|ed|ing|ement)\b/.test(q)) {
    const age = parseTargetAge(q);
    if (age !== null) return { kind: 'retire_at_age', targetAge: age, label: `age ${age}` };
  }

  // Wealth target with NO deadline (W.4). The dated sibling above already took
  // "save $X by <date>" (linear /goals model). A stated amount without a date is
  // the W.1 compounding question. A date shape we cannot window abstains rather
  // than answering the open-ended planner under a year the user named (TASKS 2.7).
  {
    const amount = parseTargetAmount(q);
    const strongGoalPhrase =
      /\bsavings? goals?\b/.test(q) ||
      /\bsaved? up\b/.test(q) ||
      /\b(set|put) aside\b/.test(q) ||
      /\b(sock|squirrel) away\b/.test(q) ||
      /\b(down[\s-]?payment|emergency fund|nest egg|rainy[\s-]?day fund)\b/.test(q);
    const saveVerb = /\b(save|saved|saving|accumulate|put away)\b/.test(q);
    const reachVerb = /\b(reach|hit|get to)\b/.test(q);
    const haveWealth = /\bhave\b/.test(q) && amount !== null && /\b(mil|million|billion)\b/.test(q);
    const wantsGoal = strongGoalPhrase || ((saveVerb || reachVerb) && amount !== null) || haveWealth;
    if (
      amount !== null &&
      wantsGoal &&
      !statedAmountIsPerPeriodRate(q) &&
      !statedAmountIsComparedOrNegated(q) &&
      !unresolvedDateShape(q, today) &&
      parseExplicitTimeframe(q, today) === null &&
      parseTargetDate(q, today) === null
    ) {
      return { kind: 'wealth_target', targetCents: amount, label: formatCents(amount as Cents) };
    }
  }

  // Debt payoff / debt-freedom (loans + overall debt) — BEFORE cash_needed so
  // "pay off my loan" / "when am I debt-free" isn't read as credit-card cash-needed.
  // Requires debt/loan vocabulary. An explicit "credit card" phrasing stays
  // cash_needed: "pay off my credit card debt" is a this-cycle question answered
  // from /cards, not a long-horizon payoff plan (DECISIONS #98).
  const namesCreditCard = /\bcredit cards?\b/.test(q);
  if (
    /\b(avalanche|snowball)\b/.test(q) ||
    /\bdebt[\s-]?free\b/.test(q) ||
    /\bout of debt\b/.test(q) ||
    (!namesCreditCard &&
      /\b(pay off|payoff|paying off|pay down|paydown|get out of)\b(?:\s+\w+){0,3}?\s+(debt|debts|loans?)\b/.test(
        q,
      )) ||
    (/\bloan\b/.test(q) && /\b(pay|payoff|pay off|pay down|owe|when|how long|clear)\b/.test(q))
  ) {
    return { kind: 'debt_payoff' };
  }

  // Cash needed to pay cards (require card/payment/due context to avoid grabbing
  // "how much can I spend").
  if (
    /\b(card|cards|credit card|statement|balance due)\b/.test(q) &&
    /\b(pay|owe|due|minimum|payoff|pay off|need)\b/.test(q)
  ) {
    return { kind: 'cash_needed' };
  }
  if (/\bhow much .*(do i (owe|need to pay)).*\b(card|cards|credit)\b/.test(q)) {
    return { kind: 'cash_needed' };
  }
  if (/\b(when|what)('?s| is| are)?.* (card|cards|payments?|bills?) due\b/.test(q) || /\bdue date\b/.test(q)) {
    return { kind: 'cash_needed' };
  }

  // Guilt-free / safe to spend (present/conditional) — before the past-tense
  // spend total. "safe to spend" stays a permanent alias (#295): users keep
  // the phrase long after a relabel, and dropping it would silently demote a
  // routed question to the LLM. The guilt-free alias is GATED off past-tense
  // questions (critic P1-4, executed repro): "guilt free" is a real merchant
  // and food-marketing phrase, so "how much did I spend at Guilt Free Bakery
  // in June?" must fall through to the merchant/total parsers instead of
  // answering with this month's plan figure.
  if (
    /\b(safe to spend|left to spend|spending plan)\b/.test(q) ||
    (/\bguilt[- ]?free\b/.test(q) && !/\b(did|spent)\b/.test(q)) ||
    /\bhow much (can|could|should) i (safely |comfortably )?spend\b/.test(q) ||
    /\bcan i (afford|safely spend|spend)\b/.test(q) ||
    /\bafford\b/.test(q)
  ) {
    // #166 (audit P1): "can I afford a $3,000 vacation in September" was
    // answered with THIS MONTH's plan, silently discarding both the amount and
    // the date. With a concrete LUMP amount AND a target date STRICTLY BEYOND
    // the current month it IS the inverse savings question — route it to the
    // same solver as "can I save $X by <date>". Guards (critic F1/F2): a
    // per-period rate ("afford $500 a month…"), a CURRENT-month date ("this
    // month" — exactly what safe_to_spend answers), and recurring-bill
    // vocabulary ("afford my rent/payment" — an obligation, not a savings
    // goal) all stay on the affordability answer.
    if (
      /\bafford\b/.test(q) &&
      !statedAmountIsPerPeriodRate(q) &&
      !/\b(rent|mortgage|bills?|payments?)\b/.test(q)
    ) {
      const amount = parseTargetAmount(q);
      const target = amount !== null ? parseTargetDate(q, today) : null;
      if (amount !== null && target && target.date.slice(0, 7) > today.slice(0, 7)) {
        return { kind: 'savings_goal_by_date', targetDate: target.date, targetCents: amount, label: target.label };
      }
    }
    return { kind: 'safe_to_spend' };
  }

  // Largest purchases (single biggest buy) — before top-categories so
  // "biggest purchase" isn't read as a category ranking. The route reads its
  // OBJECT like the spend family does (TASKS 2.7): "at costco" scopes the
  // ranking to that merchant; a scope it cannot represent (a fronted store, a
  // payment method, a category modifier, an unreadable name, an unresolvable
  // date) abstains instead of answering the GLOBAL biggest purchase — which
  // was a true figure under a false question.
  if (
    /\b(biggest|largest|most expensive|priciest|highest|single largest)\b/.test(q) &&
    /\b(purchases?|transactions?|buy|bought|expenses?|charges?|payments?|spent on|things?|items?)\b/.test(q) &&
    !/categor/.test(q)
  ) {
    const scope = largestScope(q, today, custom);
    if (scope === null || unresolvedDateShape(q, today)) return { kind: 'unknown', question };
    return {
      kind: 'largest_purchases',
      timeframe: parseTimeframe(q, today),
      limit: DEFAULT_LARGEST_LIMIT,
      ...(scope.merchant ? { merchant: scope.merchant } : {}),
    };
  }

  // Income
  if (/\bhow much .*(make|made|earn|earned|brought in|get paid|got paid|income)\b/.test(q) || /\bmy income\b/.test(q)) {
    // A date shape the parser could not window ("in 2027") must abstain, not
    // silently answer the default this-month window (TASKS 2.7).
    if (unresolvedDateShape(q, today)) return { kind: 'unknown', question };
    return { kind: 'income', timeframe: parseTimeframe(q, today) };
  }

  // Spending family
  const mentionsSpend = /\b(spend|spent|spending)\b/.test(q) || /\bhow much .*\bon\b/.test(q) || /\bmoney go\b/.test(q);
  if (mentionsSpend) {
    // A date shape the parser could not resolve into a window — a future year
    // ("in 2027"), an invalid numeric date ("on 13/5"), a two-digit year —
    // abstains the WHOLE family (TASKS 2.7). Before this, only the
    // spend_total sink was protected (by the #229 licence), so "groceries in
    // 2025" answered the unhedged THIS-MONTH Groceries figure and "since
    // 2024" the this-month total: a true figure under a different window.
    if (unresolvedDateShape(q, today)) return { kind: 'unknown', question };
    // BEFORE any object is resolved (#226 cycle 4): an unreadable object must not reach
    // the CATEGORY route either. It did — decomposed "café zurich" matched the `cafe`
    // synonym and answered ALL coffee-shop spending for a question about one store,
    // because `resolveSpendTarget` ran first and the guard sat below it. Readability is
    // a precondition of routing, not a fallback for when routing fails.
    //
    // Sole exception (TASKS 2.6): an object that IS one of the user's own custom
    // categories — "how much did I spend on Café?" is their own vocabulary, readable by
    // definition. Equality, not containment: "at café zurich" still abstains.
    const spendObject = spendObjectOf(q);
    if (spendObject !== null && spendObjectUnreadable(spendObject)) {
      const own = customCategoryForObject(spendObject, custom);
      if (own) return { kind: 'spend_by_category', timeframe: parseTimeframe(q, today), target: own };
      return { kind: 'unknown', question };
    }
    // Extract the at/with merchant BEFORE category routing (O.10a): a multi-word
    // store name must not lose to a category synonym that matches a proper
    // substring of it ("Costco Gas" contains `\bgas\b`→fuel; "Amazon Prime"
    // contains `\bamazon\b`→shopping). Single-token merchants still yield to
    // intentional synonyms (Amazon→shopping, Starbucks→coffee) — DECISIONS #168.
    const merchant = extractSpendMerchant(q);
    const target = resolveSpendTarget(q, custom);
    const wantsRanking =
      /\b(top|most|biggest|highest|main)\b.*\bcategor/.test(q) ||
      /\bcategor.*\b(top|most|biggest|highest)\b/.test(q) ||
      /\b(what|where) (did|do|does) .*(spend the most|most|money go)\b/.test(q) ||
      /\bwhere does my money go\b/.test(q) ||
      /\btop categor/.test(q) ||
      /\bbreakdown\b/.test(q);
    const timeframe = parseTimeframe(q, today);
    if (wantsRanking && !target) return { kind: 'top_categories', timeframe, limit: DEFAULT_TOP_LIMIT };
    const merchantTakesPrecedence =
      !!merchant &&
      !isLicensedIdiomPhrase(merchant) &&
      merchant.includes(' ') &&
      !categorySynonymOwnsWholePhrase(merchant);
    if (target && !merchantTakesPrecedence) {
      return { kind: 'spend_by_category', timeframe, target };
    }
    // #168: "how much did I spend AT COSTCO" — an at/with object is a MERCHANT,
    // not a category (resolveSpendTarget ran first and returned null). Route it to
    // the per-merchant total, which matches the term against the transactions'
    // own canonical merchant names. A statistical qualifier ("at/with average")
    // still isn't a merchant and abstains.
    // A licensed idiom is not a store (TASKS 2.7 critic F1/F7): "spend at the
    // moment" / "at the end of last month" extracted merchants "moment" and
    // "end of" and answered a confident-wrong "No spending at Moment…". Such
    // an object falls through to the SINK, whose licence consumes the idiom
    // and keeps the honest total ("at the end of last month" now answers last
    // month's total) — or withholds it ("at least $500": the figure is an
    // unconsumed object, so the honest redirect stands).
    if (merchant && !isLicensedIdiomPhrase(merchant)) {
      const first = merchant.split(' ')[0];
      if (NON_MERCHANT_SPEND_OBJECTS.has(first)) return { kind: 'unknown', question };
      return { kind: 'merchant_spend', timeframe, merchant };
    }
    // `spend_total` is the SINK of this family, and it must EARN its answer (TASKS 2.6,
    // the #226 inversion). Four critic cycles each hardened one verb-anchored guard in
    // front of it, and each time the input moved one syntactic inch — a fronted object
    // ("At Costco, how much did I spend?"), a sentence break, punctuation glue — and
    // landed here anyway: the user's ENTIRE spending, presented unhedged as the answer
    // to a question about one store. So the sink no longer trusts the guards: the total
    // requires a POSITIVE LICENCE — no at/with/on object anywhere in the question that
    // the total does not account for (this subsumes the old verb-anchored "on <object>"
    // #166 guard), and no name content we cannot read. Objects that ARE the total ("on
    // everything"), a timeframe ("on March 5"), or a licensed idiom ("at least", "at
    // the end of last month") keep the total answer.
    if (unconsumedSpendObject(q, today) !== null) return { kind: 'unknown', question };
    if (containsUnreadableName(q)) return { kind: 'unknown', question };
    return { kind: 'spend_total', timeframe };
  }

  // Account balance (after savings-rate / safe-to-spend so it doesn't poach them)
  if (
    /\bbalance\b/.test(q) ||
    /\bhow much (is |do i have )?in my\b/.test(q) ||
    /\b(checking|savings|brokerage)( account)?\b/.test(q) ||
    /\bhow much (money )?(do i have|is in)\b/.test(q)
  ) {
    return { kind: 'account_balance', query: q };
  }

  return { kind: 'unknown', question };
}

// ─── validation (the zod-substitute, matching the parseLlmCategory convention) ─

/** A real calendar month key: month 01–12 only (`2026-13` is not a window). */
const YM_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
/** Labels are UI copy echoed into an answer's headline; a real one is short
 *  ("the last 24 months" is 19 chars). A longer one is not a label — reject it
 *  rather than let a client-echoed frame smuggle a sentence into the copy. */
const MAX_LABEL_LEN = 40;
/** The parser emits at most 4 merchant tokens; a longer one is not a store name. */
const MAX_MERCHANT_LEN = 64;

function isTimeframe(x: unknown): x is Timeframe {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.fromYm === 'string' &&
    YM_RE.test(t.fromYm) &&
    typeof t.toYm === 'string' &&
    YM_RE.test(t.toYm) &&
    t.fromYm <= t.toYm &&
    typeof t.label === 'string' &&
    t.label.length > 0 &&
    t.label.length <= MAX_LABEL_LEN
  );
}

function isSpendTarget(x: unknown, validCustomIds: ReadonlySet<string> = new Set()): x is SpendTarget {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  if (typeof t.label !== 'string' || t.label.length === 0 || t.label.length > MAX_LABEL_LEN) return false;
  if (t.type === 'category')
    return (
      typeof t.categoryId === 'string' &&
      (CATEGORY_BY_ID.has(t.categoryId) || validCustomIds.has(t.categoryId))
    );
  if (t.type === 'categories')
    return (
      Array.isArray(t.categoryIds) &&
      t.categoryIds.length > 0 &&
      t.categoryIds.every(
        (id) => typeof id === 'string' && (CATEGORY_BY_ID.has(id) || validCustomIds.has(id)),
      )
    );
  if (t.type === 'group') return typeof t.group === 'string' && GROUPS.includes(t.group as string);
  return false;
}

/**
 * The label a target is ALLOWED to carry, derived from the target's own identity.
 *
 * A `SpendTarget` now round-trips through the client (the conversation frame,
 * TASKS 2.1), so its label is untrusted text that lands verbatim in a money
 * headline — "You spent $840.00 on Groceries this month." A forged frame could
 * otherwise attach the label "Groceries" to the TRAVEL group and get a true
 * figure under a false name. So the label is never trusted: it is RE-DERIVED
 * from the id/group, and only an umbrella (whose label is a synthesized phrase
 * like "utilities") keeps its own — validated against the closed set of labels
 * the synonym table can actually produce (critic P2-B, cycle 2).
 */
function canonicalTargetLabel(
  t: SpendTarget,
  custom: readonly { id: string; name?: string }[],
): string | null {
  if (t.type === 'category') {
    // The reader's own vocabulary FIRST — `custom` carries their custom
    // categories AND any built-in they renamed, both server-loaded, so this is
    // still a re-derivation and a forged frame label still cannot survive it.
    // Reading the static map first printed "You spent $840.00 on Groceries" to a
    // reader whose every other screen said "Food shop" — while the SAME answer's
    // top-categories list said "Food shop". One reply, two names, one bucket.
    // Trimmed: this label lands verbatim in a money headline (critic F7).
    const own = custom.find((c) => c.id === t.categoryId)?.name?.trim();
    if (own) return own;
    return CATEGORY_BY_ID.get(t.categoryId)?.name ?? null;
  }
  if (t.type === 'group') {
    // The synonym table's own phrasing for this group ("eating out"), else the group.
    const spoken = SYNONYMS.find(
      (s) => s.target.type === 'group' && s.target.group === t.group,
    )?.target.label;
    return spoken ?? t.group;
  }
  // Umbrella: the id set is what identifies it, so match the label to the entry
  // whose leaves it names. An unrecognised umbrella is not a target we emit.
  const key = [...t.categoryIds].sort().join(',');
  const entry = SYNONYMS.find(
    (s) => s.target.type === 'categories' && [...s.target.categoryIds].sort().join(',') === key,
  );
  return entry?.target.label ?? null;
}

/**
 * Validate an arbitrary object as a well-formed AssistantIntent. Used to gate
 * any LLM-proposed routing before it reaches the data layer — a malformed or
 * hallucinated intent is rejected (→ caller falls back to `unknown`), so the
 * model can never smuggle in an unknown category id or a broken timeframe.
 */
export function validateIntent(
  x: unknown,
  custom: readonly { id: string; name?: string }[] = [],
): AssistantIntent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const validCustomIds = new Set(custom.map((c) => c.id));
  /** Accept a target only with a label derived from its own identity, never the
   *  client's (see canonicalTargetLabel). */
  const withCanonicalLabel = (t: SpendTarget): SpendTarget | null => {
    const label = canonicalTargetLabel(t, custom);
    return label ? { ...t, label } : null;
  };
  switch (o.kind) {
    case 'net_worth':
    case 'safe_to_spend':
    case 'cash_needed':
    case 'debt_payoff':
    case 'subscriptions':
    case 'cash_flow_radar':
    case 'forecast':
    case 'savings_rate':
      return { kind: o.kind };
    case 'account_balance':
      return typeof o.query === 'string' ? { kind: 'account_balance', query: o.query } : null;
    case 'debt_free_by_date': {
      if (typeof o.targetDate !== 'string' || typeof o.label !== 'string') return null;
      // A real calendar date only (isoDate throws on e.g. 2027-13-40 or junk).
      try {
        return { kind: 'debt_free_by_date', targetDate: isoDate(o.targetDate), label: o.label };
      } catch {
        return null;
      }
    }
    case 'savings_goal_by_date': {
      if (typeof o.targetDate !== 'string' || typeof o.label !== 'string') return null;
      // A bad/absent amount degrades to null (→ the answer ASKS for it), never to a
      // smuggled figure; only an invalid DATE rejects the whole intent (isoDate throws).
      const amt =
        typeof o.targetCents === 'number' && Number.isFinite(o.targetCents) && o.targetCents > 0
          ? o.targetCents
          : null;
      try {
        return { kind: 'savings_goal_by_date', targetDate: isoDate(o.targetDate), targetCents: amt, label: o.label };
      } catch {
        return null;
      }
    }
    case 'retire_at_age': {
      if (typeof o.targetAge !== 'number' || !Number.isInteger(o.targetAge) || o.targetAge < 18 || o.targetAge > 110) {
        return null;
      }
      return typeof o.label === 'string' ? { kind: 'retire_at_age', targetAge: o.targetAge, label: o.label } : null;
    }
    case 'wealth_target': {
      if (
        typeof o.targetCents !== 'number' ||
        !Number.isInteger(o.targetCents) ||
        !Number.isFinite(o.targetCents) ||
        o.targetCents <= 0 ||
        typeof o.label !== 'string'
      ) {
        return null;
      }
      return { kind: 'wealth_target', targetCents: o.targetCents, label: o.label };
    }
    case 'spend_total':
      return isTimeframe(o.timeframe) ? { kind: 'spend_total', timeframe: o.timeframe } : null;
    case 'income':
      return isTimeframe(o.timeframe) ? { kind: 'income', timeframe: o.timeframe } : null;
    case 'spend_by_category': {
      if (!isTimeframe(o.timeframe) || !isSpendTarget(o.target, validCustomIds)) return null;
      const target = withCanonicalLabel(o.target);
      return target ? { kind: 'spend_by_category', timeframe: o.timeframe, target } : null;
    }
    case 'merchant_spend':
      return isTimeframe(o.timeframe) &&
        typeof o.merchant === 'string' &&
        o.merchant.trim().length > 0 &&
        o.merchant.length <= MAX_MERCHANT_LEN
        ? { kind: 'merchant_spend', timeframe: o.timeframe, merchant: o.merchant }
        : null;
    case 'top_categories':
      return isTimeframe(o.timeframe) && typeof o.limit === 'number' && o.limit > 0
        ? { kind: 'top_categories', timeframe: o.timeframe, limit: Math.min(20, Math.floor(o.limit)) }
        : null;
    case 'largest_purchases': {
      if (!(isTimeframe(o.timeframe) && typeof o.limit === 'number' && o.limit > 0)) return null;
      const base = {
        kind: 'largest_purchases' as const,
        timeframe: o.timeframe,
        limit: Math.min(20, Math.floor(o.limit)),
      };
      if (o.merchant === undefined) return base;
      // The optional merchant scope (TASKS 2.7) round-trips through the client
      // (the conversation frame), so it is bounded exactly like merchant_spend's.
      return typeof o.merchant === 'string' && o.merchant.trim().length > 0 && o.merchant.length <= MAX_MERCHANT_LEN
        ? { ...base, merchant: o.merchant }
        : null;
    }
    case 'unknown':
      return typeof o.question === 'string' ? { kind: 'unknown', question: o.question } : null;
    default:
      return null;
  }
}
