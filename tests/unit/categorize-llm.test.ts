import { describe, expect, it } from 'vitest';
import {
  buildCategorizePrompt,
  parseLlmCategory,
  pickAssistedCategory,
} from '@/lib/engine/categorize/llm';

describe('parseLlmCategory — schema validation (DECISIONS #38)', () => {
  it('accepts a valid {categoryId, confidence} and converts to bps', () => {
    expect(parseLlmCategory({ categoryId: 'dining', confidence: 0.9 })).toEqual({
      categoryId: 'dining',
      confidenceBps: 9000,
    });
  });

  it('rejects unknown / placeholder category ids', () => {
    expect(parseLlmCategory({ categoryId: 'not-a-category', confidence: 0.9 })).toBeNull();
    expect(parseLlmCategory({ categoryId: 'uncategorized', confidence: 0.9 })).toBeNull();
  });

  it('caps confidence at the user-rule ceiling (9900) — 10000 is reserved for user-dictated (critic P0-1)', () => {
    // An LLM confidence of 1.0 would round to 10000 and collide with the
    // "you set this" sentinel — dropped from the prediction log and shown as a
    // human fact. It must cap at 9900 so it stays logged and labeled 'llm'.
    expect(parseLlmCategory({ categoryId: 'dining', confidence: 1 })).toEqual({
      categoryId: 'dining',
      confidenceBps: 9900,
    });
    // 0.99996 also rounds to 10000 without the cap.
    expect(parseLlmCategory({ categoryId: 'dining', confidence: 0.99996 })?.confidenceBps).toBe(9900);
  });

  it('rejects missing or out-of-range confidence, and non-objects', () => {
    expect(parseLlmCategory({ categoryId: 'dining' })).toBeNull();
    expect(parseLlmCategory({ categoryId: 'dining', confidence: 1.5 })).toBeNull();
    expect(parseLlmCategory({ categoryId: 'dining', confidence: -0.1 })).toBeNull();
    expect(parseLlmCategory({ categoryId: 'dining', confidence: 'high' })).toBeNull();
    expect(parseLlmCategory(null)).toBeNull();
    expect(parseLlmCategory('dining')).toBeNull();
  });
});

describe('buildCategorizePrompt', () => {
  it('includes the descriptor, amount, and the allowed category ids', () => {
    const p = buildCategorizePrompt({ rawDescriptor: 'SQ *BLUE BOTTLE', amountCents: -742 });
    expect(p).toContain('SQ *BLUE BOTTLE');
    expect(p).toContain('7.42');
    expect(p).toContain('dining');
    expect(p).toContain('JSON');
  });
});

describe('pickAssistedCategory — LLM only assists when deterministic is unsure (DECISIONS #38)', () => {
  const confidentLlm = { categoryId: 'software', confidenceBps: 9200 };

  it('never overrides a CONFIDENT deterministic result', () => {
    const det = { categoryId: 'groceries', confidenceBps: 9500, needsReview: false };
    expect(pickAssistedCategory(det, confidentLlm)).toEqual({
      categoryId: 'groceries',
      confidenceBps: 9500,
      source: 'deterministic',
    });
  });

  it('uses the LLM pick when deterministic was unsure AND the LLM is confident', () => {
    const det = { categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true };
    expect(pickAssistedCategory(det, confidentLlm)).toEqual({
      categoryId: 'software',
      confidenceBps: 9200,
      source: 'llm',
    });
  });

  it('keeps the deterministic result when the LLM is absent (no key) or itself unsure', () => {
    const det = { categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true };
    expect(pickAssistedCategory(det, null).source).toBe('deterministic');
    expect(pickAssistedCategory(det, { categoryId: 'software', confidenceBps: 5000 }).source).toBe(
      'deterministic',
    );
  });
});
