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
import { formatCents, type Cents } from '@/lib/money';
import {
  type AssistantIntent,
  ASSISTANT_INTENT_KINDS,
  containsUnreadableName,
  largestScope,
  parseTargetAge,
  parseTargetAmount,
  parseExplicitTimeframe,
  parseTargetDate,
  parseTimeframe,
  resolveSpendTarget,
  unconsumedSpendObject,
  unresolvedDateShape,
  whatToCutFromQuestion,
  fiStatusFromQuestion,
  lifestyleCreepFromQuestion,
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
    '- safe_to_spend: how much is guilt-free (safe) to spend this month',
    '- cash_needed: how much is owed on credit cards and by when',
    '- debt_payoff: when the user will be debt-free / how to pay off loans and debts at their current payments, with NO specific deadline (snowball vs avalanche)',
    '- debt_free_by_date: whether the user can be debt-free by a SPECIFIC date they name (e.g. "by December 2027", "in 3 years") and what extra payment it would take',
    '- savings_goal_by_date: whether the user can reach a SPECIFIC savings target by a date they name (e.g. "save $15,000 by December 2027", "set aside money for a down payment by 2028") and what monthly amount it would take',
    '- retire_at_age: whether the user can retire at a SPECIFIC age they name (e.g. "can I retire at 60?", "retire by age 67") and what monthly contribution it would take to make their money last',
    '- fi_status: standing financial-independence date and FI number from the Coach FI card — "when can I retire?", "when will I be FI?", "what\'s my FI number", "am I saving enough for retirement". Never a named age (that is retire_at_age), never an amount or date',
    '- wealth_target: a stated nest-egg / wealth number with NO deadline (e.g. "save up to 10 mil", "I want $10M", "what do I need to do to get to ten million") — when they would arrive at the current pace and what monthly contribution a horizon would take. If they name a date, use savings_goal_by_date instead',
    '- subscriptions: recurring subscriptions and their cost (the list of what they pay, NOT which to cut)',
    '- what_to_cut: where to look for big-win cuts (unused gym, price increases, negotiable bills) — "what should I cut?", "where can I save money", "help me cut spending". Never a named store or category, never an amount or date (those are other intents). Does NOT move an FI date',
    '- lifestyle_creep: whether discretionary spending is outpacing income (Coach lifestyle-creep card) — "is my lifestyle creeping?", "lifestyle inflation", "is my spending outpacing my income". Never a named store or category, never an amount or date. Not subscription price increases (that is what_to_cut)',
    '- cash_flow_radar: will the payment account run out of money / go negative / overdraft in the next 90 days (committed flows + card dues — same as Cash flow radar)',
    '- forecast: projected cash balance from recurring income and bills only (NOT card payments; use cash_flow_radar for running out of money)',
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
export function intentFromKind(
  kindRaw: string | null,
  question: string,
  today: ISODate,
  custom: readonly { id: string; name: string }[] = [],
): AssistantIntent | null {
  if (!kindRaw || !(LLM_ROUTABLE_KINDS as readonly string[]).includes(kindRaw)) return null;
  // The parser abstains on a question naming an object it cannot read ("how much did I
  // spend at 星巴克") specifically to hand it to the model — but the model's only
  // expressible reading of a store-scoped spend question is `spend_total`
  // (`merchant_spend` is not in its closed set), and that would answer the user's ENTIRE
  // spending for a question about one shop. Every parameter below is re-derived from
  // these same unreadable words, so nothing here can be grounded: abstain (#226 cycle 4).
  // The F6 precedent, generalized — a kind is a hint, never a licence to answer a
  // different question.
  if (containsUnreadableName(question)) return null;
  const kind = kindRaw as (typeof LLM_ROUTABLE_KINDS)[number];
  const timeframe = parseTimeframe(question, today);
  // A date SHAPE the parser could not window ("in 2027", "on 13/5") abstains
  // every timeframe-carrying kind here exactly as it does in the parser
  // (TASKS 2.7) — otherwise `parseTimeframe`'s this-month default would answer
  // a window the user never named, through the very route that exists to
  // rescue what the parser abstained on. The goal kinds (debt_free_by_date,
  // savings_goal_by_date) are exempt: "by 2028" is a legitimate FUTURE
  // deadline, re-derived by their own parseTargetDate.
  const badDateShape = unresolvedDateShape(question, today);
  switch (kind) {
    case 'net_worth':
    case 'safe_to_spend':
    case 'cash_needed':
    case 'debt_payoff':
    case 'cash_flow_radar':
    case 'forecast':
    case 'savings_rate':
      return { kind };
    case 'subscriptions': {
      // A model that tagged a cut question as the roster still owes the cut
      // route — the kind is a hint. "What subscriptions am I paying for?"
      // stays subscriptions. A scoped cut ("on groceries") abstains rather
      // than answering the roster.
      const cut = whatToCutFromQuestion(question, today, custom);
      if (cut?.kind === 'what_to_cut') return cut;
      if (cut?.kind === 'unknown') return null;
      return { kind };
    }
    case 'what_to_cut': {
      const cut = whatToCutFromQuestion(question, today, custom);
      return cut?.kind === 'what_to_cut' ? cut : null;
    }
    case 'lifestyle_creep': {
      const creep = lifestyleCreepFromQuestion(question, today, custom);
      return creep?.kind === 'lifestyle_creep' ? creep : null;
    }
    case 'account_balance':
      return { kind, query: question.toLowerCase() };
    case 'spend_total':
      // The same POSITIVE LICENCE the parser's sink requires (TASKS 2.6): the
      // parser abstained on "At Costco, how much did I spend?" precisely because
      // the total does not answer a one-store question — and the model's closed
      // set has no `merchant_spend`, so its only expressible reading of that
      // question IS the total. A kind is a hint, never a licence to answer a
      // different question (the F6 precedent): an unconsumed at/with/on object
      // anywhere in the question keeps the honest unknown.
      return badDateShape || unconsumedSpendObject(question, today) ? null : { kind, timeframe };
    case 'income':
      return badDateShape ? null : { kind, timeframe };
    case 'top_categories':
      return badDateShape ? null : { kind, timeframe, limit: 5 };
    case 'largest_purchases': {
      // The same scope discipline as the parser's route (TASKS 2.7): the
      // merchant is re-derived from the user's own words; a scope the ranking
      // cannot represent abstains — the model's kind is a hint, never a
      // licence to answer the GLOBAL ranking for a scoped question.
      if (badDateShape) return null;
      const scope = largestScope(question, today, custom);
      return scope
        ? { kind, timeframe, limit: 5, ...(scope.merchant ? { merchant: scope.merchant } : {}) }
        : null;
    }
    case 'spend_by_category': {
      if (badDateShape) return null;
      const target = resolveSpendTarget(question.toLowerCase(), custom);
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
      // words — the model supplied only the KIND, never a number. No parseable date → if they
      // still named an amount, that is the W.4 wealth-target question, not a deadline we invent.
      // A missing amount stays null on the dated path (the answer then asks for it).
      const target = parseTargetDate(question, today);
      if (target) {
        return { kind, targetDate: target.date, targetCents: parseTargetAmount(question), label: target.label };
      }
      const amount = parseTargetAmount(question);
      return amount !== null
        ? { kind: 'wealth_target', targetCents: amount, label: formatCents(amount as Cents) }
        : null;
    }
    case 'retire_at_age': {
      // The age is re-derived deterministically from the user's own words — the model supplied
      // only the KIND, never the number. No stated age → the standing FI card if the
      // words ask it, otherwise unknown rather than guessing an age.
      const age = parseTargetAge(question);
      if (age !== null) return { kind, targetAge: age, label: `age ${age}` };
      const standing = fiStatusFromQuestion(question, today, custom);
      return standing?.kind === 'fi_status' ? standing : null;
    }
    case 'fi_status': {
      // A named age is the inverse planner — the kind is a hint, never a licence
      // to answer the unaged card under an age the user named.
      const age = parseTargetAge(question);
      if (age !== null) return { kind: 'retire_at_age', targetAge: age, label: `age ${age}` };
      const standing = fiStatusFromQuestion(question, today, custom);
      return standing?.kind === 'fi_status' ? standing : null;
    }
    case 'wealth_target': {
      // Amount re-derived from the user's words. A parseable deadline is the dated sibling
      // (linear /goals model) — do not answer the compounding planner under a date they named.
      const dated = parseTargetDate(question, today);
      const amount = parseTargetAmount(question);
      if (dated) {
        return {
          kind: 'savings_goal_by_date',
          targetDate: dated.date,
          targetCents: amount,
          label: dated.label,
        };
      }
      if (
        amount === null ||
        unresolvedDateShape(question, today) ||
        parseExplicitTimeframe(question, today) !== null
      ) {
        return null;
      }
      return { kind, targetCents: amount, label: formatCents(amount as Cents) };
    }
    default:
      return null;
  }
}
