/**
 * Ask Aimplifi — deterministic intent parser known-answer tests (DECISIONS #75).
 * Every expected intent is hand-written: the parser is pure and rule-based, so
 * these pin its routing decisions. TODAY = 2026-06-23 → this month 2026-06, last
 * month 2026-05, this year 2026-01..2026-06.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  parseTimeframe,
  resolveSpendTarget,
  validateIntent,
  type AssistantIntent,
} from '@/lib/engine/assistant/intent';

const TODAY = isoDate('2026-06-23');
const kindOf = (q: string) => parseAssistantQuery(q, TODAY).kind;

describe('parseAssistantQuery — routing', () => {
  const cases: [string, AssistantIntent['kind']][] = [
    // net worth
    ["What's my net worth?", 'net_worth'],
    ['show me my networth', 'net_worth'],
    // savings rate (beats the generic "savings" account match)
    ["what's my savings rate?", 'savings_rate'],
    ['how much of my income do I save', 'savings_rate'],
    // subscriptions
    ['what subscriptions am I paying for?', 'subscriptions'],
    ['list my recurring payments', 'subscriptions'],
    ['how much do I spend on recurring charges', 'subscriptions'],
    // forecast
    ['will I run out of money in the next 90 days?', 'forecast'],
    ["what's my cash flow forecast", 'forecast'],
    ['am I going to go negative', 'forecast'],
    // cash needed
    ['how much do I need to pay my cards?', 'cash_needed'],
    ['what do I owe on my credit cards', 'cash_needed'],
    ['when is my credit card payment due', 'cash_needed'],
    ['how much to pay off my cards this cycle', 'cash_needed'],
    // safe to spend (present/conditional, with adverbs)
    ['how much can I safely spend this month?', 'safe_to_spend'],
    ["what's safe to spend right now", 'safe_to_spend'],
    ['can I afford to spend more this week', 'safe_to_spend'],
    ['how much do I have left to spend', 'safe_to_spend'],
    // largest purchases
    ['what was my biggest purchase this month?', 'largest_purchases'],
    ['show my most expensive transactions last month', 'largest_purchases'],
    ["what's the largest thing I bought", 'largest_purchases'],
    // income
    ['how much did I make last month?', 'income'],
    ['how much have I earned this year', 'income'],
    ['what was my income in May', 'income'],
    // spend total / by category / top
    ['how much did I spend last month', 'spend_total'],
    ['how much did I spend on groceries last month?', 'spend_by_category'],
    ['how much did I spend on dining out this month', 'spend_by_category'],
    ['how much do I spend on coffee', 'spend_by_category'],
    ['how much did I spend on food in May', 'spend_by_category'],
    ['what did I spend the most on this month', 'top_categories'],
    ['what are my top spending categories', 'top_categories'],
    ['where does my money go', 'top_categories'],
    // account balance
    ["what's my checking balance?", 'account_balance'],
    ['how much is in my savings account', 'account_balance'],
    // unknown
    ["what's the weather", 'unknown'],
    ['tell me a joke', 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('routes %j → %s', (q, expected) => {
    expect(kindOf(q)).toBe(expected);
  });
});

describe('parseAssistantQuery — extracted params', () => {
  it('resolves category + timeframe together', () => {
    const i = parseAssistantQuery('how much did I spend on groceries last month?', TODAY);
    expect(i).toEqual({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
  });

  it('maps "food" to the whole Food & Dining group', () => {
    const i = parseAssistantQuery('how much did I spend on food this month', TODAY);
    expect(i.kind).toBe('spend_by_category');
    if (i.kind === 'spend_by_category') expect(i.target).toEqual({ type: 'group', group: 'Food & Dining', label: 'food & dining' });
  });
});

describe('parseTimeframe', () => {
  it('this month / last month / this year', () => {
    expect(parseTimeframe('this month', TODAY)).toEqual({ fromYm: '2026-06', toYm: '2026-06', label: 'this month' });
    expect(parseTimeframe('last month', TODAY)).toEqual({ fromYm: '2026-05', toYm: '2026-05', label: 'last month' });
    expect(parseTimeframe('this year', TODAY)).toEqual({ fromYm: '2026-01', toYm: '2026-06', label: '2026 so far' });
  });
  it('named month resolves to the most recent past occurrence', () => {
    expect(parseTimeframe('in May', TODAY)).toEqual({ fromYm: '2026-05', toYm: '2026-05', label: 'May 2026' });
    // August hasn't happened yet in June 2026 → last year's August
    expect(parseTimeframe('in August', TODAY)).toEqual({ fromYm: '2025-08', toYm: '2025-08', label: 'August 2025' });
  });
  it('explicit year wins', () => {
    expect(parseTimeframe('in March 2024', TODAY)).toEqual({ fromYm: '2024-03', toYm: '2024-03', label: 'March 2024' });
  });
  it('trailing N months', () => {
    expect(parseTimeframe('the last 3 months', TODAY)).toEqual({ fromYm: '2026-04', toYm: '2026-06', label: 'the last 3 months' });
  });
  it('defaults to this month', () => {
    expect(parseTimeframe('blah', TODAY)).toEqual({ fromYm: '2026-06', toYm: '2026-06', label: 'this month' });
  });
});

describe('resolveSpendTarget', () => {
  it('leaf categories beat their group', () => {
    expect(resolveSpendTarget('groceries')).toEqual({ type: 'category', categoryId: 'groceries', label: 'Groceries' });
    expect(resolveSpendTarget('gas')).toEqual({ type: 'category', categoryId: 'fuel', label: 'Fuel' });
    expect(resolveSpendTarget('coffee')).toEqual({ type: 'category', categoryId: 'coffee', label: 'Coffee Shops' });
  });
  it('broad words map to groups', () => {
    expect(resolveSpendTarget('travel')).toEqual({ type: 'group', group: 'Travel', label: 'travel' });
  });
  // #154 critic P1: "gas bill"/"natural gas" is the UTILITY, not gasoline — the
  // synonym must beat the bare `gas`→fuel rule instead of being shadowed dead.
  it('gas bill / natural gas resolve to the natural-gas utility, not fuel', () => {
    expect(resolveSpendTarget('natural gas')).toEqual({ type: 'category', categoryId: 'natural-gas', label: 'Natural Gas' });
    expect(resolveSpendTarget('my gas bill')).toEqual({ type: 'category', categoryId: 'natural-gas', label: 'Natural Gas' });
    expect(resolveSpendTarget('gas')).toEqual({ type: 'category', categoryId: 'fuel', label: 'Fuel' }); // bare "gas" still fuel
    expect(resolveSpendTarget('electricity')).toEqual({ type: 'category', categoryId: 'electricity', label: 'Electricity' });
  });
  // #154 critic P2: "utilities" is an umbrella that must SUM the split-out leaves,
  // else the total silently under-reports. phone/internet/insurance stay excluded.
  it('the "utilities" umbrella sums the whole utility family', () => {
    expect(resolveSpendTarget('how much on utilities')).toEqual({
      type: 'categories',
      categoryIds: ['utilities', 'electricity', 'natural-gas', 'water', 'trash'],
      label: 'utilities',
    });
  });
  it('returns null for non-spend text', () => {
    expect(resolveSpendTarget('what is my net worth')).toBeNull();
  });
});

describe('validateIntent (zod-substitute gate)', () => {
  it('accepts well-formed intents', () => {
    expect(validateIntent({ kind: 'net_worth' })).toEqual({ kind: 'net_worth' });
    expect(
      validateIntent({
        kind: 'spend_by_category',
        timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
        target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
      }),
    ).not.toBeNull();
  });
  it('rejects malformed / hallucinated intents', () => {
    expect(validateIntent(null)).toBeNull();
    expect(validateIntent({ kind: 'drop_table' })).toBeNull();
    expect(validateIntent({ kind: 'spend_by_category', timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'x' }, target: { type: 'category', categoryId: 'NOT_A_CATEGORY', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total', timeframe: { fromYm: 'bad', toYm: '2026-05', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total' })).toBeNull(); // missing timeframe
  });
});
