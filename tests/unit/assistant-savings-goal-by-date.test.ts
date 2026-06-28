/**
 * Ask Aimplifi — savings_goal_by_date intent (inverse planning, DECISIONS #126).
 *
 * Locks the seams the feature adds end-to-end:
 *   1. parseTargetAmount — DETERMINISTIC dollar-amount extraction (the fabrication-sensitive
 *      surface: the amount is the user's own number, never the model's). Adversarially tested
 *      so a year can't become a dollar figure and a bare number is never silently assumed.
 *   2. routing — save/goal vocab + a date → savings_goal_by_date; "savings rate" not poached;
 *      a date with no amount still routes (so the answer can ASK), not a fabricated figure.
 *   3. the validator + LLM kind path (date AND amount re-derived deterministically).
 *   4. the formatter — honest copy per outcome, ask-for-amount, and the save action shape.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  parseTargetAmount,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { solveSavingsGoalByDate, type SavingsGoalByDateResult } from '@/lib/engine/solve/savings-goal-by-date';
import { answerSavingsGoalByDate, answerSavingsGoalNeedsAmount } from '@/lib/engine/assistant/answer';

const today = isoDate('2026-06-10');

describe('parseTargetAmount — deterministic dollar-amount extraction', () => {
  it('parses "$" amounts with grouping and decimals', () => {
    expect(parseTargetAmount('save $15,000 by december 2027')).toBe(1_500_000);
    expect(parseTargetAmount('save $1,500.50 by march')).toBe(150_050);
    expect(parseTargetAmount('save $500 by june')).toBe(50_000);
    expect(parseTargetAmount('$1,000,000 nest egg by 2050')).toBe(100_000_000);
  });

  it('parses magnitude suffixes (k / m / grand / million)', () => {
    expect(parseTargetAmount('save $20k by 2028')).toBe(2_000_000);
    expect(parseTargetAmount('reach $50k in savings by 2030')).toBe(5_000_000);
    expect(parseTargetAmount('1.5k by december')).toBe(150_000);
    expect(parseTargetAmount('save 2 million by 2050')).toBe(200_000_000);
    expect(parseTargetAmount('set aside 3 grand by march')).toBe(300_000);
  });

  it('parses "<n> dollars" and bare thousands-grouped numbers', () => {
    expect(parseTargetAmount('save 500 dollars by june')).toBe(50_000);
    expect(parseTargetAmount('set aside 50,000 for a down payment by 2028')).toBe(5_000_000);
  });

  it('NEVER reads a bare year (or any unmarked number) as a dollar amount', () => {
    // The load-bearing guard: "by 2028" must not become "$2,028" — no $, no suffix, no grouping.
    expect(parseTargetAmount('be debt free by 2028')).toBeNull();
    expect(parseTargetAmount('save money by december 2028')).toBeNull();
    expect(parseTargetAmount('save up by 2030')).toBeNull();
    expect(parseTargetAmount('reach my goal in 3 years')).toBeNull();
    // A bare unmarked number is NOT assumed to be dollars (ask, don't invent).
    expect(parseTargetAmount('save 15000 by 2028')).toBeNull();
  });

  it('an explicit "$" on a year-looking number is still that amount (user marked it)', () => {
    expect(parseTargetAmount('save $2,028 by december')).toBe(202_800);
  });
});

describe('routing — savings_goal_by_date vs siblings', () => {
  it('save + amount + date routes to savings_goal_by_date with the parsed amount', () => {
    const i = parseAssistantQuery('I want to save $15,000 by December 2027', today);
    expect(i.kind).toBe('savings_goal_by_date');
    expect(i).toMatchObject({ targetDate: '2027-12-31', targetCents: 1_500_000, label: 'December 2027' });
  });

  it('the demo example "Can I save $20,000 by December 2028?" parses amount + date', () => {
    expect(parseAssistantQuery('Can I save $20,000 by December 2028?', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetDate: '2028-12-31',
      targetCents: 2_000_000,
    });
  });

  it('a strong goal phrase + date but NO amount routes here with targetCents null (so it can ASK)', () => {
    const i = parseAssistantQuery('I want to save up for a house by December 2028', today);
    expect(i).toMatchObject({ kind: 'savings_goal_by_date', targetCents: null, targetDate: '2028-12-31' });
  });

  it('"emergency fund of $10,000 by 2028" routes (strong phrase + amount)', () => {
    expect(parseAssistantQuery('build an emergency fund of $10,000 by 2028', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: 1_000_000,
      targetDate: '2028-12-31',
    });
  });

  it('does NOT poach the forward savings_rate question', () => {
    expect(parseAssistantQuery("what's my savings rate?", today).kind).toBe('savings_rate');
    expect(parseAssistantQuery('how much of my income do I save?', today).kind).toBe('savings_rate');
  });

  it('"how much is in my savings?" stays account_balance (not a by-date goal)', () => {
    expect(parseAssistantQuery('how much is in my savings?', today).kind).toBe('account_balance');
  });

  it('a save question with NO date does not route to the planner', () => {
    // No deadline → nothing to solve for; falls through to other intents/unknown.
    expect(parseAssistantQuery('I want to save $15,000', today).kind).not.toBe('savings_goal_by_date');
    expect(parseAssistantQuery('save $500 a month', today).kind).not.toBe('savings_goal_by_date');
  });

  it('does not regress the debt_free_by_date sibling', () => {
    expect(parseAssistantQuery('can I be debt-free by December 2028?', today).kind).toBe('debt_free_by_date');
  });
});

describe('validator + LLM kind path', () => {
  it('validates a well-formed intent; a bad amount degrades to null; a bad date rejects', () => {
    expect(
      validateIntent({ kind: 'savings_goal_by_date', targetDate: '2028-12-31', targetCents: 2_000_000, label: 'December 2028' }),
    ).toEqual({ kind: 'savings_goal_by_date', targetDate: '2028-12-31', targetCents: 2_000_000, label: 'December 2028' });
    // negative/zero/NaN amount → null (ask), not a smuggled figure
    expect(
      validateIntent({ kind: 'savings_goal_by_date', targetDate: '2028-12-31', targetCents: -5, label: 'x' }),
    ).toMatchObject({ targetCents: null });
    // invalid date → whole intent rejected
    expect(validateIntent({ kind: 'savings_goal_by_date', targetDate: '2028-13-40', targetCents: 100, label: 'x' })).toBeNull();
  });

  it('intentFromKind re-derives BOTH the date and the amount; null date → null (no goal to plan)', () => {
    expect(intentFromKind('savings_goal_by_date', 'save $15,000 by december 2027', today)).toEqual({
      kind: 'savings_goal_by_date',
      targetDate: '2027-12-31',
      targetCents: 1_500_000,
      label: 'December 2027',
    });
    // model said by-date but there's no date → don't invent one
    expect(intentFromKind('savings_goal_by_date', 'help me save more', today)).toBeNull();
    // date but no amount → routes with null amount (the answer asks)
    expect(intentFromKind('savings_goal_by_date', 'save up by december 2028', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: null,
    });
  });
});

describe('answerSavingsGoalByDate — honest copy per outcome', () => {
  const base = { targetMonths: 12, goalAmountCents: 600_000, remainingCents: 600_000 };

  it('needs-amount: asks for the figure, offers no save action', () => {
    const a = answerSavingsGoalNeedsAmount('December 2028');
    expect(a.headline).toMatch(/how much do you want to have saved by December 2028/i);
    expect(a.action).toBeUndefined();
    expect(a.source).toEqual({ label: 'See goals', href: '/goals' });
  });

  it('already-funded: no action', () => {
    const r: SavingsGoalByDateResult = {
      ...base,
      outcome: 'already-funded',
      requiredMonthlyCents: 0,
      monthsToGoal: 0,
      shareOfSafeToSpendBps: 0,
      withinSafeToSpend: true,
      remainingCents: 0,
    };
    const a = answerSavingsGoalByDate(r, 'December 2028', '2028-12-31', '2026-06-10');
    expect(a.headline).toMatch(/already set aside .* funded/i);
    expect(a.action).toBeUndefined();
  });

  it('unreachable too-soon vs past read differently, no action', () => {
    const soon: SavingsGoalByDateResult = {
      ...base, outcome: 'unreachable', targetMonths: 0,
      requiredMonthlyCents: null, monthsToGoal: null, shareOfSafeToSpendBps: null, withinSafeToSpend: null,
    };
    expect(answerSavingsGoalByDate(soon, 'June 2026', '2026-06-30', '2026-06-10').headline).toMatch(/too soon/i);
    const past: SavingsGoalByDateResult = { ...soon };
    const a = answerSavingsGoalByDate(past, 'the end of 2020', '2020-12-31', '2026-06-10');
    expect(a.headline).toMatch(/already behind us/i);
    expect(a.headline).not.toMatch(/too soon/i);
    expect(a.action).toBeUndefined();
  });

  it('reachable within budget: states the figure, the share, and the save action', () => {
    const r: SavingsGoalByDateResult = {
      ...base, outcome: 'reachable',
      requiredMonthlyCents: 50_000, monthsToGoal: 12, shareOfSafeToSpendBps: 2_500, withinSafeToSpend: true,
    };
    const a = answerSavingsGoalByDate(r, 'June 2027', '2027-06-30', '2026-06-10');
    expect(a.headline).toMatch(/save \$6,000\.00 by June 2027/);
    expect(a.headline).toMatch(/\$500\.00\/mo/);
    expect(a.headline).toMatch(/25% of your safe-to-spend/);
    expect(a.facts).toContainEqual({ label: 'Share of safe-to-spend', value: '25%' });
    expect(a.action).toEqual({ kind: 'save_savings_goal', targetDate: '2027-06-30', label: 'June 2027', goalAmountCents: 600_000 });
  });

  it('reachable over budget: honest "beyond a single month", exactly one share clause', () => {
    const r: SavingsGoalByDateResult = {
      ...base, goalAmountCents: 1_200_000, remainingCents: 1_200_000, targetMonths: 2, outcome: 'reachable',
      requiredMonthlyCents: 600_000, monthsToGoal: 2, shareOfSafeToSpendBps: 120_000, withinSafeToSpend: false,
    };
    const a = answerSavingsGoalByDate(r, 'August 2026', '2026-08-31', '2026-06-10');
    expect(a.headline).toMatch(/\$6,000\.00\/mo/);
    expect(a.headline).toMatch(/1200% of your safe-to-spend/);
    expect(a.headline).toMatch(/beyond a single month/i);
    expect((a.headline.match(/safe-to-spend/g) ?? []).length).toBe(1);
    expect(a.action?.kind).toBe('save_savings_goal');
  });

  it('overspent (share null): honest "budget you don\'t have yet", no %, still savable', () => {
    const r: SavingsGoalByDateResult = {
      ...base, outcome: 'reachable',
      requiredMonthlyCents: 50_000, monthsToGoal: 12, shareOfSafeToSpendBps: null, withinSafeToSpend: null,
    };
    const a = answerSavingsGoalByDate(r, 'June 2027', '2027-06-30', '2026-06-10');
    expect(a.headline).toMatch(/\$500\.00\/mo/);
    expect(a.headline).toMatch(/budget you don't have yet/i);
    expect(a.headline).not.toMatch(/%/);
    expect(a.facts.some((f) => f.label === 'Share of safe-to-spend')).toBe(false);
    expect(a.action?.kind).toBe('save_savings_goal');
  });

  it('every reachable answer states the no-growth assumption (guardrail: assumptions inline)', () => {
    const r: SavingsGoalByDateResult = {
      ...base, outcome: 'reachable',
      requiredMonthlyCents: 50_000, monthsToGoal: 12, shareOfSafeToSpendBps: 2_500, withinSafeToSpend: true,
    };
    const a = answerSavingsGoalByDate(r, 'June 2027', '2027-06-30', '2026-06-10');
    expect(`${a.detail}`).toMatch(/no investment growth/i);
    expect(`${a.detail}`).toMatch(/illustration, not advice/i);
  });
});

describe('share rounding (non-divisible) — engine + formatter', () => {
  it('rounds the bps share and the displayed percent', () => {
    // $6,000 over 12 months → $500/mo; against $3,750/mo safe-to-spend → 1333 bps → "13%".
    const r = solveSavingsGoalByDate({
      goalAmountCents: 600_000,
      currentSavingsCents: 0,
      targetDate: isoDate('2027-06-10'),
      today,
      safeToSpendCents: 375_000,
    });
    expect(r.requiredMonthlyCents).toBe(50_000);
    expect(r.shareOfSafeToSpendBps).toBe(1_333); // round(50000/375000*10000) = round(1333.33)
    const a = answerSavingsGoalByDate(r, 'June 2027', '2027-06-30', '2026-06-10');
    expect(a.headline).toMatch(/13% of your safe-to-spend/);
  });
});

describe('hostile-critic #126 regression locks', () => {
  it('P0: an ungrouped 4+ digit "$" amount is NOT truncated to its first 3 digits', () => {
    // The most natural way users type a target. "$20000" must be $20,000, not $200 (100x wrong,
    // a number the user never stated, durably persisted on Save).
    expect(parseTargetAmount('save $20000 by december 2028')).toBe(2_000_000);
    expect(parseTargetAmount('$50000')).toBe(5_000_000);
    expect(parseTargetAmount('save $5000 by 2028')).toBe(500_000);
    expect(parseTargetAmount('$1234')).toBe(123_400);
    expect(parseTargetAmount('$2000000 by 2050')).toBe(200_000_000);
    // and the grouped / suffix / ≤3-digit forms still parse correctly
    expect(parseTargetAmount('$20,000')).toBe(2_000_000);
    expect(parseTargetAmount('$20k')).toBe(2_000_000);
    expect(parseTargetAmount('$500')).toBe(50_000);
    // the corrupted figure also can't reach the intent
    expect(parseAssistantQuery('save $20000 by december 2028', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: 2_000_000,
    });
  });

  it('P1: "have $X saved by <date>" — the canonical phrasing — routes (past participle "saved")', () => {
    expect(parseAssistantQuery('I want to have $20,000 saved by 2028', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: 2_000_000,
      targetDate: '2028-12-31',
    });
    expect(parseAssistantQuery('have $20000 saved by december 2028', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: 2_000_000,
    });
  });

  it('P2: a PAST/STATUS review is not flipped into a "how much?" ask', () => {
    expect(parseAssistantQuery('did I reach my savings goal in March', today).kind).not.toBe('savings_goal_by_date');
    expect(parseAssistantQuery('how much have I saved toward my down payment as of December', today).kind).not.toBe(
      'savings_goal_by_date',
    );
  });

  it('P2: a per-period RATE is not misread as a lump-sum target (and yields to affordability)', () => {
    const i = parseAssistantQuery('can I afford to set aside $500 a month until December', today);
    expect(i.kind).not.toBe('savings_goal_by_date'); // the $500/mo rate is not a $500 goal
    expect(i.kind).toBe('safe_to_spend'); // "can I afford" → the affordability answer
  });

  it('P2: a comma-grouped NON-money quantity is not read as dollars', () => {
    expect(parseTargetAmount('will I hit 10,000 steps by december')).toBeNull();
    expect(parseAssistantQuery('will I hit 10,000 steps by december', today).kind).not.toBe('savings_goal_by_date');
    // but a real grouped dollar goal still parses
    expect(parseTargetAmount('set aside 50,000 for a house by 2028')).toBe(5_000_000);
  });

  // Confirmation-critic round: the P2a/P2b guards must NOT over-block legitimate forward goals.
  it('confirm: "how much per month to save $X by <date>" — the canonical inverse ask — routes (rate is the SOLVED-FOR unit, not the amount)', () => {
    expect(parseAssistantQuery('how much should I save each month to have $20,000 by December 2027', today)).toMatchObject({
      kind: 'savings_goal_by_date',
      targetCents: 2_000_000,
      targetDate: '2027-12-31',
    });
    expect(parseAssistantQuery('how much per month to save $20,000 by 2027', today).kind).toBe('savings_goal_by_date');
  });

  it('confirm: an amount-bearing forward goal with an inverted "have I" / a cadence word still routes', () => {
    expect(parseAssistantQuery('have I got enough saved to reach $20,000 by 2028', today).kind).toBe('savings_goal_by_date');
    expect(parseAssistantQuery('save $20,000 by 2028, putting away money biweekly', today).kind).toBe('savings_goal_by_date');
  });

  it('confirm: the adjacent-rate case still yields (so the precise guard did not regress P2b)', () => {
    expect(parseAssistantQuery('can I afford to set aside $500 a month until December', today).kind).toBe('safe_to_spend');
    expect(parseAssistantQuery('I will save $500/mo until December', today).kind).not.toBe('savings_goal_by_date');
  });
});
