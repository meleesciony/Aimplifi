/**
 * Ask Aimplifi — runway intent (standing Coach room-for-error card).
 *
 * /coach already prints months of expenses in cash via `runwayTitle` +
 * `COACH_COPY.runway`. This slice routes "how many months of runway do I have?"
 * through Ask onto that SAME figure. No new month-count math. Copy does not
 * say "this card" or "below" — those claims are false in Ask.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  runwayFromQuestion,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerRunway } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { runwayTitle } from '@/lib/engine/fi/insights';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

describe('routing — runway', () => {
  it('test_regression__runway_how_many_months_routes_to_coach', () => {
    expect(kindOf('How many months of runway do I have?')).toBe('runway');
    expect(kindOf('how many months of runway do I have')).toBe('runway');
    expect(kindOf("what's my cash runway")).toBe('runway');
    expect(kindOf("what's my cash buffer")).toBe('runway');
    expect(kindOf("what's my room for error")).toBe('runway');
    expect(kindOf('how long would my cash last')).toBe('runway');
    expect(kindOf('do I have an emergency fund')).toBe('runway');
    expect(kindOf("what's my emergency fund coverage")).toBe('runway');
    expect(kindOf('how many months of expenses do I have in cash')).toBe('runway');
  });

  it('does not steal radar, forecast, FI, cuts, or savings rate', () => {
    expect(kindOf('will I run out of money in the next 90 days?')).toBe('cash_flow_radar');
    expect(kindOf("what's my cash flow forecast")).toBe('forecast');
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
  });
});

describe('abstentions — the majority', () => {
  it('a dated emergency-fund goal stays the inverse planner', () => {
    expect(kindOf('save $10,000 for an emergency fund by December 2027')).toBe(
      'savings_goal_by_date',
    );
    expect(runwayFromQuestion('save $10,000 for an emergency fund by December 2027', today)).toBeNull();
  });

  it('an amount is a different planner', () => {
    expect(kindOf('emergency fund $10,000')).not.toBe('runway');
    expect(runwayFromQuestion('how many months of runway $500', today)).toBeNull();
  });

  it('test_regression__runway_date_window_abstains', () => {
    expect(kindOf('how many months of runway last month')).toBe('unknown');
    expect(kindOf("what's my cash runway this month")).toBe('unknown');
    expect(kindOf('emergency fund coverage in 2025')).toBe('unknown');
    expect(runwayFromQuestion('how many months of runway last month', today)).toEqual({
      kind: 'unknown',
      question: 'how many months of runway last month',
    });
  });

  it('a named store or category is not the standing card', () => {
    expect(kindOf('how many months of runway at Costco')).toBe('unknown');
    expect(kindOf("what's my grocery runway")).toBe('unknown');
  });

  it('a goal to fund an emergency fund is not the standing coverage card', () => {
    expect(kindOf('I want to save for an emergency fund')).not.toBe('runway');
    expect(runwayFromQuestion('I want to save for an emergency fund', today)).toBeNull();
  });

  it('unrelated cash words do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('runway');
    expect(kindOf('how much cash do I need for my cards')).not.toBe('runway');
    expect(kindOf('how much did I spend last month')).not.toBe('runway');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'runway' })).toEqual({ kind: 'runway' });
    expect(validateIntent({ kind: 'runway', extra: true })).toEqual({ kind: 'runway' });
  });
});

describe('intentFromKind — the model picks a route, never a window', () => {
  it('re-derives from the words; a non-runway question tagged runway abstains', () => {
    expect(intentFromKind('runway', 'How many months of runway do I have?', today)).toEqual({
      kind: 'runway',
    });
    expect(intentFromKind('runway', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('runway', 'whatever', today)).toBeNull();
    expect(intentFromKind('runway', 'will I run out of money', today)).toBeNull();
  });
});

describe('answerRunway — phrases the coach card, originates no month count', () => {
  it('test_regression__runway_answer_agrees_with_coach_runway_card', () => {
    const a = answerRunway({ runwayMonths: 4.2, frozenCashNote: null });
    expect(a.kind).toBe('runway');
    expect(a.headline).toBe(runwayTitle(4.2));
    expect(a.headline).toBe('4.2 months');
    expect(a.detail).toBe(COACH_COPY.runway(4.2));
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.facts[0]).toEqual({ label: 'Room for error', value: '4.2 months' });
  });

  it('test_regression__runway_copy_does_not_claim_this_card_or_below', () => {
    for (const months of [4.2, -2.3, Infinity]) {
      const a = answerRunway({
        runwayMonths: months,
        frozenCashNote: 'Checking (…1234) last refreshed on 2026-05-01 — the cash side of this estimate.',
      });
      const blob = `${a.headline} ${a.detail ?? ''} ${a.facts.map((f) => f.value).join(' ')}`;
      expect(blob).not.toMatch(/this card/i);
      expect(blob).not.toMatch(/\bbelow\b/i);
    }
  });

  it('the three title states match the Coach card mapping, without page-position claims', () => {
    expect(answerRunway({ runwayMonths: 4.2, frozenCashNote: null }).headline).toBe('4.2 months');
    expect(answerRunway({ runwayMonths: -2.3, frozenCashNote: null }).headline).toBe('no cash buffer');
    expect(answerRunway({ runwayMonths: Infinity, frozenCashNote: null }).headline).toBe(
      'no expenses yet',
    );
  });

  it('appends the same frozen-cash note the Coach card prints', () => {
    const note = 'Checking last refreshed on 2026-05-01 — the cash side of this estimate.';
    const a = answerRunway({ runwayMonths: 4.2, frozenCashNote: note });
    expect(a.detail).toBe(`${COACH_COPY.runway(4.2)} ${note}`);
  });
});
