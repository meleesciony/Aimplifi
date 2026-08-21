/**
 * Ask Aimplifi — lifestyle_creep intent (standing Coach lifestyle-creep card).
 *
 * /coach already prints discretionary-vs-income via `COACH_COPY.creepCard`.
 * This slice routes "is my lifestyle creeping?" through Ask onto that SAME
 * verdict. No new growth math. Copy does not say "this card" or "below" —
 * those claims are false in Ask.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import {
  lifestyleCreepFromQuestion,
  parseAssistantQuery,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerLifestyleCreep } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { CreepResult } from '@/lib/engine/fi/insights';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const flagged: CreepResult = {
  flagged: true,
  spendGrowthBps: 1240,
  incomeGrowthBps: 10,
  incomeMeasured: true,
  spendMeasured: true,
  incomeBaselineCents: cents(500_000),
  discretionaryBaselineCents: cents(120_000),
  monthlyDiscretionaryCents: [],
  windowMonths: 6,
  loanPaymentsExcluded: false,
};
const clear: CreepResult = { ...flagged, flagged: false, spendGrowthBps: 20 };
const notComparable: CreepResult = {
  ...flagged,
  flagged: false,
  incomeMeasured: false,
  incomeBaselineCents: cents(8),
};

describe('routing — lifestyle_creep', () => {
  it('test_regression__lifestyle_creep_is_my_lifestyle_creeping_routes_to_coach', () => {
    expect(kindOf('Is my lifestyle creeping?')).toBe('lifestyle_creep');
    expect(kindOf('is my lifestyle creeping')).toBe('lifestyle_creep');
    expect(kindOf('am I experiencing lifestyle creep?')).toBe('lifestyle_creep');
    expect(kindOf('has lifestyle inflation set in')).toBe('lifestyle_creep');
    expect(kindOf('is my spending outpacing my income')).toBe('lifestyle_creep');
    expect(kindOf('is my discretionary spending going up')).toBe('lifestyle_creep');
  });

  it('does not steal cuts, FI, income, or spend totals', () => {
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf("what's my income")).toBe('income');
    expect(kindOf('how much did I spend last month')).toBe('spend_total');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
  });
});

describe('abstentions — the majority', () => {
  it('subscription price-increase language stays the cut list, not this card', () => {
    expect(kindOf('what subscriptions should I cut')).toBe('what_to_cut');
    expect(kindOf('is there price creep on my subscriptions')).not.toBe('lifestyle_creep');
    expect(lifestyleCreepFromQuestion('is there price creep on my subscriptions', today)).toBeNull();
  });

  it('an amount is a different planner', () => {
    expect(kindOf('is my lifestyle creeping $500')).not.toBe('lifestyle_creep');
    expect(lifestyleCreepFromQuestion('is my lifestyle creeping $500', today)).toBeNull();
  });

  it('test_regression__lifestyle_creep_date_window_abstains', () => {
    expect(kindOf('is my lifestyle creeping last month')).toBe('unknown');
    expect(kindOf('is my lifestyle creeping this month')).toBe('unknown');
    expect(kindOf('lifestyle inflation in 2025')).toBe('unknown');
    expect(lifestyleCreepFromQuestion('is my lifestyle creeping last month', today)).toEqual({
      kind: 'unknown',
      question: 'is my lifestyle creeping last month',
    });
  });

  it('a named store or category is not the standing card', () => {
    expect(kindOf('is my lifestyle creeping at Costco')).toBe('unknown');
    expect(kindOf('is my grocery spending outpacing my income')).toBe('unknown');
  });

  it('unrelated spend/income words do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('lifestyle_creep');
    expect(kindOf('is my spending going up')).not.toBe('lifestyle_creep');
    expect(kindOf('how much did I spend last month')).not.toBe('lifestyle_creep');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'lifestyle_creep' })).toEqual({ kind: 'lifestyle_creep' });
    expect(validateIntent({ kind: 'lifestyle_creep', extra: true })).toEqual({ kind: 'lifestyle_creep' });
  });
});

describe('intentFromKind — the model picks a route, never a window', () => {
  it('re-derives from the words; a non-creep question tagged lifestyle_creep abstains', () => {
    expect(intentFromKind('lifestyle_creep', 'Is my lifestyle creeping?', today)).toEqual({
      kind: 'lifestyle_creep',
    });
    expect(intentFromKind('lifestyle_creep', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('lifestyle_creep', 'whatever', today)).toBeNull();
  });
});

describe('answerLifestyleCreep — phrases the coach card, originates no growth', () => {
  it('test_regression__lifestyle_creep_answer_agrees_with_coach_creep_card', () => {
    const a = answerLifestyleCreep(flagged);
    const card = COACH_COPY.creepCard(flagged);
    expect(a.kind).toBe('lifestyle_creep');
    expect(a.headline).toBe(card.title);
    expect(a.detail).toBe(card.body);
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.facts[0]).toEqual({ label: 'Window', value: 'the last 6 months' });
    expect(a.facts[1]).toEqual({
      label: 'Spending vs income',
      value: 'spending outpaced income',
    });
  });

  it('test_regression__lifestyle_creep_copy_does_not_claim_this_card_or_below', () => {
    for (const creep of [flagged, clear, notComparable]) {
      const a = answerLifestyleCreep(creep);
      const blob = `${a.headline} ${a.detail ?? ''} ${a.facts.map((f) => f.value).join(' ')}`;
      expect(blob).not.toMatch(/this card/i);
      expect(blob).not.toMatch(/\bbelow\b/i);
    }
  });

  it('the three verdicts match the Coach card mapping, without page-position claims', () => {
    expect(answerLifestyleCreep(flagged).headline).toBe('Spending is outpacing income');
    expect(answerLifestyleCreep(clear).headline).toBe('Tracking income');
    expect(answerLifestyleCreep(notComparable).headline).toBe("Can't compare yet");
    expect(answerLifestyleCreep(clear).facts[1]).toEqual({
      label: 'Spending vs income',
      value: 'tracking income',
    });
    expect(answerLifestyleCreep(notComparable).facts).toEqual([
      { label: 'Window', value: 'the last 6 months' },
    ]);
  });
});
