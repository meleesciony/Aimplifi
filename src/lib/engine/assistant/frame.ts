/**
 * Conversation frame — deterministic ellipsis resolution for Ask (TASKS 2.1).
 *
 * The assistant is stateless: every question is parsed on its own. That makes a
 * natural follow-up ("what about last month?") an `unknown`, because the
 * fragment names no intent. This module cures that amnesia WITHOUT an LLM and
 * WITHOUT any new number: it holds the previous turn's resolved intent as a
 * frame of slots — `{kind, timeframe, target, merchant, limit}` — and rebuilds
 * the SAME intent with the one slot the fragment names swapped out.
 *
 * Cardinal rules this module obeys:
 *  - It is only ever consulted when the deterministic parser already returned
 *    `unknown`. A question that routes on its own is never re-interpreted, so
 *    every existing route is byte-identical whether a frame is present or not.
 *  - It originates nothing. Every slot it emits either comes from the frame
 *    (already validated) or is parsed out of the user's own words by the same
 *    parser helpers the full router uses (`parseExplicitTimeframe`,
 *    `resolveSpendTarget`, `extractMerchantPhrase`) — never a re-implementation.
 *  - It abstains loudly. A fragment that names no slot, or names a slot the
 *    framed intent does not have, resolves to `null` — the caller keeps the
 *    honest `unknown` (and the LLM rescue still gets its turn).
 */
import { addMonthsClamped, isoDate, type ISODate } from '@/lib/dates';
import {
  extractMerchantPhrase,
  isNonMerchantObject,
  MONTH_TITLE,
  parseExplicitTimeframe,
  parseTimeframe,
  resolveSpendTarget,
  type AssistantIntent,
  type AssistantIntentKind,
  type SpendTarget,
  type Timeframe,
} from '@/lib/engine/assistant/intent';

/** The slots carried between Ask turns. Only ever built from a resolved intent. */
export interface AskFrame {
  kind: Exclude<AssistantIntentKind, 'unknown'>;
  timeframe?: Timeframe;
  target?: SpendTarget;
  merchant?: string;
  limit?: number;
}

/** Merchant names are capped (the parser emits at most 4 tokens); a frame arrives
 *  from the client, so clamp what it can echo back into an answer's copy. */
const MAX_MERCHANT_LEN = 64;

/** Fragments longer than this are real questions, not ellipses — abstain. */
const MAX_FRAGMENT_TOKENS = 6;

/** Intents whose answer is scoped to a calendar window (a timeframe is swappable). */
const TIMEFRAME_KINDS = new Set<AskFrame['kind']>([
  'spend_total',
  'spend_by_category',
  'merchant_spend',
  'top_categories',
  'largest_purchases',
  'income',
]);

/**
 * Intents where a bare category or merchant fragment means "the same TOTAL,
 * about this instead". After `net_worth` or `income`, "what about groceries?"
 * has no defensible reading, so the frame abstains rather than inventing a spend
 * question the user did not ask.
 *
 * `largest_purchases` is deliberately EXCLUDED (critic P2-5): after "what was my
 * biggest purchase?", "what about at Costco?" means the biggest purchase AT
 * Costco — an answer no engine computes. Emitting a merchant TOTAL there would
 * silently change the question under the user, so the frame abstains and the
 * honest `unknown` redirect stands. `top_categories` IS included: it lists
 * categories, so naming one is a drill-down, not a change of question.
 */
const SPEND_FAMILY = new Set<AskFrame['kind']>([
  'spend_total',
  'spend_by_category',
  'merchant_spend',
  'top_categories',
]);

/** The frame left behind by a resolved intent; `null` for `unknown` (nothing to carry). */
export function frameFromIntent(intent: AssistantIntent): AskFrame | null {
  switch (intent.kind) {
    case 'unknown':
      return null;
    case 'spend_total':
    case 'income':
      return { kind: intent.kind, timeframe: intent.timeframe };
    case 'spend_by_category':
      return { kind: intent.kind, timeframe: intent.timeframe, target: intent.target };
    case 'merchant_spend':
      return {
        kind: intent.kind,
        timeframe: intent.timeframe,
        merchant: intent.merchant.slice(0, MAX_MERCHANT_LEN),
      };
    case 'top_categories':
    case 'largest_purchases':
      return { kind: intent.kind, timeframe: intent.timeframe, limit: intent.limit };
    default:
      return { kind: intent.kind };
  }
}

/**
 * Leading conversational cues that mark a fragment as a follow-up. Stripped
 * before slot extraction: "what about last month" → "last month". A fragment
 * may also carry no cue at all ("last month?"), which is why the cue is optional
 * and the token cap does the abstaining.
 */
