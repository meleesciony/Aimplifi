/**
 * Ask Aimplifi — pure LLM routing helpers (DECISIONS #75).
 *
 * The deterministic parser (intent.ts) handles the overwhelming majority of
 * questions. For a genuinely-unrecognized phrasing, an optional LLM may CLASSIFY
 * the question into one of our known intent kinds — and nothing more. Every
 * parameter (timeframe, category) is then re-derived DETERMINISTICALLY from the
 * user's own words via the same parser, so the model can never inject an unknown
 * category id, a bad date window, or a fabricated number. The model picks a route;
 * the engines produce the facts.
 *
 * Pure + testable; the network call lives in server/assistant-llm.ts (returns
 * null with no key, exactly like categorize/llm.ts → the demo needs no key).
 */
import type { ISODate } from '@/lib/dates';
import {
  type AssistantIntent,
  ASSISTANT_INTENT_KINDS,
  parseTargetAge,
  parseTargetAmount,
  parseTargetDate,
  parseTimeframe,
  resolveSpendTarget,
} from './intent';

/** The kinds the model is allowed to choose (everything except the fallback). */
export const LLM_ROUTABLE_KINDS = ASSISTANT_INTENT_KINDS.filter((k) => k !== 'unknown');

/** Build the (deterministic) classification prompt for one question. */
export function buildIntentPrompt(question: string): string {
  return [
    'You route a personal-finance question to exactly one intent. Do NOT answer it.',
    'Allowed intents:',
    '- net_worth: total assets minus liabilities',
    '- account_balance: the balance of a specific account (checking, savings, brokerage)',
    '- spend_total: total spending over a period',
    '- spend_by_category: spending in one category/group over a period',
    '- top_categories: the biggest spending categories',
    '- largest_purchases: the single biggest individual purchases',
    '- income: money earned over a period',
    '- safe_to_spend: how much is safe to spend this month',
    '- cash_needed: how much is owed on credit cards and by when',
    '- debt_payoff: when the user will be debt-free / how to pay off loans and debts at their current payments, with NO specific deadline (snowball vs avalanche)',
    '- debt_free_by_date: whether the user can be debt-free by a SPECIFIC date they name (e.g. "by December 2027", "in 3 years") and what extra payment it would take',
    '- savings_goal_by_date: whether the user can reach a SPECIFIC savings target by a date they name (e.g. "save $15,000 by December 2027", "set aside money for a down payment by 2028") and what monthly amount it would take',
    '- retire_at_age: whether the user can retire at a SPECIFIC age they name (e.g. "can I retire at 60?", "retire by age 67") and what monthly contribution it would take to make their money last',
    '- subscriptions: recurring subscriptions and their cost',
    '- forecast: projected cash balance / running out of money',
    '- savings_rate: percent of income saved',
    '- none: the question is NOT about the user\'s own personal finances (off-topic, chit-chat, advice, or unanswerable from their accounts) — use this rather than forcing a fit',
    `Question: ${question}`,
    'Respond with ONLY a JSON object, no prose: {"intent":"<one allowed intent, or none>"}.',
  ].join('\n');
}

/** Extract `intent` from a parsed model object (→ null if missing/unknown). */
export function parseIntentKind(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as Record<string, unknown>).intent;
  if (typeof v !== 'string') return null;
  return (LLM_ROUTABLE_KINDS as readonly string[]).includes(v) ? v : null;
}

/**
 * Turn a model-chosen kind into a fully-typed intent, with EVERY parameter
 * resolved deterministically from the original question. Returns null when the
 * kind is invalid or a category-scoped route has no resolvable target (the caller
 * then keeps the honest `unknown` answer rather than guessing).
 */
export function intentFromKind(kindRaw: string | null, question: string, today: ISODate): AssistantIntent | null {
  if (!kindRaw || !(LLM_ROUTABLE_KINDS as readonly string[]).includes(kindRaw)) return null;
  const kind = kindRaw as (typeof LLM_ROUTABLE_KINDS)[number];
  const timeframe = parseTimeframe(question, today);
  switch (kind) {
    case 'net_worth':
    case 'safe_to_spend':
    case 'cash_needed':
    case 'debt_payoff':
    case 'subscriptions':
    case 'forecast':
    case 'savings_rate':
      return { kind };
    case 'account_balance':
      return { kind, query: question.toLowerCase() };
    case 'spend_total':
      return { kind, timeframe };
    case 'income':
      return { kind, timeframe };
    case 'top_categories':
      return { kind, timeframe, limit: 5 };
    case 'largest_purchases':
      return { kind, timeframe, limit: 5 };
    case 'spend_by_category': {
      const target = resolveSpendTarget(question.toLowerCase());
      // #166 (critic F6): when the model says "category spend" but the category
      // can't be re-derived from the user's own words, the old spend_total
      // fallback re-created the exact hijack the deterministic parser now
      // abstains from ("spent at costco" -> the ALL-spending total). Honest
      // null (unknown) instead -- the model's kind is a hint, never a licence
      // to answer a different question.
      return target ? { kind, timeframe, target } : null;
    }
    case 'debt_free_by_date': {
      // The date is re-derived deterministically from the user's own words — the model
      // supplied only the KIND. No parseable date → fall back to the forward debt answer
      // rather than inventing a deadline.
      const target = parseTargetDate(question, today);
      return target ? { kind, targetDate: target.date, label: target.label } : { kind: 'debt_payoff' };
    }
    case 'savings_goal_by_date': {
      // Both the date AND the amount are re-derived deterministically from the user's own
      // words — the model supplied only the KIND, never a number. No parseable date → no goal
      // to plan, so fall back to unknown rather than inventing a deadline. A missing amount
      // stays null (the answer then asks for it).
      const target = parseTargetDate(question, today);
      return target ? { kind, targetDate: target.date, targetCents: parseTargetAmount(question), label: target.label } : null;
    }
    case 'retire_at_age': {
      // The age is re-derived deterministically from the user's own words — the model supplied
      // only the KIND, never the number. No stated age → keep `unknown` rather than guessing.
      const age = parseTargetAge(question);
      return age !== null ? { kind, targetAge: age, label: `age ${age}` } : null;
    }
    default:
      return null;
  }
}
