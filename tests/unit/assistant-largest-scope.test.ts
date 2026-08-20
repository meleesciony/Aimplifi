/**
 * TASKS 2.7(b) — `largest_purchases` earns a merchant scope (#230).
 *
 * STATUS §OPEN item 3, deferred from 2.6: "what was my biggest purchase at
 * costco?" answered the GLOBAL biggest purchase — the merchant silently
 * dropped, a true figure under a false question. The route now reads its
 * object like the spend family does: an at/with object becomes a merchant
 * scope through the SAME tokenizer and guards (#168 payment methods,
 * unreadable names), and an object the route cannot scope — a fronted store,
 * a category modifier, an unconsumed word — ABSTAINS instead of answering
 * everything. Enforced identically in the parser, `intentFromKind` (LLM +
 * vocab), the conversation frame, and validated on the client round-trip.
 *
 * TODAY = 2026-07-14.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { parseAssistantQuery, validateIntent } from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { frameFromIntent, resolveEllipsis } from '@/lib/engine/assistant/frame';
import { answerLargest, largestPurchases, type AskTxnRow } from '@/lib/engine/assistant/answer';

const TODAY = isoDate('2026-07-14');

describe('parser: merchant-scoped largest', () => {
  it('"biggest purchase at costco" scopes to the merchant', () => {
    expect(parseAssistantQuery('what was my biggest purchase at costco', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
      limit: 5,
    });
  });

  it('composes with a timeframe, including the new year windows', () => {
    expect(parseAssistantQuery('biggest purchase at costco last month', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
      timeframe: { fromYm: '2026-06', toYm: '2026-06' },
    });
    expect(parseAssistantQuery('largest purchases at costco in 2025', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
    expect(parseAssistantQuery('largest transactions with amazon', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'amazon',
    });
  });

  it('"from" is a merchant construction too (critic cycle 1, F2)', () => {
    expect(parseAssistantQuery('biggest purchase from costco', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
    });
    // …while "from <window>" names no store.
    expect(parseAssistantQuery('largest purchases from last month', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      timeframe: { fromYm: '2026-06', toYm: '2026-06' },
    });
  });

  it('unscoped questions stay global — no false abstain', () => {
    for (const q of [
      'what were my largest purchases',
      'biggest charges last month', // "charges" is also a fees synonym; must not category-abstain
      'what was my single largest expense in 2025',
      "what's the most expensive thing i bought this month",
      'my single biggest purchase this month', // benign intensifier
    ]) {
      const intent = parseAssistantQuery(q, TODAY);
      expect(intent.kind, q).toBe('largest_purchases');
      expect((intent as { merchant?: string }).merchant, q).toBeUndefined();
    }
  });

  it('test_regression__licensed_idioms_became_merchants (critic cycle 1, F1)', () => {
    // "at the moment" / "at the end of last month" extracted merchants
    // "moment" and "end of" and answered a factually false "No purchases at
    // Moment this month." where HEAD answered the correct global ranking.
    expect(parseAssistantQuery('what is my biggest purchase at the moment', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      timeframe: { fromYm: '2026-07', toYm: '2026-07' },
    });
    expect((parseAssistantQuery('what is my biggest purchase at the moment', TODAY) as { merchant?: string }).merchant).toBeUndefined();
    expect(parseAssistantQuery('biggest purchase at the end of last month', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      timeframe: { fromYm: '2026-06', toYm: '2026-06' },
    });
    // "at least $100" is a threshold we cannot represent — honest redirect,
    // never the merchant "least 100" and never the unfiltered global answer.
    expect(parseAssistantQuery('what was my biggest purchase at least $100', TODAY).kind).toBe('unknown');
    // A real store whose head word is licence vocabulary is still a store.
    expect(parseAssistantQuery('biggest purchase at best buy', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'best buy',
    });
  });

  it('test_regression__attributive_merchants_answered_the_global_ranking (critic cycle 1, F2)', () => {
    // "biggest costco purchase" carried no at/with object, resolved no
    // category, and ranked EVERYTHING — the wrong-scope disease this slice
    // exists to close. An unknown modifier now abstains.
    for (const q of [
      'what was my biggest costco purchase',
      'biggest walmart purchase this month',
      'biggest bank charges',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
      expect(intentFromKind('largest_purchases', q, TODAY), q).toBeNull();
    }
  });
});

// ── Abstentions: the majority. Every one of these answered the GLOBAL biggest
// purchase before this slice — the wrong-scope disease, unhedged.
describe('parser: abstentions', () => {
  it('a fronted store abstains (the honest redirect, mirroring the spend family)', () => {
    expect(parseAssistantQuery('At Costco, what was my biggest purchase?', TODAY).kind).toBe('unknown');
  });

  it('a payment method is not a merchant (#168)', () => {
    expect(parseAssistantQuery('biggest purchase with amex', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('biggest purchase with my credit card', TODAY).kind).toBe('unknown');
  });

  it('test_regression__account_words_became_merchants (critic cycle 2, N-1)', () => {
    // "from my checking account" minted the merchant "checking account" and
    // answered "No purchases at Checking Account this month." — the #168 class
    // (a payment SOURCE, not a store), re-opened by the new "from" anchor.
    expect(parseAssistantQuery('biggest purchase from my checking account', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('biggest payment from my bank account', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did i spend with my checking account', TODAY).kind).toBe('unknown');
  });

  it('"item" is a largest noun (critic cycle 2, N-3)', () => {
    expect(parseAssistantQuery('most expensive single item i bought this month', TODAY).kind).toBe('largest_purchases');
    expect(parseAssistantQuery('what was my biggest item last month', TODAY).kind).toBe('largest_purchases');
  });

  it('an unreadable store abstains', () => {
    expect(parseAssistantQuery('biggest purchase at 星巴克', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('biggest purchase at 🍕', TODAY).kind).toBe('unknown');
  });

  it('a category-modified largest abstains (no engine computes it)', () => {
    for (const q of [
      'biggest grocery purchase',
      'biggest food purchase last month',
      'what was my largest travel expense',
      'biggest purchase on groceries', // unconsumed "on" object
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('an unresolvable date shape abstains here too', () => {
    expect(parseAssistantQuery('biggest purchase in 2027', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('biggest purchase at costco on 13/5', TODAY).kind).toBe('unknown');
  });
});

describe('intentFromKind (LLM + vocab routes) enforces the same scope', () => {
  it('re-derives the merchant from the question', () => {
    expect(intentFromKind('largest_purchases', 'biggest purchase at costco', TODAY)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
    });
  });

  it('abstains where the parser abstains — no route re-answers a refused scope', () => {
    for (const q of [
      'At Costco, what was my biggest purchase?',
      'biggest purchase with amex',
      'biggest purchase at 星巴克',
      'biggest grocery purchase',
    ]) {
      expect(intentFromKind('largest_purchases', q, TODAY), q).toBeNull();
    }
  });
});

describe('validateIntent bounds the merchant a client can echo back', () => {
  const tf = { fromYm: '2026-07', toYm: '2026-07', label: 'this month' };

  it('round-trips a well-formed scoped intent, with and without merchant', () => {
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5, merchant: 'costco' })).toMatchObject({
      merchant: 'costco',
    });
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5 })).toMatchObject({
      kind: 'largest_purchases',
    });
  });

  it('rejects a malformed merchant instead of carrying it into copy', () => {
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5, merchant: '' })).toBeNull();
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5, merchant: '   ' })).toBeNull();
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5, merchant: 'x'.repeat(65) })).toBeNull();
    expect(validateIntent({ kind: 'largest_purchases', timeframe: tf, limit: 5, merchant: 42 })).toBeNull();
  });
});

describe('conversation frame', () => {
  const frameAfter = (q: string) => {
    const intent = parseAssistantQuery(q, TODAY);
    expect(intent.kind).toBe('largest_purchases');
    return frameFromIntent(intent);
  };

  it('a window swap CARRIES the merchant scope (never silently drops it)', () => {
    // The silent-drop lock: "biggest purchase at costco" → "what about last
    // month?" must stay Costco's biggest, not become the global biggest.
    const frame = frameAfter('biggest purchase at costco');
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
      timeframe: { fromYm: '2026-06', toYm: '2026-06' },
    });
  });

  it('a merchant fragment after largest re-scopes it (supersedes the P2-5 abstain)', () => {
    // #223 P2-5 abstained here because no engine computed it; this slice ships
    // that engine, so the fragment resolves — to the LARGEST intent, never to a
    // merchant TOTAL that silently changes the question.
    const frame = frameAfter('what was my biggest purchase this month?');
    expect(resolveEllipsis('what about at costco?', TODAY, frame)).toMatchObject({
      kind: 'largest_purchases',
      merchant: 'costco',
      limit: 5,
    });
  });

  it('still abstains on fragments largest cannot represent', () => {
    const frame = frameAfter('what was my biggest purchase this month?');
    expect(resolveEllipsis('what about groceries?', TODAY, frame)).toBeNull(); // category scope: no engine
    expect(resolveEllipsis('what about with amex?', TODAY, frame)).toBeNull(); // #168
  });
});

describe('answer engine: merchant-filtered ranking', () => {
  const rows: AskTxnRow[] = [
    { date: '2026-07-02', amountCents: -12000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-07-03', amountCents: -25000, categoryId: 'electronics', merchant: 'Best Buy', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-07-05', amountCents: -8000, categoryId: 'groceries', merchant: 'Costco Gas', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-07-08', amountCents: -30000, categoryId: 'travel', merchant: 'Delta', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
  ];
  const tf = { fromYm: '2026-07', toYm: '2026-07', label: 'this month' };

  it('scopes the ranking to merchantMatches semantics (exact, punctuation-folded)', () => {
    const top = largestPurchases(rows, tf, 5, '2026-07-14', undefined, 'costco');
    // O.10a: Costco Gas is a different store — only the warehouse row ranks.
    expect(top.map((t) => t.merchant)).toEqual(['Costco']);
    expect(top[0].amountCents).toBe(12000);
    expect(largestPurchases(rows, tf, 5, '2026-07-14', undefined, 'costco gas').map((t) => t.merchant)).toEqual([
      'Costco Gas',
    ]);
  });

  it('unscoped ranking is byte-identical to before (no merchant given)', () => {
    const top = largestPurchases(rows, tf, 5, '2026-07-14');
    expect(top[0].merchant).toBe('Delta');
    expect(top).toHaveLength(4);
  });

  it('the scoped headline names the store; the empty case stays honest', () => {
    const scoped = largestPurchases(rows, tf, 5, '2026-07-14', undefined, 'costco');
    expect(answerLargest(scoped, tf, 'costco').headline).toBe(
      'Your biggest purchase at Costco this month was $120.00.',
    );
    const none = largestPurchases(rows, tf, 5, '2026-07-14', undefined, 'target');
    expect(answerLargest(none, tf, 'target').headline).toBe('No purchases at Target this month.');
    // Unscoped copy unchanged.
    expect(answerLargest(largestPurchases(rows, tf, 5, '2026-07-14'), tf).headline).toBe(
      'Your biggest purchase this month was $300.00 at Delta.',
    );
  });
});