const CUE_RE =
  /^(?:(?:ok|okay|and|but|so|now|also|no|nope|actually)[,\s]+)*(?:what about|how about|what if|and what about|same (?:but )?for|same as|same|just|only)?\s*/;

/** Prepositions that can lead a slot fragment ("at Costco", "in March", "on groceries"). */
const LEADING_PREPOSITIONS = new Set(['at', 'with', 'for', 'on', 'in', 'about']);

/**
 * A fragment that NEGATES or EXCLUDES is not a slot swap. Without this,
 * "restaurants not groceries" resolves through `resolveSpendTarget`, whose
 * first-match-wins synonym order returns GROCERIES — a confident figure for the
 * category the user just rejected (critic P1-2). We cannot represent exclusion,
 * so we abstain. (A leading "no," / "actually," is a correction CUE, stripped
 * above, not a negation — "no, restaurants?" still resolves.)
 */
const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'except', 'excluding', 'without', 'instead', 'besides',
  'minus', 'rather', 'nor',
]);

/**
 * Words that prove the text is a QUESTION or a comparison, not an ellipsis:
 * "why so much on dining?", "should I cut back on dining?", "groceries vs
 * restaurants?". Each names a real slot, so without this guard the frame answers
 * a bare spend figure to a question about advice, causation, or comparison —
 * none of which the figure answers (critic P2-4). The proper cues ("what about",
 * "how about", "what if") are stripped by CUE_RE before this runs, so they never
 * trip it. Deliberately excludes demonstratives and temporal words ("this",
 * "last") — they are how a timeframe is named.
 */
const QUESTION_WORDS = new Set([
  'why', 'how', 'what', 'when', 'where', 'who', 'which', 'whose',
  'is', 'are', 'was', 'were', 'am', 'be', 'been',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'might',
  'if', 'because', 'than', 'then', 'vs', 'versus', 'compared', 'against',
  'much', 'many', 'more', 'less', 'high', 'low', 'cut', 'back', 'save',
]);

/**
 * Resolve a follow-up fragment against the previous turn's frame, or `null` when
 * it is not a resolvable ellipsis. Call ONLY when `parseAssistantQuery` returned
 * `unknown` for this question.
 */
export function resolveEllipsis(
  question: string,
  today: ISODate,
  frame: AskFrame | null | undefined,
  custom: readonly { id: string; name: string }[] = [],
): AssistantIntent | null {
  if (!frame) return null;
  const q = question.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\?+$/, '').trim();
  if (!q) return null;

  const rest = q.replace(CUE_RE, '').trim();
  if (!rest) return null;
  const words = rest.split(' ');
  if (words.length > MAX_FRAGMENT_TOKENS) return null;
  // A sentence, a comparison, or an exclusion — none of which is a slot swap.
  if (words.some((w) => NEGATION_WORDS.has(strip(w)) || QUESTION_WORDS.has(strip(w)))) return null;

  const timeframe = parseExplicitTimeframe(rest, today);
  const target = resolveSpendTarget(rest, custom);
  const merchant = target ? null : merchantFragment(rest);
  if (!timeframe && !target && !merchant) return null;

  // A category/merchant swap only makes sense against a spending question.
  if ((target || merchant) && !SPEND_FAMILY.has(frame.kind)) return null;
  // A bare timeframe swap needs an intent that HAS a timeframe.
  if (!target && !merchant && !TIMEFRAME_KINDS.has(frame.kind)) return null;

  // A freshly parsed window is correct by construction; a CARRIED one may have
  // gone stale ("this month", framed in June, is a lie on July 1) — re-label it
  // against today (critic P2-7). The window itself never moves.
  const when = timeframe ?? (frame.timeframe ? relabelForToday(frame.timeframe, today) : parseTimeframe('', today));

  if (target) return { kind: 'spend_by_category', timeframe: when, target };
  if (merchant) return { kind: 'merchant_spend', timeframe: when, merchant };

  // Timeframe-only: the same question, a different window. Every other slot is
  // carried verbatim from the frame.
  switch (frame.kind) {
    case 'spend_total':
    case 'income':
      return { kind: frame.kind, timeframe: when };
    case 'spend_by_category':
      return frame.target
        ? { kind: 'spend_by_category', timeframe: when, target: frame.target }
        : null;
    case 'merchant_spend':
      return frame.merchant
        ? { kind: 'merchant_spend', timeframe: when, merchant: frame.merchant }
        : null;
    case 'top_categories':
    case 'largest_purchases':
      return frame.limit
        ? { kind: frame.kind, timeframe: when, limit: frame.limit }
        : null;
    default:
      return null;
  }
}

