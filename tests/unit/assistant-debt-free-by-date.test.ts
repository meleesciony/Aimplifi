/**
 * Ask Aimplifi — debt_free_by_date intent (inverse planning, DECISIONS #125).
 *
 * Locks the four seams the feature adds end-to-end:
 *   1. parseTargetDate — deterministic date extraction (zero-key, no Date object).
 *   2. routing — "by <date>" → debt_free_by_date; no date → forward debt_payoff (no regression).
 *   3. the validator + LLM kind path (the date is re-derived deterministically).
 *   4. the formatter — honest copy per outcome, and the save-as-goal action only when actionable.
 * Plus a seed-grounding block proving the solver reconciles with planDebtPayoff on the REAL demo debts.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { roundHalfAwayFromZero } from '@/lib/money';
import { buildSeedData } from '@/lib/seed/build';
import { type DebtInput, planDebtPayoff } from '@/lib/engine/debt/payoff';
import { solveDebtFreeByDate, type DebtFreeByDateResult } from '@/lib/engine/solve/debt-free-by-date';
import { parseAssistantQuery, parseTargetDate, validateIntent } from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerDebtFreeByDate } from '@/lib/engine/assistant/answer';

const today = isoDate('2026-06-10');

describe('parseTargetDate — deterministic date extraction', () => {
  it('"by December 2027" → end of that month with a full-month label', () => {
    expect(parseTargetDate('be debt-free by december 2027', today)).toEqual({
      date: '2027-12-31',
      label: 'December 2027',
    });
  });

  it('"in 3 years" → the end of the landing month (consistent with the by-<month> rule)', () => {
    expect(parseTargetDate('be debt-free in 3 years', today)).toEqual({ date: '2029-06-30', label: 'June 2029' });
  });

  it('"in 18 months" / "by the end of 2028" / "by next month" resolve to month/year end', () => {
    expect(parseTargetDate('debt-free in 18 months', today)).toEqual({ date: '2027-12-31', label: 'December 2027' });
    expect(parseTargetDate('clear my debt by the end of 2028', today)).toEqual({ date: '2028-12-31', label: 'the end of 2028' });
    expect(parseTargetDate('debt-free by next month', today)).toEqual({ date: '2026-07-31', label: 'July 2026' });
  });

  it('PARSE-1 regression: a month mentioned in passing does NOT hijack a "by <year>" deadline', () => {
    // "in march" describes when the loan started; "by 2028" is the deadline → end of 2028, not March.
    expect(parseTargetDate('i started my loan in march, can i be debt free by 2028?', today)).toEqual({
      date: '2028-12-31',
      label: 'the end of 2028',
    });
    expect(parseTargetDate('pay off my march loan by 2030', today)).toEqual({ date: '2030-12-31', label: 'the end of 2030' });
  });

  it('PARSE-1 regression (year in passing): a START year "in <year>" does NOT hijack the real deadline', () => {
    // "in 2020" is when the loan started; the deadline is "by December 2027" (a month+year).
    expect(parseTargetDate('i started my loan in 2020, can i be debt free by december 2027?', today)).toEqual({
      date: '2027-12-31',
      label: 'December 2027',
    });
    // "in 2019" start year; "by 2028" is the real (bare-year) deadline.
    expect(parseTargetDate('took the loan in 2019, want to be debt free by 2028', today)).toEqual({
      date: '2028-12-31',
      label: 'the end of 2028',
    });
  });

  it('"by 2028" (bare year with a cue) → end of that year', () => {
    expect(parseTargetDate('pay off my loan by 2028', today)).toEqual({ date: '2028-12-31', label: 'the end of 2028' });
  });

  it('"by next year" → end of next year', () => {
    expect(parseTargetDate('debt-free by next year', today)).toEqual({ date: '2027-12-31', label: 'the end of 2027' });
  });

  it('a month with no year resolves to its next future occurrence', () => {
    // From Jun 10 2026: "by March" → March 2027 (already past this year); "by Dec" → this Dec.
    expect(parseTargetDate('debt-free by march', today)?.date).toBe('2027-03-31');
    expect(parseTargetDate('debt-free by december', today)?.date).toBe('2026-12-31');
  });

  it('returns null when no date is stated', () => {
    expect(parseTargetDate('when will I be debt-free', today)).toBeNull();
    expect(parseTargetDate('pay off my debt', today)).toBeNull();
  });
});

describe('routing — debt_free_by_date vs the forward debt_payoff', () => {
  it('a debt-free question WITH a date routes to debt_free_by_date', () => {
    const i = parseAssistantQuery('Can I be debt-free by December 2027?', today);
    expect(i.kind).toBe('debt_free_by_date');
    expect(i).toMatchObject({ targetDate: '2027-12-31', label: 'December 2027' });
  });

  it('"in 2 years" debt-free routes with the offset date (end of that month)', () => {
    const i = parseAssistantQuery('can I be debt free in 2 years', today);
    expect(i).toMatchObject({ kind: 'debt_free_by_date', targetDate: '2028-06-30' });
  });

  it('"pay off my loan by 2028" routes to debt_free_by_date', () => {
    expect(parseAssistantQuery('pay off my loan by 2028', today).kind).toBe('debt_free_by_date');
  });

  it('a debt question WITHOUT a date stays the forward debt_payoff (no regression)', () => {
    expect(parseAssistantQuery('when will I be debt-free?', today).kind).toBe('debt_payoff');
    expect(parseAssistantQuery('pay off my debt', today).kind).toBe('debt_payoff');
    expect(parseAssistantQuery('snowball vs avalanche', today).kind).toBe('debt_payoff');
  });

  it('a credit-card payment question (no date) still stays cash_needed', () => {
    expect(parseAssistantQuery('how much to pay off my credit card?', today).kind).toBe('cash_needed');
  });

  it('PARSE-1 regression at the routing layer: stray month + "by <year>" uses the year deadline', () => {
    const i = parseAssistantQuery('i started my loan in march, can i be debt free by 2028?', today);
    expect(i).toMatchObject({ kind: 'debt_free_by_date', targetDate: '2028-12-31' });
  });

  it('ROUTE-2: "done with my debt by <year>" routes to debt_free_by_date', () => {
    expect(parseAssistantQuery('i want to be done with my debt by 2028', today).kind).toBe('debt_free_by_date');
  });

  it('ROUTE-1 (accepted convention): a credit-card question stays cash_needed even WITH a date (DECISIONS #98)', () => {
    // A bare "credit card" question is a this-cycle /cards question by convention; a long-horizon
    // date does not pull it into the inverse planner. Pinned so the boundary is intentional.
    expect(parseAssistantQuery('pay off my credit card by december 2027', today).kind).toBe('cash_needed');
  });
});

describe('share rounding (non-divisible) — engine + formatter', () => {
  it('rounds the bps share and the displayed percent', () => {
    // $1,200 @ 0% over 12 months needs $100/mo; against $750/mo safe-to-spend → 1333 bps → "13%".
    const r = solveDebtFreeByDate({
      debts: [{ id: 'c', name: 'Card', balanceCents: 120_000, aprBps: 0, minimumPaymentCents: 0 }],
      strategy: 'avalanche',
      targetDate: isoDate('2027-06-10'),
      today,
      safeToSpendCents: 75_000,
    });
    expect(r.requiredExtraMonthlyCents).toBe(10_000);
    expect(r.shareOfSafeToSpendBps).toBe(1_333); // round(10000/75000*10000)=round(1333.33)
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-10', '2026-06-10', 0);
    expect(a.headline).toMatch(/13% of your guilt-free spending/);
    expect(a.facts).toContainEqual({ label: 'Share of guilt-free spending', value: '13%' });
  });
});

describe('validator + LLM kind path', () => {
  it('validates a well-formed intent and rejects a bad/absent date', () => {
    expect(validateIntent({ kind: 'debt_free_by_date', targetDate: '2027-12-31', label: 'December 2027' })).toEqual({
      kind: 'debt_free_by_date',
      targetDate: '2027-12-31',
      label: 'December 2027',
    });
    expect(validateIntent({ kind: 'debt_free_by_date', targetDate: '2027-13-40', label: 'bad' })).toBeNull();
    expect(validateIntent({ kind: 'debt_free_by_date', targetDate: '2027-12-31' })).toBeNull();
  });

  it('intentFromKind re-derives the date from the question; falls back to debt_payoff with no date', () => {
    expect(intentFromKind('debt_free_by_date', 'be debt-free by december 2027', today)).toEqual({
      kind: 'debt_free_by_date',
      targetDate: '2027-12-31',
      label: 'December 2027',
    });
    // The model said "by-date" but the text has no date → don't invent one; use the forward answer.
    expect(intentFromKind('debt_free_by_date', 'help me become debt free', today)).toEqual({ kind: 'debt_payoff' });
  });
});

describe('answerDebtFreeByDate — honest copy per outcome', () => {
  const base = { targetMonths: 18, totalBalanceCents: 120_000 };

  it('already-debt-free: no action offered', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      outcome: 'already-debt-free',
      requiredExtraMonthlyCents: 0,
      monthsToDebtFree: 0,
      shareOfSafeToSpendBps: 0,
      withinSafeToSpend: true,
      totalBalanceCents: 0,
    };
    const a = answerDebtFreeByDate(r, 'December 2027', '2027-12-31', '2026-06-10', 0);
    expect(a.headline).toMatch(/already debt-free/i);
    expect(a.action).toBeUndefined();
  });

  it('unreachable: honest "too soon", no action, shows the balance', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      outcome: 'unreachable',
      targetMonths: 0,
      requiredExtraMonthlyCents: null,
      monthsToDebtFree: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      totalBalanceCents: 500_000,
    };
    const a = answerDebtFreeByDate(r, 'June 2026', '2026-06-30', '2026-06-10', 0);
    expect(a.headline).toMatch(/too soon/i);
    expect(a.action).toBeUndefined();
    expect(a.facts).toContainEqual({ label: 'Total debt', value: '$5,000.00' });
  });

  it('on-track: "no extra needed", offers the save action, dates the payoff', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      outcome: 'on-track',
      requiredExtraMonthlyCents: 0,
      monthsToDebtFree: 6,
      shareOfSafeToSpendBps: 0,
      withinSafeToSpend: true,
    };
    const a = answerDebtFreeByDate(r, 'December 2027', '2027-12-31', '2026-06-10', 0);
    expect(a.headline).toMatch(/on track/i);
    expect(a.headline).toMatch(/no extra/i);
    expect(a.action).toEqual({ kind: 'save_debt_free_goal', targetDate: '2027-12-31', label: 'December 2027' });
    expect(a.facts).toContainEqual({ label: 'Debt-free by', value: 'Dec 2026' }); // addMonths(2026-06-10, 6)
  });

  it('reachable within budget: states the figure, the share, and the save action', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      targetMonths: 12,
      outcome: 'reachable',
      requiredExtraMonthlyCents: 10_000,
      monthsToDebtFree: 12,
      shareOfSafeToSpendBps: 1_000,
      withinSafeToSpend: true,
    };
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-30', '2026-06-10', 0);
    expect(a.headline).toMatch(/add about \$100\.00\/mo/);
    expect(a.headline).toMatch(/10% of your guilt-free spending/);
    expect(a.facts).toContainEqual({ label: 'Share of guilt-free spending', value: '10%' });
    expect(a.action?.kind).toBe('save_debt_free_goal');
  });

  it('reachable over budget: honest "more than your whole guilt-free spending", not a fake yes', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      targetMonths: 3,
      outcome: 'reachable',
      requiredExtraMonthlyCents: 400_000,
      monthsToDebtFree: 3,
      shareOfSafeToSpendBps: 40_000,
      withinSafeToSpend: false,
      totalBalanceCents: 1_200_000,
    };
    const a = answerDebtFreeByDate(r, 'September 2026', '2026-09-30', '2026-06-10', 0);
    expect(a.headline).toMatch(/\$4,000\.00\/mo/);
    expect(a.headline).toMatch(/400% of your guilt-free spending/);
    expect(a.headline).toMatch(/beyond a single month/i);
    // exactly ONE share clause (no doubled "— about X% — more than your whole" stacking)
    expect((a.headline.match(/guilt-free spending/g) ?? []).length).toBe(1);
  });

  it('overspent (share null, within null): honest "budget you don\'t have yet", NOT a fake yes (UX-1)', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      targetMonths: 12,
      outcome: 'reachable',
      requiredExtraMonthlyCents: 10_000,
      monthsToDebtFree: 12,
      shareOfSafeToSpendBps: null, // safe-to-spend ≤ 0
      withinSafeToSpend: null,
    };
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-30', '2026-06-10', 0);
    expect(a.headline).toMatch(/\$100\.00\/mo/);
    expect(a.headline).toMatch(/over your monthly plan|budget you don't have yet/i);
    expect(a.headline).not.toMatch(/%/); // no share %, no fake-affordable framing
    expect(a.facts.some((f) => f.label === 'Share of guilt-free spending')).toBe(false);
    expect(a.action?.kind).toBe('save_debt_free_goal'); // still savable
  });

  it('unreachable past date reads "already behind us", not "too soon" (UX-5)', () => {
    const r: DebtFreeByDateResult = {
      ...base,
      outcome: 'unreachable',
      targetMonths: 0,
      requiredExtraMonthlyCents: null,
      monthsToDebtFree: null,
      shareOfSafeToSpendBps: null,
      withinSafeToSpend: null,
      totalBalanceCents: 500_000,
    };
    const a = answerDebtFreeByDate(r, 'the end of 2020', '2020-12-31', '2026-06-10', 0);
    expect(a.headline).toMatch(/already behind us/i);
    expect(a.headline).not.toMatch(/too soon/i);
  });
});

describe('seed grounding — solver reconciles with planDebtPayoff on the REAL demo debts', () => {
  const seed = buildSeedData('2026-06-10');
  // Build the demo DebtInput[] exactly as loadDebtAccounts does (CREDIT/LOAN, balance > 0,
  // card minimum = max($35, 1% of balance) when none is stored). Kept in lockstep here so
  // the grounding asserts against the same inputs the server feeds the engine.
  const demoDebts: DebtInput[] = seed.accounts
    .filter((a) => (a.type === 'CREDIT' || a.type === 'LOAN') && a.currentBalanceCents > 0)
    .map((a) => {
      const stored = (a as { minimumPaymentCents?: number | null }).minimumPaymentCents;
      const aprBps = (a as { aprBps?: number }).aprBps ?? 0;
      const minimumPaymentCents =
        stored != null && stored > 0
          ? stored
          : a.type === 'CREDIT'
            ? Math.max(3500, roundHalfAwayFromZero(a.currentBalanceCents / 100))
            : 0;
      return { id: a.id, name: a.name, balanceCents: a.currentBalanceCents, aprBps, minimumPaymentCents };
    });

  it('the demo actually has debts to plan', () => {
    expect(demoDebts.length).toBeGreaterThan(0);
  });

  it('a far target solves, and the required extra is the true minimum (independent planDebtPayoff)', () => {
    const r = solveDebtFreeByDate({
      debts: demoDebts,
      strategy: 'avalanche',
      targetDate: isoDate('2031-12-31'),
      today,
      safeToSpendCents: 500_000,
    });
    expect(r.outcome === 'reachable' || r.outcome === 'on-track').toBe(true);
    const required = r.requiredExtraMonthlyCents as number;
    const months = planDebtPayoff({ debts: demoDebts, strategy: 'avalanche', extraMonthlyCents: required }).monthsToDebtFree;
    expect(months).not.toBeNull();
    expect(months as number).toBeLessThanOrEqual(r.targetMonths);
    if (required > 0) {
      const below = planDebtPayoff({ debts: demoDebts, strategy: 'avalanche', extraMonthlyCents: required - 1 }).monthsToDebtFree;
      expect(below === null || (below as number) > r.targetMonths).toBe(true);
    }
  });

  it('a target sooner than one cycle is honestly unreachable', () => {
    const r = solveDebtFreeByDate({
      debts: demoDebts,
      strategy: 'avalanche',
      targetDate: isoDate('2026-06-30'),
      today,
      safeToSpendCents: 500_000,
    });
    expect(r.outcome).toBe('unreachable');
    expect(r.requiredExtraMonthlyCents).toBeNull();
  });
});
