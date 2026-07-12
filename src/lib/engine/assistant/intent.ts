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
import { addMonthsClamped, daysInMonth, isoDate, type ISODate } from '@/lib/dates';
import { centsFromDollarString } from '@/lib/money';
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
  | { kind: 'largest_purchases'; timeframe: Timeframe; limit: number }
  | { kind: 'income'; timeframe: Timeframe }
  | { kind: 'safe_to_spend' }
  | { kind: 'cash_needed' }
  | { kind: 'debt_payoff' }
  | { kind: 'debt_free_by_date'; targetDate: ISODate; label: string }
  | { kind: 'savings_goal_by_date'; targetDate: ISODate; targetCents: number | null; label: string }
  | { kind: 'retire_at_age'; targetAge: number; label: string }
  | { kind: 'subscriptions' }
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
  'subscriptions',
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

const ymOf = (date: string) => date.slice(0, 7);
/** The month key `n` months before `ym` (clamped month arithmetic, no Date). */
function priorYm(ym: string, n: number): string {
  return addMonthsClamped(isoDate(`${ym}-01`), -n).slice(0, 7);
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
  const todayYm = ymOf(today);
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
  const todayYm = ymOf(today);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));

  if (/\b(this|current) month\b/.test(q) || /\bmonth to date\b/.test(q) || /\bmtd\b/.test(q)) {
    return { fromYm: todayYm, toYm: todayYm, label: 'this month' };
  }
  if (/\b(last|previous|prior|past) month\b/.test(q)) {
    const p = priorYm(todayYm, 1);
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
    return { fromYm: priorYm(todayYm, n - 1), toYm: todayYm, label: `the last ${n} months` };
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
    return { fromYm: ym, toYm: ym, label: `${MONTH_TITLE[i]} ${year}` };
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
 * it must carry a "$", a magnitude suffix (k/m/grand/thousand/million/bn/billion), the word
 * "dollars"/"bucks", or thousands grouping. Integer-cents throughout (no float on money):
 * the base ≤2-decimal value parses via centsFromDollarString, then scales by an integer
 * multiplier; anything it can't parse exactly falls through to null (ask, don't guess).
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

  // 1) Magnitude form FIRST, so "$15k" isn't read as "$15" by the plain-dollar rule below.
  const MULT: Record<string, number> = {
    k: 1_000,
    grand: 1_000,
    thousand: 1_000,
    m: 1_000_000,
    million: 1_000_000,
    bn: 1_000_000_000,
    billion: 1_000_000_000,
  };
  const mag = q.match(new RegExp(`\\$?\\s?(${INT})(?:\\.(\\d{1,2}))?\\s*(k|m|bn|grand|thousand|million|billion)\\b`));
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

/** Map free text to a spending target (leaf category or group), else null. The
 *  user's custom categories are matched by name AFTER the system synonyms (so a
 *  built-in mapping always wins) but BEFORE the verbatim-group fallback. */
export function resolveSpendTarget(
  q: string,
  custom: readonly { id: string; name: string }[] = [],
): SpendTarget | null {
  for (const { re, target } of SYNONYMS) {
    if (re.test(q)) return target;
  }
  // Custom categories (DECISIONS #111), longest name first so "golf club" beats
  // "golf"; word-boundary + escaped so it can't be a stray substring hit.
  for (const c of [...custom].sort((a, b) => b.name.length - a.name.length)) {
    const name = c.name.trim().toLowerCase();
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(q)) return catTarget(c.id, c.name);
  }
  // Fallback: a group name spoken verbatim (e.g. "personal & family").
  for (const g of GROUPS) {
    if (q.includes(g.toLowerCase())) return groupTarget(g, g.toLowerCase());
  }
  return null;
}

// ─── intent parsing ─────────────────────────────────────────────────────────

