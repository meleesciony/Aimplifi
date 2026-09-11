/**
 * Ask Aimplifi — goal_status intent (DECISIONS #738).
 *
 * Routes "am I on track for my <stored goal>?" onto the SAME `goalProgress` +
 * `goalPaceSentence` the /goals card prints. No new money math. The inverse
 * planner (`savings_goal_by_date`) still owns a NEW amount + date.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md):
 * a confident status for the wrong goal, or for a goal they did not name, is
 * the failure mode.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  extractGoalNameQuery,
  goalStatusFromQuestion,
  parseAssistantQuery,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import {
  answerGoalStatus,
  answerGoalStatusAmbiguous,
  answerGoalStatusNoMatch,
} from '@/lib/engine/assistant/answer';
import { goalProgress } from '@/lib/engine/goals/progress';
import { GOAL_PACE_LABEL, goalPaceSentence } from '@/lib/engine/goals/progress-copy';
import { matchGoalName } from '@/lib/engine/goals/match';

const today = isoDate('2026-06-10');
const STORED = ['Japan trip', 'Emergency fund', 'Hawaii vacation', 'Groceries'] as const;
const kindOf = (q: string, names: readonly string[] = STORED) =>
  parseAssistantQuery(q, today, [], names).kind;

describe('routing — goal_status', () => {
  it('on-track / on-pace / how-am-I-doing questions with a name route here', () => {
    const q = parseAssistantQuery('am I on track for my Japan trip?', today, [], STORED);
    expect(q).toEqual({ kind: 'goal_status', nameQuery: 'japan trip' });
    expect(kindOf("how's my Japan trip goal looking?")).toBe('goal_status');
    expect(kindOf('how am I doing on my emergency fund?')).toBe('goal_status');
    expect(kindOf('is my Japan trip on track?')).toBe('goal_status');
    expect(kindOf('progress on my Hawaii vacation')).toBe('goal_status');
    expect(kindOf('will I make my Japan trip date?')).toBe('goal_status');
    expect(kindOf('am I on track for Japan trip')).toBe('goal_status');
    expect(kindOf('am I on track for "Japan trip"?')).toBe('goal_status');
    expect(kindOf('am I on track for my June wedding?', ['June wedding'])).toBe('goal_status');
    expect(kindOf('am I on track for my Trip at sea?', ['Trip at sea'])).toBe('goal_status');
    expect(kindOf('am I on track for my Summer 2027 trip?', ['Summer 2027 trip'])).toBe('goal_status');
  });

  it('both orders of name and on-track extract the same query', () => {
    expect(extractGoalNameQuery('am I on track for my Japan trip?')).toBe('japan trip');
    expect(extractGoalNameQuery('for my Japan trip, am I on track?')).toBe('japan trip');
    expect(extractGoalNameQuery('am I on track for Japan trip')).toBe('japan trip');
  });

  it('a quoted name wins', () => {
    expect(extractGoalNameQuery('am I on track for "Italy 2027"?')).toBe('italy 2027');
  });
});

describe('abstentions — the majority', () => {
  it('a nameless on-track question is unknown — never the only / first goal', () => {
    expect(kindOf('am I on track?')).toBe('unknown');
    expect(kindOf('am I on track for my savings goal?')).toBe('unknown');
    expect(kindOf('am I on track for my goals?')).toBe('unknown');
    expect(goalStatusFromQuestion('am I on track?', today)).toBeNull();
    expect(goalStatusFromQuestion('am I on track for my savings goal?', today)).toEqual({
      kind: 'unknown',
      question: 'am I on track for my savings goal?',
    });
  });

  it('an amount or date stays the inverse planner / wealth target, not a stored row', () => {
    expect(kindOf('am I on track to save $6,000 by June 2027?')).toBe('savings_goal_by_date');
    expect(kindOf('save $15,000 by December 2027')).toBe('savings_goal_by_date');
    expect(kindOf('am I on track to save $6,000?')).toBe('wealth_target');
    expect(goalStatusFromQuestion('am I on track to save $6,000 by June 2027?', today)).toBeNull();
  });

  it('retirement / FI / debt-free stay those routes', () => {
    expect(kindOf('am I on track for retirement?')).toBe('fi_status');
    expect(kindOf('am I on track to retire?')).toBe('fi_status');
    expect(kindOf('Can I retire at 60?')).toBe('retire_at_age');
    expect(kindOf('am I on track to be debt-free?')).toBe('debt_payoff');
    expect(goalStatusFromQuestion('am I on track for retirement?', today)).toBeNull();
  });

  it('a named date window or store is unknown, not a stored-goal status', () => {
    expect(kindOf('am I on track for my Japan trip this month?')).toBe('unknown');
    expect(kindOf('am I on track for my Japan trip at Costco?')).toBe('unknown');
    expect(kindOf('am I on track for my June wedding this month?', ['June wedding'])).toBe(
      'unknown',
    );
  });

  it('a spend-synonym inside the goal name is still the goal, not a Travel total', () => {
    const q = parseAssistantQuery('am I on track for my Japan trip?', today, [], STORED);
    expect(q).toEqual({ kind: 'goal_status', nameQuery: 'japan trip' });
    expect(kindOf('am I on track for my groceries goal?')).toEqual('goal_status');
  });

  it('spend / net-worth / savings-rate questions are not poached', () => {
    expect(kindOf('how much did I spend last month?')).toBe('spend_total');
    expect(kindOf('what is my net worth?')).toBe('net_worth');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
    expect(kindOf("how's my spending looking?")).toBe('spend_total');
    expect(kindOf('how am I doing with my spending?')).toBe('spend_total');
    expect(kindOf('how am I doing on my spending?')).toBe('spend_total');
    expect(kindOf('how am I doing on my spending last month?')).toBe('spend_total');
    expect(kindOf('how am I doing on my income last month?')).toBe('income');
    expect(kindOf('how am I doing on my checking account last month?')).toBe('account_balance');
    expect(kindOf('how am I doing on my spending at Costco?')).toBe('merchant_spend');
    expect(kindOf('am I on track for my Japan trip this month?')).toBe('unknown');
    expect(kindOf('am I on track for my Japan trip at Costco?')).toBe('unknown');
  });

  it('test_regression__goal_status_does_not_delete_debt_payoff (critic #738 P0-1)', () => {
    expect(kindOf('am I on track to pay off my car loan?')).toBe('debt_payoff');
    expect(kindOf('am I on track to pay off my student loans?')).toBe('debt_payoff');
    expect(kindOf('am I on track to pay off my loans?')).toBe('debt_payoff');
    expect(kindOf('am I on track to pay off my debt?')).toBe('debt_payoff');
    expect(kindOf('am I on pace to pay off my loans?')).toBe('debt_payoff');
    expect(kindOf('am I on track to be debt-free?')).toBe('debt_payoff');
    expect(goalStatusFromQuestion('am I on track to pay off my car loan?', today)).toBeNull();
  });

  it('test_regression__goal_status_does_not_claim_rent_bills_or_loans (critic #738 P1-2)', () => {
    expect(kindOf('am I behind on my rent?')).not.toBe('goal_status');
    expect(kindOf('am I behind on my bills?')).not.toBe('goal_status');
    expect(kindOf('am I behind on my credit cards?')).not.toBe('goal_status');
    expect(kindOf('am I behind on my student loan?')).not.toBe('goal_status');
    expect(kindOf('how am I doing on dining out?')).not.toBe('goal_status');
    expect(kindOf('progress on my mortgage')).not.toBe('goal_status');
    expect(kindOf('how am I doing on paying off my loans?')).toBe('debt_payoff');
  });

  it('test_regression__goal_status_does_not_delete_debt_payoff_nouns (critic #738 cycle 2 P0-1)', () => {
    expect(kindOf('am I on track with my car loan payoff?', ['Car loan'])).toBe('debt_payoff');
    expect(kindOf('am I on track for my loan payoff?')).toBe('debt_payoff');
    expect(kindOf('am I on pace on my student loan payoff?')).toBe('debt_payoff');
    expect(kindOf('am I on track with my debt snowball?')).toBe('debt_payoff');
    expect(kindOf('am I on track for my loan paydown?')).not.toBe('goal_status');
    expect(goalStatusFromQuestion('am I on track with my car loan payoff?', today, [], ['Car loan'])).toBeNull();
  });

  it('test_regression__goal_status_does_not_claim_income_or_accounts (critic #738 cycle 2 P1-3/P1-4)', () => {
    expect(kindOf('how am I doing on my income?')).toBe('income');
    expect(kindOf('how am I doing with my income?')).toBe('income');
    expect(kindOf('how am I doing on my savings account?')).toBe('account_balance');
    expect(kindOf('how am I doing with my checking account?')).toBe('account_balance');
    expect(kindOf('how am I doing on my Chase checking?')).toBe('account_balance');
    expect(kindOf('am I on track with my emergency savings?')).toBe('account_balance');
    expect(kindOf('am I on track with my spending plan?')).toBe('safe_to_spend');
    expect(kindOf('am I on track for my guilt-free spending?')).toBe('safe_to_spend');
    expect(kindOf('will I hit my credit card due date?')).toBe('cash_needed');
    expect(kindOf('will I hit my card due date?')).toBe('cash_needed');
  });

  it('test_regression__unnamed_noun_is_unknown_not_a_claimed_miss (critic #738 cycle 2 P1-5)', () => {
    expect(kindOf('am I on track for my Japan trip?', [])).toBe('unknown');
    expect(kindOf('how am I doing on my investments?')).toBe('unknown');
    expect(kindOf('am I on track for my taxes?')).toBe('unknown');
    expect(goalStatusFromQuestion('am I on track for my Japan trip?', today, [], [])).toBeNull();
  });

  it('emergency-fund STATUS coverage stays runway; on-track for the named goal does not', () => {
    expect(kindOf('do I have an emergency fund?')).toBe('runway');
    expect(kindOf('am I on track for my emergency fund?')).toBe('goal_status');
  });

  it('validateIntent requires a bounded non-empty nameQuery', () => {
    expect(validateIntent({ kind: 'goal_status', nameQuery: 'japan trip' })).toEqual({
      kind: 'goal_status',
      nameQuery: 'japan trip',
    });
    expect(validateIntent({ kind: 'goal_status', nameQuery: '  Japan Trip  ' })).toEqual({
      kind: 'goal_status',
      nameQuery: 'japan trip',
    });
    expect(validateIntent({ kind: 'goal_status' })).toBeNull();
    expect(validateIntent({ kind: 'goal_status', nameQuery: '' })).toBeNull();
    expect(validateIntent({ kind: 'goal_status', nameQuery: 'x'.repeat(61) })).toBeNull();
  });
});

describe('intentFromKind — the model picks a route, never a stored row', () => {
  it('re-derives the name from the words', () => {
    expect(intentFromKind('goal_status', 'am I on track for my Japan trip?', today, [], STORED)).toEqual({
      kind: 'goal_status',
      nameQuery: 'japan trip',
    });
  });

  it('a nameless or dated question tagged goal_status abstains', () => {
    expect(intentFromKind('goal_status', 'am I on track?', today)).toBeNull();
    expect(intentFromKind('goal_status', 'how much did I spend last month?', today)).toBeNull();
    expect(intentFromKind('goal_status', 'save $6,000 by June 2027', today)).toBeNull();
  });
});

describe('answer — byte-identical to the /goals card sentence', () => {
  const input = {
    name: 'Japan trip',
    targetCents: 600_000,
    savedCents: 0,
    monthlyContributionCents: 50_000,
    targetDate: isoDate('2027-06-10'),
    today,
  };
  const progress = goalProgress(input);

  it('detail IS goalPaceSentence; headline names the stored goal and the badge', () => {
    const a = answerGoalStatus({ ...input, progress });
    expect(a.kind).toBe('goal_status');
    expect(a.headline).toBe(`Japan trip — ${GOAL_PACE_LABEL['on-track']}.`);
    expect(a.detail).toBe(goalPaceSentence(progress, input));
    expect(a.detail).toContain("counting the $0.00 you've marked saved");
    expect(a.detail).toContain('right on your date');
    expect(a.facts).toEqual([
      { label: 'Marked saved', value: '$0.00 of $6,000.00' },
      { label: 'Funded', value: '0%' },
    ]);
    expect(a.source).toEqual({ label: 'See goals', href: '/goals' });
  });

  it('no-match and ambiguous answers carry no figures', () => {
    const none = answerGoalStatusNoMatch('italy');
    expect(none.facts).toEqual([]);
    expect(none.headline).toContain('italy');
    expect(none.detail).toMatch(/Open Goals/i);
    const amb = answerGoalStatusAmbiguous('trip', ['Japan trip', 'Italy trip']);
    expect(amb.facts).toEqual([]);
    expect(amb.detail).toContain('Japan trip');
    expect(amb.detail).toContain('Italy trip');
  });

  it('server matching: unique name → that row; trip across two names → ambiguous', () => {
    expect(matchGoalName('japan trip', ['Japan trip', 'Hawaii vacation'])).toEqual({
      kind: 'unique',
      name: 'Japan trip',
    });
    expect(matchGoalName('trip', ['Japan trip', 'Italy trip']).kind).toBe('ambiguous');
    expect(matchGoalName('italy', ['Japan trip']).kind).toBe('none');
  });
});
