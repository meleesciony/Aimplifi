/**
 * Ask Aimplifi — retire_at_age intent (inverse planning, DECISIONS #131).
 *
 * Locks the seams the feature adds end-to-end:
 *   1. parseTargetAge — DETERMINISTIC age extraction (the fabrication-sensitive surface: the
 *      age is the user's own number, never the model's). Bounded to [18,110]; abstains on junk.
 *   2. routing — retirement vocab + an age → retire_at_age; not poached by forecast/debt/savings;
 *      a retirement question with no age falls through (no fabricated age).
 *   3. the validator + LLM kind path (age re-derived deterministically).
 *   4. the formatter — honest copy per outcome and the save-retirement-age action shape.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { parseAssistantQuery, parseTargetAge, validateIntent } from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerRetireAtAge } from '@/lib/engine/assistant/answer';
import type { RetireAtAgeResult } from '@/lib/engine/solve/retire-at-age';

const today = isoDate('2026-06-10');

describe('parseTargetAge — deterministic age extraction', () => {
  it('parses the natural phrasings', () => {
    expect(parseTargetAge('can I retire at 60?')).toBe(60);
    expect(parseTargetAge('retire by age 67')).toBe(67);
    expect(parseTargetAge('I want to retire at age 55')).toBe(55);
    expect(parseTargetAge("when I'm 62")).toBe(62);
    expect(parseTargetAge('when I am 62')).toBe(62);
    expect(parseTargetAge('what do I need to save to retire at 50')).toBe(50);
  });

  it('abstains (null) when no plausible age is stated', () => {
    expect(parseTargetAge('can I retire?')).toBeNull();
    expect(parseTargetAge('retire in 20 years')).toBeNull(); // a horizon, not an age
    expect(parseTargetAge('help me plan retirement')).toBeNull();
  });

  it('rejects out-of-range ages (DIAL_LIMITS.retirementAge [18,110])', () => {
    expect(parseTargetAge('retire at 12')).toBeNull(); // too young
    expect(parseTargetAge('retire at 130')).toBeNull(); // too old
    expect(parseTargetAge('retire at 9')).toBeNull(); // single digit never matches
  });

  it('does not read a dollar-suffixed or year number as an age', () => {
    expect(parseTargetAge('retire at 100k')).toBeNull(); // "100k" is not an age
  });

  it('#131 critic P2: covers the natural inflections retiring / retired (not just "retire")', () => {
    expect(parseTargetAge("I'm retiring at 65")).toBe(65);
    expect(parseTargetAge('retired at 60')).toBe(60);
    expect(parseTargetAge('retiring by age 67')).toBe(67);
  });
});

describe('routing — retire_at_age vs siblings', () => {
  it('the demo example "Can I retire at 60?" routes with the parsed age + label', () => {
    expect(parseAssistantQuery('Can I retire at 60?', today)).toEqual({
      kind: 'retire_at_age',
      targetAge: 60,
      label: 'age 60',
    });
  });

  it('"what do I need to save to retire at 62" routes here (no date → not a savings goal)', () => {
    const i = parseAssistantQuery('what do I need to save to retire at 62', today);
    expect(i.kind).toBe('retire_at_age');
    expect(i).toMatchObject({ targetAge: 62 });
  });

  it('"retire by age 67" routes here', () => {
    expect(parseAssistantQuery('can I retire by age 67?', today).kind).toBe('retire_at_age');
  });

  it('a retirement question with NO age does not route to the planner', () => {
    expect(parseAssistantQuery('when can I retire?', today).kind).not.toBe('retire_at_age');
    expect(parseAssistantQuery('am I saving enough for retirement?', today).kind).not.toBe('retire_at_age');
  });

  it('#131 critic P2: the inflections "retiring"/"retired" route deterministically (zero-key demo)', () => {
    expect(parseAssistantQuery("I'm retiring at 65", today)).toMatchObject({ kind: 'retire_at_age', targetAge: 65 });
    expect(parseAssistantQuery('I retired at 60', today)).toMatchObject({ kind: 'retire_at_age', targetAge: 60 });
    // an explicit retirement-AGE question wins over the generic "afford" → safe_to_spend route
    expect(parseAssistantQuery('can I afford to retire at 60', today).kind).toBe('retire_at_age');
  });

  it('does not poach the forward siblings', () => {
    expect(parseAssistantQuery('when will I be debt-free?', today).kind).toBe('debt_payoff');
    expect(parseAssistantQuery('will I run out of money in 90 days?', today).kind).toBe('forecast');
    expect(parseAssistantQuery("what's my savings rate?", today).kind).toBe('savings_rate');
  });

  it('does not regress the date-based inverse planners', () => {
    expect(parseAssistantQuery('can I be debt-free by December 2028?', today).kind).toBe('debt_free_by_date');
    expect(parseAssistantQuery('can I save $20,000 by December 2028?', today).kind).toBe('savings_goal_by_date');
  });
});

describe('validator + LLM kind path', () => {
  it('validates a well-formed intent; rejects an out-of-range / non-integer age or missing label', () => {
    expect(validateIntent({ kind: 'retire_at_age', targetAge: 60, label: 'age 60' })).toEqual({
      kind: 'retire_at_age',
      targetAge: 60,
      label: 'age 60',
    });
    expect(validateIntent({ kind: 'retire_at_age', targetAge: 12, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'retire_at_age', targetAge: 111, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'retire_at_age', targetAge: 60.5, label: 'x' })).toBeNull();
    expect(validateIntent({ kind: 'retire_at_age', targetAge: 60 })).toBeNull(); // no label
  });

  it('intentFromKind re-derives the age from the question; null when no age stated', () => {
    expect(intentFromKind('retire_at_age', 'can I retire at 60?', today)).toEqual({
      kind: 'retire_at_age',
      targetAge: 60,
      label: 'age 60',
    });
    // model said retire_at_age but there's no age → keep unknown, don't invent
    expect(intentFromKind('retire_at_age', 'help me retire someday', today)).toBeNull();
  });
});

describe('answerRetireAtAge — honest copy per outcome', () => {
  const base = {
    retirementAge: 60,
    yearsToRetirement: 20,
    currentMonthlyContributionCents: 50_000,
    plannedAnnualWithdrawalCents: 4_000_000,
    balanceAtRetirementCents: 90_000_000,
    sustainableAnnualWithdrawalCents: 3_600_000,
    endBalanceCents: 1_000_000,
  };

  it('reachable within budget: states the extra, the share, and the save action', () => {
    const r: RetireAtAgeResult = {
      ...base,
      outcome: 'reachable',
      requiredMonthlyContributionCents: 80_000,
      requiredAdditionalMonthlyCents: 30_000,
      shareOfSafeToSpendBps: 1_500,
      withinSafeToSpend: true,
      unreachableReason: null,
    };
    const a = answerRetireAtAge(r, 'age 60');
    expect(a.headline).toMatch(/To retire at 60/);
    expect(a.headline).toMatch(/\$300\.00\/mo/);
    expect(a.headline).toMatch(/15% of your safe-to-spend/);
    expect(a.facts).toContainEqual({ label: 'Share of safe-to-spend', value: '15%' });
    expect(a.action).toEqual({ kind: 'save_retirement_age', targetAge: 60, label: 'age 60' });
    expect(a.source).toEqual({ label: 'Open retirement outlook', href: '/investments' });
  });

  it('reachable over budget: honest "beyond a single month", exactly one share clause', () => {
    const r: RetireAtAgeResult = {
      ...base,
      outcome: 'reachable',
      requiredMonthlyContributionCents: 750_000,
      requiredAdditionalMonthlyCents: 700_000,
      shareOfSafeToSpendBps: 35_000,
      withinSafeToSpend: false,
      unreachableReason: null,
    };
    const a = answerRetireAtAge(r, 'age 60');
    expect(a.headline).toMatch(/\$7,000\.00\/mo/);
    expect(a.headline).toMatch(/350% of your safe-to-spend/);
    expect(a.headline).toMatch(/beyond a single month/i);
    expect((a.headline.match(/safe-to-spend/g) ?? []).length).toBe(1);
    expect(a.action?.kind).toBe('save_retirement_age');
  });

  it('overspent (share null): honest "budget you don\'t have yet", no %, still savable', () => {
    const r: RetireAtAgeResult = {
      ...base,
      outcome: 'reachable',
      requiredMonthlyContributionCents: 80_000,
      requiredAdditionalMonthlyCents: 30_000,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      unreachableReason: null,
    };
    const a = answerRetireAtAge(r, 'age 60');
    expect(a.headline).toMatch(/\$300\.00\/mo/);
    expect(a.headline).toMatch(/budget you don't have yet/i);
    expect(a.headline).not.toMatch(/%/);
    expect(a.facts.some((f) => f.label === 'Share of safe-to-spend')).toBe(false);
    expect(a.action?.kind).toBe('save_retirement_age');
  });

  it('already-on-track: no extra needed, still offers to save the age', () => {
    const r: RetireAtAgeResult = {
      ...base,
      outcome: 'already-on-track',
      requiredMonthlyContributionCents: 50_000,
      requiredAdditionalMonthlyCents: 0,
      shareOfSafeToSpendBps: 0,
      withinSafeToSpend: true,
      unreachableReason: null,
    };
    const a = answerRetireAtAge(r, 'age 60');
    expect(a.headline).toMatch(/on track to retire at 60/i);
    expect(a.facts).toContainEqual({ label: 'Extra needed', value: '$0.00/mo' });
    expect(a.action?.kind).toBe('save_retirement_age');
  });

  it('unreachable: age-in-past / age-after-end / cannot-sustain read differently, no action', () => {
    const u = (over: Partial<RetireAtAgeResult>): RetireAtAgeResult => ({
      ...base,
      outcome: 'unreachable',
      requiredMonthlyContributionCents: null,
      requiredAdditionalMonthlyCents: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      balanceAtRetirementCents: 0,
      sustainableAnnualWithdrawalCents: 0,
      endBalanceCents: 0,
      unreachableReason: 'cannot-sustain',
      ...over,
    });

    const past = answerRetireAtAge(u({ retirementAge: 39, unreachableReason: 'age-in-past' }), 'age 39');
    expect(past.headline).toMatch(/at or before your age today/i);
    expect(past.action).toBeUndefined();

    const after = answerRetireAtAge(u({ retirementAge: 100, unreachableReason: 'age-after-end' }), 'age 100');
    expect(after.headline).toMatch(/past the age your plan runs through/i);
    expect(after.action).toBeUndefined();

    const cannot = answerRetireAtAge(
      u({ retirementAge: 40, unreachableReason: 'cannot-sustain', plannedAnnualWithdrawalCents: 1_200_000 }),
      'age 40',
    );
    expect(cannot.headline).toMatch(/can't cover about \$12,000\.00\/yr/);
    expect(cannot.action).toBeUndefined();
  });

  it('every actionable answer states the assumptions inline (guardrail: illustration, not advice; today\'s dollars)', () => {
    const r: RetireAtAgeResult = {
      ...base,
      outcome: 'reachable',
      requiredMonthlyContributionCents: 80_000,
      requiredAdditionalMonthlyCents: 30_000,
      shareOfSafeToSpendBps: 1_500,
      withinSafeToSpend: true,
      unreachableReason: null,
    };
    const a = answerRetireAtAge(r, 'age 60');
    expect(`${a.detail}`).toMatch(/illustration, not advice/i);
    expect(`${a.detail}`).toMatch(/today's dollars|after-inflation/i);
  });
});
