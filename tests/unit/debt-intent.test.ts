/**
 * Ask Aimplifi — debt_payoff intent (Wave 3, DECISIONS #97). Locks the routing
 * boundary (loan/debt phrasings → debt_payoff; credit-card payment questions
 * stay cash_needed, NOT poached) and the answer formatter delegating to the
 * same engine the /goals planner uses.
 */
import { describe, expect, it } from 'vitest';
import { parseAssistantQuery } from '@/lib/engine/assistant/intent';
import { answerDebtPayoff } from '@/lib/engine/assistant/answer';
import { planDebtPayoff } from '@/lib/engine/debt/payoff';
import { isoDate } from '@/lib/dates';

const today = isoDate('2026-06-25');

describe('debt_payoff routing', () => {
  it('routes debt-freedom / loan-payoff / strategy phrasings to debt_payoff', () => {
    for (const q of [
      'When will I be debt-free?',
      'pay off my debt',
      'help me pay off all my loans',
      'snowball vs avalanche',
      'how long to pay off my loan?',
    ]) {
      expect(parseAssistantQuery(q, today).kind, q).toBe('debt_payoff');
    }
  });

  it('does NOT poach credit-card payment questions (those stay cash_needed)', () => {
    expect(parseAssistantQuery('how much do I need to pay off my cards?', today).kind).toBe('cash_needed');
    expect(parseAssistantQuery('what is due on my credit card?', today).kind).toBe('cash_needed');
  });
});

describe('answerDebtPayoff', () => {
  const debts = [{ id: 'l', name: 'Auto Loan', balanceCents: 1_430_000, aprBps: 649, minimumPaymentCents: 38_500 }];

  it('phrases a debt-free date from the engine result and links the planner', () => {
    const plan = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 0 });
    const a = answerDebtPayoff(plan, today, debts.length);
    expect(a.kind).toBe('debt_payoff');
    expect(a.headline).toMatch(/debt-free/i);
    expect(a.source?.href).toBe('/goals');
    expect(a.facts.some((f) => f.label === 'Total interest')).toBe(true);
  });

  it('handles the no-debt case gracefully', () => {
    const plan = planDebtPayoff({ debts: [], strategy: 'avalanche', extraMonthlyCents: 0 });
    const a = answerDebtPayoff(plan, today, 0);
    expect(a.headline).toMatch(/no tracked debts/i);
    expect(a.facts).toEqual([]);
  });
});
