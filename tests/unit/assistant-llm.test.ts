/**
 * Ask Aimplifi — LLM routing helpers (DECISIONS #75). The model may only pick a
 * KIND; every parameter is re-derived deterministically from the user's words, so
 * a hallucinated category/timeframe/number can never reach data. These tests pin
 * that contract.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildIntentPrompt, intentFromKind, parseIntentKind } from '@/lib/engine/assistant/llm';

const TODAY = isoDate('2026-06-23');

describe('buildIntentPrompt', () => {
  it('embeds the question and demands JSON only', () => {
    const p = buildIntentPrompt('how much did I spend on coffee');
    expect(p).toContain('how much did I spend on coffee');
    expect(p).toMatch(/ONLY a JSON object/i);
    expect(p).toContain('spend_by_category');
  });
});

describe('parseIntentKind', () => {
  it('accepts a routable kind', () => {
    expect(parseIntentKind({ intent: 'net_worth' })).toBe('net_worth');
  });
  it('rejects unknown, none (abstention), non-routable, and malformed', () => {
    expect(parseIntentKind({ intent: 'unknown' })).toBeNull(); // not routable
    expect(parseIntentKind({ intent: 'none' })).toBeNull(); // model abstained → deterministic unknown
    expect(parseIntentKind({ intent: 'drop_table' })).toBeNull();
    expect(parseIntentKind({})).toBeNull();
    expect(parseIntentKind(null)).toBeNull();
    expect(parseIntentKind('net_worth')).toBeNull();
  });
});

describe('intentFromKind — params come from the question, not the model', () => {
  it('parameterless kinds', () => {
    expect(intentFromKind('net_worth', 'whatever', TODAY)).toEqual({ kind: 'net_worth' });
  });
  it('re-derives timeframe + category deterministically', () => {
    expect(intentFromKind('spend_by_category', 'how much on groceries last month', TODAY)).toEqual({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
  });
  it('category route with no resolvable target returns null — never a total (#166 critic F6)', () => {
    // The old spend_total fallback re-created the hijack the deterministic
    // parser abstains from: with an LLM key set, "spent at costco" escalated
    // to the model, came back spend_by_category, failed to resolve, and was
    // answered with the ALL-spending total anyway. Honest unknown instead.
    expect(intentFromKind('spend_by_category', 'how much did I spend at costco', TODAY)).toBeNull();
  });
  it('rejects a null / non-routable kind', () => {
    expect(intentFromKind(null, 'x', TODAY)).toBeNull();
    expect(intentFromKind('unknown', 'x', TODAY)).toBeNull();
  });
});