/** Normalize: lowercase, collapse whitespace, strip a trailing question mark. */
function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim();
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
  const m = /\b(?:spend|spent|spending)\b[^.?!]*?\b(?:at|with)\s+(.+)$/.exec(q);
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
  const tokens = after.toLowerCase().split(/\s+/).filter(Boolean);
  while (tokens.length && MERCHANT_LEADING_SKIP.has(tokens[0])) tokens.shift();
  const out: string[] = [];
  for (const raw of tokens) {
    const w = raw.replace(/[^a-z0-9'&.-]/g, '');
    if (!w) break;
    if (TOTAL_SPEND_OBJECTS.has(w) || MERCHANT_STOP_WORDS.has(w)) break;
    out.push(w);
    if (out.length >= 4) break;
  }
  const phrase = out.join(' ').trim();
  return phrase || null;
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

function statedAmountIsPerPeriodRate(q: string): boolean {
  return /\$?\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:\/\s*(?:mo|month|wk|week|yr|year|day)|(?:a|per|each)\s+(?:month|week|year|day|fortnight)|monthly|weekly|biweekly|fortnightly|yearly|annually)\b/.test(
    q,
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

  // Forecast / will I run out
  if (
    /\b(forecast|cash[\s-]?flow|run(ning)? out of (money|cash)|go(ing)? negative|negative balance|overdraf|next (30|60|90) days|in (30|60|90) days)\b/.test(
      q,
    ) ||
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

  // Safe to spend (present/conditional) — before the past-tense spend total.
  if (
    /\b(safe to spend|left to spend|spending plan)\b/.test(q) ||
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
  // "biggest purchase" isn't read as a category ranking.
  if (
    /\b(biggest|largest|most expensive|priciest|highest|single largest)\b/.test(q) &&
    /\b(purchases?|transactions?|buy|bought|expenses?|charges?|payments?|spent on|things?)\b/.test(q) &&
    !/categor/.test(q)
  ) {
    return { kind: 'largest_purchases', timeframe: parseTimeframe(q, today), limit: DEFAULT_LARGEST_LIMIT };
  }

  // Income
  if (/\bhow much .*(make|made|earn|earned|brought in|get paid|got paid|income)\b/.test(q) || /\bmy income\b/.test(q)) {
    return { kind: 'income', timeframe: parseTimeframe(q, today) };
  }

  // Spending family
  const mentionsSpend = /\b(spend|spent|spending)\b/.test(q) || /\bhow much .*\bon\b/.test(q) || /\bmoney go\b/.test(q);
  if (mentionsSpend) {
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
    if (target) return { kind: 'spend_by_category', timeframe, target };
    // #168: "how much did I spend AT COSTCO" — an at/with object is a MERCHANT,
    // not a category (resolveSpendTarget ran first and returned null). Route it to
    // the per-merchant total, which matches the term against the transactions'
    // own canonical merchant names. A statistical qualifier ("at/with average")
    // still isn't a merchant and abstains.
    const merchant = extractSpendMerchant(q);
    if (merchant) {
      const first = merchant.split(' ')[0];
      if (NON_MERCHANT_SPEND_OBJECTS.has(first)) return { kind: 'unknown', question };
      return { kind: 'merchant_spend', timeframe, merchant };
    }
    // #166 invariant kept: an unresolved "on <object>" ("on golf", "on average")
    // is a question we can't answer precisely — a category we don't track, or a
    // merchant the user phrased with "on". Abstain to the honest redirect rather
    // than hijacking to the ALL-spending total. Objects that ARE the total
    // ("on everything") or a month ("on March 5", already a parsed timeframe)
    // keep the total answer (critic F7).
    const onObject = /\b(?:spend|spent|spending)\b[^.?!]*?\bon\s+([a-z0-9]+)/.exec(q);
    if (onObject && !TOTAL_SPEND_OBJECTS.has(onObject[1])) {
      return { kind: 'unknown', question };
    }
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
    const system = CATEGORY_BY_ID.get(t.categoryId)?.name;
    if (system) return system;
    const own = custom.find((c) => c.id === t.categoryId)?.name;
    return own ?? null;
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
    case 'largest_purchases':
      return isTimeframe(o.timeframe) && typeof o.limit === 'number' && o.limit > 0
        ? { kind: 'largest_purchases', timeframe: o.timeframe, limit: Math.min(20, Math.floor(o.limit)) }
        : null;
    case 'unknown':
      return typeof o.question === 'string' ? { kind: 'unknown', question: o.question } : null;
    default:
      return null;
  }
}
