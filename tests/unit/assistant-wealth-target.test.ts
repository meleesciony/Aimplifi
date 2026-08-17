/**
 * Ask Aimplifi — wealth_target intent (W.4, the fourth plan-in-words solver).
 *
 * W.1 shipped the engine and the /coach card. This slice routes the owner's
 * spoken question ("if I want to save up to 10 mil … what do I need to do?")
 * through Ask. Abstention tests are the majority: a wrong parse fabricates a
 * target (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { formatCents, type Cents } from '@/lib/money';
import {
  parseAssistantQuery,
  parseTargetAmount,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerWealthTarget } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { solveWealthTarget, seededHorizon } from '@/lib/engine/solve/wealth-target';

const today = isoDate('2026-06-10');
const TEN_MILLION = 1_000_000_000;

describe('parseTargetAmount — W.4 spoken magnitudes', () => {
  it('parses the three forms the owner used', () => {
    expect(parseTargetAmount('save up to 10 mil')).toBe(TEN_MILLION);
    expect(parseTargetAmount('if I want $10M')).toBe(TEN_MILLION);
    expect(parseTargetAmount('ten million')).toBe(TEN_MILLION);
  });

  it('parses the nearby spoken variants', () => {
    expect(parseTargetAmount('save $10 mil')).toBe(TEN_MILLION);
    expect(parseTargetAmount('10mil')).toBe(TEN_MILLION);
    expect(parseTargetAmount('a million')).toBe(100_000_000);
    expect(parseTargetAmount('one million')).toBe(100_000_000);
    expect(parseTargetAmount('two million')).toBe(200_000_000);
    expect(parseTargetAmount('ten mil')).toBe(TEN_MILLION);
    expect(parseTargetAmount('ten million dollars')).toBe(TEN_MILLION);
  });

  it('does not let mil steal million', () => {
    expect(parseTargetAmount('save 2 million by 2050')).toBe(200_000_000);
  });
});

describe('parseTargetAmount — W.4 abstentions (the majority)', () => {
  it('abstains when no amount is stated', () => {
    expect(parseTargetAmount('what do I need to do to get wealthy')).toBeNull();
    expect(parseTargetAmount('save up')).toBeNull();
    expect(parseTargetAmount('million')).toBeNull();
    expect(parseTargetAmount('ten')).toBeNull();
  });

  it('abstains on a compound number-word (would otherwise read the last word)', () => {
    expect(parseTargetAmount('twenty five million')).toBeNull();
    expect(parseTargetAmount('twenty-five million')).toBeNull();
  });

  it('abstains on a fraction of a million', () => {
    expect(parseTargetAmount('half a million')).toBeNull();
    expect(parseTargetAmount('quarter of a million')).toBeNull();
  });

  it('abstains on a non-money unit next to the magnitude', () => {
    expect(parseTargetAmount('ten million steps')).toBeNull();
    expect(parseTargetAmount('10 million miles')).toBeNull();
  });

  it('still abstains on a bare ungrouped number (existing #126 rule)', () => {
    expect(parseTargetAmount('save 15000')).toBeNull();
  });
});

describe('routing — wealth_target vs siblings', () => {
  it('test_regression__w4_owner_question_routes_to_wealth_target', () => {
    expect(
      parseAssistantQuery('if I want to save up to 10 mil what do I need to do?', today),
    ).toEqual({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
      label: formatCents(TEN_MILLION as Cents),
    });
  });

  it('"$10M" / "ten million" / "save $10 million" route here', () => {
    expect(parseAssistantQuery('I want to save $10M', today)).toMatchObject({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
    });
    expect(parseAssistantQuery('how do I get to ten million?', today)).toMatchObject({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
    });
    expect(parseAssistantQuery('what do I need to do to have 10 mil', today)).toMatchObject({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
    });
  });

  it('a save + amount with NO date is now the wealth planner (the W.1 gap)', () => {
    expect(parseAssistantQuery('I want to save $15,000', today)).toEqual({
      kind: 'wealth_target',
      targetCents: 1_500_000,
      label: formatCents(1_500_000 as Cents),
    });
  });

  it('a dated savings question stays on the linear by-date solver', () => {
    expect(parseAssistantQuery('I want to save $15,000 by December 2027', today).kind).toBe(
      'savings_goal_by_date',
    );
    expect(parseAssistantQuery('save $10 million by 2050', today).kind).toBe('savings_goal_by_date');
  });

  it('does not poach siblings', () => {
    expect(parseAssistantQuery("what's my savings rate?", today).kind).toBe('savings_rate');
    expect(parseAssistantQuery('how much is in my savings?', today).kind).toBe('account_balance');
    expect(parseAssistantQuery('Can I retire at 60?', today).kind).toBe('retire_at_age');
    expect(parseAssistantQuery('save $500 a month', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('can I be debt-free by December 2028?', today).kind).toBe(
      'debt_free_by_date',
    );
  });

  it('abstains when the amount is missing, compared, negated, or a date we cannot window', () => {
    expect(parseAssistantQuery('if I want to save up what do I need to do?', today).kind).not.toBe(
      'wealth_target',
    );
    expect(parseAssistantQuery('save 10 mil or 20 mil', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('not 10 million', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('more than 10 mil', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('at least ten million', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('save twenty five million', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('thanks a million', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('what is 10 million', today).kind).not.toBe('wealth_target');
    expect(parseAssistantQuery('save 10 mil in 2027', today).kind).not.toBe('wealth_target');
  });
});

describe('validator + LLM kind path', () => {
  it('validates a well-formed intent; a bad amount rejects the whole intent', () => {
    expect(
      validateIntent({ kind: 'wealth_target', targetCents: TEN_MILLION, label: '$10,000,000.00' }),
    ).toEqual({ kind: 'wealth_target', targetCents: TEN_MILLION, label: '$10,000,000.00' });
    expect(validateIntent({ kind: 'wealth_target', targetCents: -5, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'wealth_target', targetCents: 0, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'wealth_target', targetCents: 10.5, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'wealth_target', label: 'x' })).toBeNull();
  });

  it('intentFromKind re-derives the amount; no amount → null (never invent)', () => {
    expect(intentFromKind('wealth_target', 'save up to 10 mil', today)).toEqual({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
      label: formatCents(TEN_MILLION as Cents),
    });
    expect(intentFromKind('wealth_target', 'help me get rich', today)).toBeNull();
  });

  it('a dated question the model tagged wealth_target becomes the by-date solver', () => {
    expect(intentFromKind('wealth_target', 'save $15,000 by december 2027', today)).toEqual({
      kind: 'savings_goal_by_date',
      targetDate: '2027-12-31',
      targetCents: 1_500_000,
      label: 'December 2027',
    });
  });

  it('a dateless amount the model tagged savings_goal_by_date becomes wealth_target', () => {
    expect(intentFromKind('savings_goal_by_date', 'save up to 10 mil', today)).toEqual({
      kind: 'wealth_target',
      targetCents: TEN_MILLION,
      label: formatCents(TEN_MILLION as Cents),
    });
  });
});

describe('answerWealthTarget — phrases the W.1 engine, originates no figure', () => {
  const dials = { returnIsDefault: true, inflationIsDefault: true };
  const shared = {
    currentPortfolioCents: 0,
    currentMonthlyContributionCents: 1_000_000,
    nominalReturnBps: 0,
    inflationBps: 0,
    monthlyIncomeCents: 5_000_000,
    safeToSpendCents: 2_000_000,
  };

  function phrase(targetCents: number) {
    const pace = solveWealthTarget({ ...shared, targetAmountCents: targetCents, deadlineMonths: null });
    const seed = seededHorizon(pace.monthsAtCurrentRate, pace.contributionFloored);
    const required = solveWealthTarget({
      ...shared,
      targetAmountCents: targetCents,
      deadlineMonths: seed.years * 12,
    });
    return answerWealthTarget(pace, required, {
      horizonYears: seed.years,
      horizonBasis: seed.seeded ? 'seeded' : 'fallback',
      contributionBasis: 'recent-surplus',
      historicalMonthlySavingsCents: shared.currentMonthlyContributionCents,
      averagedOverMonths: 6,
      dialOwnership: dials,
      nominalReturnBps: shared.nominalReturnBps,
      inflationBps: shared.inflationBps,
    });
  }

  it('already-there uses the card sentence and points at /coach', () => {
    const pace = solveWealthTarget({
      ...shared,
      targetAmountCents: 500_000,
      currentPortfolioCents: 1_000_000,
      deadlineMonths: null,
    });
    const required = solveWealthTarget({
      ...shared,
      targetAmountCents: 500_000,
      currentPortfolioCents: 1_000_000,
      deadlineMonths: 12,
    });
    const a = answerWealthTarget(pace, required, {
      horizonYears: 1,
      horizonBasis: 'fallback',
      contributionBasis: 'recent-surplus',
      historicalMonthlySavingsCents: shared.currentMonthlyContributionCents,
      averagedOverMonths: 6,
      dialOwnership: dials,
      nominalReturnBps: shared.nominalReturnBps,
      inflationBps: shared.inflationBps,
    });
    expect(a.kind).toBe('wealth_target');
    expect(a.headline).toBe(
      COACH_COPY.wealthTargetAlreadyThere(1_000_000 as Cents, 500_000 as Cents),
    );
    expect(a.source).toEqual({ label: 'Open wealth target', href: '/coach' });
    expect(a.action).toBeUndefined();
  });

  it('out-of-range refuses rather than projecting', () => {
    const a = phrase(0);
    expect(a.headline).toBe(COACH_COPY.wealthTargetOutOfRange());
  });

  it('reachable headline is the pace line; detail names the start and the required monthly', () => {
    const a = phrase(12_000_000);
    const pace = solveWealthTarget({
      ...shared,
      targetAmountCents: 12_000_000,
      deadlineMonths: null,
    });
    expect(pace.monthsAtCurrentRate).toBe(12);
    expect(a.headline).toBe(
      COACH_COPY.wealthTargetPaceLine({
        basis: 'recent-surplus',
        contributionCents: 1_000_000 as Cents,
        contributionFloored: false,
        historicalCents: 1_000_000 as Cents,
        averagedOverMonths: 6,
        arrivalMonths: 12,
        realBps: 0,
      }),
    );
    expect(a.detail).toMatch(/Starting from/);
    expect(a.detail).toMatch(/illustration, not advice/i);
    expect(a.facts).toContainEqual({ label: 'Target', value: formatCents(12_000_000 as Cents) });
    expect(a.facts.some((f) => f.label === 'Monthly contribution to arrive')).toBe(true);
  });
});
