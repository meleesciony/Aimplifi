/**
 * Ask Aimplifi — fi_status intent (standing Coach FI card).
 *
 * /coach already prints months-to-FI and the FI number. This slice routes
 * "when can I retire?" (no age) through Ask onto those SAME figures. No new
 * projection, no invented FI-date movement. Copy does not say "this card" or
 * "below" — those claims are false in Ask.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import {
  fiStatusFromQuestion,
  parseAssistantQuery,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerFiStatus } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const onTrack = {
  fiNumberCents: 1_500_000_00,
  annualExpensesCents: 60_000_00,
  monthlySavingsCents: 2_000_00,
  monthlySavingsMonths: 6,
  monthsToFI: 207,
  coastIsCoast: false,
  coastRequiredMonthlyCents: 1_200_00,
  coastTargetYears: 25,
  coastTargetYearsIsAppDefault: true,
  portfolioCents: 80_000_00,
  swrBps: 400,
  frozenPortfolioNote: null as string | null,
};

describe('routing — fi_status', () => {
  it('test_regression__fi_status_when_can_i_retire_routes_to_coach_fi', () => {
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('when can I retire')).toBe('fi_status');
    expect(kindOf('when will I be financially independent?')).toBe('fi_status');
    expect(kindOf("what's my FI number")).toBe('fi_status');
    expect(kindOf('what is my financial independence number')).toBe('fi_status');
    expect(kindOf('am I saving enough for retirement?')).toBe('fi_status');
    expect(kindOf('when will I be FI')).toBe('fi_status');
  });

  it('does not steal the aged inverse planner, wealth target, or savings rate', () => {
    expect(kindOf('Can I retire at 60?')).toBe('retire_at_age');
    expect(kindOf("I'm retiring at 65")).toBe('retire_at_age');
    expect(kindOf('if I want to save up to 10 mil what do I need to do?')).toBe('wealth_target');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
    expect(kindOf('when will I be debt-free?')).toBe('debt_payoff');
  });
});

describe('abstentions — the majority', () => {
  it('a named age stays the inverse planner, not the unaged card', () => {
    expect(kindOf('when can I retire at 55')).toBe('retire_at_age');
    expect(fiStatusFromQuestion('when can I retire at 55', today)).toBeNull();
  });

  it('an amount is a different planner', () => {
    expect(kindOf('save 10 mil for retirement')).not.toBe('fi_status');
    expect(fiStatusFromQuestion('save 10 mil for retirement', today)).toBeNull();
  });

  it('test_regression__fi_status_date_window_abstains', () => {
    expect(kindOf('when can I retire last month')).toBe('unknown');
    expect(kindOf('when can I retire this month')).toBe('unknown');
    expect(kindOf("what's my FI number in 2025")).toBe('unknown');
    expect(kindOf('retire in 20 years')).toBe('unknown');
    expect(fiStatusFromQuestion('when can I retire last month', today)).toEqual({
      kind: 'unknown',
      question: 'when can I retire last month',
    });
  });

  it('a named store or category is not the standing card', () => {
    expect(kindOf('when can I retire at Costco')).toBe('unknown');
    expect(kindOf("what's my FI number on groceries")).toBe('unknown');
  });

  it('unrelated retire-shaped words do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('fi_status');
    expect(kindOf('how much did I spend last month')).not.toBe('fi_status');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'fi_status' })).toEqual({ kind: 'fi_status' });
    expect(validateIntent({ kind: 'fi_status', extra: true })).toEqual({ kind: 'fi_status' });
  });
});

describe('intentFromKind — the model picks a route, never an age', () => {
  it('re-derives from the words; a non-FI question tagged fi_status abstains', () => {
    expect(intentFromKind('fi_status', 'When can I retire?', today)).toEqual({ kind: 'fi_status' });
    expect(intentFromKind('fi_status', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('fi_status', 'whatever', today)).toBeNull();
  });

  it('a model that tagged a no-age retire question as retire_at_age still owes the standing card', () => {
    expect(intentFromKind('retire_at_age', 'when can I retire?', today)).toEqual({ kind: 'fi_status' });
    expect(intentFromKind('retire_at_age', 'Can I retire at 60?', today)).toMatchObject({
      kind: 'retire_at_age',
      targetAge: 60,
    });
  });

  it('a model that tagged an aged question as fi_status still owes the inverse planner', () => {
    expect(intentFromKind('fi_status', 'Can I retire at 60?', today)).toMatchObject({
      kind: 'retire_at_age',
      targetAge: 60,
    });
  });
});

describe('answerFiStatus — phrases the coach FI card, originates no date', () => {
  it('test_regression__fi_status_answer_agrees_with_coach_fi_headline_math', () => {
    const a = answerFiStatus(onTrack);
    expect(a.kind).toBe('fi_status');
    expect(a.headline).toBe(
      "At your current savings rate you'd reach financial independence in about 17 years 3 months.",
    );
    expect(a.headline).toContain('17 years 3 months');
    expect(a.facts[0]).toEqual({
      label: 'FI number',
      value: formatCents(cents(onTrack.fiNumberCents)),
    });
    expect(a.facts[1]).toEqual({ label: 'Years to FI', value: '17 years 3 months' });
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.detail).toContain(
      COACH_COPY.fiNumber(
        cents(onTrack.fiNumberCents),
        onTrack.swrBps,
        cents(onTrack.annualExpensesCents),
        onTrack.monthlySavingsMonths,
      ),
    );
    expect(a.detail).toContain(COACH_COPY.yourEnough());
    expect(a.detail).toContain(COACH_COPY.freedomDividend(17));
  });

  it('test_regression__fi_status_copy_does_not_claim_this_card_or_below', () => {
    const a = answerFiStatus(onTrack);
    const blob = `${a.headline} ${a.detail ?? ''} ${a.facts.map((f) => f.value).join(' ')}`;
    expect(blob).not.toMatch(/this card/i);
    expect(blob).not.toMatch(/\bbelow\b/i);
  });

  it('the four headline states match the Coach FI card mapping, without page-position claims', () => {
    expect(answerFiStatus({ ...onTrack, monthsToFI: null }).headline).toMatch(/beyond the 100 years/);
    expect(
      answerFiStatus({ ...onTrack, monthsToFI: null, monthlySavingsCents: 0, coastIsCoast: true })
        .headline,
    ).toMatch(/Coach shows whether you're Coast FI/);
    expect(
      answerFiStatus({
        ...onTrack,
        monthsToFI: null,
        monthlySavingsCents: 0,
        coastIsCoast: false,
      }).headline,
    ).toMatch(/a projection date wouldn't be honest/);
  });

  it('carries a frozen-portfolio note the card would print', () => {
    const note = 'Brokerage stopped updating on June 1, 2026.';
    const a = answerFiStatus({ ...onTrack, frozenPortfolioNote: note });
    expect(a.detail).toContain(note);
  });
});
