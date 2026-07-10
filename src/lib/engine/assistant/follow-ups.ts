/**
 * Contextual follow-up chips for Ask answers (TASKS 1.2 / DECISIONS #197).
 *
 * Pure, static intent → full NL question strings. No new parsing: every chip is
 * a complete question the existing `parseAssistantQuery` already routes. The UI
 * re-submits via the same `pick()` → `askAssistant()` path as empty-state chips.
 *
 * `unknown` returns [] — the answer formatter already attaches ASSISTANT_SUGGESTIONS.
 */
import type { AssistantIntent } from '@/lib/engine/assistant/intent';

const MAX_CHIPS = 3;

function flipTimeframeLabel(label: string): string {
  if (label === 'this month') return 'last month';
  if (label === 'last month') return 'this month';
  return 'this month';
}

/** Up to three follow-up question strings for a resolved intent. */
export function followUpQuestions(intent: AssistantIntent): readonly string[] {
  switch (intent.kind) {
    case 'unknown':
      return [];

    case 'spend_total': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      return take([
        `How much did I spend ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'spend_by_category': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      return take([
        `How much did I spend on ${intent.target.label} ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'merchant_spend': {
      const other = flipTimeframeLabel(intent.timeframe.label);
      // Title-case the cleaned merchant for a natural chip (parser is case-insensitive).
      const merchant = titleCase(intent.merchant);
      return take([
        `How much did I spend at ${merchant} ${other}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
      ]);
    }

    case 'top_categories':
      return take([
        `How much did I spend ${intent.timeframe.label}?`,
        `What was my biggest purchase ${intent.timeframe.label}?`,
        'How much did I spend on groceries this month?',
      ]);

    case 'largest_purchases':
      return take([
        `How much did I spend ${intent.timeframe.label}?`,
        `What were my top spending categories ${intent.timeframe.label}?`,
        'How much did I spend at Costco this month?',
      ]);

    case 'income':
      return take([
        "What's my savings rate?",
        'How much did I spend this month?',
        'What is my net worth?',
      ]);

    case 'net_worth':
      return take([
        'How much did I spend this month?',
        "What's my savings rate?",
        'How much can I safely spend this month?',
      ]);

    case 'account_balance':
      return take([
        'What is my net worth?',
        'How much can I safely spend this month?',
        'How much do I need to pay my cards?',
      ]);

    case 'safe_to_spend':
      return take([
        'How much did I spend this month?',
        'What were my top spending categories this month?',
        'What is my net worth?',
      ]);

    case 'cash_needed':
      return take([
        'Will I run out of money in the next 90 days?',
        'How much can I safely spend this month?',
        'When will I be debt-free?',
      ]);

    case 'debt_payoff':
      return take([
        'Can I be debt-free by December 2028?',
        'How much do I need to pay my cards?',
        'What is my net worth?',
      ]);

    case 'debt_free_by_date':
      return take([
        'When will I be debt-free?',
        'How much can I safely spend this month?',
        'What is my net worth?',
      ]);

    case 'savings_goal_by_date':
      return take([
        intent.targetCents == null
          ? 'Can I save $20,000 by December 2028?'
          : "What's my savings rate?",
        'How much can I safely spend this month?',
        'What is my net worth?',
      ]);

    case 'retire_at_age':
      return take([
        'Can I retire at 60?',
        "What's my savings rate?",
        'What is my net worth?',
      ]);

    case 'subscriptions':
      return take([
        'How much did I spend this month?',
        'How much can I safely spend this month?',
        'Will I run out of money in the next 90 days?',
      ]);

    case 'forecast':
      return take([
        'How much do I need to pay my cards?',
        'How much can I safely spend this month?',
        'What subscriptions am I paying for?',
      ]);

    case 'savings_rate':
      return take([
        'How much did I spend this month?',
        'What is my net worth?',
        'How much can I safely spend this month?',
      ]);
  }
}

function take(chips: string[]): readonly string[] {
  return chips.slice(0, MAX_CHIPS);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
