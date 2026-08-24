/**
 * Ask Aimplifi — next_dollar intent (W.6(b) extra-dollar ranking).
 *
 * The answer phrases the SAME `nextDollar` plan `/coach` prints, via
 * COACH_COPY (one author). Abstentions are the majority. Copy does not say
 * "this card" or "below". Does not steal debt_payoff, cash_needed, or runway.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  nextDollarFromQuestion,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerNextDollar } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { nextDollar } from '@/lib/engine/fi/next-dollar';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const demoPlan = nextDollar({
  debts: [
    {
      id: 'acct-autoloan',
      name: 'Auto Loan',
      kind: 'installment',
      balanceCents: 1_430_000,
      aprBps: 649,
    },
  ],
  expectedReturnBps: 700,
  returnIsDefault: true,
  runwayMonths: 4.2,
  employerMatch: 'unknown',
});

describe('routing — next_dollar', () => {
  it('test_regression__next_dollar_where_should_my_next_dollar_go_routes', () => {
    expect(kindOf('Where should my next dollar go?')).toBe('next_dollar');
    expect(kindOf('where should extra money go')).toBe('next_dollar');
    expect(kindOf('where does my money go')).not.toBe('next_dollar');
    expect(kindOf('Should I pay off debt or invest?')).toBe('next_dollar');
    expect(kindOf('should I invest or pay down my loan')).toBe('next_dollar');
    expect(kindOf('should I fund my emergency fund or invest')).toBe('next_dollar');
    expect(kindOf('marginal dollar')).toBe('next_dollar');
  });

  it('does not steal debt-free, cards, runway, or FI questions', () => {
    expect(kindOf('When will I be debt-free?')).toBe('debt_payoff');
    expect(kindOf('How much do I need to pay my cards?')).toBe('cash_needed');
    expect(kindOf('How many months of runway do I have?')).toBe('runway');
    expect(kindOf('do I have an emergency fund')).toBe('runway');
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
  });

  it('test_regression__w6b_invest_cooccurrence_is_not_the_ranking', () => {
    expect(kindOf('When will I be debt-free so I can invest?')).toBe('debt_payoff');
    expect(kindOf('How long to pay off my loan if I keep investing?')).toBe('debt_payoff');
    expect(kindOf('How much do I need to pay off my cards so I can invest?')).toBe('cash_needed');
  });

  it('test_regression__w6b_instead_of_and_before_are_contrast', () => {
    expect(kindOf('Should I invest instead of paying off debt?')).toBe('next_dollar');
    expect(kindOf('Should I pay off debt before investing?')).toBe('next_dollar');
    expect(kindOf('Should I invest rather than paying off debt?')).toBe('next_dollar');
  });

  it('test_regression__w6b_before_i_can_is_not_contrast', () => {
    expect(kindOf('How much do I need to pay off my cards before I can invest?')).toBe(
      'cash_needed',
    );
    expect(kindOf('When will I be debt-free before I can invest?')).toBe('debt_payoff');
    expect(kindOf('How long to pay off my loan before investing?')).toBe('debt_payoff');
  });

  it('test_regression__w6b_auto_loan_and_mortgage_are_not_spend_targets', () => {
    expect(kindOf('should I invest or pay down my auto loan')).toBe('next_dollar');
    expect(kindOf('Should I pay off my mortgage before investing?')).toBe('next_dollar');
  });
});

describe('abstentions — the majority', () => {
  it('an amount declines so a planner can match', () => {
    expect(nextDollarFromQuestion('where should my next $500 go', today)).toBeNull();
  });

  it('test_regression__next_dollar_date_window_abstains', () => {
    expect(kindOf('next dollar last month')).toBe('unknown');
    expect(nextDollarFromQuestion('next dollar last month', today)).toEqual({
      kind: 'unknown',
      question: 'next dollar last month',
    });
  });

  it('a named store or category is not the ranking', () => {
    expect(kindOf('next dollar at Costco')).toBe('unknown');
    expect(kindOf('should I invest or pay off groceries')).toBe('unknown');
  });

  it('bare invest / debt without the contrast is not this route', () => {
    expect(kindOf('should I invest')).not.toBe('next_dollar');
    expect(kindOf('how do I pay off my loan')).toBe('debt_payoff');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'next_dollar' })).toEqual({ kind: 'next_dollar' });
    expect(validateIntent({ kind: 'next_dollar', extra: true })).toEqual({ kind: 'next_dollar' });
  });
});

describe('intentFromKind — the model picks a route, never the words', () => {
  it('re-derives from the words; a question tagged next_dollar that is not one abstains', () => {
    expect(intentFromKind('next_dollar', 'Where should my next dollar go?', today)).toEqual({
      kind: 'next_dollar',
    });
    expect(intentFromKind('next_dollar', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('next_dollar', 'whatever', today)).toBeNull();
    expect(intentFromKind('next_dollar', 'When will I be debt-free?', today)).toBeNull();
  });
});

describe('answerNextDollar — one author, copy bans', () => {
  it('phrases the engine through COACH_COPY and does not say this card / below', () => {
    const a = answerNextDollar(demoPlan);
    expect(a.kind).toBe('next_dollar');
    expect(a.headline).toBe(COACH_COPY.nextDollarHeadline(demoPlan));
    expect(a.headline).toContain('investing');
    expect(a.detail).toContain(COACH_COPY.nextDollarWhy(demoPlan));
    expect(a.detail).toContain('Auto Loan');
    expect(a.detail).not.toMatch(/this card/i);
    expect(a.detail).not.toMatch(/\bbelow\b/i);
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
  });
});
