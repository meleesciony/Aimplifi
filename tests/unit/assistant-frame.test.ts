/**
 * Conversation frame — deterministic ellipsis resolution (TASKS 2.1).
 *
 * Every case is hand-verified: the frame carries the previous turn's slots, the
 * fragment names ONE of them, and the rebuilt intent is the same question with
 * that slot swapped. The abstention cases matter as much as the resolutions —
 * the frame must never invent a question the user did not ask.
 */
import { describe, it, expect } from 'vitest';
import { isoDate } from '@/lib/dates';
import { frameFromIntent, resolveEllipsis, type AskFrame } from '@/lib/engine/assistant/frame';
import {
  parseAssistantQuery,
  validateIntent,
  type AssistantIntent,
} from '@/lib/engine/assistant/intent';

const TODAY = isoDate('2026-06-15');
const THIS_MONTH = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

/** The frame a real question would leave behind (parser → frame, no hand-built state). */
function frameAfter(question: string): AskFrame | null {
  return frameFromIntent(parseAssistantQuery(question, TODAY));
}

describe('frameFromIntent', () => {
  it('carries exactly the slots the intent has', () => {
    expect(frameAfter('how much did I spend this month?')).toEqual({
      kind: 'spend_total',
      timeframe: THIS_MONTH,
    });
    expect(frameAfter('how much did I spend on groceries last month?')).toEqual({
      kind: 'spend_by_category',
      timeframe: LAST_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
    expect(frameAfter('how much did I spend at costco this month?')).toEqual({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'costco',
    });
    expect(frameAfter('what were my top spending categories this month?')).toMatchObject({
      kind: 'top_categories',
      timeframe: THIS_MONTH,
      limit: 5,
    });
    expect(frameAfter('what is my net worth?')).toEqual({ kind: 'net_worth' });
  });

  it('leaves NO frame behind for unknown (nothing to follow up on)', () => {
    expect(frameFromIntent({ kind: 'unknown', question: 'blah' })).toBeNull();
  });

  it('clamps a merchant name a client could echo back oversized', () => {
    const frame = frameFromIntent({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'x'.repeat(500),
    });
    expect(frame?.merchant).toHaveLength(64);
  });
});

describe('resolveEllipsis — timeframe swap', () => {
  it('"what about last month?" re-runs the spend total in the new window', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toEqual({
      kind: 'spend_total',
      timeframe: LAST_MONTH,
    });
  });

  it('keeps the CATEGORY while swapping the window', () => {
    const frame = frameAfter('how much did I spend on groceries this month?');
    expect(resolveEllipsis('and last month?', TODAY, frame)).toEqual({
      kind: 'spend_by_category',
      timeframe: LAST_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
  });

  it('keeps the MERCHANT while swapping the window', () => {
    const frame = frameAfter('how much did I spend at costco this month?');
    expect(resolveEllipsis('how about last month', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: LAST_MONTH,
      merchant: 'costco',
    });
  });

  it('keeps the LIMIT of a top-categories question', () => {
    const frame = frameAfter('what were my top spending categories this month?');
    expect(frame?.limit).toBe(5); // the parser's fixed ranking size
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toEqual({
      kind: 'top_categories',
      timeframe: LAST_MONTH,
      limit: 5,
    });
  });

  it('resolves a bare fragment with no cue word ("last month?")', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(resolveEllipsis('last month?', TODAY, frame)).toEqual({
      kind: 'spend_total',
      timeframe: LAST_MONTH,
    });
  });

  it('resolves a named month ("what about in March?")', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(resolveEllipsis('what about in march?', TODAY, frame)).toEqual({
      kind: 'spend_total',
      timeframe: { fromYm: '2026-03', toYm: '2026-03', label: 'March 2026' },
    });
  });

  it('swaps the window of an income question', () => {
    const frame = frameAfter('how much did I make this month?');
    expect(frame?.kind).toBe('income');
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toEqual({
      kind: 'income',
      timeframe: LAST_MONTH,
    });
  });
});

describe('resolveEllipsis — category / merchant swap', () => {
  it('"and groceries?" narrows a spend total to a category, keeping the window', () => {
    const frame = frameAfter('how much did I spend last month?');
    expect(resolveEllipsis('and groceries?', TODAY, frame)).toEqual({
      kind: 'spend_by_category',
      timeframe: LAST_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
  });

  it('swaps ONE category for another, keeping the window', () => {
    const frame = frameAfter('how much did I spend on groceries last month?');
    expect(resolveEllipsis('what about restaurants?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: LAST_MONTH,
    });
  });

  it('"what about at costco?" swaps a category question to a merchant question', () => {
    const frame = frameAfter('how much did I spend on groceries last month?');
    expect(resolveEllipsis('what about at costco?', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: LAST_MONTH,
      merchant: 'costco',
    });
  });

  it('swaps BOTH slots when the fragment names both', () => {
    const frame = frameAfter('how much did I spend on groceries this month?');
    expect(resolveEllipsis('what about restaurants in march?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2026-03', toYm: '2026-03', label: 'March 2026' },
    });
  });

  it('a merchant fragment after a merchant question swaps the merchant', () => {
    const frame = frameAfter('how much did I spend at costco this month?');
    expect(resolveEllipsis('same for trader joes', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'trader joes',
    });
  });

  it('resolves a custom category by name', () => {
    const custom = [{ id: 'cus_1', name: 'Golf' }];
    const frame = frameFromIntent(
      parseAssistantQuery('how much did I spend last month?', TODAY, custom),
    );
    expect(resolveEllipsis('what about golf?', TODAY, frame, custom)).toEqual({
      kind: 'spend_by_category',
      timeframe: LAST_MONTH,
      target: { type: 'category', categoryId: 'cus_1', label: 'Golf' },
    });
  });
});

describe('resolveEllipsis — abstention (the frame never invents a question)', () => {
  it('abstains with no frame — the first question of a session is unchanged', () => {
    expect(resolveEllipsis('what about last month?', TODAY, null)).toBeNull();
    expect(resolveEllipsis('what about last month?', TODAY, undefined)).toBeNull();
  });

  it('abstains when the fragment names no slot at all', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(resolveEllipsis('why is that so high?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about it?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('', TODAY, frame)).toBeNull();
  });

  it('abstains on a long question — an ellipsis is a FRAGMENT, not a sentence', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(
      resolveEllipsis(
        'what about the money I moved between my savings and checking last month',
        TODAY,
        frame,
      ),
    ).toBeNull();
  });

  it('abstains on a timeframe swap for an intent that has no window', () => {
    const frame = frameAfter('what is my net worth?');
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toBeNull();
  });

  it('abstains on a category swap for a non-spending question', () => {
    expect(resolveEllipsis('what about groceries?', TODAY, frameAfter('what is my net worth?'))).toBeNull();
    // Income has a window, but no per-category answer exists.
    expect(
      resolveEllipsis('what about groceries?', TODAY, frameAfter('how much did I make this month?')),
    ).toBeNull();
  });

  it('abstains on a PAYMENT METHOD — "same for Amex" is not a merchant (#168)', () => {
    const frame = frameAfter('how much did I spend at costco this month?');
    expect(resolveEllipsis('same for amex', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about my card?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about average?', TODAY, frame)).toBeNull();
  });
});

/**
 * Hostile-critic regressions (TASKS 2.1, cycle 1). Each of these ANSWERED a
 * question the user did not ask before the fix; each fails on the old code.
 */
describe('regression — hostile critic cycle 1', () => {
  it('P1-1: a timeframe-first fragment keeps the merchant it names', () => {
    // Old: "at costco" sat behind the timeframe, the merchant tokenizer never saw
    // it, and the frame carried the OLD category → a confident grocery figure.
    const frame = frameAfter('how much did I spend on groceries this month?');
    expect(resolveEllipsis('and this month at costco?', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'costco',
    });
    expect(resolveEllipsis('last month at costco?', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: LAST_MONTH,
      merchant: 'costco',
    });
  });

  it('P1-2: a NEGATED fragment abstains — never answers the rejected category', () => {
    // Old: synonym order (groceries before dining) answered GROCERIES here.
    const frame = frameAfter('how much did I spend on groceries this month?');
    expect(resolveEllipsis('restaurants not groceries', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('no, restaurants not groceries', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('everything except groceries', TODAY, frame)).toBeNull();
    // ...but a leading "no," is a CORRECTION cue, not a negation.
    expect(resolveEllipsis('no, restaurants?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
    });
  });

  it("P1-3: the assistant's own vocabulary is not a merchant", () => {
    // Old: "what about income?" → merchant_spend("income") → "No spending at
    // Income this month." — and it stole the question from the LLM classifier.
    const frame = frameAfter('how much did I spend this month?');
    for (const q of ['what about income?', 'what about my paycheck?', 'what about refunds?']) {
      expect(resolveEllipsis(q, TODAY, frame), q).toBeNull();
    }
  });

  it('P2-4: a WHY / SHOULD / comparison question is not a slot swap', () => {
    const frame = frameAfter('how much did I spend this month?');
    for (const q of [
      'why so much on dining?',
      'should i cut back on dining?',
      'groceries vs restaurants?',
      'is that more than last month?',
    ]) {
      expect(resolveEllipsis(q, TODAY, frame), q).toBeNull();
    }
  });

  it('P2-5: a merchant fragment after "biggest purchase" abstains (no engine answers it)', () => {
    const frame = frameAfter('what was my biggest purchase this month?');
    expect(frame?.kind).toBe('largest_purchases');
    expect(resolveEllipsis('what about at costco?', TODAY, frame)).toBeNull();
    // The timeframe swap — which IS answerable — still works.
    expect(resolveEllipsis('what about last month?', TODAY, frame)).toMatchObject({
      kind: 'largest_purchases',
      timeframe: LAST_MONTH,
    });
  });

  it('P2-6: validateIntent bounds the fields a client-echoed frame can carry', () => {
    expect(validateIntent({ kind: 'spend_total', timeframe: { fromYm: '2026-13', toYm: '2026-13', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total', timeframe: { fromYm: '1900-01', toYm: '9999-99', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total', timeframe: { ...THIS_MONTH, label: 'X'.repeat(200) } })).toBeNull();
    expect(validateIntent({ kind: 'merchant_spend', timeframe: THIS_MONTH, merchant: 'x'.repeat(100_000) })).toBeNull();
    // A real one still passes.
    expect(validateIntent({ kind: 'merchant_spend', timeframe: THIS_MONTH, merchant: 'costco' })).toEqual({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'costco',
    });
  });

  it('P2-7: a carried deictic window is re-labelled across a month boundary', () => {
    // Framed on June 15 ("this month" = 2026-06); asked again on July 1.
    const frame = frameAfter('how much did I spend on groceries this month?');
    const july = isoDate('2026-07-01');
    expect(resolveEllipsis('what about restaurants?', july, frame)).toMatchObject({
      // The WINDOW is unchanged (2026-06) — only the lie in its name is fixed.
      timeframe: { fromYm: '2026-06', toYm: '2026-06', label: 'last month' },
    });
    const august = isoDate('2026-08-03');
    expect(resolveEllipsis('what about restaurants?', august, frame)).toMatchObject({
      timeframe: { fromYm: '2026-06', toYm: '2026-06', label: 'June 2026' },
    });
    // Same month: the label was true and stays verbatim.
    expect(resolveEllipsis('what about restaurants?', TODAY, frame)).toMatchObject({
      timeframe: THIS_MONTH,
    });
  });
});

/** Cycle 2 of the same critic: the fixes held (0 P0/P1), and it found these. */
describe('regression — hostile critic cycle 2', () => {
  it('P2-B: a target label is DERIVED from its identity, never trusted from the client', () => {
    // A forged frame labelled the TRAVEL group "Groceries" — a true figure under a
    // false name in the headline. The label is now re-derived from the group/id.
    const forged = {
      kind: 'spend_by_category',
      timeframe: THIS_MONTH,
      target: { type: 'group', group: 'Travel', label: 'Groceries' },
    };
    const out = validateIntent(forged);
    expect(out).toMatchObject({ kind: 'spend_by_category' });
    expect((out as { target: { label: string } }).target.label).not.toBe('Groceries');

    // Same for a leaf category: the client's label is ignored, the canonical name wins.
    const relabelled = validateIntent({
      kind: 'spend_by_category',
      timeframe: THIS_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Travel' },
    });
    expect((relabelled as { target: { label: string } }).target.label).toBe('Groceries');

    // An over-long label is rejected outright, not truncated into the copy.
    expect(
      validateIntent({
        kind: 'spend_by_category',
        timeframe: THIS_MONTH,
        target: { type: 'category', categoryId: 'groceries', label: 'A'.repeat(331) },
      }),
    ).toBeNull();
  });

  it('P2-B: a custom category keeps its OWN name (derived from the user\'s list)', () => {
    const out = validateIntent(
      {
        kind: 'spend_by_category',
        timeframe: THIS_MONTH,
        target: { type: 'category', categoryId: 'cus_1', label: 'Groceries' },
      },
      [{ id: 'cus_1', name: 'Golf' }],
    );
    expect((out as { target: { label: string } }).target.label).toBe('Golf');
  });

  it('P2-A: a stray "at" in a fragment does not manufacture a merchant', () => {
    const frame = frameAfter('how much did I spend this month?');
    expect(resolveEllipsis('and last month at least?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about at work?', TODAY, frame)).toBeNull();
  });

  it('P3-C: a store whose name contains an ordinary word still resolves', () => {
    const frame = frameAfter('how much did I spend at costco this month?');
    expect(resolveEllipsis('and at save mart?', TODAY, frame)).toEqual({
      kind: 'merchant_spend',
      timeframe: THIS_MONTH,
      merchant: 'save mart',
    });
  });

  it('P3-D: a carried TRAILING window is re-named once today leaves it', () => {
    const frame = frameAfter('how much did I spend in the last 3 months?');
    expect(frame?.timeframe).toMatchObject({ fromYm: '2026-04', toYm: '2026-06' });
    // Same month: the label was true when asked, and still is.
    expect(resolveEllipsis('what about groceries?', TODAY, frame)).toMatchObject({
      timeframe: { label: 'the last 3 months' },
    });
    // September: the window is still Apr–Jun, so "the last 3 months" is now a lie.
    expect(resolveEllipsis('what about groceries?', isoDate('2026-09-02'), frame)).toMatchObject({
      timeframe: { fromYm: '2026-04', toYm: '2026-06', label: 'April 2026 – June 2026' },
    });
  });
});

describe('the frame is only consulted on a parser-unknown (no hijacking)', () => {
  // The server calls resolveEllipsis ONLY when parseAssistantQuery returns unknown.
  // These questions route on their own, so the frame can never touch them.
  const selfSufficient = [
    'what is my net worth?',
    'how much can I safely spend this month?',
    'how much did I spend on groceries last month?',
    'when will I be debt-free?',
  ];
  it.each(selfSufficient)('%s parses without a frame', (q) => {
    expect(parseAssistantQuery(q, TODAY).kind).not.toBe('unknown');
  });

  it('the ellipsis fragments themselves ARE parser-unknown (so the frame is reached)', () => {
    for (const q of ['what about last month?', 'and groceries?', 'same for trader joes']) {
      expect(parseAssistantQuery(q, TODAY).kind).toBe('unknown');
    }
  });
});

describe('a client-supplied frame is validated like any untrusted input', () => {
  // The client echoes the previous intent back; the server gates it with the same
  // validateIntent the LLM's proposals go through, THEN builds the frame.
  const gate = (x: unknown): AskFrame | null => {
    const valid: AssistantIntent | null = validateIntent(x);
    return valid ? frameFromIntent(valid) : null;
  };

  it('rejects junk, a hallucinated kind, and a foreign category id', () => {
    expect(gate({ kind: 'spend_by_category', timeframe: THIS_MONTH, target: { type: 'category', categoryId: 'not_a_category', label: 'x' } })).toBeNull();
    expect(gate({ kind: 'wire_me_money' })).toBeNull();
    expect(gate('nonsense')).toBeNull();
    expect(gate(null)).toBeNull();
  });

  it('rejects a broken window on the MONTH alone (not just on a junk label)', () => {
    // Each field is bad in isolation, so no case can pass for the wrong reason.
    expect(gate({ kind: 'spend_total', timeframe: { fromYm: '2026-13', toYm: '2026-13', label: 'x' } })).toBeNull();
    expect(gate({ kind: 'spend_total', timeframe: { fromYm: '2026-00', toYm: '2026-00', label: 'x' } })).toBeNull();
    expect(gate({ kind: 'spend_total', timeframe: { fromYm: 'zzzz-zz', toYm: 'zzzz-zz', label: 'x' } })).toBeNull();
    expect(gate({ kind: 'spend_total', timeframe: { ...THIS_MONTH, label: 42 } })).toBeNull();
    // A backwards window (to < from) is not a window.
    expect(gate({ kind: 'spend_total', timeframe: { fromYm: '2026-06', toYm: '2026-05', label: 'x' } })).toBeNull();
  });

  it('a custom category DELETED between turns no longer validates (the frame degrades to none)', () => {
    const prior = {
      kind: 'spend_by_category',
      timeframe: THIS_MONTH,
      target: { type: 'category', categoryId: 'cus_gone', label: 'Golf' },
    };
    // Turn 1: the category existed (the server passes the user's real list, names included).
    expect(frameFromIntent(validateIntent(prior, [{ id: 'cus_gone', name: 'Golf' }])!)).toMatchObject({
      kind: 'spend_by_category',
    });
    // Turn 2: the user deleted it — the echoed frame is rejected, not resurrected.
    expect(validateIntent(prior, [])).toBeNull();
  });

  it('accepts a well-formed prior intent and rebuilds its frame', () => {
    expect(gate({ kind: 'spend_total', timeframe: LAST_MONTH })).toEqual({
      kind: 'spend_total',
      timeframe: LAST_MONTH,
    });
  });
});

describe('test_regression__frame_abstains_on_unreadable_names (#226 cycle 3)', () => {
  // The frame consumed the parser's merchant TOKENIZER but never its unreadable-object
  // GUARD, so both halves of the parser's cardinal-sin bug lived on here.
  it('does not mangle a store it cannot read into a confident-wrong merchant', () => {
    const frame = frameAfter('how much did I spend at Costco last month?');
    // Was: merchant_spend "caf zurich" → "No spending at caf zurich last month."
    expect(resolveEllipsis('what about at café zurich?', TODAY, frame)).toBeNull();
  });

  it('does not silently DROP an unreadable store and answer the CARRIED one', () => {
    const frame = frameAfter('how much did I spend at Costco last month?');
    // Was: merchant_spend COSTCO, last month — the previous store's total, under a
    // question about a different shop the user just named. A true figure, a false question.
    expect(resolveEllipsis('what about at 星巴克 last month?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about 星巴克?', TODAY, frame)).toBeNull();
  });

  it('still resolves every readable fragment (the guard refuses only NAME content)', () => {
    const frame = frameAfter('how much did I spend at Costco last month?');
    expect(resolveEllipsis('what about at mcdonald’s?', TODAY, frame)).toMatchObject({
      kind: 'merchant_spend',
      merchant: "mcdonald's",
    });
    expect(resolveEllipsis('what about this month? 🎉', TODAY, frame)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
      timeframe: THIS_MONTH,
    });
  });
});
