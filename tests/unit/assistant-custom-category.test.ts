/**
 * Assistant custom-category awareness (DECISIONS #111). The deterministic parser
 * matches a user's custom category by name ("spend on Golf"), validation accepts
 * its id only when the user actually owns it, and the largest-purchases answer
 * resolves its name via the merged meta. Without a custom list, every path is
 * byte-identical to before (the assistant-intent/grounding goldens stay green).
 */
import { describe, expect, it } from 'vitest';
import {
  parseAssistantQuery,
  resolveSpendTarget,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { largestPurchases } from '@/lib/engine/assistant/answer';
import { mergeCategoryMeta } from '@/lib/engine/categorize/categories';
import { isoDate } from '@/lib/dates';

const TODAY = isoDate('2026-06-15');
const GOLF = { id: 'cust_golf', name: 'Golf', group: 'Entertainment', discretionary: true };

describe('parser custom-category matching', () => {
  it('routes "spend on golf" to the custom category when the user owns it', () => {
    const intent = parseAssistantQuery('how much did I spend on golf this month', TODAY, [GOLF]);
    expect(intent.kind).toBe('spend_by_category');
    if (intent.kind === 'spend_by_category') {
      expect(intent.target).toEqual({ type: 'category', categoryId: 'cust_golf', label: 'Golf' });
    }
  });

  it('without the custom list, the same question ABSTAINS (#166 — never answer the total for an unresolved target)', () => {
    // Pre-#166 this returned spend_total: a confident all-spending headline for a
    // question about golf specifically — the audit's "answers a different
    // question" P1. Unknown → the honest redirect with suggestions.
    const intent = parseAssistantQuery('how much did I spend on golf this month', TODAY);
    expect(intent.kind).toBe('unknown');
  });

  it('a system synonym still wins over a custom name', () => {
    // user names a custom "Food" — the built-in groceries/food mapping must win
    const t = resolveSpendTarget('how much on groceries', [{ id: 'cust_food', name: 'Food' }]);
    expect(t).toEqual({ type: 'category', categoryId: 'groceries', label: 'Groceries' });
  });

  it('longest custom name wins ("golf club" beats "golf")', () => {
    const t = resolveSpendTarget('spent at the golf club', [
      { id: 'a', name: 'Golf' },
      { id: 'b', name: 'Golf Club' },
    ]);
    expect(t?.type).toBe('category');
    expect(t && t.type === 'category' && t.categoryId).toBe('b');
  });
});

describe('validateIntent custom-id gating', () => {
  const proposed = {
    kind: 'spend_by_category',
    timeframe: { fromYm: '2026-06', toYm: '2026-06', label: 'this month' },
    target: { type: 'category', categoryId: 'cust_golf', label: 'Golf' },
  };
  it('rejects a custom id the user does not own', () => {
    expect(validateIntent(proposed)).toBeNull();
  });
  it('accepts a custom id the user owns', () => {
    expect(validateIntent(proposed, [GOLF])).not.toBeNull();
  });
});

describe('largestPurchases resolves custom names via meta', () => {
  const rows = [
    { date: '2026-06-10', amountCents: -9000, categoryId: 'cust_golf', merchant: 'Bear Creek GC', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
  ];
  const tf = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
  it('shows the custom name with the merged meta', () => {
    const out = largestPurchases(rows, tf, 5, TODAY, mergeCategoryMeta([GOLF]));
    expect(out[0].categoryName).toBe('Golf');
  });
  it('falls back to Uncategorized with the static default', () => {
    const out = largestPurchases(rows, tf, 5, TODAY);
    expect(out[0].categoryName).toBe('Uncategorized');
  });
});