/**
 * Pronouns and demonstratives. A store is a NAME, so a fragment that refers back
 * ("what about that?", "same for them") names no merchant — abstain rather than
 * answer "No spending at that." (The parser's own stop words already end a
 * merchant phrase at "this"/"last", so this only guards the leading word.)
 */
const PRONOUNS = new Set([
  'i', 'me', 'mine', 'we', 'us', 'you', 'he', 'she', 'it', 'they', 'them',
  'that', 'those', 'these', 'there', 'here', 'ours', 'yours', 'theirs',
]);

/** A bare (preposition-less) merchant is a short proper name, not a phrase. */
const MAX_BARE_MERCHANT_TOKENS = 3;

/**
 * Nouns that name one of the ASSISTANT'S OWN intents rather than a store. Before
 * this guard, "what about income?" resolved to the merchant "income" and
 * answered "No spending at Income this month." — a $0 non-sequitur that also
 * STOLE the question from the LLM classifier, which routes it correctly (critic
 * P1-3). Category words never reach here (`resolveSpendTarget` runs first), so
 * this set only ever catches the assistant's own vocabulary.
 */
const INTENT_NOUNS = new Set([
  'income', 'paycheck', 'paychecks', 'salary', 'earnings', 'wages', 'pay',
  'refund', 'refunds', 'balance', 'balances', 'worth', 'networth',
  'forecast', 'runway', 'debt', 'debts', 'loan', 'loans', 'payoff',
  'budget', 'plan', 'goal', 'goals', 'retirement', 'investments', 'portfolio',
  'transfer', 'transfers', 'total', 'spending', 'spend',
]);

/**
 * A merchant named by a fragment: "at Costco" / "with Costco" ANYWHERE in it
 * (so "last month at costco" keeps the merchant the user named — critic P1-1),
 * else the fragment read as a bare store name ("Costco"). Reuses the parser's
 * tokenizer, then applies three guards:
 *  - #168: a payment method or statistical qualifier ("same for Amex", "what
 *    about average") is NOT a merchant — abstain rather than answer "No spending
 *    at Amex".
 *  - a word from the assistant's own intent vocabulary is not a store (P1-3).
 *  - a bare (preposition-less) name is short; a longer phrase is prose.
 */
function merchantFragment(rest: string): string | null {
  // "…at costco", "…with costco" — the merchant construction, wherever it sits.
  const led = /\b(?:at|with)\s+(.+)$/.exec(rest);
  if (led) return cleanMerchant(led[1], false);

  const tokens = rest.split(' ');
  const after = LEADING_PREPOSITIONS.has(tokens[0]) ? tokens.slice(1).join(' ') : rest;
  if (!after.trim()) return null;
  return cleanMerchant(after, true);
}

function cleanMerchant(after: string, bare: boolean): string | null {
  const phrase = extractMerchantPhrase(after);
  if (!phrase) return null;
  const words = phrase.split(' ');
  if (words.some((w) => isNonMerchantObject(w) || INTENT_NOUNS.has(w) || PRONOUNS.has(w))) return null;
  if (bare && words.length > MAX_BARE_MERCHANT_TOKENS) return null;
  return phrase.slice(0, MAX_MERCHANT_LEN);
}

/** Punctuation-stripped word, for the guard sets ("groceries," → "groceries"). */
function strip(w: string): string {
  return w.replace(/[^a-z0-9']/g, '');
}

/**
 * Re-label a CARRIED window against today. "this month"/"last month" are deictic:
 * the window they named in June is a different window in July, so carrying the
 * label verbatim across a month boundary states something false. The window is
 * never moved — only its name is corrected ("this month" → "June 2026").
 */
function relabelForToday(tf: Timeframe, today: ISODate): Timeframe {
  if (tf.label !== 'this month' && tf.label !== 'last month') return tf;
  if (tf.fromYm !== tf.toYm) return tf;
  const todayYm = today.slice(0, 7);
  const prevYm = addMonthsClamped(isoDate(`${todayYm}-01`), -1).slice(0, 7);
  if (tf.fromYm === todayYm) return { ...tf, label: 'this month' };
  if (tf.fromYm === prevYm) return { ...tf, label: 'last month' };
  const month = MONTH_TITLE[Number(tf.fromYm.slice(5, 7)) - 1];
  return { ...tf, label: `${month} ${tf.fromYm.slice(0, 4)}` };
}
