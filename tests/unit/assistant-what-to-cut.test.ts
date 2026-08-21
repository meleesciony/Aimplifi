/**
 * Ask Aimplifi — what_to_cut intent (P.1 first slice).
 *
 * /coach already ranks findOpportunities. This slice routes "what should I
 * cut?" through Ask onto that SAME list. No FI / radar re-projection — a cut
 * that invents a date movement is the rest of P.1, not this slice.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import {
  parseAssistantQuery,
  validateIntent,
  whatToCutFromQuestion,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerWhatToCut } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { findOpportunities } from '@/lib/engine/fi/insights';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { buildSeedData } from '@/lib/seed/build';
import type { Opportunity } from '@/lib/engine/fi/insights';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const seed = buildSeedData('2026-06-10');
const series = detectRecurring(
  seed.transactions.filter((t) => t.status === 'POSTED'),
  today,
  NO_RECURRING_OVERRIDES,
);
const seedOpportunities = findOpportunities(series, 700, 250, []);
const dials = { returnIsDefault: true, inflationIsDefault: true };

function answerFrom(ops: readonly Opportunity[], moneyDials: readonly string[] = []) {
  return answerWhatToCut({
    opportunities: ops,
    moneyDials,
    expectedReturnBps: 700,
    inflationBps: 250,
    dialOwnership: dials,
  });
}

describe('routing — what_to_cut', () => {
  it('test_regression__p1_what_should_i_cut_routes_to_opportunities', () => {
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('what should I cut')).toBe('what_to_cut');
    expect(kindOf('where can I save money')).toBe('what_to_cut');
    expect(kindOf('how can I spend less')).toBe('what_to_cut');
    expect(kindOf('help me cut spending')).toBe('what_to_cut');
    expect(kindOf('what subscriptions should I cut')).toBe('what_to_cut');
    expect(kindOf('biggest savings opportunity')).toBe('what_to_cut');
    expect(kindOf("where is my money going that I don't need")).toBe('what_to_cut');
  });

  it('does not steal the subscription roster, savings rate, or wealth target', () => {
    expect(kindOf('what subscriptions am I paying for?')).toBe('subscriptions');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
    expect(kindOf('if I want to save up to 10 mil what do I need to do?')).toBe('wealth_target');
    expect(kindOf('how much did I spend last month')).toBe('spend_total');
    expect(kindOf('will I run out of money in the next 90 days?')).toBe('cash_flow_radar');
  });
});

describe('abstentions — the majority', () => {
  it('a named store is not the global list', () => {
    expect(kindOf('what should I cut at Netflix')).toBe('unknown');
    expect(kindOf('where can I save with Costco')).toBe('unknown');
    expect(whatToCutFromQuestion('what should I cut at Netflix', today)).toEqual({
      kind: 'unknown',
      question: 'what should I cut at Netflix',
    });
  });

  it('a named category is not the global list (and must not fall through to another money answer)', () => {
    expect(kindOf('what should I cut on groceries')).toBe('unknown');
    expect(kindOf('how can I spend less on dining')).toBe('unknown');
  });

  it('an amount or date is a different planner', () => {
    expect(kindOf('where can I save 10 mil')).not.toBe('what_to_cut');
    expect(kindOf('how can I save $500 a month')).not.toBe('what_to_cut');
  });

  it('test_regression__p1_cut_with_a_date_window_abstains', () => {
    // The opportunities list is not a calendar ranking. A dated cut question
    // must not answer the standing list, and must not fall through to spend.
    expect(kindOf('what should I cut last month')).toBe('unknown');
    expect(kindOf('what should I cut this month')).toBe('unknown');
    expect(kindOf('where can I save money in 2025')).toBe('unknown');
    expect(whatToCutFromQuestion('what should I cut last month', today)).toEqual({
      kind: 'unknown',
      question: 'what should I cut last month',
    });
  });

  it('haircut / cut-the-grass / bare save do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('what_to_cut');
    expect(kindOf('cut the grass')).not.toBe('what_to_cut');
    expect(kindOf('how can I save')).not.toBe('what_to_cut');
    expect(kindOf('where should I save')).not.toBe('what_to_cut');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'what_to_cut' })).toEqual({ kind: 'what_to_cut' });
    expect(validateIntent({ kind: 'what_to_cut', extra: true })).toEqual({ kind: 'what_to_cut' });
  });
});

describe('intentFromKind — the model picks a route, never a list', () => {
  it('re-derives from the words; a non-cut question tagged what_to_cut abstains', () => {
    expect(intentFromKind('what_to_cut', 'What should I cut?', today)).toEqual({
      kind: 'what_to_cut',
    });
    expect(intentFromKind('what_to_cut', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('what_to_cut', 'whatever', today)).toBeNull();
  });

  it('a model that tagged a cut question as subscriptions still owes the cut route', () => {
    expect(intentFromKind('subscriptions', 'what subscriptions should I cut', today)).toEqual({
      kind: 'what_to_cut',
    });
    expect(intentFromKind('subscriptions', 'what subscriptions am I paying for?', today)).toEqual({
      kind: 'subscriptions',
    });
  });
});

describe('answerWhatToCut — phrases the coach list, originates no figure', () => {
  it('test_regression__p1_cut_answer_agrees_with_coach_opportunities', () => {
    expect(seedOpportunities[0]?.merchant).toBe('LA Fitness');
    expect(seedOpportunities[0]?.monthlyCents).toBe(3499);
    const a = answerFrom(seedOpportunities);
    expect(a.kind).toBe('what_to_cut');
    expect(a.headline).toContain('LA Fitness');
    expect(a.headline).toContain(formatCents(cents(3499)));
    expect(a.headline).toMatch(/places to look/);
    expect(a.facts[0]).toEqual({ label: 'LA Fitness', value: `${formatCents(cents(3499))}/mo` });
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.detail).toContain(COACH_COPY.biggestLever());
    expect(a.detail).toContain(
      COACH_COPY.opportunity(seedOpportunities[0]!, 700),
    );
    expect(a.detail).toContain(COACH_COPY.opportunityBasis(700, 250, dials));
  });

  it('test_regression__p1_cut_does_not_invent_fi_movement', () => {
    const a = answerFrom(seedOpportunities);
    const blob = `${a.headline} ${a.detail ?? ''}`;
    expect(blob).not.toMatch(/FI date|years to FI|weeks sooner|moves your FI|retire .*sooner/i);
  });

  it('empty list matches the coach empty sentence', () => {
    const a = answerFrom([]);
    expect(a.headline).toBe(
      'Nothing to flag right now — check back after a few more weeks of spending data.',
    );
    expect(a.facts).toEqual([]);
    expect(a.detail).toBeUndefined();
  });

  it('protects money dials with the same sentence /coach prints', () => {
    const a = answerFrom(seedOpportunities, ['Travel', 'Dining Out']);
    expect(a.detail).toContain(COACH_COPY.moneyDials(['Travel', 'Dining Out']));
  });

  it('test_regression__w6a_ask_cut_list_omits_a_money_dial_merchant', () => {
    const protectedGym = findOpportunities(series, 700, 250, ['fitness']);
    const a = answerFrom(protectedGym, ['Fitness']);
    expect(a.headline).not.toContain('LA Fitness');
    expect(a.facts.some((f) => f.label === 'LA Fitness')).toBe(false);
    expect(a.detail).toContain(COACH_COPY.moneyDials(['Fitness']));
  });

  it('labels estimates the same way /coach does', () => {
    const est = seedOpportunities.find((o) => o.isEstimate);
    expect(est).toBeTruthy();
    const a = answerFrom(seedOpportunities);
    expect(a.facts.some((f) => f.label === est!.merchant && f.value.includes('est.'))).toBe(true);
  });

  it('caps visible rows at 5 and names the remainder from the same array', () => {
    const many: Opportunity[] = Array.from({ length: 6 }, (_, i) => ({
      kind: 'unused-subscription',
      merchant: `Shop ${i + 1}`,
      monthlyCents: cents(1000 * (6 - i)),
      todayValue10Cents: cents(0),
      todayValue20Cents: cents(0),
      todayValue30Cents: cents(0),
      isEstimate: false,
    }));
    const a = answerFrom(many);
    expect(a.headline).toContain('Shop 1');
    expect(a.facts).toHaveLength(6);
    expect(a.facts[5]?.label).toMatch(/1 more/);
    expect(a.facts[5]?.value).toBe(`${formatCents(cents(1000))}/mo`);
  });
});
