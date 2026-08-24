/**
 * Contextual Ask follow-up chips (TASKS 1.2 / DECISIONS #197).
 * Every chip is a full NL string the existing parser already routes — no new parsing.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { followUpQuestions } from '@/lib/engine/assistant/follow-ups';
import {
  ASSISTANT_INTENT_KINDS,
  parseAssistantQuery,
  type AssistantIntent,
  type Timeframe,
} from '@/lib/engine/assistant/intent';

const TODAY = isoDate('2026-06-10');
const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

function sampleIntent(kind: (typeof ASSISTANT_INTENT_KINDS)[number]): AssistantIntent {
  switch (kind) {
    case 'unknown':
      return { kind: 'unknown', question: 'hello' };
    case 'net_worth':
    case 'safe_to_spend':
    case 'cash_needed':
    case 'debt_payoff':
    case 'subscriptions':
    case 'what_to_cut':
    case 'lifestyle_creep':
    case 'runway':
    case 'rich_life':
    case 'conscious_spending':
    case 'stay_wealthy':
    case 'next_dollar':
    case 'forecast':
    case 'cash_flow_radar':
    case 'savings_rate':
      return { kind };
    case 'account_balance':
      return { kind, query: 'checking' };
    case 'spend_total':
      return { kind, timeframe: THIS_MONTH };
    case 'spend_by_category':
      return {
        kind,
        timeframe: THIS_MONTH,
        target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
      };
    case 'merchant_spend':
      return { kind, timeframe: LAST_MONTH, merchant: 'costco' };
    case 'top_categories':
    case 'largest_purchases':
      return { kind, timeframe: THIS_MONTH, limit: 5 };
    case 'income':
      return { kind, timeframe: THIS_MONTH };
    case 'debt_free_by_date':
      return { kind, targetDate: isoDate('2028-12-31'), label: 'December 2028' };
    case 'savings_goal_by_date':
      return {
        kind,
        targetDate: isoDate('2028-12-31'),
        targetCents: 2_000_000,
        label: 'December 2028',
      };
    case 'retire_at_age':
      return { kind, targetAge: 60, label: 'age 60' };
    case 'fi_status':
      return { kind };
    case 'wealth_target':
      return { kind, targetCents: 1_000_000_000, label: '$10,000,000.00' };
  }
}

describe('followUpQuestions', () => {
  it('returns [] for unknown (answerUnknown owns the capabilities list)', () => {
    expect(followUpQuestions({ kind: 'unknown', question: 'xyz' })).toEqual([]);
  });

  it('returns 2–3 chips for every non-unknown kind', () => {
    for (const kind of ASSISTANT_INTENT_KINDS) {
      if (kind === 'unknown') continue;
      const chips = followUpQuestions(sampleIntent(kind));
      expect(chips.length, kind).toBeGreaterThanOrEqual(2);
      expect(chips.length, kind).toBeLessThanOrEqual(3);
      for (const q of chips) {
        expect(q.trim().length, `${kind}: ${q}`).toBeGreaterThan(5);
      }
    }
  });

  it('interpolates category / merchant and flips this↔last month', () => {
    const cat = followUpQuestions({
      kind: 'spend_by_category',
      timeframe: THIS_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
    expect(cat[0]).toMatch(/Groceries/);
    expect(cat[0]).toMatch(/last month/);

    const merch = followUpQuestions({
      kind: 'merchant_spend',
      timeframe: LAST_MONTH,
      merchant: 'costco',
    });
    expect(merch[0]).toMatch(/Costco/);
    expect(merch[0]).toMatch(/this month/);
  });

  it('every chip parses to a non-unknown intent via the existing parser', () => {
    for (const kind of ASSISTANT_INTENT_KINDS) {
      if (kind === 'unknown') continue;
      for (const q of followUpQuestions(sampleIntent(kind))) {
        const parsed = parseAssistantQuery(q, TODAY);
        expect(parsed.kind, `chip "${q}" from ${kind}`).not.toBe('unknown');
      }
    }
  });
});
