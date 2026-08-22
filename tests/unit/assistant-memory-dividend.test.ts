/**
 * Ask Aimplifi — memory_dividend intent (Coach life-energy reflection).
 *
 * /coach already composes the line via `composeMemoryDividend`. This slice
 * routes "who notices what I buy?" onto that SAME row. No new money math.
 * Copy does not say "this card" or "below".
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  memoryDividendFromQuestion,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerMemoryDividend } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { composeMemoryDividend } from '@/lib/engine/fi/memory-dividend';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

describe('routing — memory_dividend', () => {
  it('test_regression__memory_dividend_who_notices_routes_to_coach', () => {
    expect(kindOf('Who notices what I buy?')).toBe('memory_dividend');
    expect(kindOf('who notices')).toBe('memory_dividend');
    expect(kindOf("what's a memory dividend")).toBe('memory_dividend');
    expect(kindOf('memory dividend')).toBe('memory_dividend');
    expect(kindOf('if it was meant to impress')).toBe('memory_dividend');
    expect(kindOf('nobody notices the thing')).toBe('memory_dividend');
    expect(kindOf('no one notices')).toBe('memory_dividend');
  });

  it('does not steal largest purchases, cuts, or buckets', () => {
    expect(kindOf('What was my biggest purchase this month?')).toBe('largest_purchases');
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('How are my spending buckets?')).toBe('conscious_spending');
  });
});

describe('abstentions — the majority', () => {
  it('an amount declines so other planners can match', () => {
    expect(kindOf('memory dividend $10,000')).not.toBe('memory_dividend');
    expect(memoryDividendFromQuestion('who notices $500', today)).toBeNull();
  });

  it('test_regression__memory_dividend_date_window_abstains', () => {
    expect(kindOf('who notices last month')).toBe('unknown');
    expect(kindOf('memory dividend this month')).toBe('unknown');
    expect(kindOf('who notices in 2025')).toBe('unknown');
    expect(memoryDividendFromQuestion('who notices last month', today)).toEqual({
      kind: 'unknown',
      question: 'who notices last month',
    });
  });

  it('a named store or category is unknown', () => {
    expect(kindOf('who notices at Costco')).toBe('unknown');
    expect(kindOf('memory dividend on groceries')).toBe('unknown');
    expect(kindOf('I got a haircut')).not.toBe('memory_dividend');
  });

  it('validateIntent accepts the bare kind', () => {
    expect(validateIntent({ kind: 'memory_dividend' })).toEqual({ kind: 'memory_dividend' });
    expect(validateIntent({ kind: 'memory_dividend', extra: true })).toEqual({
      kind: 'memory_dividend',
    });
  });
});

describe('intentFromKind — the kind is a hint', () => {
  it('re-derives from the words; a non-memory-dividend question tagged memory_dividend abstains', () => {
    expect(intentFromKind('memory_dividend', 'Who notices what I buy?', today)).toEqual({
      kind: 'memory_dividend',
    });
    expect(intentFromKind('memory_dividend', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('memory_dividend', 'whatever', today)).toBeNull();
    expect(intentFromKind('memory_dividend', 'What was my biggest purchase this month?', today)).toBeNull();
  });
});

describe('answer — same compose as Coach', () => {
  it('test_regression__memory_dividend_answer_agrees_with_coach_row', () => {
    const row = composeMemoryDividend({
      items: [{ categoryId: 'shopping' }],
      moneyDialIds: ['travel', 'dining'],
      meta: CATEGORY_BY_ID,
    });
    const a = answerMemoryDividend(row);
    expect(a.kind).toBe('memory_dividend');
    expect(a.headline).toBe(row.line);
    expect(a.headline).toBe(COACH_COPY.memoryDividend());
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
  });

  it('silent states still phrase the compose line, never a page position', () => {
    const empty = answerMemoryDividend(
      composeMemoryDividend({ items: [], moneyDialIds: [], meta: CATEGORY_BY_ID }),
    );
    expect(empty.headline).toBe(COACH_COPY.memoryDividendEmpty());

    const silent = answerMemoryDividend(
      composeMemoryDividend({
        items: [{ categoryId: 'rent' }],
        moneyDialIds: [],
        meta: CATEGORY_BY_ID,
      }),
    );
    expect(silent.headline).toBe(COACH_COPY.memoryDividendNotApplicable());
  });

  it('test_regression__memory_dividend_copy_does_not_claim_this_card_or_below', () => {
    const a = answerMemoryDividend(
      composeMemoryDividend({
        items: [{ categoryId: 'shopping' }],
        moneyDialIds: [],
        meta: CATEGORY_BY_ID,
      }),
    );
    expect(a.headline).not.toMatch(/\bthis card\b/i);
    expect(a.headline).not.toMatch(/\bbelow\b/i);
    expect(`${a.detail ?? ''}`).not.toMatch(/\bthis card\b/i);
    expect(`${a.detail ?? ''}`).not.toMatch(/\bbelow\b/i);
  });
});
