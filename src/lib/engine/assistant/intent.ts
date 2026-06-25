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
import { addMonthsClamped, isoDate, type ISODate } from '@/lib/dates';
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
  | { type: 'group'; group: string; label: string };

export type AssistantIntent =
  | { kind: 'net_worth' }
  | { kind: 'account_balance'; query: string }
  | { kind: 'spend_total'; timeframe: Timeframe }
  | { kind: 'spend_by_category'; timeframe: Timeframe; target: SpendTarget }
  | { kind: 'top_categories'; timeframe: Timeframe; limit: number }
  | { kind: 'largest_purchases'; timeframe: Timeframe; limit: number }
  | { kind: 'income'; timeframe: Timeframe }
  | { kind: 'safe_to_spend' }
  | { kind: 'cash_needed' }
  | { kind: 'debt_payoff' }
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
  'top_categories',
  'largest_purchases',
  'income',
  'safe_to_spend',
  'cash_needed',
  'debt_payoff',
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
const MONTH_TITLE = [
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

  return { fromYm: todayYm, toYm: todayYm, label: 'this month' };
}

// ─── category / group resolution ────────────────────────────────────────────

const GROUPS: readonly string[] = [...new Set(CATEGORIES.map((c) => c.group))].filter((g) => g !== 'Income');

function catTarget(id: string): SpendTarget {
  return { type: 'category', categoryId: id, label: CATEGORY_BY_ID.get(id)?.name ?? id };
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
  // Bills & Utilities
  { re: /\b(utilit(y|ies)|electric(ity)?|power bill|water bill)\b/, target: catTarget('utilities') },
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

/** Map free text to a spending target (leaf category or group), else null. */
export function resolveSpendTarget(q: string): SpendTarget | null {
  for (const { re, target } of SYNONYMS) {
    if (re.test(q)) return target;
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
export function parseAssistantQuery(question: string, today: ISODate): AssistantIntent {
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

  // Debt payoff / debt-freedom (loans + overall debt) — BEFORE cash_needed so
  // "pay off my loan" / "when am I debt-free" isn't read as credit-card cash-needed.
  // Requires debt/loan vocabulary; "pay off my cards" still falls through to cash_needed.
  if (
    /\b(avalanche|snowball)\b/.test(q) ||
    /\bdebt[\s-]?free\b/.test(q) ||
    /\b(pay off|payoff|paying off|get out of)\b(?:\s+\w+){0,3}?\s+(debt|debts|loans?)\b/.test(q) ||
    (/\bloan\b/.test(q) && /\b(pay|payoff|pay off|when|how long|clear)\b/.test(q))
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
    const target = resolveSpendTarget(q);
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

function isTimeframe(x: unknown): x is Timeframe {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.fromYm === 'string' &&
    /^\d{4}-\d{2}$/.test(t.fromYm) &&
    typeof t.toYm === 'string' &&
    /^\d{4}-\d{2}$/.test(t.toYm) &&
    t.fromYm <= t.toYm &&
    typeof t.label === 'string'
  );
}

function isSpendTarget(x: unknown): x is SpendTarget {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  if (t.type === 'category') return typeof t.categoryId === 'string' && CATEGORY_BY_ID.has(t.categoryId) && typeof t.label === 'string';
  if (t.type === 'group') return typeof t.group === 'string' && GROUPS.includes(t.group as string) && typeof t.label === 'string';
  return false;
}

/**
 * Validate an arbitrary object as a well-formed AssistantIntent. Used to gate
 * any LLM-proposed routing before it reaches the data layer — a malformed or
 * hallucinated intent is rejected (→ caller falls back to `unknown`), so the
 * model can never smuggle in an unknown category id or a broken timeframe.
 */
export function validateIntent(x: unknown): AssistantIntent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
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
    case 'spend_total':
      return isTimeframe(o.timeframe) ? { kind: 'spend_total', timeframe: o.timeframe } : null;
    case 'income':
      return isTimeframe(o.timeframe) ? { kind: 'income', timeframe: o.timeframe } : null;
    case 'spend_by_category':
      return isTimeframe(o.timeframe) && isSpendTarget(o.target)
        ? { kind: 'spend_by_category', timeframe: o.timeframe, target: o.target }
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
